-- =====================================================================
-- PMO Proyectos DGJ – Aprobación del anteproyecto por puesto
-- Ejecutar después de 006_avance_obra.sql. Se puede volver a ejecutar.
--
-- Etapa "3. Aprobación comercial":
--   • Industrial              → la aprueba el KAM
--   • Comercial y Residencial → la aprueba el Supervisor de ventas
-- El puesto se asigna a cada usuario en Administración → Usuarios.
-- Al aprobar queda registrado "Anteproyecto aprobado por: Nombre (Puesto)".
-- =====================================================================

-- 1. Puesto del usuario
alter table public.perfiles add column if not exists puesto text;
alter table public.perfiles drop constraint if exists perfiles_puesto_check;
alter table public.perfiles add constraint perfiles_puesto_check
  check (puesto in ('KAM', 'Supervisor de ventas'));

-- 2. Quién aprobó el anteproyecto
alter table public.proyectos add column if not exists aprobado_por    uuid references public.perfiles (id);
alter table public.proyectos add column if not exists aprobado_puesto text;
alter table public.proyectos add column if not exists aprobado_en     timestamptz;

-- 3. Reglas
create or replace function public.aprobador_anteproyecto(p_segmento text)
returns text language sql immutable as $$
  select case when p_segmento = 'Industrial' then 'KAM' else 'Supervisor de ventas' end
$$;

create or replace function public.puede_aprobar_anteproyecto(p_segmento text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfiles
     where id = auth.uid() and activo
       and rol not in ('Sin rol', 'Consulta')
       and puesto = public.aprobador_anteproyecto(p_segmento))
$$;

-- 4. Trigger de cambios de etapa (igual que 005, con la regla de aprobación por puesto)
create or replace function public.proyectos_antes_actualizar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rol text := public.mi_rol();
  n_old int  := split_part(old.etapa, '.', 1)::int;
  n_new int  := split_part(new.etapa, '.', 1)::int;
  v_ok  boolean;
  v_com text := nullif(trim(coalesce(new.comentario_cambio, '')), '');
  v_aprob   boolean := public.puede_aprobar_anteproyecto(old.segmento);  -- KAM o Supervisor de ventas según segmento
  v_firma   text;
begin
  -- Datos de aprobación: solo los escribe este trigger
  new.aprobado_por    := old.aprobado_por;
  new.aprobado_puesto := old.aprobado_puesto;
  new.aprobado_en     := old.aprobado_en;
  -- Campos que no se pueden cambiar (el folio depende de ellos)
  new.folio          := old.folio;
  new.solicitante_id := old.solicitante_id;
  new.created_at     := old.created_at;
  if v_rol is distinct from 'Administrador' then
    new.municipio    := old.municipio;
    new.segmento     := old.segmento;
    new.material     := old.material;
    new.factibilidad := old.factibilidad;   -- lo maneja el propio trigger
  end if;
  -- El PEP lo captura el proyectista (que gestiona con Inversiones) o el Administrador
  if v_rol not in ('Proyectista', 'Administrador') then
    new.elemento_pep := old.elemento_pep;
    new.fecha_pep    := old.fecha_pep;
  end if;
  -- El tiempo estimado de construcción: supervisores (Construcción), Líder o Administrador
  if v_rol not in ('Construcción', 'Líder', 'Administrador') then
    new.const_semanas := old.const_semanas;  new.const_metodo := old.const_metodo;
    new.const_detalle := old.const_detalle;  new.const_nota   := old.const_nota;
  end if;
  if new.const_semanas is null then
    new.const_metodo := null; new.const_detalle := null; new.const_nota := null;
  end if;
  new.elemento_pep := nullif(trim(coalesce(new.elemento_pep, '')), '');
  new.updated_at := now();

  if new.etapa is distinct from old.etapa then
    v_ok := v_rol is null or v_rol = 'Administrador'
      -- avances (a la etapa siguiente)
      or (n_new = n_old + 1 and (
             (n_old = 0              and v_rol = 'Comercial')
          or (n_old = 1              and v_rol = 'Líder')
          or (n_old = 2              and v_rol = 'Proyectista')
          or (n_old = 3              and v_aprob)
          or (n_old in (4,5,6,7,10)  and v_rol = 'Proyectista')
          or (n_old = 8              and v_rol = 'Permisos')
          or (n_old = 9              and v_rol in ('Permisos', 'Líder'))
          or (n_old in (11,12,13)    and v_rol = 'Construcción')))
      -- regresos y cancelación
      or (n_old = 1  and n_new = 0  and v_rol = 'Líder')
      or (n_old = 3  and n_new = 2  and v_aprob)
      or (n_old = 3  and n_new = 99 and v_aprob)
      or (n_old = 7  and n_new = 6  and v_rol = 'Proyectista')
      or (n_old = 11 and n_new = 10 and v_rol = 'Construcción');
    if not v_ok and n_old = 3 then
      raise exception 'El anteproyecto de un proyecto % lo aprueba el %. Pide al administrador que te asigne ese puesto.',
        old.segmento, public.aprobador_anteproyecto(old.segmento);
    end if;
    if not v_ok then
      raise exception 'Tu rol (%) no puede mover el proyecto de "%" a "%"',
        coalesce(v_rol, '?'), old.etapa, new.etapa;
    end if;
    if n_new < n_old and v_com is null then
      raise exception 'Escribe el motivo para regresar el proyecto a "%"', new.etapa;
    end if;
    if n_new = 99 and v_com is null then
      raise exception 'Para cancelar el proyecto escribe el motivo';
    end if;
    if n_new between 2 and 14 and new.proyectista_id is null then
      raise exception 'Asigna un proyectista antes de pasar a %', new.etapa;
    end if;
    if n_new between 5 and 14 and n_old < 5 and new.elemento_pep is null
       and coalesce(v_rol, 'Administrador') <> 'Administrador' then
      raise exception 'Falta el Elemento PEP (lo registra el proyectista) para continuar';
    end if;

    new.factibilidad := case when n_new = 2 then 'En elaboración'
                             when n_new = 3 then 'En revisión'
                             when n_new = 99 and n_old = 3 then 'Rechazada'
                             when n_old = 3 and n_new = 4 then 'Aprobada'
                             else new.factibilidad end;

    -- Firma de quien aprueba: "Nombre (Puesto)"
    if n_old = 3 then
      select coalesce(p.nombre, p.email) || ' (' || coalesce(p.puesto, p.rol) || ')'
        into v_firma from public.perfiles p where p.id = auth.uid();
      v_firma := coalesce(v_firma, 'Administrador');
    end if;
    if n_old = 3 and n_new = 4 then
      new.aprobado_por    := auth.uid();
      new.aprobado_puesto := (select coalesce(puesto, rol) from public.perfiles where id = auth.uid());
      new.aprobado_en     := now();
    elsif n_new <= 3 then
      new.aprobado_por := null; new.aprobado_puesto := null; new.aprobado_en := null;
    end if;

    insert into public.historial (proyecto_id, accion, etapa_anterior, etapa_nueva, comentario)
    values (new.id,
            case when n_new = 0 then 'Devuelto a Comercial'
                 when n_new = 99 and n_old = 3 then 'Anteproyecto no aprobado por: ' || v_firma || ' – Cancelado'
                 when n_new = 99 then 'Cancelado'
                 when n_old = 3 and n_new = 4 then 'Anteproyecto aprobado por: ' || v_firma
                 when n_old = 3 and n_new = 2 then 'Cambios al anteproyecto solicitados por: ' || v_firma
                 when n_old = 7 and n_new = 6 then 'DRO con correcciones'
                 when n_old = 11 and n_new = 10 then 'Carpeta técnica regresada a Proyectos'
                 when n_new < n_old then 'Regresado de etapa'
                 else 'Avance de etapa' end,
            old.etapa, new.etapa, v_com);
    v_com := null;
  end if;

  if v_com is not null then
    insert into public.historial (proyecto_id, accion, comentario)
    values (new.id, 'Comentario', v_com);
  end if;

  if new.proyectista_id is distinct from old.proyectista_id and new.proyectista_id is not null then
    insert into public.historial (proyecto_id, accion, comentario)
    select new.id, 'Proyectista asignado', coalesce(p.nombre, p.email)
      from public.perfiles p where p.id = new.proyectista_id;
  end if;

  if new.elemento_pep is distinct from old.elemento_pep and new.elemento_pep is not null then
    insert into public.historial (proyecto_id, accion, comentario)
    values (new.id, 'Elemento PEP registrado', new.elemento_pep);
  end if;

  if new.const_semanas is distinct from old.const_semanas
     or new.const_detalle is distinct from old.const_detalle
     or new.const_nota is distinct from old.const_nota then
    insert into public.historial (proyecto_id, accion, comentario)
    values (new.id,
            case when new.const_semanas is null then 'Estimación de construcción eliminada (se usa el tiempo estándar)'
                 else 'Tiempo de construcción estimado' end,
            case when new.const_semanas is null then null
                 else new.const_semanas || ' semanas (' || coalesce(new.const_metodo, '—') || ')'
                      || coalesce(' · ' || new.const_nota, '') end);
  end if;

  new.comentario_cambio := null;
  return new;
end $$;

drop trigger if exists proyectos_bu on public.proyectos;
create trigger proyectos_bu before update on public.proyectos
  for each row execute function public.proyectos_antes_actualizar();

-- 5. Quién puede modificar proyectos: el aprobador ve y mueve los que esperan su aprobación
drop policy if exists proyectos_update on public.proyectos;
create policy proyectos_update on public.proyectos for update to authenticated
  using (
       public.mi_rol() in ('Administrador', 'Líder', 'Permisos', 'Construcción')
    or (public.mi_rol() = 'Proyectista' and proyectista_id = auth.uid())
    or (public.mi_rol() = 'Comercial' and solicitante_id = auth.uid() and etapa like '0.%')
    or (etapa like '3.%' and public.puede_aprobar_anteproyecto(segmento))
  )
  with check (coalesce(public.mi_rol(), 'Sin rol') not in ('Sin rol', 'Consulta'));

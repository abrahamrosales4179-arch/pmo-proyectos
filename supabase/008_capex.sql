-- =====================================================================
-- PMO Proyectos DGJ – CAPEX del Elemento PEP
-- Ejecutar después de 007_aprobacion_anteproyecto.sql. Se puede volver a ejecutar.
--
-- El proyectista captura el CAPEX (MXN) junto con el Elemento PEP.
-- La pestaña CAPEX lo reparte en el tiempo según el Gantt (etapa de
-- Construcción) y según el avance de obra reportado.
-- =====================================================================

alter table public.proyectos add column if not exists capex numeric(14,2);
alter table public.proyectos drop constraint if exists proyectos_capex_check;
alter table public.proyectos add constraint proyectos_capex_check check (capex is null or capex >= 0);

-- Trigger de cambios (igual que 007, protege y registra el CAPEX)
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
    new.capex        := old.capex;
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

  if new.capex is distinct from old.capex and new.capex is not null then
    insert into public.historial (proyecto_id, accion, comentario)
    values (new.id, case when old.capex is null then 'CAPEX registrado' else 'CAPEX actualizado' end,
            to_char(new.capex, 'FM$999,999,999,990.00') || ' MXN'
            || coalesce(' (antes ' || to_char(old.capex, 'FM$999,999,999,990.00') || ')', ''));
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

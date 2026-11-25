-- =====================================================================
-- PMO Proyectos DGJ – PEP por proyectista + tiempo estimado de construcción
-- Ejecutar UNA vez en Supabase → SQL Editor → New query → Run
-- (después de 003_flujograma.sql). Se puede volver a ejecutar sin perder datos.
--
--   • El Elemento PEP lo registra el proyectista asignado (gestiona con
--     Inversiones) o el Administrador. Ya no se usa el rol Inversiones.
--   • Los supervisores (rol Construcción), el Líder o el Administrador
--     capturan el tiempo estimado de construcción de cada proyecto:
--     manual en semanas, o calculado por tramos (material, diámetro y
--     longitud) con los rendimientos de config_rendimientos.
--     Ese tiempo sustituye al estándar del segmento en el Gantt.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Campos de la estimación de construcción
-- ---------------------------------------------------------------------
alter table public.proyectos add column if not exists const_semanas numeric(5,1) check (const_semanas >= 0);
alter table public.proyectos add column if not exists const_metodo  text check (const_metodo in ('Cálculo','Manual'));
alter table public.proyectos add column if not exists const_detalle jsonb;   -- tramos, cuadrillas, días extra, días por semana
alter table public.proyectos add column if not exists const_nota    text;

-- ---------------------------------------------------------------------
-- 2. Rendimientos de instalación (metros por día por cuadrilla)
--    Valores DE EJEMPLO: valídalos con los supervisores en Administración.
-- ---------------------------------------------------------------------
create table if not exists public.config_rendimientos (
  material   text not null check (material in ('Polietileno','Acero')),
  diametro   text not null,
  metros_dia numeric(6,1) not null check (metros_dia > 0),
  orden      int not null default 0,
  primary key (material, diametro)
);

insert into public.config_rendimientos (material, diametro, metros_dia, orden) values
  ('Polietileno', '1/2" (20 mm)',  60, 10),
  ('Polietileno', '3/4" (25 mm)',  60, 20),
  ('Polietileno', '1" (32 mm)',    50, 30),
  ('Polietileno', '2" (63 mm)',    40, 40),
  ('Polietileno', '3" (90 mm)',    30, 50),
  ('Polietileno', '4" (110 mm)',   25, 60),
  ('Polietileno', '6" (160 mm)',   18, 70),
  ('Acero',       '1"',            25, 10),
  ('Acero',       '2"',            20, 20),
  ('Acero',       '3"',            15, 30),
  ('Acero',       '4"',            12, 40),
  ('Acero',       '6"',             8, 50),
  ('Acero',       '8"',             6, 60)
on conflict (material, diametro) do nothing;

alter table public.config_rendimientos enable row level security;
drop policy if exists rend_select on public.config_rendimientos;
create policy rend_select on public.config_rendimientos for select to authenticated using (true);
drop policy if exists rend_admin on public.config_rendimientos;
create policy rend_admin on public.config_rendimientos for all to authenticated
  using (public.mi_rol() = 'Administrador') with check (public.mi_rol() = 'Administrador');

-- ---------------------------------------------------------------------
-- 3. Reglas de actualización (reemplaza la versión de 003)
-- ---------------------------------------------------------------------
create or replace function public.proyectos_antes_actualizar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rol text := public.mi_rol();
  n_old int  := split_part(old.etapa, '.', 1)::int;
  n_new int  := split_part(new.etapa, '.', 1)::int;
  v_ok  boolean;
  v_com text := nullif(trim(coalesce(new.comentario_cambio, '')), '');
begin
  -- Campos que no se pueden cambiar (el folio depende de ellos)
  new.folio          := old.folio;
  new.solicitante_id := old.solicitante_id;
  new.created_at     := old.created_at;
  if v_rol is distinct from 'Administrador' then
    new.municipio := old.municipio;
    new.segmento  := old.segmento;
    new.material  := old.material;
  end if;

  -- El PEP lo captura el proyectista (que gestiona con Inversiones) o el Administrador
  if v_rol not in ('Proyectista', 'Administrador') then
    new.elemento_pep := old.elemento_pep;
    new.fecha_pep    := old.fecha_pep;
  end if;
  -- El tiempo estimado de construcción lo capturan los supervisores (Construcción), Líder o Administrador
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
    v_ok := v_rol is null                         -- SQL Editor / service role
         or v_rol = 'Administrador'
         or (v_rol = 'Líder'        and n_old = 1 and n_new in (0, 2))
         or (v_rol = 'Comercial'    and n_old = 0 and n_new = 1)
         or (v_rol = 'Comercial'    and n_old = 2 and n_new in (3, 9) and old.factibilidad = 'En revisión')
         or (v_rol = 'Proyectista'  and n_old = 3 and n_new = 4)
         or (v_rol = 'Permisos'     and n_old = 4 and n_new = 5)
         or (v_rol = 'Construcción' and n_old between 5 and 7 and n_new = n_old + 1);
    if not v_ok then
      raise exception 'Tu rol (%) no puede mover el proyecto de "%" a "%"',
        coalesce(v_rol, '?'), old.etapa, new.etapa;
    end if;
    if n_new = 0 and v_com is null then
      raise exception 'Para devolver a Comercial escribe el motivo';
    end if;
    if n_new = 9 and v_com is null then
      raise exception 'Para cancelar el proyecto escribe el motivo';
    end if;
    if n_new in (2, 3) and new.proyectista_id is null then
      raise exception 'Asigna un proyectista antes de pasar a %', new.etapa;
    end if;
    if n_new between 5 and 8 and n_old < 5 and new.elemento_pep is null
       and coalesce(v_rol, 'Administrador') <> 'Administrador' then
      raise exception 'Falta el Elemento PEP (lo registra el proyectista) para entrar a Construcción';
    end if;

    if n_new = 2 then new.factibilidad := 'En elaboración'; end if;
    if n_old = 2 and n_new = 3 then new.factibilidad := 'Aprobada'; end if;
    if n_old = 2 and n_new = 9 then new.factibilidad := 'Rechazada'; end if;

    insert into public.historial (proyecto_id, accion, etapa_anterior, etapa_nueva, comentario)
    values (new.id,
            case when n_new = 0 then 'Devuelto a Comercial'
                 when n_new = 9 and n_old = 2 then 'Factibilidad no aprobada – Cancelado'
                 when n_new = 9 then 'Cancelado'
                 when n_old = 2 and n_new = 3 then 'Factibilidad aprobada por Ventas'
                 when n_new < n_old then 'Regresado de etapa'
                 else 'Avance de etapa' end,
            old.etapa, new.etapa, v_com);
    v_com := null;

  elsif new.factibilidad is distinct from old.factibilidad then
    v_ok := v_rol is null or v_rol = 'Administrador'
         or (v_rol = 'Proyectista' and n_old = 2 and new.factibilidad = 'En revisión'
             and coalesce(old.factibilidad, 'En elaboración') = 'En elaboración')
         or (v_rol = 'Comercial' and n_old = 2 and old.factibilidad = 'En revisión'
             and new.factibilidad = 'En elaboración');
    if not v_ok then
      raise exception 'Tu rol (%) no puede cambiar la factibilidad a "%"', coalesce(v_rol, '?'), new.factibilidad;
    end if;
    if new.factibilidad = 'En elaboración' and v_com is null then
      raise exception 'Escribe qué cambios necesita la factibilidad';
    end if;
    insert into public.historial (proyecto_id, accion, comentario)
    values (new.id,
            case new.factibilidad when 'En revisión' then 'Factibilidad enviada a Ventas para aprobación'
                                  when 'En elaboración' then 'Ventas pidió cambios a la factibilidad'
                                  else 'Factibilidad: ' || coalesce(new.factibilidad, '—') end,
            v_com);
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

-- Quién puede modificar proyectos (las reglas finas están en el trigger)
drop policy if exists proyectos_update on public.proyectos;
create policy proyectos_update on public.proyectos for update to authenticated
  using (
       public.mi_rol() in ('Administrador', 'Líder', 'Permisos', 'Construcción')
    or (public.mi_rol() = 'Proyectista' and proyectista_id = auth.uid())
    or (public.mi_rol() = 'Comercial' and solicitante_id = auth.uid()
        and (etapa like '0.%' or etapa like '2.%'))
  )
  with check (coalesce(public.mi_rol(), 'Sin rol') not in ('Sin rol', 'Consulta'));

-- Actividad del flujograma: ahora la hace el proyectista con Inversiones
update public.config_actividades
   set nombre = 'Gestionar con Inversiones la aprobación de la ficha y el Elemento PEP', area = 'Proyectos / Inversiones',
       entregables = 'El proyectista registra el PEP en la app · Notificación de creación de PEP a Construcción e Instalaciones'
 where etapa = '3. Carpeta técnica' and nombre = 'Aprobación de ficha de inversión y generación de Elemento PEP'
   and not exists (select 1 from public.config_actividades x where x.etapa = '3. Carpeta técnica'
                    and x.nombre = 'Gestionar con Inversiones la aprobación de la ficha y el Elemento PEP');
delete from public.config_actividades
 where etapa = '3. Carpeta técnica' and nombre = 'Aprobación de ficha de inversión y generación de Elemento PEP';

-- =====================================================================
-- PMO Proyectos DGJ – Gantt (fecha requerida de gas + tiempos por etapa)
-- Ejecutar UNA vez en Supabase → SQL Editor → New query → Run.
-- Se puede volver a ejecutar sin perder datos.
-- =====================================================================

-- Fecha en que el cliente necesita el gas (punto de partida del Gantt)
alter table public.proyectos add column if not exists fecha_requerida_gas date;

-- Semanas que dura cada etapa, por segmento
create table if not exists public.config_tiempos (
  segmento text not null check (segmento in ('Residencial','Comercial','Industrial')),
  etapa    text not null,
  semanas  numeric(5,1) not null default 1 check (semanas >= 0),
  primary key (segmento, etapa)
);

-- Tiempos de ejemplo (valídalos con tu equipo en Administración → Tiempos por etapa)
insert into public.config_tiempos (segmento, etapa, semanas) values
  ('Residencial','1. Solicitud',1), ('Residencial','3. Carpeta técnica',4), ('Residencial','4. Permisos',8),
  ('Residencial','5. Construcción',6), ('Residencial','6. Puesta en servicio',1), ('Residencial','7. Cierre y as-built',2),
  ('Comercial','1. Solicitud',1), ('Comercial','3. Carpeta técnica',4), ('Comercial','4. Permisos',8),
  ('Comercial','5. Construcción',4), ('Comercial','6. Puesta en servicio',1), ('Comercial','7. Cierre y as-built',2),
  ('Industrial','1. Solicitud',1), ('Industrial','3. Carpeta técnica',6), ('Industrial','4. Permisos',10),
  ('Industrial','5. Construcción',8), ('Industrial','6. Puesta en servicio',2), ('Industrial','7. Cierre y as-built',2)
on conflict (segmento, etapa) do nothing;

alter table public.config_tiempos enable row level security;
drop policy if exists tiempos_select on public.config_tiempos;
create policy tiempos_select on public.config_tiempos for select to authenticated using (true);
drop policy if exists tiempos_admin on public.config_tiempos;
create policy tiempos_admin on public.config_tiempos for all to authenticated
  using (public.mi_rol() = 'Administrador') with check (public.mi_rol() = 'Administrador');

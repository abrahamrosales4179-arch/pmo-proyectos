-- =====================================================================
-- PMO Proyectos DGJ – Avance de obra
-- Ejecutar después de 005_etapas.sql. Se puede volver a ejecutar.
--
-- Los supervisores (rol Construcción), el Líder o el Administrador
-- reportan el avance de la obra: porcentaje y, si el proyecto tiene
-- tramos en su estimación de construcción, metros instalados por tramo.
-- Cada reporte queda en el historial del proyecto.
-- =====================================================================

create table if not exists public.avance_obra (
  id          bigint generated always as identity primary key,
  proyecto_id uuid not null references public.proyectos (id) on delete cascade,
  fecha       date not null default current_date,
  porcentaje  numeric(5,1) not null check (porcentaje between 0 and 100),
  detalle     jsonb,            -- [{material, diametro, longitud, instalado}]
  nota        text,
  usuario_id  uuid references public.perfiles (id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists avance_obra_proyecto on public.avance_obra (proyecto_id, fecha desc);

alter table public.avance_obra enable row level security;
drop policy if exists avance_select on public.avance_obra;
create policy avance_select on public.avance_obra for select to authenticated
  using (coalesce(public.mi_rol(), 'Sin rol') <> 'Sin rol');
drop policy if exists avance_insert on public.avance_obra;
create policy avance_insert on public.avance_obra for insert to authenticated
  with check (public.mi_rol() in ('Construcción', 'Líder', 'Administrador') and usuario_id = auth.uid());
drop policy if exists avance_delete on public.avance_obra;
create policy avance_delete on public.avance_obra for delete to authenticated
  using (public.mi_rol() = 'Administrador');

-- Cada reporte de avance se anota en el historial
create or replace function public.avance_obra_historial()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.historial (proyecto_id, usuario_id, accion, comentario)
  values (new.proyecto_id, new.usuario_id, 'Avance de obra reportado',
          new.porcentaje || ' % al ' || to_char(new.fecha, 'DD/MM/YYYY') || coalesce(' · ' || new.nota, ''));
  return new;
end $$;
drop trigger if exists avance_obra_ai on public.avance_obra;
create trigger avance_obra_ai after insert on public.avance_obra
  for each row execute function public.avance_obra_historial();

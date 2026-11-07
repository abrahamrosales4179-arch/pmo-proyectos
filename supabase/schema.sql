-- =====================================================================
-- PMO Proyectos DGJ – Esquema para Supabase
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO → Run
-- Se puede volver a ejecutar sin perder datos.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Perfiles y roles
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  nombre     text,
  rol        text not null default 'Sin rol'
             check (rol in ('Sin rol','Administrador','Consulta','Comercial',
                            'Líder','Proyectista','Permisos','Construcción')),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Rol del usuario que hace la petición (null si no tiene perfil o está inactivo)
create or replace function public.mi_rol()
returns text language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where id = auth.uid() and activo
$$;

-- Al crear un usuario en Authentication se crea su perfil.
-- El PRIMER usuario queda como Administrador; los demás como "Sin rol".
create or replace function public.crear_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Opcional: aceptar solo correos de la empresa (quita los guiones para activarlo)
  -- if lower(new.email) not like '%@engie.com' then
  --   raise exception 'Solo se permiten correos @engie.com';
  -- end if;
  insert into public.perfiles (id, email, nombre, rol)
  values (new.id,
          lower(new.email),
          coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
          case when exists (select 1 from public.perfiles) then 'Sin rol' else 'Administrador' end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.crear_perfil();

-- ---------------------------------------------------------------------
-- 2. Catálogos
-- ---------------------------------------------------------------------
create table if not exists public.municipios (
  nombre text primary key,
  clave  text not null unique
);

insert into public.municipios (nombre, clave) values
  ('Zapopan','Z'), ('Tlajomulco','TJ'), ('Tlaquepaque','TQ'),
  ('Guadalajara','G'), ('Tonalá','T'), ('El Salto','S')
on conflict (nombre) do nothing;

-- Documentos requeridos por etapa / segmento / material
-- segmento o material NULL = aplica a todos
create table if not exists public.config_documentos (
  id          bigint generated always as identity primary key,
  nombre      text not null,
  etapa       text not null default '1. Solicitud',
  segmento    text check (segmento in ('Residencial','Comercial','Industrial')),
  material    text check (material in ('Polietileno','Acero')),
  obligatorio boolean not null default true,
  orden       int not null default 0
);

-- Documentos de ejemplo (solo si la tabla está vacía).
-- Reemplázalos por tus 23 documentos desde la pantalla Administración.
insert into public.config_documentos (nombre, etapa, segmento, material, obligatorio, orden)
select * from (values
  ('Solicitud de servicio firmada',          '1. Solicitud',       null,          null,     true,  10),
  ('Identificación del solicitante',         '1. Solicitud',       null,          null,     true,  20),
  ('Comprobante de propiedad / predial',     '1. Solicitud',       null,          null,     true,  30),
  ('Plano o croquis de ubicación',           '1. Solicitud',       null,          null,     true,  40),
  ('Acta constitutiva',                      '1. Solicitud',       'Comercial',   null,     true,  50),
  ('Acta constitutiva',                      '1. Solicitud',       'Industrial',  null,     true,  50),
  ('Consumo estimado de gas',                '1. Solicitud',       'Industrial',  null,     true,  60),
  ('Especificación de presión requerida',    '1. Solicitud',       'Industrial',  'Acero',  true,  70),
  ('Plano de proyecto',                      '3. Carpeta técnica', null,          null,     true,  10),
  ('Memoria de cálculo',                     '3. Carpeta técnica', null,          null,     true,  20),
  ('Presupuesto / PEP SAP',                  '3. Carpeta técnica', null,          null,     false, 30),
  ('Licencia municipal de obra',             '4. Permisos',        null,          null,     true,  10),
  ('Reporte fotográfico de obra',            '5. Construcción',    null,          null,     false, 10),
  ('Pruebas de hermeticidad',                '6. Puesta en servicio', null,       null,     true,  10),
  ('Plano as-built',                         '7. Cierre y as-built', null,        null,     true,  10),
  ('Alta en GIS',                            '7. Cierre y as-built', null,        null,     true,  20)
) as v(nombre, etapa, segmento, material, obligatorio, orden)
where not exists (select 1 from public.config_documentos);

-- ---------------------------------------------------------------------
-- 3. Proyectos
-- ---------------------------------------------------------------------
create table if not exists public.proyectos (
  id                uuid primary key default gen_random_uuid(),
  folio             text unique,
  nombre            text not null,
  municipio         text not null references public.municipios (nombre),
  segmento          text not null check (segmento in ('Residencial','Comercial','Industrial')),
  material          text not null default 'Polietileno' check (material in ('Polietileno','Acero')),
  direccion         text,
  descripcion       text,
  etapa             text not null default '1. Solicitud' check (etapa ~ '^[0-9]+\. '),
  solicitante_id    uuid references public.perfiles (id),
  proyectista_id    uuid references public.perfiles (id),
  fecha_compromiso  date,
  bloqueo           text,
  siguiente_accion  text,
  comentario_cambio text,   -- campo temporal: el comentario se guarda en historial y se limpia
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists proyectos_etapa_idx on public.proyectos (etapa);

create table if not exists public.historial (
  id             bigint generated always as identity primary key,
  proyecto_id    uuid not null references public.proyectos (id) on delete cascade,
  usuario_id     uuid references public.perfiles (id) default auth.uid(),
  accion         text not null,
  etapa_anterior text,
  etapa_nueva    text,
  comentario     text,
  created_at     timestamptz not null default now()
);
create index if not exists historial_proyecto_idx on public.historial (proyecto_id);

create table if not exists public.documentos (
  id             bigint generated always as identity primary key,
  proyecto_id    uuid not null references public.proyectos (id) on delete cascade,
  config_doc_id  bigint references public.config_documentos (id) on delete set null,
  nombre_archivo text not null,
  ruta           text not null,
  tamano         bigint,
  subido_por     uuid references public.perfiles (id) default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists documentos_proyecto_idx on public.documentos (proyecto_id);

create table if not exists public.licencias (
  id                bigint generated always as identity primary key,
  proyecto_id       uuid not null references public.proyectos (id) on delete cascade,
  tipo              text not null,
  dependencia       text,
  estatus           text not null default 'Pendiente'
                    check (estatus in ('Pendiente','En trámite','Aprobada','Rechazada')),
  fecha_ingreso     date,
  fecha_vencimiento date,
  notas             text,
  created_at        timestamptz not null default now()
);
create index if not exists licencias_proyecto_idx on public.licencias (proyecto_id);

-- ---------------------------------------------------------------------
-- 4. Folio automático
--    [clave municipio][R/C/I][P/A][año 2 dígitos][consecutivo 3 dígitos]
--    Ej. ZRP26001, TIA26133. Consecutivo por combinación y año.
-- ---------------------------------------------------------------------
create or replace function public.proyectos_antes_insertar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rol     text := public.mi_rol();
  v_clave   text;
  v_prefijo text;
  v_sig     int;
begin
  if new.segmento <> 'Industrial' then
    new.material := 'Polietileno';
  end if;

  -- Toda solicitud nueva entra en "1. Solicitud" y la registra quien la crea
  if v_rol is distinct from 'Administrador' then
    new.etapa := '1. Solicitud';
    new.proyectista_id := null;
  end if;
  new.solicitante_id := coalesce(auth.uid(), new.solicitante_id);

  select clave into v_clave from public.municipios where nombre = new.municipio;
  if v_clave is null then
    raise exception 'Municipio "%" no tiene clave', new.municipio;
  end if;

  v_prefijo := v_clave || left(new.segmento, 1) || left(new.material, 1)
               || to_char(now() at time zone 'America/Mexico_City', 'YY');

  -- Evita folios duplicados si dos personas envían al mismo tiempo
  perform pg_advisory_xact_lock(hashtext(v_prefijo));

  select coalesce(max(substring(folio from length(v_prefijo) + 1)::int), 0) + 1
    into v_sig
    from public.proyectos
   where folio ~ ('^' || v_prefijo || '[0-9]{3}$');

  new.folio := v_prefijo || lpad(v_sig::text, 3, '0');
  new.comentario_cambio := null;
  return new;
end $$;

drop trigger if exists proyectos_bi on public.proyectos;
create trigger proyectos_bi before insert on public.proyectos
  for each row execute function public.proyectos_antes_insertar();

create or replace function public.proyectos_despues_insertar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.historial (proyecto_id, usuario_id, accion, etapa_nueva)
  values (new.id, new.solicitante_id, 'Solicitud creada', new.etapa);
  return new;
end $$;

drop trigger if exists proyectos_ai on public.proyectos;
create trigger proyectos_ai after insert on public.proyectos
  for each row execute function public.proyectos_despues_insertar();

-- ---------------------------------------------------------------------
-- 5. Reglas de cambio de etapa + historial automático
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
  new.updated_at := now();

  if new.etapa is distinct from old.etapa then
    v_ok := v_rol is null                         -- SQL Editor / service role
         or v_rol = 'Administrador'
         or (v_rol = 'Líder'        and n_old = 1 and n_new in (0, 3))
         or (v_rol = 'Comercial'    and n_old = 0 and n_new = 1)
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
    if n_new = 3 and new.proyectista_id is null then
      raise exception 'Asigna un proyectista antes de pasar a Carpeta técnica';
    end if;

    insert into public.historial (proyecto_id, accion, etapa_anterior, etapa_nueva, comentario)
    values (new.id,
            case when n_new = 0 then 'Devuelto a Comercial'
                 when n_new < n_old then 'Regresado de etapa'
                 else 'Avance de etapa' end,
            old.etapa, new.etapa, v_com);
  elsif v_com is not null then
    insert into public.historial (proyecto_id, accion, comentario)
    values (new.id, 'Comentario', v_com);
  end if;

  if new.proyectista_id is distinct from old.proyectista_id and new.proyectista_id is not null then
    insert into public.historial (proyecto_id, accion, comentario)
    select new.id, 'Proyectista asignado', coalesce(p.nombre, p.email)
      from public.perfiles p where p.id = new.proyectista_id;
  end if;

  new.comentario_cambio := null;
  return new;
end $$;

drop trigger if exists proyectos_bu on public.proyectos;
create trigger proyectos_bu before update on public.proyectos
  for each row execute function public.proyectos_antes_actualizar();

-- ---------------------------------------------------------------------
-- 6. Seguridad (Row Level Security)
--    Todos los usuarios con rol pueden VER todo; cada rol solo puede
--    MODIFICAR lo que le corresponde.
-- ---------------------------------------------------------------------
alter table public.perfiles          enable row level security;
alter table public.municipios        enable row level security;
alter table public.config_documentos enable row level security;
alter table public.proyectos         enable row level security;
alter table public.historial         enable row level security;
alter table public.documentos        enable row level security;
alter table public.licencias         enable row level security;

-- Perfiles
drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles for select to authenticated using (true);
drop policy if exists perfiles_update on public.perfiles;
create policy perfiles_update on public.perfiles for update to authenticated
  using (public.mi_rol() = 'Administrador') with check (public.mi_rol() = 'Administrador');

-- Catálogos: leen todos, edita el Administrador
drop policy if exists municipios_select on public.municipios;
create policy municipios_select on public.municipios for select to authenticated using (true);
drop policy if exists municipios_admin on public.municipios;
create policy municipios_admin on public.municipios for all to authenticated
  using (public.mi_rol() = 'Administrador') with check (public.mi_rol() = 'Administrador');

drop policy if exists configdocs_select on public.config_documentos;
create policy configdocs_select on public.config_documentos for select to authenticated using (true);
drop policy if exists configdocs_admin on public.config_documentos;
create policy configdocs_admin on public.config_documentos for all to authenticated
  using (public.mi_rol() = 'Administrador') with check (public.mi_rol() = 'Administrador');

-- Proyectos
drop policy if exists proyectos_select on public.proyectos;
create policy proyectos_select on public.proyectos for select to authenticated
  using (coalesce(public.mi_rol(), 'Sin rol') <> 'Sin rol');

drop policy if exists proyectos_insert on public.proyectos;
create policy proyectos_insert on public.proyectos for insert to authenticated
  with check (public.mi_rol() in ('Comercial', 'Administrador'));

drop policy if exists proyectos_update on public.proyectos;
create policy proyectos_update on public.proyectos for update to authenticated
  using (
       public.mi_rol() in ('Administrador', 'Líder', 'Permisos', 'Construcción')
    or (public.mi_rol() = 'Proyectista' and proyectista_id = auth.uid())
    or (public.mi_rol() = 'Comercial' and solicitante_id = auth.uid() and etapa like '0.%')
  )
  with check (coalesce(public.mi_rol(), 'Sin rol') not in ('Sin rol', 'Consulta'));

drop policy if exists proyectos_delete on public.proyectos;
create policy proyectos_delete on public.proyectos for delete to authenticated
  using (public.mi_rol() = 'Administrador');

-- Historial: se lee; se agregan comentarios; nadie edita ni borra
drop policy if exists historial_select on public.historial;
create policy historial_select on public.historial for select to authenticated
  using (coalesce(public.mi_rol(), 'Sin rol') <> 'Sin rol');
drop policy if exists historial_insert on public.historial;
create policy historial_insert on public.historial for insert to authenticated
  with check (coalesce(public.mi_rol(), 'Sin rol') not in ('Sin rol', 'Consulta')
              and usuario_id = auth.uid());

-- Documentos
drop policy if exists documentos_select on public.documentos;
create policy documentos_select on public.documentos for select to authenticated
  using (coalesce(public.mi_rol(), 'Sin rol') <> 'Sin rol');
drop policy if exists documentos_insert on public.documentos;
create policy documentos_insert on public.documentos for insert to authenticated
  with check (coalesce(public.mi_rol(), 'Sin rol') not in ('Sin rol', 'Consulta'));
drop policy if exists documentos_delete on public.documentos;
create policy documentos_delete on public.documentos for delete to authenticated
  using (public.mi_rol() = 'Administrador' or subido_por = auth.uid());

-- Licencias
drop policy if exists licencias_select on public.licencias;
create policy licencias_select on public.licencias for select to authenticated
  using (coalesce(public.mi_rol(), 'Sin rol') <> 'Sin rol');
drop policy if exists licencias_write on public.licencias;
create policy licencias_write on public.licencias for insert to authenticated
  with check (public.mi_rol() in ('Administrador', 'Líder', 'Permisos'));
drop policy if exists licencias_update on public.licencias;
create policy licencias_update on public.licencias for update to authenticated
  using (public.mi_rol() in ('Administrador', 'Líder', 'Permisos'));
drop policy if exists licencias_delete on public.licencias;
create policy licencias_delete on public.licencias for delete to authenticated
  using (public.mi_rol() = 'Administrador');

-- ---------------------------------------------------------------------
-- 7. Almacenamiento de archivos (bucket privado "expedientes")
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('expedientes', 'expedientes', false)
on conflict (id) do nothing;

drop policy if exists expedientes_select on storage.objects;
create policy expedientes_select on storage.objects for select to authenticated
  using (bucket_id = 'expedientes' and coalesce(public.mi_rol(), 'Sin rol') <> 'Sin rol');

drop policy if exists expedientes_insert on storage.objects;
create policy expedientes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'expedientes'
              and coalesce(public.mi_rol(), 'Sin rol') not in ('Sin rol', 'Consulta'));

drop policy if exists expedientes_delete on storage.objects;
create policy expedientes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'expedientes'
         and (owner = auth.uid() or public.mi_rol() = 'Administrador'));

-- =====================================================================
-- 8. Gantt (mismo contenido que 002_gantt.sql)
-- =====================================================================
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

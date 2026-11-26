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

-- =====================================================================
-- 9. Flujograma de proyectos (mismo contenido que 003_flujograma.sql)
-- =====================================================================
-- ---------------------------------------------------------------------
-- 1. Rol Inversiones
-- ---------------------------------------------------------------------
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles add constraint perfiles_rol_check
  check (rol in ('Sin rol','Administrador','Consulta','Comercial','Líder',
                 'Proyectista','Inversiones','Permisos','Construcción'));

-- ---------------------------------------------------------------------
-- 2. Nuevos campos del proyecto
-- ---------------------------------------------------------------------
alter table public.proyectos add column if not exists factibilidad text
  check (factibilidad in ('En elaboración','En revisión','Aprobada','Rechazada'));
alter table public.proyectos add column if not exists elemento_pep text;
alter table public.proyectos add column if not exists fecha_pep date;

-- ---------------------------------------------------------------------
-- 3. Reglas de cambio de etapa (reemplaza la versión de schema.sql)
--    1 → 2  Líder asigna proyectista (o devuelve a Comercial → 0)
--    2      Proyectista envía la factibilidad a Ventas ("En revisión")
--    2 → 3  Ventas (Comercial solicitante) aprueba
--    2 → 9  Ventas no aprueba: Cancelado (motivo obligatorio)
--    2      Ventas pide cambios: vuelve a "En elaboración"
--    3 → 4  Proyectista · 4 → 5 Permisos (requiere Elemento PEP)
--    5 → 6 → 7 → 8  Construcción
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

  -- Inversiones solo captura el Elemento PEP
  if v_rol = 'Inversiones' then
    new.nombre := old.nombre;  new.direccion := old.direccion;  new.descripcion := old.descripcion;
    new.etapa := old.etapa;    new.proyectista_id := old.proyectista_id;
    new.fecha_compromiso := old.fecha_compromiso;  new.bloqueo := old.bloqueo;
    new.siguiente_accion := old.siguiente_accion;  new.fecha_requerida_gas := old.fecha_requerida_gas;
    new.factibilidad := old.factibilidad;
    n_new := n_old;
  end if;
  -- El PEP solo lo capturan Inversiones o el Administrador
  if v_rol not in ('Inversiones', 'Administrador') then
    new.elemento_pep := old.elemento_pep;
    new.fecha_pep    := old.fecha_pep;
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
      raise exception 'Falta el Elemento PEP (lo registra Inversiones) para entrar a Construcción';
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
       public.mi_rol() in ('Administrador', 'Líder', 'Permisos', 'Construcción', 'Inversiones')
    or (public.mi_rol() = 'Proyectista' and proyectista_id = auth.uid())
    or (public.mi_rol() = 'Comercial' and solicitante_id = auth.uid()
        and (etapa like '0.%' or etapa like '2.%'))
  )
  with check (coalesce(public.mi_rol(), 'Sin rol') not in ('Sin rol', 'Consulta'));

-- ---------------------------------------------------------------------
-- 4. Actividades del flujograma
-- ---------------------------------------------------------------------
create table if not exists public.config_actividades (
  id          bigint generated always as identity primary key,
  etapa       text not null,
  orden       int  not null default 0,
  nombre      text not null,
  area        text not null,
  dias        numeric(5,1),
  entregables text,
  decision    boolean not null default false,
  unique (etapa, nombre)
);

create table if not exists public.proyecto_actividades (
  proyecto_id  uuid   not null references public.proyectos (id) on delete cascade,
  actividad_id bigint not null references public.config_actividades (id) on delete cascade,
  estatus      text   not null default 'Pendiente'
               check (estatus in ('Pendiente','En proceso','Hecha','No aplica')),
  usuario_id   uuid references public.perfiles (id) default auth.uid(),
  updated_at   timestamptz not null default now(),
  primary key (proyecto_id, actividad_id)
);

insert into public.config_actividades (etapa, orden, nombre, area, dias, entregables, decision) values
  -- 1. Solicitud
  ('1. Solicitud', 10, 'Obtención de información', 'Ventas', null, 'Plano arquitectónico (plantas, alzado, cortes) · Plano de instalaciones · Plano estructural · KMZ · Formato de solicitud · FIR', false),
  ('1. Solicitud', 20, 'Subir información al expediente', 'Ventas', null, 'Sustituye la carpeta de Teams', false),
  ('1. Solicitud', 30, 'Toma de polígono en KMZ para socializar', 'Socialización', null, null, false),
  ('1. Solicitud', 40, 'Asignación de proyectista por Jefatura', 'Proyectos', 1, null, false),
  ('1. Solicitud', 50, '¿Información completa?', 'Proyectos', 1, 'Si no: se devuelve a Ventas', true),
  -- 2. Ingeniería y factibilidad
  ('2. Ingeniería y factibilidad', 10, 'Elaborar plano de proyecto', 'Proyectos', 4, 'Plano red · Plano de columnas · Solicitud a O&M de red existente', false),
  ('2. Ingeniería y factibilidad', 20, 'Modelo hidráulico GasWorks', 'Proyectos', 1, 'Generación del MH · Cálculo de caída de presión · Memoria de flujo', false),
  ('2. Ingeniería y factibilidad', 30, 'Generar ficha de inversión', 'Proyectos', 1, null, false),
  ('2. Ingeniería y factibilidad', 40, 'Generar formato de factibilidad técnico-económica', 'Proyectos', 1, null, false),
  ('2. Ingeniería y factibilidad', 50, 'Aprobación de factibilidad', 'Ventas', 2, 'Si no se aprueba: FIN (Cancelado)', true),
  -- 3. Carpeta técnica
  ('3. Carpeta técnica', 10, 'Gestionar con Inversiones la aprobación de la ficha y el Elemento PEP', 'Proyectos / Inversiones', 7, 'El proyectista registra el PEP en la app · Notificación de creación de PEP a Construcción e Instalaciones', false),
  ('3. Carpeta técnica', 20, 'Trámite de dictamen de diseño', 'Proyectos', 15, 'Memoria de cálculo de espesores · MTD', false),
  ('3. Carpeta técnica', 30, 'Generar expediente de permisos', 'Proyectos', 10, 'Cronograma de obra · Planos de movilidad · Presupuesto de obra civil · Planos de permisos · MTD permisos · Dictamen de diseño (Zapopan)', false),
  ('3. Carpeta técnica', 40, 'Revisión del DRO', 'DRO', 15, null, false),
  ('3. Carpeta técnica', 50, '¿Hay correcciones del DRO?', 'DRO', null, 'Si hay: se corrige el expediente de permisos', true),
  ('3. Carpeta técnica', 60, 'Subir información a carpeta de Permisos', 'Proyectos', 0.5, null, false),
  ('3. Carpeta técnica', 70, 'Generar carpetas técnicas', 'Proyectos', 1, 'Factibilidad técnica · Vale de almacén · Plano de proyecto · Cartografía DWG · Memoria descriptiva · Orden de servicio/pedido · Elemento PEP · Vo.Bo. usuarios del subsuelo', false),
  ('3. Carpeta técnica', 80, 'Carga de información a carpeta de proyecto', 'Proyectos', null, null, false),
  -- 4. Permisos
  ('4. Permisos', 10, 'Liberación de zona', 'Socialización', null, null, false),
  ('4. Permisos', 20, 'Obtención de licencias de construcción', 'Permisos', null, 'Licencias de dependencias', false),
  ('4. Permisos', 30, 'Reporte de vigencias de permisos', 'Permisos', null, 'Obras públicas · Movilidad estatal · Movilidad municipal · Vo.Bo. servicios · Permisos especiales', false),
  -- 5. Construcción
  ('5. Construcción', 10, 'Jefe asigna proyecto a supervisor', 'Construcción', null, 'Archivo de proyectos', false),
  ('5. Construcción', 20, 'Recorrido de presentación de proyecto', 'Construcción', null, 'Minuta de trabajo entre áreas', false),
  ('5. Construcción', 30, '¿Carpeta completa y proyecto correcto?', 'Construcción', null, 'Si no: Proyectos realiza cambios al proyecto', true),
  ('5. Construcción', 40, 'Impresión de carpeta técnica', 'Construcción', null, null, false),
  ('5. Construcción', 50, 'Recorrido y entrega de información a contratista', 'Construcción', null, 'Carpeta técnica · Apertura de bitácora · Minutas de obra · Identificación de infraestructura', false),
  ('5. Construcción', 60, 'Generar OTE I', 'Construcción', null, 'Formato de información general · Recorrido O&M (identificación de red)', false),
  ('5. Construcción', 70, 'Recorrido con dependencias', 'Construcción', null, 'Bitácora · Notas · Minutas', false),
  ('5. Construcción', 80, 'Planeación de obra', 'Construcción', null, 'Cronograma de obra · Rev. presupuesto · Rev. materiales · Rev. vigencias de permisos', false),
  ('5. Construcción', 90, 'Aviso de arranque de obra', 'Construcción', null, 'Formato de aviso de obra · Dar de alta en APP', false),
  ('5. Construcción', 100, 'Sondeos', 'Construcción', null, 'Toma de espesores · Estudios de mecánica de suelos · Informe de PND''s', false),
  ('5. Construcción', 110, 'Generar OTE II', 'Construcción', null, null, false),
  ('5. Construcción', 120, 'Aprobación de OTE''s', 'Dirección Técnica', null, 'OTE firmada', false),
  ('5. Construcción', 130, 'Desarrollo de obra', 'Construcción', null, 'Bitácora de obra · ERUM · Pláticas de seguridad · Firma de vales de materiales · Rev. soldaduras · Levantamiento GIS · Rev. P.H. · Rev. documentos diarios de contratistas', false),
  ('5. Construcción', 140, 'Validación de información', 'Construcción', null, 'AS-BUILT · Puntos GIS · PND''s · Completar OTE', false),
  ('5. Construcción', 150, 'Generación de informe para UV', 'Construcción', null, 'Solicitud de acta de verificación y dictamen', false),
  ('5. Construcción', 160, 'Revisión de puntos GIS', 'Construcción', null, null, false),
  ('5. Construcción', 170, '¿Puntos GIS correctos?', 'Proyectos', null, 'Si no: se vuelve a validar la información', true),
  -- 6. Puesta en servicio
  ('6. Puesta en servicio', 10, 'Solicitud de PEG', 'Construcción', null, 'Correo de solicitud', false),
  ('6. Puesta en servicio', 20, 'Programación de PEG', 'O&M', null, null, false),
  ('6. Puesta en servicio', 30, '¿Obra correcta?', 'O&M', null, 'Si no: regresa a Desarrollo de obra', true),
  ('6. Puesta en servicio', 40, 'PEG', 'O&M', null, null, false),
  ('6. Puesta en servicio', 50, 'Acta de barrido', 'O&M', null, null, false),
  -- 7. Cierre y as-built
  ('7. Cierre y as-built', 10, 'Carga de documentos ARSH y GIS', 'Proyectos', null, null, false),
  ('7. Cierre y as-built', 20, 'Levantamiento de puntos GIS', 'Construcción / Instalaciones', null, null, false),
  ('7. Cierre y as-built', 30, 'Sellado de plano As Built y acreditación de puntos GIS', 'Proyectos', 5, null, false),
  ('7. Cierre y as-built', 40, 'Actualización y carga de red en DGN, GIS y GasWork', 'Proyectos', 3, null, false),
  ('7. Cierre y as-built', 50, 'Reparación de caja de interconexión', 'Construcción', null, null, false),
  ('7. Cierre y as-built', 60, 'Cierre de obra', 'Construcción', null, 'Formato de cierre de obra', false),
  ('7. Cierre y as-built', 70, 'Cerrado de almacén', 'Construcción', null, 'Balance de materiales · Vales de traspaso · Vales de devolución', false),
  ('7. Cierre y as-built', 80, 'Revisión de comprometidos (MO y materiales)', 'Construcción', null, null, false),
  ('7. Cierre y as-built', 90, '¿CAPEX suficiente?', 'Construcción', null, 'Si no: Proyectos solicita Adendum o Reclasificación', true),
  ('7. Cierre y as-built', 100, 'Estimación final', 'Construcción', null, null, false),
  ('7. Cierre y as-built', 110, 'Capitalización', 'Construcción', null, null, false)
on conflict (etapa, nombre) do nothing;

alter table public.config_actividades   enable row level security;
alter table public.proyecto_actividades enable row level security;

drop policy if exists actividades_select on public.config_actividades;
create policy actividades_select on public.config_actividades for select to authenticated using (true);
drop policy if exists actividades_admin on public.config_actividades;
create policy actividades_admin on public.config_actividades for all to authenticated
  using (public.mi_rol() = 'Administrador') with check (public.mi_rol() = 'Administrador');

drop policy if exists pact_select on public.proyecto_actividades;
create policy pact_select on public.proyecto_actividades for select to authenticated
  using (coalesce(public.mi_rol(), 'Sin rol') <> 'Sin rol');
drop policy if exists pact_insert on public.proyecto_actividades;
create policy pact_insert on public.proyecto_actividades for insert to authenticated
  with check (coalesce(public.mi_rol(), 'Sin rol') not in ('Sin rol', 'Consulta'));
drop policy if exists pact_update on public.proyecto_actividades;
create policy pact_update on public.proyecto_actividades for update to authenticated
  using (coalesce(public.mi_rol(), 'Sin rol') not in ('Sin rol', 'Consulta'))
  with check (coalesce(public.mi_rol(), 'Sin rol') not in ('Sin rol', 'Consulta'));

-- ---------------------------------------------------------------------
-- 5. Documentos requeridos según el flujograma
--    Se quitan los de ejemplo que no tengan archivos y se agregan los
--    entregables del flujograma (no duplica si ya existen con el mismo nombre).
-- ---------------------------------------------------------------------
delete from public.config_documentos c
 where (c.nombre, c.etapa) in (
   ('Solicitud de servicio firmada','1. Solicitud'), ('Identificación del solicitante','1. Solicitud'),
   ('Comprobante de propiedad / predial','1. Solicitud'), ('Plano o croquis de ubicación','1. Solicitud'),
   ('Acta constitutiva','1. Solicitud'), ('Consumo estimado de gas','1. Solicitud'),
   ('Especificación de presión requerida','1. Solicitud'), ('Plano de proyecto','3. Carpeta técnica'),
   ('Memoria de cálculo','3. Carpeta técnica'), ('Presupuesto / PEP SAP','3. Carpeta técnica'),
   ('Licencia municipal de obra','4. Permisos'), ('Reporte fotográfico de obra','5. Construcción'),
   ('Pruebas de hermeticidad','6. Puesta en servicio'), ('Plano as-built','7. Cierre y as-built'),
   ('Alta en GIS','7. Cierre y as-built'))
   and not exists (select 1 from public.documentos d where d.config_doc_id = c.id);

insert into public.config_documentos (nombre, etapa, segmento, material, obligatorio, orden)
select v.nombre, v.etapa, null, null, v.obligatorio, v.orden
  from (values
    ('Formato de solicitud',                         '1. Solicitud', true, 10),
    ('Plano arquitectónico (plantas, alzado y cortes)', '1. Solicitud', true, 20),
    ('Plano de instalaciones',                       '1. Solicitud', true, 30),
    ('Plano estructural',                            '1. Solicitud', false, 40),
    ('KMZ del predio',                               '1. Solicitud', true, 50),
    ('FIR',                                          '1. Solicitud', true, 60),
    ('Plano de red',                                 '2. Ingeniería y factibilidad', true, 10),
    ('Plano de columnas',                            '2. Ingeniería y factibilidad', false, 20),
    ('Modelo hidráulico GasWorks / memoria de flujo','2. Ingeniería y factibilidad', true, 30),
    ('Ficha de inversión',                           '2. Ingeniería y factibilidad', true, 40),
    ('Formato de factibilidad técnico-económica',    '2. Ingeniería y factibilidad', true, 50),
    ('Dictamen de diseño',                           '3. Carpeta técnica', true, 10),
    ('Memoria de cálculo de espesores',              '3. Carpeta técnica', true, 20),
    ('Expediente de permisos (planos, cronograma, presupuesto de obra civil)', '3. Carpeta técnica', true, 30),
    ('Carpeta técnica (vale de almacén, cartografía DWG, memoria descriptiva, orden de servicio)', '3. Carpeta técnica', true, 40),
    ('Vo.Bo. usuarios del subsuelo',                 '3. Carpeta técnica', true, 50),
    ('Constancia de liberación de zona',             '4. Permisos', true, 10),
    ('Licencias de dependencias',                    '4. Permisos', true, 20),
    ('Reporte de vigencias de permisos',             '4. Permisos', true, 30),
    ('Minuta de recorrido de presentación',          '5. Construcción', false, 10),
    ('OTE I',                                        '5. Construcción', true, 20),
    ('Formato de aviso de obra',                     '5. Construcción', true, 30),
    ('Informe de sondeos / PND''s',                  '5. Construcción', true, 40),
    ('OTE II firmada',                               '5. Construcción', true, 50),
    ('Bitácora de obra',                             '5. Construcción', true, 60),
    ('Informe para UV (acta de verificación y dictamen)', '5. Construcción', true, 70),
    ('Acta de barrido',                              '6. Puesta en servicio', true, 10),
    ('Plano As Built sellado',                       '7. Cierre y as-built', true, 10),
    ('Documentos ARSH',                              '7. Cierre y as-built', true, 20),
    ('Formato de cierre de obra',                    '7. Cierre y as-built', true, 30),
    ('Balance de materiales y vales',                '7. Cierre y as-built', true, 40),
    ('Estimación final',                             '7. Cierre y as-built', true, 50),
    ('Adendum o reclasificación',                    '7. Cierre y as-built', false, 60)
  ) as v(nombre, etapa, obligatorio, orden)
 where not exists (select 1 from public.config_documentos c
                    where lower(c.nombre) = lower(v.nombre) and c.etapa = v.etapa);

-- ---------------------------------------------------------------------
-- 6. Tiempo de la nueva etapa en el Gantt
--    Flujograma: plano 4 + modelo 1 + ficha 1 + factibilidad 1 + aprobación 2 = 9 días hábiles
-- ---------------------------------------------------------------------
create table if not exists public.config_tiempos (
  segmento text not null check (segmento in ('Residencial','Comercial','Industrial')),
  etapa    text not null,
  semanas  numeric(5,1) not null default 1 check (semanas >= 0),
  primary key (segmento, etapa)
);
insert into public.config_tiempos (segmento, etapa, semanas) values
  ('Residencial','2. Ingeniería y factibilidad',2),
  ('Comercial','2. Ingeniería y factibilidad',2),
  ('Industrial','2. Ingeniería y factibilidad',3)
on conflict (segmento, etapa) do nothing;

-- =====================================================================
-- 10. PEP por proyectista y tiempo de construcción (mismo contenido que 004_construccion.sql)
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

-- =====================================================================
-- 11. Flujo de 14 etapas (mismo contenido que 005_etapas.sql)
-- =====================================================================
-- ---------------------------------------------------------------------
-- 1. Trigger: reglas de cambio de etapa por rol
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
          or (n_old = 3              and v_rol = 'Comercial')
          or (n_old in (4,5,6,7,10)  and v_rol = 'Proyectista')
          or (n_old = 8              and v_rol = 'Permisos')
          or (n_old = 9              and v_rol in ('Permisos', 'Líder'))
          or (n_old in (11,12,13)    and v_rol = 'Construcción')))
      -- regresos y cancelación
      or (n_old = 1  and n_new = 0  and v_rol = 'Líder')
      or (n_old = 3  and n_new = 2  and v_rol = 'Comercial')
      or (n_old = 3  and n_new = 99 and v_rol = 'Comercial')
      or (n_old = 7  and n_new = 6  and v_rol = 'Proyectista')
      or (n_old = 11 and n_new = 10 and v_rol = 'Construcción');
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

    insert into public.historial (proyecto_id, accion, etapa_anterior, etapa_nueva, comentario)
    values (new.id,
            case when n_new = 0 then 'Devuelto a Comercial'
                 when n_new = 99 and n_old = 3 then 'Factibilidad no aprobada – Cancelado'
                 when n_new = 99 then 'Cancelado'
                 when n_old = 3 and n_new = 4 then 'Factibilidad aprobada por el área comercial'
                 when n_old = 3 and n_new = 2 then 'El área comercial pidió cambios al anteproyecto'
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

-- Quién puede modificar proyectos (las reglas finas están en el trigger)
drop policy if exists proyectos_update on public.proyectos;
create policy proyectos_update on public.proyectos for update to authenticated
  using (
       public.mi_rol() in ('Administrador', 'Líder', 'Permisos', 'Construcción')
    or (public.mi_rol() = 'Proyectista' and proyectista_id = auth.uid())
    or (public.mi_rol() = 'Comercial' and solicitante_id = auth.uid()
        and (etapa like '0.%' or etapa like '3.%'))
  )
  with check (coalesce(public.mi_rol(), 'Sin rol') not in ('Sin rol', 'Consulta'));

-- ---------------------------------------------------------------------
-- 2. Mover los proyectos existentes a las etapas nuevas
--    (sin disparar el trigger para no llenar el historial)
-- ---------------------------------------------------------------------
alter table public.proyectos disable trigger proyectos_bu;
update public.proyectos set etapa = case
    when etapa = '2. Ingeniería y factibilidad' and factibilidad = 'En revisión' then '3. Aprobación comercial (KAM)'
    when etapa = '2. Ingeniería y factibilidad' then '2. Anteproyecto y factibilidad'
    when etapa = '3. Carpeta técnica' and elemento_pep is null then '4. Obtención del PEP'
    when etapa = '3. Carpeta técnica' then '5. Dictamen de diseño'
    when etapa = '4. Permisos' then '8. Licencias'
    when etapa = '5. Construcción' then '11. Construcción'
    when etapa = '6. Puesta en servicio' then '13. Puesta en servicio'
    when etapa = '7. Cierre y as-built' then '12. Cierre y as-built'
    when etapa = '8. Entregado a O&M' then '14. Entregado a O&M'
    when etapa = '9. Cancelado' then '99. Cancelado'
    else etapa end
 where etapa in ('2. Ingeniería y factibilidad','3. Carpeta técnica','4. Permisos','5. Construcción',
                 '6. Puesta en servicio','7. Cierre y as-built','8. Entregado a O&M','9. Cancelado');
alter table public.proyectos enable trigger proyectos_bu;

-- Historial: mismos nombres nuevos (para que el Gantt «real» siga funcionando)
drop table if exists _mapa_etapas;
create temporary table _mapa_etapas (vieja text primary key, nueva text);
insert into _mapa_etapas values
  ('2. Ingeniería y factibilidad', '2. Anteproyecto y factibilidad'),
  ('3. Carpeta técnica',           '5. Dictamen de diseño'),
  ('4. Permisos',                  '8. Licencias'),
  ('5. Construcción',              '11. Construcción'),
  ('6. Puesta en servicio',        '13. Puesta en servicio'),
  ('7. Cierre y as-built',         '12. Cierre y as-built'),
  ('8. Entregado a O&M',           '14. Entregado a O&M'),
  ('9. Cancelado',                 '99. Cancelado');
update public.historial h set etapa_anterior = m.nueva from _mapa_etapas m where h.etapa_anterior = m.vieja;
update public.historial h set etapa_nueva    = m.nueva from _mapa_etapas m where h.etapa_nueva    = m.vieja;

-- ---------------------------------------------------------------------
-- 3. Documentos requeridos: a su etapa nueva
-- ---------------------------------------------------------------------
drop table if exists _mapa_docs;
create temporary table _mapa_docs (nombre text, vieja text, nueva text);
insert into _mapa_docs values
  ('Plano de red',                                   '2. Ingeniería y factibilidad', '2. Anteproyecto y factibilidad'),
  ('Plano de columnas',                              '2. Ingeniería y factibilidad', '2. Anteproyecto y factibilidad'),
  ('Modelo hidráulico GasWorks / memoria de flujo',  '2. Ingeniería y factibilidad', '2. Anteproyecto y factibilidad'),
  ('Ficha de inversión',                             '2. Ingeniería y factibilidad', '2. Anteproyecto y factibilidad'),
  ('Formato de factibilidad técnico-económica',      '2. Ingeniería y factibilidad', '2. Anteproyecto y factibilidad'),
  ('Dictamen de diseño',                             '3. Carpeta técnica', '5. Dictamen de diseño'),
  ('Memoria de cálculo de espesores',                '3. Carpeta técnica', '5. Dictamen de diseño'),
  ('Expediente de permisos (planos, cronograma, presupuesto de obra civil)', '3. Carpeta técnica', '6. Expediente de permisos'),
  ('Carpeta técnica (vale de almacén, cartografía DWG, memoria descriptiva, orden de servicio)', '3. Carpeta técnica', '10. Carpeta técnica'),
  ('Vo.Bo. usuarios del subsuelo',                   '3. Carpeta técnica', '10. Carpeta técnica'),
  ('Constancia de liberación de zona',               '4. Permisos', '9. Socialización y liberación de zona'),
  ('Licencias de dependencias',                      '4. Permisos', '8. Licencias'),
  ('Reporte de vigencias de permisos',               '4. Permisos', '8. Licencias');
update public.config_documentos c set etapa = m.nueva
  from _mapa_docs m
 where c.nombre = m.nombre and c.etapa = m.vieja
   and not exists (select 1 from public.config_documentos x where x.nombre = c.nombre and x.etapa = m.nueva);
-- El resto de cada etapa vieja se mueve completo
update public.config_documentos c set etapa = m.nueva
  from (values ('3. Carpeta técnica','10. Carpeta técnica'), ('4. Permisos','8. Licencias'),
               ('5. Construcción','11. Construcción'), ('6. Puesta en servicio','13. Puesta en servicio'),
               ('7. Cierre y as-built','12. Cierre y as-built'), ('2. Ingeniería y factibilidad','2. Anteproyecto y factibilidad'))
       as m(vieja, nueva)
 where c.etapa = m.vieja
   and not exists (select 1 from _mapa_docs d where d.nombre = c.nombre and d.vieja = c.etapa)
   and not exists (select 1 from public.config_documentos x where x.nombre = c.nombre and x.etapa = m.nueva);
-- Duplicados que pudieran quedar con nombre de etapa viejo (solo si no tienen archivos)
delete from public.config_documentos c
 where c.etapa in ('2. Ingeniería y factibilidad','3. Carpeta técnica','4. Permisos','5. Construcción',
                   '6. Puesta en servicio','7. Cierre y as-built','8. Entregado a O&M')
   and not exists (select 1 from public.documentos d where d.config_doc_id = c.id);

insert into public.config_documentos (nombre, etapa, segmento, material, obligatorio, orden)
select v.nombre, v.etapa, null, null, v.obligatorio, v.orden
  from (values
    ('Formato de factibilidad firmado por el KAM', '3. Aprobación comercial (KAM)', false, 10),
    ('Revisión del DRO sin correcciones',          '7. Revisión DRO', true, 10)
  ) as v(nombre, etapa, obligatorio, orden)
 where not exists (select 1 from public.config_documentos c where lower(c.nombre) = lower(v.nombre) and c.etapa = v.etapa);

-- ---------------------------------------------------------------------
-- 4. Actividades del flujograma: a su etapa nueva
-- ---------------------------------------------------------------------
drop table if exists _mapa_act;
create temporary table _mapa_act (nombre text, nueva text);
insert into _mapa_act values
  ('Elaborar plano de proyecto',                                '2. Anteproyecto y factibilidad'),
  ('Modelo hidráulico GasWorks',                                '2. Anteproyecto y factibilidad'),
  ('Generar ficha de inversión',                                '2. Anteproyecto y factibilidad'),
  ('Generar formato de factibilidad técnico-económica',         '2. Anteproyecto y factibilidad'),
  ('Aprobación de factibilidad',                                '3. Aprobación comercial (KAM)'),
  ('Gestionar con Inversiones la aprobación de la ficha y el Elemento PEP', '4. Obtención del PEP'),
  ('Aprobación de ficha de inversión y generación de Elemento PEP',         '4. Obtención del PEP'),
  ('Trámite de dictamen de diseño',                             '5. Dictamen de diseño'),
  ('Generar expediente de permisos',                            '6. Expediente de permisos'),
  ('Revisión del DRO',                                          '7. Revisión DRO'),
  ('¿Hay correcciones del DRO?',                                '7. Revisión DRO'),
  ('Subir información a carpeta de Permisos',                   '7. Revisión DRO'),
  ('Obtención de licencias de construcción',                    '8. Licencias'),
  ('Reporte de vigencias de permisos',                          '8. Licencias'),
  ('Liberación de zona',                                        '9. Socialización y liberación de zona'),
  ('Generar carpetas técnicas',                                 '10. Carpeta técnica'),
  ('Carga de información a carpeta de proyecto',                '10. Carpeta técnica');
update public.config_actividades a set etapa = m.nueva
  from _mapa_act m
 where a.nombre = m.nombre and a.etapa <> m.nueva
   and a.etapa in ('2. Ingeniería y factibilidad','3. Carpeta técnica','4. Permisos')
   and not exists (select 1 from public.config_actividades x where x.nombre = a.nombre and x.etapa = m.nueva);
update public.config_actividades a set etapa = m.nueva
  from (values ('5. Construcción','11. Construcción'), ('6. Puesta en servicio','13. Puesta en servicio'),
               ('7. Cierre y as-built','12. Cierre y as-built')) as m(vieja, nueva)
 where a.etapa = m.vieja
   and not exists (select 1 from public.config_actividades x where x.nombre = a.nombre and x.etapa = m.nueva);
-- Lo que quede con nombre de etapa viejo son duplicados de una reinstalación
delete from public.config_actividades
 where etapa in ('2. Ingeniería y factibilidad','3. Carpeta técnica','4. Permisos','5. Construcción',
                 '6. Puesta en servicio','7. Cierre y as-built');
update public.config_actividades set nombre = 'Revisión del DRO', area = 'Proyectos / DRO'
 where etapa = '7. Revisión DRO' and nombre = 'Revisión del DRO';
update public.config_actividades set entregables = 'Si hay: regresa a Expediente de permisos'
 where etapa = '7. Revisión DRO' and nombre = '¿Hay correcciones del DRO?';
update public.config_actividades set entregables = 'Si no se aprueba: se cancela el proyecto; si pide cambios: regresa a Anteproyecto'
 where etapa = '3. Aprobación comercial (KAM)' and nombre = 'Aprobación de factibilidad';

-- ---------------------------------------------------------------------
-- 5. Tiempos por etapa (semanas) para el Gantt
--    Se conservan los valores que ya tenías en Permisos, Construcción,
--    Puesta en servicio y Cierre; las etapas nuevas toman los días del
--    flujograma (5 días hábiles = 1 semana).
-- ---------------------------------------------------------------------
insert into public.config_tiempos (segmento, etapa, semanas)
select s.segmento, v.nueva,
       coalesce((select t.semanas from public.config_tiempos t where t.segmento = s.segmento and t.etapa = v.vieja), v.defecto)
  from (values ('Residencial'), ('Comercial'), ('Industrial')) as s(segmento)
 cross join (values
    ('2. Anteproyecto y factibilidad',          null,                    1.5),
    ('3. Aprobación comercial (KAM)',           null,                    0.5),
    ('4. Obtención del PEP',                    null,                    1.5),
    ('5. Dictamen de diseño',                   null,                    3),
    ('6. Expediente de permisos',               null,                    2),
    ('7. Revisión DRO',                         null,                    3),
    ('8. Licencias',                            '4. Permisos',           8),
    ('9. Socialización y liberación de zona',   null,                    1),
    ('10. Carpeta técnica',                     null,                    0.5),
    ('11. Construcción',                        '5. Construcción',       6),
    ('12. Cierre y as-built',                   '7. Cierre y as-built',  2),
    ('13. Puesta en servicio',                  '6. Puesta en servicio', 1)
  ) as v(nueva, vieja, defecto)
on conflict (segmento, etapa) do nothing;
delete from public.config_tiempos
 where etapa in ('2. Ingeniería y factibilidad','3. Carpeta técnica','4. Permisos','5. Construcción',
                 '6. Puesta en servicio','7. Cierre y as-built');

drop table if exists _mapa_etapas;
drop table if exists _mapa_docs;
drop table if exists _mapa_act;

-- =====================================================================
-- 12. Avance de obra (mismo contenido que 006_avance_obra.sql)
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

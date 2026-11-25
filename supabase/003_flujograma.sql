-- =====================================================================
-- PMO Proyectos DGJ – Alineación con el Flujograma de Proyectos (sep-2025)
-- Ejecutar UNA vez en Supabase → SQL Editor → New query → Run.
-- Se puede volver a ejecutar sin perder datos.
--
-- Qué agrega:
--   • Etapa "2. Ingeniería y factibilidad" con aprobación de Ventas
--     (si Ventas no aprueba, el proyecto pasa a "9. Cancelado").
--   • Rol "Inversiones" y campo Elemento PEP (obligatorio para entrar
--     a Construcción).
--   • Catálogo de actividades del flujograma (área responsable, días,
--     entregables) y su avance por proyecto.
--   • Documentos requeridos tomados del flujograma (reemplaza los de
--     ejemplo que no tengan archivos subidos).
--   • Tiempo de la nueva etapa 2 en el Gantt.
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
  ('3. Carpeta técnica', 10, 'Aprobación de ficha de inversión y generación de Elemento PEP', 'Inversiones', 7, 'Notificación de creación de PEP a Construcción e Instalaciones', false),
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

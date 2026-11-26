-- =====================================================================
-- PMO Proyectos DGJ – Flujo de 14 etapas (expediente de permisos aparte
-- de la carpeta técnica). Ejecutar después de 004_construccion.sql.
-- Se puede volver a ejecutar sin perder datos.
--
--   0. Devuelta a Comercial
--   1. Solicitud                              Comercial → Líder asigna proyectista
--   2. Anteproyecto y factibilidad            Proyectista
--   3. Aprobación comercial (KAM)             Comercial: aprueba, pide cambios (→2) o cancela (→99)
--   4. Obtención del PEP                      Proyectista (gestiona con Inversiones)
--   5. Dictamen de diseño                     Proyectista
--   6. Expediente de permisos                 Proyectista
--   7. Revisión DRO                           Proyectista: sin correcciones → 8 · con correcciones → 6
--   8. Licencias                              Permisos
--   9. Socialización y liberación de zona     Permisos / Líder
--  10. Carpeta técnica                        Proyectista
--  11. Construcción                           Construcción (puede regresar a 10 si la carpeta está incompleta)
--  12. Cierre y as-built                      Construcción
--  13. Puesta en servicio                     Construcción
--  14. Entregado a O&M
--  99. Cancelado
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

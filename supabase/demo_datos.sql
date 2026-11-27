-- =====================================================================
-- PMO Proyectos DGJ – DATOS DE PRUEBA
-- 35 proyectos de los tres segmentos en todas las etapas, y al menos dos
-- usuarios por rol y por puesto. Ejecutar después de 008_capex.sql.
--
-- • Los proyectos llevan "[DEMO]" al inicio de la descripción.
-- • Los usuarios de prueba usan correos @ejemplo.com y NO tienen
--   contraseña: no pueden entrar hasta que se les asigne una en
--   Supabase → Authentication → Users.
-- • Para quitar todo: supabase/demo_borrar.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Usuarios de prueba
-- ---------------------------------------------------------------------
drop table if exists demo_u, demo_p;
create temp table demo_u (email text primary key, nombre text, rol text, puesto text);
insert into demo_u values
  ('laura.mendez@ejemplo.com',    'Laura Méndez',     'Administrador', null),
  ('jorge.ibarra@ejemplo.com',    'Jorge Ibarra',     'Consulta',      null),
  ('paola.ruiz@ejemplo.com',      'Paola Ruiz',       'Consulta',      null),
  ('comercial@ejemplo.com',       'Daniela Ortiz',    'Comercial',     null),
  ('mariana.solis@ejemplo.com',   'Mariana Solís',    'Comercial',     null),
  ('ricardo.navarro@ejemplo.com', 'Ricardo Navarro',  'Comercial',     'KAM'),
  ('fernanda.castro@ejemplo.com', 'Fernanda Castro',  'Comercial',     'KAM'),
  ('hector.salinas@ejemplo.com',  'Héctor Salinas',   'Comercial',     'Supervisor de ventas'),
  ('gabriela.reyes@ejemplo.com',  'Gabriela Reyes',   'Comercial',     'Supervisor de ventas'),
  ('alberto.franco@ejemplo.com',  'Alberto Franco',   'Líder',         null),
  ('sofia.vargas@ejemplo.com',    'Sofía Vargas',     'Líder',         null),
  ('proyectista@ejemplo.com',     'Iván Mora',        'Proyectista',   null),
  ('carla.estrada@ejemplo.com',   'Carla Estrada',    'Proyectista',   null),
  ('rocio.delgado@ejemplo.com',   'Rocío Delgado',    'Permisos',      null),
  ('gestor@ejemplo.com',          'Emilio Gestor',    'Permisos',      null),
  ('tomas.aguilar@ejemplo.com',   'Tomás Aguilar',    'Construcción',  null),
  ('supervisor@ejemplo.com',      'Marco Supervisor', 'Construcción',  null);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       u.email, '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('nombre', u.nombre), now(), now(), '', '', '', ''
  from demo_u u
 where not exists (select 1 from auth.users a where lower(a.email) = u.email);

update public.perfiles p set nombre = u.nombre, rol = u.rol, puesto = u.puesto, activo = true
  from demo_u u where p.email = u.email;

-- ---------------------------------------------------------------------
-- 2. Proyectos
-- ---------------------------------------------------------------------
create temp table demo_p (i int, nombre text, municipio text, segmento text, material text,
                          n int, retraso numeric, frac numeric, capex numeric, bloqueo text);
-- n = etapa actual · retraso = semanas de atraso acumulado (negativo = adelantado) · frac = qué tanto lleva de la etapa
insert into demo_p values
  ( 1, 'Fracc. Los Encinos 2a etapa',          'Zapopan',     'Residencial', 'Polietileno',  0,  0,   0.2, null,    null),
  ( 2, 'Coto Bosque Alto',                     'Tlajomulco',  'Residencial', 'Polietileno',  1,  0,   0.3, null,    null),
  ( 3, 'Plaza Comercial Las Fuentes',          'Guadalajara', 'Comercial',   'Polietileno',  1,  0.5, 0.8, null,    null),
  ( 4, 'Planta de Alimentos del Valle',        'El Salto',    'Industrial',  'Acero',        1, -1,   0.5, null,    null),
  ( 5, 'Residencial Altavista',                'Zapopan',     'Residencial', 'Polietileno',  2,  0,   0.4, null,    null),
  ( 6, 'Hotel Boutique Centro',                'Guadalajara', 'Comercial',   'Polietileno',  2,  1,   0.9, null,    null),
  ( 7, 'Nave Industrial Periférico Sur',       'Tlaquepaque', 'Industrial',  'Acero',        2,  0,   0.2, null,    null),
  ( 8, 'Fracc. Valle de los Robles',           'Tonalá',      'Residencial', 'Polietileno',  3,  0,   0.5, null,    null),
  ( 9, 'Centro Comercial Paseo Norte',         'Zapopan',     'Comercial',   'Polietileno',  3,  0.5, 1.5, null,    null),
  (10, 'Planta Empacadora Agave Azul',         'Tlajomulco',  'Industrial',  'Polietileno',  3, -0.5, 0.3, null,    null),
  (11, 'Torres Mirador',                       'Guadalajara', 'Residencial', 'Polietileno',  4,  0,   0.3, null,    null),
  (12, 'Restaurante Los Agaves',               'Tlaquepaque', 'Comercial',   'Polietileno',  4,  1.5, 1.2, 650000,  'Inversiones no ha liberado la ficha'),
  (13, 'Fundidora Metales de Occidente',       'El Salto',    'Industrial',  'Acero',        4,  0,   0.6, 7400000, null),
  (14, 'Coto Santa Anita',                     'Tlajomulco',  'Residencial', 'Polietileno',  5,  0,   0.4, 1850000, null),
  (15, 'Clínica San Rafael',                   'Zapopan',     'Comercial',   'Polietileno',  5,  2,   1.1, 920000,  null),
  (16, 'Fracc. Jardines del Sol',              'Tonalá',      'Residencial', 'Polietileno',  6,  0,   0.5, 2300000, null),
  (17, 'Planta Textil Las Pintas',             'El Salto',    'Industrial',  'Acero',        6,  0.5, 0.7, 5600000, null),
  (18, 'Plaza Patria Oriente',                 'Guadalajara', 'Comercial',   'Polietileno',  7,  0,   0.3, 1100000, null),
  (19, 'Residencial Puerta del Bosque',        'Zapopan',     'Residencial', 'Polietileno',  7,  1,   1.0, 3100000, 'DRO pidió correcciones en planos'),
  (20, 'Fracc. Hacienda Real',                 'Tlaquepaque', 'Residencial', 'Polietileno',  8,  0,   0.4, 2650000, null),
  (21, 'Planta de Plásticos del Bajío',        'Tlajomulco',  'Industrial',  'Acero',        8,  3,   1.4, 8200000, 'Licencia municipal detenida en ventanilla'),
  (22, 'Supermercado Las Palmas',              'Tonalá',      'Comercial',   'Polietileno',  9,  0,   0.5, 780000,  null),
  (23, 'Coto Los Olivos',                      'Zapopan',     'Residencial', 'Polietileno',  9, -0.5, 0.2, 1450000, null),
  (24, 'Parque Industrial El Castillo',        'El Salto',    'Industrial',  'Acero',       10,  0,   0.5, 9100000, null),
  (25, 'Fracc. Arboledas',                     'Guadalajara', 'Residencial', 'Polietileno', 10,  1,   1.2, 2050000, null),
  (26, 'Fracc. Lomas del Pedregal',            'Tlajomulco',  'Residencial', 'Polietileno', 11,  0,   0.5, 3400000, null),
  (27, 'Centro de Distribución Periférico',    'Tlaquepaque', 'Industrial',  'Acero',       11,  1,   0.7, 6800000, null),
  (28, 'Plaza Galerías Norte',                 'Zapopan',     'Comercial',   'Polietileno', 11,  2.5, 1.1, 1350000, 'Falta permiso de cierre de calle'),
  (29, 'Fracc. Villas de San Martín',          'Tonalá',      'Residencial', 'Polietileno', 11, -0.5, 0.1, 2750000, null),
  (30, 'Torre Corporativa Américas',           'Guadalajara', 'Comercial',   'Polietileno', 12,  0,   0.5, 1600000, null),
  (31, 'Planta Química Santa Rosa',            'El Salto',    'Industrial',  'Acero',       12,  1,   0.8, 7900000, null),
  (32, 'Residencial Cumbres',                  'Zapopan',     'Residencial', 'Polietileno', 13,  0,   0.4, 1950000, null),
  (33, 'Fracc. Rinconada del Valle',           'Tlajomulco',  'Residencial', 'Polietileno', 14,  0,   0,   2450000, null),
  (34, 'Panadería Industrial La Espiga',       'Tlaquepaque', 'Industrial',  'Polietileno', 14,  1,   0,   2900000, null),
  (35, 'Plaza Comercial Tonalá Centro',        'Tonalá',      'Comercial',   'Polietileno', 99,  0,   0,   null,    null);

do $$
declare
  v_hoy   date := (now() at time zone 'America/Mexico_City')::date;
  r       record;
  w       numeric[];      -- semanas por etapa 1..13
  ini     date[];         -- inicio planeado de cada etapa
  ent     date[];         -- fecha real de entrada a cada etapa
  v_gas   date;
  v_id    uuid;
  v_n     int;            -- etapa "efectiva" (0 → 1, 99 → 3, 14 → 13)
  v_tot   numeric;
  k       int;
  v_sol   uuid; v_lid uuid; v_proy uuid; v_apr uuid; v_perm uuid; v_cons uuid;
  v_firma text; v_pep text; v_fpep date; v_etq text; v_quien uuid; v_fecha date; v_pct numeric; v_ritmo numeric;
  com     uuid[]; lid uuid[]; pry uuid[]; kam uuid[]; sup uuid[]; per uuid[]; con uuid[];
begin
  if exists (select 1 from public.proyectos where descripcion like '[DEMO]%') then
    raise exception 'Ya hay datos de prueba. Ejecuta primero supabase/demo_borrar.sql';
  end if;

  select array_agg(id order by email) into com from public.perfiles where rol = 'Comercial' and puesto is null and email like '%@ejemplo.com';
  select array_agg(id order by email) into lid from public.perfiles where rol = 'Líder'        and email like '%@ejemplo.com';
  select array_agg(id order by email) into pry from public.perfiles where rol = 'Proyectista'  and email like '%@ejemplo.com';
  select array_agg(id order by email) into kam from public.perfiles where puesto = 'KAM'       and email like '%@ejemplo.com';
  select array_agg(id order by email) into sup from public.perfiles where puesto = 'Supervisor de ventas' and email like '%@ejemplo.com';
  select array_agg(id order by email) into per from public.perfiles where rol = 'Permisos'     and email like '%@ejemplo.com';
  select array_agg(id order by email) into con from public.perfiles where rol = 'Construcción' and email like '%@ejemplo.com';

  alter table public.proyectos disable trigger proyectos_bu;
  alter table public.avance_obra disable trigger avance_obra_ai;

  for r in select * from demo_p order by i loop
    -- Semanas por etapa según el segmento
    select array_agg(coalesce(t.semanas, 1) order by g.k) into w
      from generate_series(1, 13) g(k)
      left join public.config_tiempos t on t.segmento = r.segmento and split_part(t.etapa, '.', 1)::int = g.k;

    v_n := case when r.n = 0 then 1 when r.n = 99 then 3 when r.n = 14 then 13 else r.n end;

    -- Fecha de gas para que hoy caiga dentro de la etapa actual (con el retraso indicado)
    v_tot := 0;
    for k in v_n .. 13 loop v_tot := v_tot + w[k]; end loop;
    if r.n = 14 then
      v_gas := v_hoy - (3 + r.i % 5) * 7;                                 -- entregado hace unas semanas
    elsif r.n = 0 then
      v_gas := v_hoy + round((v_tot + 2) * 7)::int;
    else
      v_gas := v_hoy - round((r.frac * w[v_n] + r.retraso) * 7)::int + round(v_tot * 7)::int;
    end if;
    v_gas := v_gas + (7 - extract(isodow from v_gas)::int) % 7 - 2;     -- cae en viernes

    ini := array_fill(null::date, array[14]); ent := array_fill(null::date, array[14]);
    ini[14] := v_gas;
    for k in reverse 13 .. 1 loop ini[k] := ini[k + 1] - round(w[k] * 7)::int; end loop;
    for k in 1 .. least(v_n, 13) loop
      ent[k] := ini[k] + round(r.retraso * 7 * k / greatest(v_n, 1))::int;
    end loop;
    if r.n = 14 then ent[14] := v_gas + round(r.retraso * 7)::int; end if;
    if ent[v_n] > v_hoy then ent[v_n] := v_hoy - 1; end if;
    for k in reverse v_n - 1 .. 1 loop
      if ent[k] >= ent[k + 1] then ent[k] := ent[k + 1] - 2; end if;
    end loop;

    -- Personas
    v_sol  := com[1 + r.i % array_length(com, 1)];
    v_lid  := lid[1 + r.i % array_length(lid, 1)];
    v_proy := pry[1 + r.i % array_length(pry, 1)];
    v_apr  := case when r.segmento = 'Industrial' then kam[1 + r.i % array_length(kam, 1)] else sup[1 + r.i % array_length(sup, 1)] end;
    v_perm := per[1 + r.i % array_length(per, 1)];
    v_cons := con[1 + r.i % array_length(con, 1)];
    select coalesce(nombre, email) || ' (' || coalesce(puesto, rol) || ')' into v_firma from public.perfiles where id = v_apr;

    insert into public.proyectos (nombre, municipio, segmento, material, direccion, descripcion, solicitante_id, fecha_requerida_gas)
    values (r.nombre, r.municipio, r.segmento, r.material,
            'Av. Ejemplo ' || (100 + r.i * 37) || ', ' || r.municipio,
            '[DEMO] Proyecto de prueba ' || r.segmento || ' para ver la app con datos.',
            v_sol, v_gas)
    returning id into v_id;

    -- PEP y CAPEX (desde Obtención del PEP; en esa etapa solo si ya se tiene)
    v_pep := null; v_fpep := null;
    if r.n between 5 and 14 or (r.n = 4 and r.capex is not null) then
      v_pep  := case r.segmento when 'Industrial' then 'I' when 'Comercial' then 'C' else 'R' end
                || '-26-' || lpad((200 + r.i * 7)::text, 4, '0') || '-001';
      v_fpep := case when r.n = 4 then v_hoy - 3 else ent[5] - 2 end;
    end if;

    update public.proyectos set
      etapa = (select e from unnest(array['0. Devuelta a Comercial','1. Solicitud','2. Anteproyecto y factibilidad',
               '3. Aprobación comercial (KAM)','4. Obtención del PEP','5. Dictamen de diseño','6. Expediente de permisos',
               '7. Revisión DRO','8. Licencias','9. Socialización y liberación de zona','10. Carpeta técnica',
               '11. Construcción','12. Cierre y as-built','13. Puesta en servicio','14. Entregado a O&M','99. Cancelado']) e
               where split_part(e, '.', 1)::int = r.n),
      proyectista_id = case when r.n >= 2 then v_proy end,
      factibilidad   = case when r.n = 2 then 'En elaboración' when r.n = 3 then 'En revisión'
                            when r.n = 99 then 'Rechazada' when r.n >= 4 then 'Aprobada' end,
      aprobado_por    = case when r.n between 4 and 14 then v_apr end,
      aprobado_puesto = case when r.n between 4 and 14 then (select coalesce(puesto, rol) from public.perfiles where id = v_apr) end,
      aprobado_en     = case when r.n between 4 and 14 then (ent[4] + time '12:00') at time zone 'America/Mexico_City' end,
      elemento_pep = v_pep, fecha_pep = v_fpep,
      capex = case when v_pep is not null then r.capex end,
      bloqueo = r.bloqueo,
      siguiente_accion = case when r.n between 1 and 13 then 'Seguimiento semanal' end,
      fecha_compromiso = case when r.n between 1 and 13 then ini[least(v_n + 1, 14)] end,
      created_at = (ent[1] + time '09:30') at time zone 'America/Mexico_City',
      updated_at = now()
    where id = v_id;

    -- Historial
    update public.historial set created_at = (ent[1] + time '09:30') at time zone 'America/Mexico_City', usuario_id = v_sol
     where proyecto_id = v_id and accion = 'Solicitud creada';

    if r.n = 0 then
      insert into public.historial (proyecto_id, usuario_id, accion, etapa_anterior, etapa_nueva, comentario, created_at)
      values (v_id, v_lid, 'Devuelto a Comercial', '1. Solicitud', '0. Devuelta a Comercial',
              'Falta el comprobante de propiedad y el plano de ubicación', ((ent[1] + 3) + time '11:00') at time zone 'America/Mexico_City');
    end if;

    for k in 2 .. least(v_n, 13) loop
      v_quien := case when k = 2 then v_lid when k in (3,5,6,7,8,11) then v_proy when k = 4 then v_apr
                      when k in (9,10) then v_perm else v_cons end;
      v_etq := case when k = 4 then 'Anteproyecto aprobado por: ' || v_firma else 'Avance de etapa' end;
      insert into public.historial (proyecto_id, usuario_id, accion, etapa_anterior, etapa_nueva, created_at)
      select v_id, v_quien, v_etq, a.e, b.e, (ent[k] + time '10:00') at time zone 'America/Mexico_City'
        from (select e from unnest(array['1. Solicitud','2. Anteproyecto y factibilidad','3. Aprobación comercial (KAM)',
               '4. Obtención del PEP','5. Dictamen de diseño','6. Expediente de permisos','7. Revisión DRO','8. Licencias',
               '9. Socialización y liberación de zona','10. Carpeta técnica','11. Construcción','12. Cierre y as-built',
               '13. Puesta en servicio']) e) a,
             (select e from unnest(array['1. Solicitud','2. Anteproyecto y factibilidad','3. Aprobación comercial (KAM)',
               '4. Obtención del PEP','5. Dictamen de diseño','6. Expediente de permisos','7. Revisión DRO','8. Licencias',
               '9. Socialización y liberación de zona','10. Carpeta técnica','11. Construcción','12. Cierre y as-built',
               '13. Puesta en servicio']) e) b
       where split_part(a.e, '.', 1)::int = k - 1 and split_part(b.e, '.', 1)::int = k;
      if k = 2 then
        insert into public.historial (proyecto_id, usuario_id, accion, comentario, created_at)
        select v_id, v_lid, 'Proyectista asignado', coalesce(nombre, email), (ent[2] + time '10:01') at time zone 'America/Mexico_City'
          from public.perfiles where id = v_proy;
      end if;
    end loop;

    if r.n = 14 then
      insert into public.historial (proyecto_id, usuario_id, accion, etapa_anterior, etapa_nueva, comentario, created_at)
      values (v_id, v_cons, 'Avance de etapa', '13. Puesta en servicio', '14. Entregado a O&M', 'Gas en servicio, entregado a O&M',
              (ent[14] + time '10:00') at time zone 'America/Mexico_City');
    elsif r.n = 99 then
      select coalesce(nombre, email) || ' (' || coalesce(puesto, rol) || ')' into v_firma from public.perfiles where id = v_apr;
      insert into public.historial (proyecto_id, usuario_id, accion, etapa_anterior, etapa_nueva, comentario, created_at)
      values (v_id, v_apr, 'Anteproyecto no aprobado por: ' || v_firma || ' – Cancelado', '3. Aprobación comercial (KAM)', '99. Cancelado',
              'El cliente pospuso la obra un año; no es rentable con el consumo estimado', ((ent[3] + 2) + time '13:00') at time zone 'America/Mexico_City');
    end if;

    if v_pep is not null then
      insert into public.historial (proyecto_id, usuario_id, accion, comentario, created_at) values
        (v_id, v_proy, 'Elemento PEP registrado', v_pep, (v_fpep + time '16:00') at time zone 'America/Mexico_City'),
        (v_id, v_proy, 'CAPEX registrado', to_char(r.capex, 'FM$999,999,999,990.00') || ' MXN', (v_fpep + time '16:01') at time zone 'America/Mexico_City');
    end if;

    if r.bloqueo is not null then
      insert into public.historial (proyecto_id, usuario_id, accion, comentario, created_at)
      values (v_id, v_lid, 'Comentario', 'Bloqueo: ' || r.bloqueo, ((v_hoy - 2) + time '12:00') at time zone 'America/Mexico_City');
    end if;

    -- Actividades del flujograma de las etapas ya terminadas
    insert into public.proyecto_actividades (proyecto_id, actividad_id, estatus, usuario_id, updated_at)
    select v_id, a.id, 'Hecha', v_proy, now()
      from public.config_actividades a
     where split_part(a.etapa, '.', 1)::int < (case when r.n = 0 then 1 when r.n = 99 then 3 else r.n end)
    on conflict do nothing;

    -- Licencias (desde la etapa 8)
    if r.n between 8 and 14 then
      insert into public.licencias (proyecto_id, tipo, dependencia, estatus, fecha_ingreso, fecha_vencimiento, notas) values
        (v_id, 'Licencia de construcción (obra en vía pública)', 'Municipio de ' || r.municipio,
         case when r.n = 8 and r.retraso > 1 then 'En trámite' else 'Aprobada' end,
         ent[8] + 2, ent[8] + 180, case when r.n = 8 and r.retraso > 1 then 'En revisión en ventanilla' end),
        (v_id, 'Permiso de ruptura de pavimento', 'Obras Públicas ' || r.municipio,
         case when r.n = 8 then 'En trámite' else 'Aprobada' end,
         ent[8] + 3, ent[8] + 120, null);
    end if;

    -- Avance de obra (Construcción en adelante)
    if r.n = 11 and r.frac > 0.15 then
      v_ritmo := case when r.retraso > 2 then 0.65 when r.retraso > 0.5 then 0.85 else 1.05 end;
      v_fecha := ent[11] + 7; v_pct := 0;
      while v_fecha <= v_hoy loop
        v_pct := least(95, round(((v_fecha - ent[11]) / (w[11] * 7) * 100 * v_ritmo)::numeric / 5) * 5);
        if v_pct > 0 then
          insert into public.avance_obra (proyecto_id, fecha, porcentaje, nota, usuario_id)
          values (v_id, v_fecha, v_pct, case when v_fecha + 7 > v_hoy then 'Reporte semanal de cuadrilla' end, v_cons);
        end if;
        v_fecha := v_fecha + 7;
      end loop;
    elsif r.n between 12 and 14 then
      insert into public.avance_obra (proyecto_id, fecha, porcentaje, nota, usuario_id) values
        (v_id, ent[11] + round(w[11] * 3.5)::int, 50, null, v_cons),
        (v_id, ent[12] - 1, 100, 'Obra terminada', v_cons);
    end if;
  end loop;

  alter table public.proyectos enable trigger proyectos_bu;
  alter table public.avance_obra enable trigger avance_obra_ai;
end $$;

select count(*) as proyectos_demo from public.proyectos where descripcion like '[DEMO]%';
drop table if exists demo_u, demo_p;

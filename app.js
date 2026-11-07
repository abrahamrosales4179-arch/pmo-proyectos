import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, NOMBRE_APP, ETAPAS } from './config.js';

// ---------------------------------------------------------------------
// Constantes y estado
// ---------------------------------------------------------------------
const ROLES = ['Administrador', 'Consulta', 'Comercial', 'Líder', 'Proyectista', 'Permisos', 'Construcción', 'Sin rol'];
const SEGMENTOS = ['Residencial', 'Comercial', 'Industrial'];
const MATERIALES = ['Polietileno', 'Acero'];
const ESTATUS_LIC = ['Pendiente', 'En trámite', 'Aprobada', 'Rechazada'];
const BUCKET = 'expedientes';

const configurado = !SUPABASE_URL.includes('TU-PROYECTO') && !SUPABASE_ANON_KEY.includes('PEGA-AQUI');
const sb = configurado ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const app = document.getElementById('app');
const S = { session: null, perfil: null, municipios: [], configDocs: [], perfiles: [], tiempos: [], ganttListo: false };

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const num = (e) => parseInt(e, 10);
const etapaPorNum = (n) => ETAPAS.find((e) => num(e) === n);
const siguienteEtapa = (e) => { const i = ETAPAS.indexOf(e); return i >= 0 && i < ETAPAS.length - 1 ? ETAPAS[i + 1] : null; };
const hoyISO = () => new Date().toLocaleDateString('en-CA');
const fecha = (d) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fechaHora = (d) => (d ? new Date(d).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const tamano = (b) => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const nombreDe = (id) => { const p = S.perfiles.find((x) => x.id === id); return p ? p.nombre || p.email : '—'; };
const rol = () => S.perfil?.rol;
const esAdmin = () => rol() === 'Administrador';
const puedeEditar = () => !!rol() && !['Consulta', 'Sin rol'].includes(rol());
const puedeCrear = () => ['Comercial', 'Administrador'].includes(rol());
const badgeEtapa = (e) => `<span class="badge e${num(e)}">${esc(e)}</span>`;
const vencido = (p) => p.fecha_compromiso && p.fecha_compromiso < hoyISO() && num(p.etapa) < 8;

function toast(msg, tipo = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}
const errorTxt = (e) => e?.message || String(e);
const fallo = (e) => { console.error(e); toast(errorTxt(e), 'error'); };
function vista(msg = '') {
  const v = $('#vista');
  v.innerHTML = msg ? `<p class="muted">${esc(msg)}</p>` : '';
  window.scrollTo(0, 0);
  return v;
}

function docsDe(etapa, segmento, material) {
  return S.configDocs
    .filter((d) => d.etapa === etapa && (!d.segmento || d.segmento === segmento) && (!d.material || d.material === material))
    .sort((a, b) => a.orden - b.orden || a.id - b.id);
}

async function subirArchivo(proyectoId, docId, file) {
  const limpio = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_');
  const ruta = `${proyectoId}/${docId ?? 'otros'}/${Date.now()}_${limpio}`;
  const up = await sb.storage.from(BUCKET).upload(ruta, file, { upsert: false });
  if (up.error) throw up.error;
  const ins = await sb.from('documentos').insert({ proyecto_id: proyectoId, config_doc_id: docId, nombre_archivo: file.name, ruta, tamano: file.size });
  if (ins.error) throw ins.error;
}

// ---------------------------------------------------------------------
// Arranque y sesión
// ---------------------------------------------------------------------
async function init() {
  document.title = NOMBRE_APP;
  if (!configurado) {
    app.innerHTML = `<div class="centro"><div class="card login">
      <h1>${esc(NOMBRE_APP)}</h1>
      <p>Falta configurar la conexión a Supabase.</p>
      <p class="muted">Edita <b>config.js</b> con la URL y la <i>anon public key</i> de tu proyecto (Supabase → Project Settings → API). Los pasos completos están en el README.</p>
    </div></div>`;
    return;
  }
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  sb.auth.onAuthStateChange((_evento, session) => {
    const antes = !!S.session;
    S.session = session;
    if (antes !== !!session) setTimeout(cargarYMostrar, 0);
  });
  window.addEventListener('hashchange', router);
  await cargarYMostrar();
}

async function cargarCatalogos() {
  const [mun, docs, pers] = await Promise.all([
    sb.from('municipios').select('*').order('nombre'),
    sb.from('config_documentos').select('*').order('orden'),
    sb.from('perfiles').select('id,email,nombre,rol,activo').order('nombre'),
  ]);
  const e = mun.error || docs.error || pers.error;
  if (e) throw e;
  S.municipios = mun.data;
  S.configDocs = docs.data;
  S.perfiles = pers.data;
  // Tiempos del Gantt (si aún no se ejecuta supabase/002_gantt.sql, la app sigue funcionando sin Gantt)
  const tiempos = await sb.from('config_tiempos').select('*');
  S.ganttListo = !tiempos.error;
  S.tiempos = tiempos.data || [];
}

// ---------------------------------------------------------------------
// Gantt: se calcula hacia atrás desde la fecha requerida de gas
// ---------------------------------------------------------------------
const ETAPAS_ANTES = [1, 3, 4, 5, 6];   // terminan el día que se requiere el gas
const ETAPAS_DESPUES = [7];             // ocurren después de la puesta en servicio
const DIA = 86400000;
function diaDe(x) {
  if (x instanceof Date) { const d = new Date(x); d.setHours(12, 0, 0, 0); return d; }
  if (typeof x === 'string' && x.length === 10) return new Date(x + 'T12:00:00');
  const d = new Date(x); d.setHours(12, 0, 0, 0); return d;
}
const sumaDias = (d, n) => new Date(d.getTime() + n * DIA);
const isoDe = (d) => d.toLocaleDateString('en-CA');
const semanasDe = (seg, etapa) => Number(S.tiempos.find((t) => t.segmento === seg && t.etapa === etapa)?.semanas ?? 0);
const totalSemanas = (seg) => ETAPAS_ANTES.reduce((a, n) => a + semanasDe(seg, etapaPorNum(n)), 0);
const nombreCorto = (e) => e.replace(/^\d+\.\s*/, '');

function planDe(p) {
  if (!p.fecha_requerida_gas || !S.tiempos.length) return null;
  const req = diaDe(p.fecha_requerida_gas);
  const filas = [];
  let fin = req;
  for (const n of [...ETAPAS_ANTES].reverse()) {
    const etapa = etapaPorNum(n);
    if (!etapa) continue;
    const inicio = sumaDias(fin, -Math.round(semanasDe(p.segmento, etapa) * 7));
    filas.unshift({ n, etapa, inicio, fin });
    fin = inicio;
  }
  let ini = req;
  for (const n of ETAPAS_DESPUES) {
    const etapa = etapaPorNum(n);
    if (!etapa) continue;
    const f = sumaDias(ini, Math.round(semanasDe(p.segmento, etapa) * 7));
    filas.push({ n, etapa, inicio: ini, fin: f, despues: true });
    ini = f;
  }
  if (!filas.length) return null;
  const recibido = diaDe(p.created_at);
  return { req, filas, inicioPlan: filas[0].inicio, holgura: Math.round((filas[0].inicio - recibido) / DIA) };
}

function estadoPlan(p, plan = planDe(p)) {
  if (!plan) return null;
  const n = num(p.etapa);
  if (n >= 8) return { clase: 'ok', texto: 'Entregado' };
  const fila = plan.filas.find((f) => f.n === Math.max(1, n));
  if (!fila) return null;
  const dias = Math.round((fila.fin - diaDe(hoyISO())) / DIA);
  if (dias < 0) return { clase: 'mal', texto: `Atrasado ${Math.ceil(-dias / 7)} sem` };
  if (dias <= 7) return { clase: 'riesgo', texto: 'En riesgo' };
  return { clase: 'ok', texto: 'A tiempo' };
}
const pillPlan = (st) => (st ? `<span class="plan ${st.clase}">${esc(st.texto)}</span>` : '<span class="muted">—</span>');

// Fechas reales de entrada y salida de cada etapa, según el historial
function realesDe(p, hist) {
  const cambios = hist.filter((h) => h.etapa_nueva).map((h) => ({ ...h, t: diaDe(h.created_at) })).sort((a, b) => a.t - b.t);
  const r = {};
  for (const c of cambios) {
    if (c.etapa_anterior && r[c.etapa_anterior]) r[c.etapa_anterior].fin = c.t;
    if (!r[c.etapa_nueva]) r[c.etapa_nueva] = { inicio: c.t, fin: null };
  }
  if (r[p.etapa]) r[p.etapa].fin = null; // etapa en curso
  return r;
}

function ganttHtml(p, plan, reales) {
  const hoy = diaDe(hoyISO());
  const fechas = [hoy, diaDe(p.created_at), ...plan.filas.flatMap((f) => [f.inicio, f.fin])];
  Object.values(reales).forEach((r) => { fechas.push(r.inicio); if (r.fin) fechas.push(r.fin); });
  const min = sumaDias(new Date(Math.min(...fechas)), -7);
  const max = sumaDias(new Date(Math.max(...fechas)), 7);
  const pct = (d) => (((d - min) / (max - min)) * 100).toFixed(2);
  const ancho = (a, b) => Math.max(0.6, ((b - a) / (max - min)) * 100).toFixed(2);

  const meses = [];
  for (let m = new Date(min.getFullYear(), min.getMonth() + 1, 1, 12); m < max; m = new Date(m.getFullYear(), m.getMonth() + 1, 1, 12)) meses.push(m);
  const lineas = `${meses.map((m) => `<i class="g-mes" style="left:${pct(m)}%"></i>`).join('')}
    <i class="g-hoy" style="left:${pct(hoy)}%"></i><i class="g-req" style="left:${pct(plan.req)}%"></i>`;

  const filas = plan.filas.map((f) => {
    const r = reales[f.etapa];
    let real = '';
    if (r) {
      const fin = r.fin || hoy;
      const clase = fin > f.fin ? 'tarde' : r.fin ? 'ok' : 'curso';
      real = `<div class="g-bar real ${clase}" style="left:${pct(r.inicio)}%;width:${ancho(r.inicio, fin)}%" title="Real: ${fecha(isoDe(r.inicio))} – ${r.fin ? fecha(isoDe(r.fin)) : 'en curso'}"></div>`;
    }
    return `<div class="g-fila ${f.etapa === p.etapa ? 'actual' : ''}">
      <div class="g-label"><b>${esc(nombreCorto(f.etapa))}</b><small>${fecha(isoDe(f.inicio))} – ${fecha(isoDe(f.fin))}</small></div>
      <div class="g-track">${lineas}
        <div class="g-bar plan ${f.despues ? 'post' : ''}" style="left:${pct(f.inicio)}%;width:${ancho(f.inicio, f.fin)}%" title="Plan: ${Math.round((f.fin - f.inicio) / DIA / 7 * 10) / 10} semanas"></div>
        ${real}
      </div></div>`;
  }).join('');

  return `<div class="gantt">
    <div class="g-fila g-escala"><div class="g-label"></div><div class="g-track">
      ${meses.map((m) => `<span style="left:${pct(m)}%">${m.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' })}</span>`).join('')}
    </div></div>
    ${filas}
  </div>
  <div class="g-leyenda">
    <span><i class="sw plan"></i>Plan</span><span><i class="sw ok"></i>Real a tiempo</span><span><i class="sw curso"></i>En curso</span>
    <span><i class="sw tarde"></i>Real fuera de plan</span><span><i class="sw hoy"></i>Hoy</span><span><i class="sw req"></i>Gas requerido</span>
  </div>`;
}

async function cargarYMostrar() {
  if (!S.session) { S.perfil = null; return pantallaLogin(); }
  try {
    const { data, error } = await sb.from('perfiles').select('*').eq('id', S.session.user.id).maybeSingle();
    if (error) throw error;
    S.perfil = data;
    if (!data || data.rol === 'Sin rol' || !data.activo) return pantallaSinRol();
    await cargarCatalogos();
    pantallaPrincipal();
    router();
  } catch (e) {
    app.innerHTML = `<div class="centro"><div class="card login"><h1>Error</h1><p>${esc(errorTxt(e))}</p>
      <p class="muted">¿Ejecutaste supabase/schema.sql en tu proyecto?</p><button class="btn" id="btnSalir">Salir</button></div></div>`;
    $('#btnSalir').onclick = () => sb.auth.signOut();
  }
}

function pantallaLogin() {
  app.innerHTML = `<div class="centro"><form class="card login" id="frmLogin">
    <h1>${esc(NOMBRE_APP)}</h1>
    <p class="muted">Control y seguimiento de proyectos</p>
    <label>Correo<input type="email" name="email" required autocomplete="username"></label>
    <label>Contraseña<input type="password" name="password" required autocomplete="current-password"></label>
    <button class="btn" type="submit">Entrar</button>
    <p class="muted chico">¿Sin acceso o sin contraseña? Pide al administrador que te dé de alta.</p>
  </form></div>`;
  $('#frmLogin').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const btn = $('button', ev.target);
    btn.disabled = true; btn.textContent = 'Entrando…';
    const { error } = await sb.auth.signInWithPassword({ email: f.get('email').trim(), password: f.get('password') });
    if (error) { toast(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos' : error.message, 'error'); btn.disabled = false; btn.textContent = 'Entrar'; }
  };
}

function pantallaSinRol() {
  const correo = S.session.user.email;
  app.innerHTML = `<div class="centro"><div class="card login">
    <h1>${esc(NOMBRE_APP)}</h1>
    <p>Tu usuario <b>${esc(correo)}</b> todavía no tiene un rol asignado${S.perfil && !S.perfil.activo ? ' o está desactivado' : ''}.</p>
    <p class="muted">Pide al administrador que te asigne uno en la pantalla Administración.</p>
    <button class="btn sec" id="btnSalir">Salir</button>
  </div></div>`;
  $('#btnSalir').onclick = () => sb.auth.signOut();
}

function pantallaPrincipal() {
  app.innerHTML = `
  <header class="top">
    <a class="marca" href="#/inicio">${esc(NOMBRE_APP)}</a>
    <nav>
      <a href="#/inicio" data-r="inicio">Inicio</a>
      ${S.ganttListo ? '<a href="#/gantt" data-r="gantt">Gantt general</a>' : ''}
      ${puedeCrear() ? '<a href="#/nueva" data-r="nueva">Nueva solicitud</a>' : ''}
      ${esAdmin() ? '<a href="#/admin" data-r="admin">Administración</a>' : ''}
    </nav>
    <div class="usuario">
      <a href="#/cuenta" data-r="cuenta" title="Mi cuenta">${esc(S.perfil.nombre || S.perfil.email)} <small>${esc(S.perfil.rol)}</small></a>
      <button class="btn sec chico" id="btnSalir">Salir</button>
    </div>
  </header>
  <main id="vista"></main>`;
  $('#btnSalir').onclick = () => sb.auth.signOut();
}

function router() {
  if (!S.perfil || !$('#vista')) return;
  const [, ruta = 'inicio', id] = (location.hash || '#/inicio').split('/');
  $$('nav a, .usuario a').forEach((a) => a.classList.toggle('activo', a.dataset.r === ruta));
  if (ruta === 'nueva') return vistaNueva();
  if (ruta === 'gantt') return vistaGanttGeneral();
  if (ruta === 'p' && id) return vistaDetalle(id);
  if (ruta === 'admin') return vistaAdmin();
  if (ruta === 'cuenta') return vistaCuenta();
  return vistaInicio();
}

// ---------------------------------------------------------------------
// Inicio: bandeja por rol
// ---------------------------------------------------------------------
function enMiBandeja(p) {
  const me = S.perfil.id;
  const n = num(p.etapa);
  switch (rol()) {
    case 'Administrador':
    case 'Consulta': return true;
    case 'Comercial': return p.solicitante_id === me;
    case 'Líder': return n === 1;
    case 'Proyectista': return n === 3 && p.proyectista_id === me;
    case 'Permisos': return n === 4;
    case 'Construcción': return n >= 5 && n <= 7;
    default: return false;
  }
}

async function vistaInicio() {
  const v = vista('Cargando proyectos…');
  const { data, error } = await sb.from('proyectos').select('*').order('created_at', { ascending: false });
  if (error) { v.innerHTML = `<p class="error">${esc(errorTxt(error))}</p>`; return; }

  const verTodoSiempre = ['Administrador', 'Consulta'].includes(rol());
  const f = { todos: verTodoSiempre, etapa: '', q: '' };

  v.innerHTML = `
    <div class="titulo">
      <h1 id="tituloBandeja"></h1>
      <div class="acciones">
        ${verTodoSiempre ? '' : '<label class="switch"><input type="checkbox" id="chkTodos"> Ver todos</label>'}
        ${puedeCrear() ? '<a class="btn" href="#/nueva">+ Nueva solicitud</a>' : ''}
      </div>
    </div>
    <div class="kpis" id="kpis"></div>
    <input id="txtBuscar" class="buscar" type="search" placeholder="Buscar por folio, nombre, municipio o dirección…">
    <div id="lista"></div>`;

  const pintar = () => {
    const base = f.todos ? data : data.filter(enMiBandeja);
    const conteo = Object.fromEntries(ETAPAS.map((e) => [e, 0]));
    base.forEach((p) => { if (p.etapa in conteo) conteo[p.etapa]++; });
    const atrasado = (p) => vencido(p) || estadoPlan(p)?.clase === 'mal';
    const vencidos = base.filter(atrasado).length;
    const q = f.q.trim().toLowerCase();
    const lista = base.filter((p) =>
      (!f.etapa || (f.etapa === 'vencidos' ? atrasado(p) : p.etapa === f.etapa)) &&
      (!q || [p.folio, p.nombre, p.municipio, p.direccion].some((x) => (x || '').toLowerCase().includes(q))));

    $('#tituloBandeja').textContent = f.todos ? 'Todos los proyectos' : 'Mi bandeja';
    $('#kpis').innerHTML =
      `<button class="kpi ${!f.etapa ? 'activo' : ''}" data-etapa=""><b>${base.length}</b><span>Total</span></button>` +
      ETAPAS.map((e) => `<button class="kpi k${num(e)} ${f.etapa === e ? 'activo' : ''}" data-etapa="${esc(e)}"><b>${conteo[e]}</b><span>${esc(e)}</span></button>`).join('') +
      `<button class="kpi alerta ${f.etapa === 'vencidos' ? 'activo' : ''}" data-etapa="vencidos"><b>${vencidos}</b><span>Atrasados</span></button>`;
    $('#lista').innerHTML = lista.length ? tablaProyectos(lista) : '<p class="vacio">No hay proyectos en esta vista.</p>';

    $$('.kpi', v).forEach((b) => (b.onclick = () => { f.etapa = f.etapa === b.dataset.etapa ? '' : b.dataset.etapa; pintar(); }));
    $$('tr[data-id]', v).forEach((tr) => (tr.onclick = () => (location.hash = `#/p/${tr.dataset.id}`)));
  };

  $('#txtBuscar').oninput = (e) => { f.q = e.target.value; pintar(); };
  const chk = $('#chkTodos');
  if (chk) chk.onchange = () => { f.todos = chk.checked; f.etapa = ''; pintar(); };
  pintar();
}

function tablaProyectos(lista) {
  return `<div class="tabla-wrap"><table class="tabla">
    <thead><tr><th>Folio</th><th>Proyecto</th><th>Municipio</th><th>Segmento</th><th>Etapa</th><th>Proyectista</th><th>Gas requerido</th><th>Plan</th></tr></thead>
    <tbody>${lista.map((p) => `
      <tr data-id="${p.id}">
        <td><b>${esc(p.folio)}</b></td>
        <td>${esc(p.nombre)}${p.bloqueo ? ' <span class="bloq" title="' + esc(p.bloqueo) + '">⚠ Bloqueo</span>' : ''}</td>
        <td>${esc(p.municipio)}</td>
        <td>${esc(p.segmento)}${p.segmento === 'Industrial' ? ' · ' + esc(p.material) : ''}</td>
        <td>${badgeEtapa(p.etapa)}</td>
        <td>${p.proyectista_id ? esc(nombreDe(p.proyectista_id)) : '<span class="muted">—</span>'}</td>
        <td>${fecha(p.fecha_requerida_gas)}</td>
        <td>${pillPlan(estadoPlan(p))}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

// ---------------------------------------------------------------------
// Gantt general: todos los proyectos en una sola línea de tiempo
// ---------------------------------------------------------------------
async function vistaGanttGeneral() {
  const v = vista('Cargando proyectos…');
  if (!S.ganttListo) { v.innerHTML = '<p class="muted">Falta ejecutar <b>supabase/002_gantt.sql</b> en Supabase para activar el Gantt.</p>'; return; }
  const { data, error } = await sb.from('proyectos').select('*').order('fecha_requerida_gas', { ascending: true, nullsFirst: false });
  if (error) { v.innerHTML = `<p class="error">${esc(errorTxt(error))}</p>`; return; }

  const todos = data.map((p) => { const plan = planDe(p); return { p, plan, st: estadoPlan(p, plan) }; });
  const f = { seg: '', estado: '', entregados: false, q: '' };

  v.innerHTML = `
    <div class="titulo"><h1>Gantt general</h1></div>
    <div class="kpis" id="ggKpis"></div>
    <div class="gg-filtros">
      <input id="ggBuscar" type="search" placeholder="Buscar por folio, nombre o municipio…">
      <select id="ggSeg"><option value="">Todos los segmentos</option>${SEGMENTOS.map((x) => `<option>${x}</option>`).join('')}</select>
      <label class="switch"><input type="checkbox" id="ggEntregados"> Incluir entregados</label>
    </div>
    <div id="ggCuerpo"></div>`;

  const pintar = () => {
    const q = f.q.trim().toLowerCase();
    const base = todos.filter(({ p }) =>
      (f.entregados || num(p.etapa) < 8) && (!f.seg || p.segmento === f.seg) &&
      (!q || [p.folio, p.nombre, p.municipio].some((x) => (x || '').toLowerCase().includes(q))));
    const conPlan = base.filter((x) => x.plan);
    const sinFecha = base.filter((x) => !x.plan);
    const cuenta = (c) => conPlan.filter((x) => x.st?.clase === c && num(x.p.etapa) < 8).length;
    const kpi = (clave, n, txt, extra = '') => `<button class="kpi ${extra} ${f.estado === clave ? 'activo' : ''}" data-estado="${clave}"><b>${n}</b><span>${txt}</span></button>`;
    $('#ggKpis').innerHTML = kpi('', base.length, 'Proyectos') + kpi('ok', cuenta('ok'), 'A tiempo', 'gk-ok') +
      kpi('riesgo', cuenta('riesgo'), 'En riesgo', 'gk-riesgo') + kpi('mal', cuenta('mal'), 'Atrasados', 'alerta') +
      kpi('sin', sinFecha.length, 'Sin fecha de gas', 'k0');

    let filas = f.estado === 'sin' ? [] : conPlan.filter((x) => !f.estado || (x.st?.clase === f.estado && num(x.p.etapa) < 8));
    filas = filas.sort((a, b) => a.plan.req - b.plan.req);
    const listaSin = !f.estado || f.estado === 'sin' ? sinFecha : [];

    $('#ggCuerpo').innerHTML = (filas.length ? ganttGeneralHtml(filas) : '<p class="vacio">No hay proyectos con fecha requerida de gas en esta vista.</p>') +
      (listaSin.length ? `<div class="card gg-sin"><h2>Sin fecha requerida de gas (${listaSin.length})</h2>
        <p class="muted chico">No aparecen en el Gantt hasta que se capture la fecha en el proyecto.</p>
        <ul>${listaSin.map(({ p }) => `<li><a href="#/p/${p.id}"><b>${esc(p.folio)}</b> · ${esc(p.nombre)}</a> ${badgeEtapa(p.etapa)}</li>`).join('')}</ul></div>` : '');

    $$('.kpi', v).forEach((b) => (b.onclick = () => { f.estado = f.estado === b.dataset.estado ? '' : b.dataset.estado; pintar(); }));
    $$('.g-fila[data-id]', v).forEach((r) => (r.onclick = () => (location.hash = `#/p/${r.dataset.id}`)));
  };

  $('#ggBuscar').oninput = (e) => { f.q = e.target.value; pintar(); };
  $('#ggSeg').onchange = (e) => { f.seg = e.target.value; pintar(); };
  $('#ggEntregados').onchange = (e) => { f.entregados = e.target.checked; pintar(); };
  pintar();
}

function ganttGeneralHtml(filas) {
  const hoy = diaDe(hoyISO());
  const fechas = [hoy, ...filas.flatMap(({ plan }) => [plan.filas[0].inicio, plan.filas[plan.filas.length - 1].fin, plan.req])];
  const min = sumaDias(new Date(Math.min(...fechas)), -10);
  const max = sumaDias(new Date(Math.max(...fechas)), 10);
  const pct = (d) => (((d - min) / (max - min)) * 100).toFixed(2);
  const ancho = (a, b) => Math.max(0.4, ((b - a) / (max - min)) * 100).toFixed(2);

  const meses = [];
  for (let m = new Date(min.getFullYear(), min.getMonth() + 1, 1, 12); m < max; m = new Date(m.getFullYear(), m.getMonth() + 1, 1, 12)) meses.push(m);
  const paso = meses.length > 18 ? 3 : meses.length > 9 ? 2 : 1; // menos etiquetas si el rango es largo
  const lineas = `${meses.map((m) => `<i class="g-mes" style="left:${pct(m)}%"></i>`).join('')}<i class="g-hoy" style="left:${pct(hoy)}%"></i>`;

  const html = filas.map(({ p, plan, st }) => {
    const n = num(p.etapa);
    const actual = n >= 8 ? 99 : Math.max(1, n);
    const segs = plan.filas.map((s) => {
      const clase = s.n < actual ? 'hecho' : s.n === actual ? `actual ${st?.clase || ''}` : 'futuro';
      return `<div class="gg-seg ${clase} ${s.despues ? 'post' : ''}" style="left:${pct(s.inicio)}%;width:${ancho(s.inicio, s.fin)}%"
        title="${esc(s.etapa)}: ${fecha(isoDe(s.inicio))} – ${fecha(isoDe(s.fin))}${s.n === actual ? ' (etapa actual)' : ''}"></div>`;
    }).join('');
    return `<div class="g-fila" data-id="${p.id}" title="Abrir ${esc(p.folio)}">
      <div class="g-label"><b>${esc(p.folio)} · ${esc(p.nombre)}</b>
        <small>${esc(p.segmento)} · ${esc(nombreCorto(p.etapa))} · gas ${fecha(p.fecha_requerida_gas)}</small>
        <span class="gg-pill">${pillPlan(st)}</span></div>
      <div class="g-track">${lineas}${segs}<i class="gg-gas" style="left:${pct(plan.req)}%" title="Gas requerido: ${fecha(p.fecha_requerida_gas)}"></i></div>
    </div>`;
  }).join('');

  return `<div class="gantt gg">
    <div class="g-fila g-escala"><div class="g-label"></div><div class="g-track">
      ${meses.map((m, i) => (i % paso ? '' : `<span style="left:${pct(m)}%">${m.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' })}</span>`)).join('')}
    </div></div>
    ${html}
  </div>
  <div class="g-leyenda">
    <span><i class="sw gg-hecho"></i>Etapa terminada</span><span><i class="sw ok"></i>Etapa actual a tiempo</span>
    <span><i class="sw gg-riesgo"></i>Actual en riesgo</span><span><i class="sw tarde"></i>Actual atrasada</span>
    <span><i class="sw plan"></i>Etapa por venir</span><span><i class="sw hoy"></i>Hoy</span><span><i class="sw req"></i>Gas requerido</span>
  </div>`;
}

// ---------------------------------------------------------------------
// Nueva solicitud
// ---------------------------------------------------------------------
function vistaNueva() {
  if (!puedeCrear()) { location.hash = '#/inicio'; return; }
  const v = vista();
  const archivos = new Map(); // config_doc_id -> File[]
  let otros = [];

  v.innerHTML = `
    <div class="titulo"><h1>Nueva solicitud</h1></div>
    <form id="frm" class="card grid" novalidate>
      <label class="full">Nombre del proyecto *<input name="nombre" required maxlength="200"></label>
      <label>Municipio *<select name="municipio" required><option value="">Selecciona…</option>
        ${S.municipios.map((m) => `<option>${esc(m.nombre)}</option>`).join('')}</select></label>
      <label>Segmento *<select name="segmento" required><option value="">Selecciona…</option>
        ${SEGMENTOS.map((s) => `<option>${s}</option>`).join('')}</select></label>
      <label id="lblMaterial" hidden>Material *<select name="material">${MATERIALES.map((m) => `<option>${m}</option>`).join('')}</select></label>
      ${S.ganttListo ? `<label>Fecha requerida de gas *<input type="date" name="fecha_requerida_gas" required min="${hoyISO()}"></label>` : ''}
      <div class="full" id="viabilidad"></div>
      <label class="full">Dirección<input name="direccion" maxlength="300"></label>
      <label class="full">Descripción / alcance<textarea name="descripcion" rows="3"></textarea></label>
      <div class="full folio">Folio: <b id="folioPrev">—</b> <small class="muted">(el consecutivo se asigna al enviar)</small></div>
    </form>
    <section class="card">
      <div class="card-h"><h2>Documentos de la solicitud</h2><span id="contador" class="pill"></span></div>
      <div id="docs"><p class="muted">Elige el segmento para ver los documentos requeridos.</p></div>
      <div class="doc">
        <span class="estado opc">+</span>
        <div class="doc-info"><b>Otros archivos</b><small>Opcional</small><div class="files" id="otrosLista"></div></div>
        <label class="btn sec chico">Adjuntar<input type="file" id="otros" multiple hidden></label>
      </div>
    </section>
    <div class="barra"><a class="btn sec" href="#/inicio">Cancelar</a><button id="btnEnviar" class="btn" disabled>Enviar solicitud</button></div>`;

  const frm = $('#frm');
  const valores = () => {
    const f = Object.fromEntries(new FormData(frm));
    if (f.segmento !== 'Industrial') f.material = 'Polietileno';
    return f;
  };
  const aplicables = () => { const f = valores(); return f.segmento ? docsDe('1. Solicitud', f.segmento, f.material) : []; };

  const actualizar = () => {
    const f = valores();
    $('#lblMaterial').hidden = f.segmento !== 'Industrial';
    const lista = aplicables();
    for (const id of [...archivos.keys()]) if (!lista.some((d) => d.id === id)) archivos.delete(id);

    if (f.segmento) {
      $('#docs').innerHTML = lista.length ? lista.map((d) => {
        const fs = archivos.get(d.id) || [];
        return `<div class="doc">
          <span class="estado ${fs.length ? 'ok' : d.obligatorio ? 'pend' : 'opc'}">${fs.length ? '✓' : d.obligatorio ? '!' : '·'}</span>
          <div class="doc-info"><b>${esc(d.nombre)}</b><small>${d.obligatorio ? 'Obligatorio' : 'Opcional'}</small>
            <div class="files">${fs.map((x) => esc(x.name)).join('<br>')}</div></div>
          <label class="btn sec chico">${fs.length ? 'Cambiar' : 'Adjuntar'}<input type="file" multiple hidden data-doc="${d.id}"></label>
        </div>`;
      }).join('') : '<p class="muted">No hay documentos configurados para este segmento.</p>';
      $$('input[data-doc]', v).forEach((inp) => (inp.onchange = () => {
        const id = Number(inp.dataset.doc);
        if (inp.files.length) archivos.set(id, [...inp.files]); else archivos.delete(id);
        actualizar();
      }));
    }
    $('#otrosLista').innerHTML = otros.map((x) => esc(x.name)).join('<br>');

    const oblig = lista.filter((d) => d.obligatorio);
    const listos = oblig.filter((d) => (archivos.get(d.id) || []).length).length;
    $('#contador').textContent = f.segmento ? `${listos} de ${oblig.length} obligatorios` : '';
    $('#contador').className = 'pill ' + (listos === oblig.length && f.segmento ? 'ok' : '');

    const mun = S.municipios.find((m) => m.nombre === f.municipio);
    $('#folioPrev').textContent = mun && f.segmento
      ? `${mun.clave}${f.segmento[0]}${f.material[0]}${String(new Date().getFullYear()).slice(-2)}###` : '—';

    // Viabilidad de la fecha requerida de gas
    const viab = $('#viabilidad');
    if (f.segmento && f.fecha_requerida_gas && S.tiempos.length) {
      const sem = totalSemanas(f.segmento);
      const posible = sumaDias(diaDe(hoyISO()), Math.round(sem * 7));
      const req = diaDe(f.fecha_requerida_gas);
      const dif = Math.round((req - posible) / DIA / 7 * 10) / 10;
      viab.innerHTML = dif >= 0
        ? `<div class="nota ok">Con los tiempos de ${esc(f.segmento)} (${sem} semanas) la fecha sí alcanza: quedan <b>${dif} semanas de holgura</b>. El proyecto debe arrancar a más tardar el <b>${fecha(isoDe(sumaDias(req, -Math.round(sem * 7))))}</b>.</div>`
        : `<div class="aviso">No alcanza: con los tiempos de ${esc(f.segmento)} se necesitan ${sem} semanas y faltan <b>${-dif}</b>. La fecha más próxima posible es el <b>${fecha(isoDe(posible))}</b>. Puedes cambiarla o enviarla así y el Líder decidirá si acorta etapas.</div>`;
    } else viab.innerHTML = '';

    $('#btnEnviar').disabled = !(f.nombre?.trim() && f.municipio && f.segmento && (f.fecha_requerida_gas || !S.ganttListo) && listos === oblig.length);
  };

  frm.oninput = actualizar;
  frm.onchange = actualizar;
  $('#otros').onchange = (e) => { otros = [...e.target.files]; actualizar(); };

  $('#btnEnviar').onclick = async () => {
    const btn = $('#btnEnviar');
    const f = valores();
    btn.disabled = true; btn.textContent = 'Creando solicitud…';
    try {
      const { data: p, error } = await sb.from('proyectos').insert({
        nombre: f.nombre.trim(), municipio: f.municipio, segmento: f.segmento, material: f.material,
        direccion: f.direccion?.trim() || null, descripcion: f.descripcion?.trim() || null,
        ...(S.ganttListo ? { fecha_requerida_gas: f.fecha_requerida_gas || null } : {}),
      }).select().single();
      if (error) throw error;

      const cola = [...[...archivos].flatMap(([id, fs]) => fs.map((file) => [id, file])), ...otros.map((file) => [null, file])];
      let i = 0;
      const errores = [];
      for (const [id, file] of cola) {
        btn.textContent = `Subiendo archivos ${++i}/${cola.length}…`;
        try { await subirArchivo(p.id, id, file); } catch (e) { errores.push(`${file.name}: ${errorTxt(e)}`); }
      }
      if (errores.length) toast(`Solicitud ${p.folio} creada, pero fallaron ${errores.length} archivo(s). Súbelos desde el detalle.`, 'error');
      else toast(`Solicitud ${p.folio} creada`);
      location.hash = `#/p/${p.id}`;
    } catch (e) {
      fallo(e);
      btn.textContent = 'Enviar solicitud';
      actualizar();
    }
  };
  actualizar();
}

// ---------------------------------------------------------------------
// Detalle del proyecto
// ---------------------------------------------------------------------
function puedeActualizar(p) {
  const r = rol(), me = S.perfil.id;
  return ['Administrador', 'Líder', 'Permisos', 'Construcción'].includes(r)
    || (r === 'Proyectista' && p.proyectista_id === me)
    || (r === 'Comercial' && p.solicitante_id === me && num(p.etapa) === 0);
}
const gestionaLicencias = () => ['Administrador', 'Líder', 'Permisos'].includes(rol());

function accionesDe(p) {
  const r = rol(), me = S.perfil.id, n = num(p.etapa), adm = esAdmin(), out = [];
  if (n === 1 && (adm || r === 'Líder')) {
    out.push({ id: 'asignar', label: 'Asignar proyectista', destino: etapaPorNum(3) });
    out.push({ id: 'devolver', label: 'Devolver a Comercial', destino: etapaPorNum(0), sec: true });
  }
  if (n === 0 && (adm || (r === 'Comercial' && p.solicitante_id === me)))
    out.push({ id: 'avanzar', label: 'Reenviar al Líder', destino: etapaPorNum(1), revisaDocs: '1. Solicitud' });
  if (n === 3 && (adm || (r === 'Proyectista' && p.proyectista_id === me)))
    out.push({ id: 'avanzar', label: 'Enviar a Permisos', destino: etapaPorNum(4), revisaDocs: p.etapa });
  if (n === 4 && (adm || r === 'Permisos'))
    out.push({ id: 'avanzar', label: 'Enviar a Construcción', destino: etapaPorNum(5), revisaDocs: p.etapa, revisaLic: true });
  if (n >= 5 && n <= 7 && (adm || r === 'Construcción'))
    out.push({ id: 'avanzar', label: `Avanzar a «${siguienteEtapa(p.etapa)}»`, destino: siguienteEtapa(p.etapa), revisaDocs: p.etapa });
  if (adm) out.push({ id: 'mover', label: 'Mover a otra etapa', sec: true });
  if (puedeEditar()) out.push({ id: 'comentar', label: 'Agregar comentario', sec: true });
  return out;
}

async function vistaDetalle(id) {
  const v = vista('Cargando proyecto…');
  const [rp, rd, rh, rl] = await Promise.all([
    sb.from('proyectos').select('*').eq('id', id).maybeSingle(),
    sb.from('documentos').select('*').eq('proyecto_id', id).order('created_at'),
    sb.from('historial').select('*').eq('proyecto_id', id).order('created_at', { ascending: false }),
    sb.from('licencias').select('*').eq('proyecto_id', id).order('created_at'),
  ]);
  const err = rp.error || rd.error || rh.error || rl.error;
  if (err) { v.innerHTML = `<p class="error">${esc(errorTxt(err))}</p>`; return; }
  const p = rp.data;
  if (!p) { v.innerHTML = '<p class="vacio">Proyecto no encontrado. <a href="#/inicio">Volver</a></p>'; return; }
  const docs = rd.data, hist = rh.data, lics = rl.data;
  const plan = planDe(p);
  const estPlan = estadoPlan(p, plan);

  const urls = {};
  if (docs.length) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(docs.map((d) => d.ruta), 3600);
    (data || []).forEach((u) => { if (u.signedUrl || u.signedURL) urls[u.path] = u.signedUrl || u.signedURL; });
  }

  const n = num(p.etapa);
  const editable = puedeActualizar(p);
  const subir = puedeEditar();

  // Pendientes para avanzar
  const faltantes = (etapa) => docsDe(etapa, p.segmento, p.material).filter((d) => d.obligatorio && !docs.some((x) => x.config_doc_id === d.id));
  const licPendientes = lics.filter((l) => l.estatus !== 'Aprobada');

  // Etapas cuyos documentos se muestran
  const etapasDocs = ETAPAS.filter((e) => num(e) >= 1 && num(e) <= Math.max(1, n));
  const idsConfig = new Set();
  const bloqueDocs = etapasDocs.map((e) => {
    const lista = docsDe(e, p.segmento, p.material);
    lista.forEach((d) => idsConfig.add(d.id));
    if (!lista.length) return '';
    return `<h3>${esc(e)}</h3>` + lista.map((d) => filaDoc(d, docs.filter((x) => x.config_doc_id === d.id))).join('');
  }).join('');
  const sueltos = docs.filter((x) => !idsConfig.has(x.config_doc_id));

  function filaDoc(d, archivos) {
    return `<div class="doc">
      <span class="estado ${archivos.length ? 'ok' : d.obligatorio ? 'pend' : 'opc'}">${archivos.length ? '✓' : d.obligatorio ? '!' : '·'}</span>
      <div class="doc-info"><b>${esc(d.nombre)}</b><small>${d.obligatorio ? 'Obligatorio' : 'Opcional'}</small>
        <div class="files">${archivos.map(archivoHtml).join('')}</div></div>
      ${subir ? `<label class="btn sec chico">Subir<input type="file" multiple hidden data-subir="${d.id}"></label>` : ''}
    </div>`;
  }
  function archivoHtml(a) {
    const borrar = esAdmin() || a.subido_por === S.perfil.id;
    return `<div class="archivo">
      ${urls[a.ruta] ? `<a href="${esc(urls[a.ruta])}" target="_blank" rel="noopener">${esc(a.nombre_archivo)}</a>` : esc(a.nombre_archivo)}
      <small class="muted">${tamano(a.tamano)} · ${esc(nombreDe(a.subido_por))} · ${fecha(a.created_at)}</small>
      ${borrar ? `<button class="link rojo" data-borrar="${a.id}" title="Eliminar">✕</button>` : ''}
    </div>`;
  }

  const acciones = accionesDe(p);
  const stepper = ETAPAS.filter((e) => num(e) >= 1).map((e) => {
    const k = num(e);
    const cls = n === 0 ? (k === 1 ? 'actual devuelto' : '') : k < n ? 'hecho' : k === n ? 'actual' : '';
    return `<li class="${cls}"><span>${k}</span><small>${esc(e.replace(/^\d+\.\s*/, ''))}</small></li>`;
  }).join('');

  v.innerHTML = `
    <a class="volver" href="#/inicio">← Volver</a>
    <div class="titulo">
      <div><h1>${esc(p.folio)} · ${esc(p.nombre)}</h1><div>${badgeEtapa(p.etapa)} ${p.bloqueo ? '<span class="bloq">⚠ Bloqueado</span>' : ''}</div></div>
    </div>
    <ol class="stepper">${stepper}</ol>
    <section class="card">
      <div class="card-h"><h2>Cronograma (Gantt)</h2>${pillPlan(estPlan)}</div>
      ${!S.ganttListo ? '<p class="muted">Falta ejecutar <b>supabase/002_gantt.sql</b> en Supabase para activar el Gantt.</p>'
        : !plan ? `<p class="muted">Captura la <b>fecha requerida de gas</b> en Seguimiento para calcular el cronograma.</p>`
        : `<p class="g-resumen">Gas requerido: <b>${fecha(p.fecha_requerida_gas)}</b> · Debía arrancar: <b>${fecha(isoDe(plan.inicioPlan))}</b> ·
            ${plan.holgura >= 0 ? `Holgura al recibir la solicitud: <b>${Math.round(plan.holgura / 7 * 10) / 10} semanas</b>` : `<span class="vencido">Llegó ${Math.round(-plan.holgura / 7 * 10) / 10} semanas tarde para los tiempos estándar</span>`}</p>
           ${ganttHtml(p, plan, realesDe(p, hist))}`}
    </section>
    ${n === 0 ? `<div class="aviso">Devuelta a Comercial. Revisa el historial para ver el motivo, corrige y reenvía.</div>` : ''}

    <div class="cols">
      <div class="col">
        ${acciones.length ? `<section class="card"><h2>Acciones</h2>
          <div class="botones">${acciones.map((a, i) => `<button class="btn ${a.sec ? 'sec' : ''}" data-accion="${i}">${esc(a.label)}</button>`).join('')}</div>
          <div id="accionForm"></div></section>` : ''}

        <section class="card">
          <div class="card-h"><h2>Expediente</h2></div>
          ${bloqueDocs || '<p class="muted">No hay documentos configurados.</p>'}
          <h3>Otros archivos</h3>
          <div class="doc"><span class="estado opc">+</span>
            <div class="doc-info"><div class="files">${sueltos.map(archivoHtml).join('') || '<small class="muted">Sin archivos</small>'}</div></div>
            ${subir ? '<label class="btn sec chico">Subir<input type="file" multiple hidden data-subir=""></label>' : ''}
          </div>
        </section>

        ${n >= 3 || lics.length ? `<section class="card">
          <h2>Licencias y permisos</h2>
          ${lics.length ? `<div class="tabla-wrap"><table class="tabla compacta"><thead><tr><th>Tipo</th><th>Dependencia</th><th>Estatus</th><th>Ingreso</th><th>Vence</th><th>Notas</th>${esAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
            ${lics.map((l) => `<tr>
              <td>${esc(l.tipo)}</td><td>${esc(l.dependencia)}</td>
              <td>${gestionaLicencias() ? `<select data-lic="${l.id}">${ESTATUS_LIC.map((s) => `<option ${s === l.estatus ? 'selected' : ''}>${s}</option>`).join('')}</select>` : `<span class="lic ${esc(l.estatus.replace(' ', ''))}">${esc(l.estatus)}</span>`}</td>
              <td>${fecha(l.fecha_ingreso)}</td>
              <td class="${l.fecha_vencimiento && l.fecha_vencimiento < hoyISO() ? 'vencido' : ''}">${fecha(l.fecha_vencimiento)}</td>
              <td>${esc(l.notas)}</td>
              ${esAdmin() ? `<td><button class="link rojo" data-borrarlic="${l.id}">✕</button></td>` : ''}
            </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin licencias registradas.</p>'}
          ${gestionaLicencias() ? `<form id="frmLic" class="grid mini">
            <label>Tipo *<input name="tipo" required placeholder="Licencia de obra"></label>
            <label>Dependencia<input name="dependencia" placeholder="Municipio de ${esc(p.municipio)}"></label>
            <label>Ingreso<input type="date" name="fecha_ingreso"></label>
            <label>Vencimiento<input type="date" name="fecha_vencimiento"></label>
            <label class="full">Notas<input name="notas"></label>
            <div class="full"><button class="btn sec chico">Agregar licencia</button></div>
          </form>` : ''}
        </section>` : ''}
      </div>

      <div class="col">
        <section class="card">
          <div class="card-h"><h2>Datos</h2>${editable && (esAdmin() || n === 0) ? '<button class="link" id="btnEditarDatos">Editar</button>' : ''}</div>
          <div id="datos">
            <dl class="datos">
              <dt>Municipio</dt><dd>${esc(p.municipio)}</dd>
              <dt>Segmento</dt><dd>${esc(p.segmento)}</dd>
              <dt>Material</dt><dd>${esc(p.material)}</dd>
              <dt>Dirección</dt><dd>${esc(p.direccion) || '—'}</dd>
              <dt>Descripción</dt><dd class="pre">${esc(p.descripcion) || '—'}</dd>
              <dt>Solicitante</dt><dd>${esc(nombreDe(p.solicitante_id))}</dd>
              <dt>Proyectista</dt><dd>${p.proyectista_id ? esc(nombreDe(p.proyectista_id)) : '—'}</dd>
              <dt>Creado</dt><dd>${fechaHora(p.created_at)}</dd>
            </dl>
          </div>
        </section>

        <section class="card">
          <h2>Seguimiento</h2>
          <form id="frmSeg" class="grid mini">
            ${S.ganttListo ? `<label>Fecha requerida de gas<input type="date" name="fecha_requerida_gas" value="${esc(p.fecha_requerida_gas || '')}" ${editable ? '' : 'disabled'}></label>` : ''}
            <label>Fecha compromiso<input type="date" name="fecha_compromiso" value="${esc(p.fecha_compromiso || '')}" ${editable ? '' : 'disabled'}></label>
            <label class="full">Bloqueo actual<input name="bloqueo" value="${esc(p.bloqueo || '')}" placeholder="Ninguno" ${editable ? '' : 'disabled'}></label>
            <label class="full">Siguiente acción<input name="siguiente_accion" value="${esc(p.siguiente_accion || '')}" ${editable ? '' : 'disabled'}></label>
            ${editable ? '<div class="full"><button class="btn sec chico">Guardar seguimiento</button></div>' : ''}
          </form>
        </section>

        <section class="card">
          <h2>Historial</h2>
          <ul class="timeline">${hist.map((h) => `<li>
            <div class="t-h"><b>${esc(h.accion)}</b><small class="muted">${fechaHora(h.created_at)}</small></div>
            <small>${esc(nombreDe(h.usuario_id))}${h.etapa_nueva ? ` · ${h.etapa_anterior ? esc(h.etapa_anterior) + ' → ' : ''}${esc(h.etapa_nueva)}` : ''}</small>
            ${h.comentario ? `<p class="pre">${esc(h.comentario)}</p>` : ''}
          </li>`).join('') || '<li class="muted">Sin movimientos</li>'}</ul>
        </section>
      </div>
    </div>`;

  const recargar = () => vistaDetalle(id);

  // --- Acciones de flujo
  $$('[data-accion]', v).forEach((b) => (b.onclick = () => {
    const a = acciones[Number(b.dataset.accion)];
    const pendDocs = a.revisaDocs ? faltantes(a.revisaDocs) : [];
    const pendLic = a.revisaLic ? licPendientes : [];
    const bloqueado = (pendDocs.length || pendLic.length) && !esAdmin();
    const proyectistas = S.perfiles.filter((x) => x.rol === 'Proyectista' && x.activo);

    let extra = '';
    if (a.id === 'asignar') extra = `<label>Proyectista *<select name="proyectista_id" required><option value="">Selecciona…</option>
      ${proyectistas.map((x) => `<option value="${x.id}" ${x.id === p.proyectista_id ? 'selected' : ''}>${esc(x.nombre || x.email)}</option>`).join('')}</select></label>
      ${proyectistas.length ? '' : '<p class="error">No hay usuarios con rol Proyectista.</p>'}`;
    if (a.id === 'mover') extra = `<label>Nueva etapa *<select name="etapa" required>${ETAPAS.filter((e) => e !== p.etapa).map((e) => `<option>${esc(e)}</option>`).join('')}</select></label>`;

    const requiereComentario = ['devolver', 'comentar'].includes(a.id);
    $('#accionForm').innerHTML = `<form class="accion">
      <h3>${esc(a.label)}</h3>
      ${pendDocs.length ? `<div class="aviso">Faltan documentos obligatorios: <b>${pendDocs.map((d) => esc(d.nombre)).join(', ')}</b></div>` : ''}
      ${pendLic.length ? `<div class="aviso">Licencias sin aprobar: <b>${pendLic.map((l) => esc(l.tipo)).join(', ')}</b></div>` : ''}
      ${bloqueado ? '' : extra}
      ${bloqueado ? '' : `<label>${requiereComentario ? (a.id === 'devolver' ? 'Motivo de la devolución *' : 'Comentario *') : 'Comentario (opcional)'}
        <textarea name="comentario" rows="3" ${requiereComentario ? 'required' : ''}></textarea></label>`}
      <div class="botones">
        <button type="button" class="btn sec" data-cancelar>Cancelar</button>
        ${bloqueado ? '' : `<button class="btn">${pendDocs.length || pendLic.length ? 'Continuar de todos modos' : 'Confirmar'}</button>`}
      </div></form>`;
    const form = $('#accionForm form');
    $('[data-cancelar]', form).onclick = () => ($('#accionForm').innerHTML = '');
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      const fd = Object.fromEntries(new FormData(form));
      const btnOk = $('button:not([data-cancelar])', form);
      btnOk.disabled = true;
      try {
        let r;
        if (a.id === 'comentar') {
          r = await sb.from('historial').insert({ proyecto_id: p.id, accion: 'Comentario', comentario: fd.comentario.trim() });
        } else {
          const cambios = { comentario_cambio: fd.comentario?.trim() || null };
          if (a.id === 'asignar') { cambios.proyectista_id = fd.proyectista_id; cambios.etapa = a.destino; }
          else if (a.id === 'mover') cambios.etapa = fd.etapa;
          else cambios.etapa = a.destino;
          r = await sb.from('proyectos').update(cambios).eq('id', p.id).select('id');
          if (!r.error && !r.data?.length) throw new Error('No tienes permiso para modificar este proyecto');
        }
        if (r.error) throw r.error;
        toast('Listo');
        recargar();
      } catch (e) { fallo(e); btnOk.disabled = false; }
    };
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));

  // --- Subir / borrar archivos
  $$('input[data-subir]', v).forEach((inp) => (inp.onchange = async () => {
    if (!inp.files.length) return;
    const docId = inp.dataset.subir ? Number(inp.dataset.subir) : null;
    const etiqueta = inp.parentElement;
    etiqueta.classList.add('cargando');
    let errores = 0;
    for (const file of inp.files) { try { await subirArchivo(p.id, docId, file); } catch (e) { errores++; fallo(e); } }
    if (!errores) toast('Archivo(s) subido(s)');
    recargar();
  }));
  $$('[data-borrar]', v).forEach((b) => (b.onclick = async () => {
    const a = docs.find((x) => x.id === Number(b.dataset.borrar));
    if (!confirm(`¿Eliminar "${a.nombre_archivo}"?`)) return;
    const s = await sb.storage.from(BUCKET).remove([a.ruta]);
    if (s.error) return fallo(s.error);
    const d = await sb.from('documentos').delete().eq('id', a.id);
    if (d.error) return fallo(d.error);
    toast('Archivo eliminado');
    recargar();
  }));

  // --- Seguimiento
  const frmSeg = $('#frmSeg');
  if (editable) frmSeg.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(frmSeg));
    const { error } = await sb.from('proyectos').update({
      fecha_compromiso: fd.fecha_compromiso || null,
      ...(S.ganttListo ? { fecha_requerida_gas: fd.fecha_requerida_gas || null } : {}),
      bloqueo: fd.bloqueo.trim() || null,
      siguiente_accion: fd.siguiente_accion.trim() || null,
    }).eq('id', p.id);
    if (error) return fallo(error);
    toast('Seguimiento guardado');
    recargar();
  };

  // --- Editar datos
  const btnEd = $('#btnEditarDatos');
  if (btnEd) btnEd.onclick = () => {
    $('#datos').innerHTML = `<form id="frmDatos" class="grid mini">
      <label class="full">Nombre *<input name="nombre" required value="${esc(p.nombre)}"></label>
      <label class="full">Dirección<input name="direccion" value="${esc(p.direccion || '')}"></label>
      <label class="full">Descripción<textarea name="descripcion" rows="3">${esc(p.descripcion || '')}</textarea></label>
      <div class="full botones"><button type="button" class="btn sec chico" id="btnCancelDatos">Cancelar</button><button class="btn chico">Guardar</button></div>
    </form>`;
    $('#btnCancelDatos').onclick = recargar;
    $('#frmDatos').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target));
      const { error } = await sb.from('proyectos').update({
        nombre: fd.nombre.trim(), direccion: fd.direccion.trim() || null, descripcion: fd.descripcion.trim() || null,
      }).eq('id', p.id);
      if (error) return fallo(error);
      toast('Datos actualizados');
      recargar();
    };
  };

  // --- Licencias
  const frmLic = $('#frmLic');
  if (frmLic) frmLic.onsubmit = async (ev) => {
    ev.preventDefault();
    if (!frmLic.reportValidity()) return;
    const fd = Object.fromEntries(new FormData(frmLic));
    const { error } = await sb.from('licencias').insert({
      proyecto_id: p.id, tipo: fd.tipo.trim(), dependencia: fd.dependencia.trim() || null,
      fecha_ingreso: fd.fecha_ingreso || null, fecha_vencimiento: fd.fecha_vencimiento || null, notas: fd.notas.trim() || null,
    });
    if (error) return fallo(error);
    toast('Licencia agregada');
    recargar();
  };
  $$('select[data-lic]', v).forEach((s) => (s.onchange = async () => {
    const { error } = await sb.from('licencias').update({ estatus: s.value }).eq('id', Number(s.dataset.lic));
    if (error) return fallo(error);
    toast('Estatus actualizado');
  }));
  $$('[data-borrarlic]', v).forEach((b) => (b.onclick = async () => {
    if (!confirm('¿Eliminar esta licencia?')) return;
    const { error } = await sb.from('licencias').delete().eq('id', Number(b.dataset.borrarlic));
    if (error) return fallo(error);
    recargar();
  }));
}

// ---------------------------------------------------------------------
// Administración
// ---------------------------------------------------------------------
async function vistaAdmin() {
  if (!esAdmin()) { location.hash = '#/inicio'; return; }
  const v = vista('Cargando…');
  try { await cargarCatalogos(); } catch (e) { v.innerHTML = `<p class="error">${esc(errorTxt(e))}</p>`; return; }
  const etapasDoc = ETAPAS.filter((e) => num(e) >= 1);
  const docsOrden = [...S.configDocs].sort((a, b) => ETAPAS.indexOf(a.etapa) - ETAPAS.indexOf(b.etapa) || a.orden - b.orden);

  v.innerHTML = `
    <div class="titulo"><h1>Administración</h1></div>

    <section class="card">
      <h2>Usuarios y roles</h2>
      <p class="muted chico">Para dar de alta a alguien: Supabase → Authentication → Users → <b>Add user</b> (correo + contraseña, marca «Auto confirm»). Después aparece aquí y le asignas su rol.</p>
      <div class="tabla-wrap"><table class="tabla compacta"><thead><tr><th>Correo</th><th>Nombre</th><th>Rol</th><th>Activo</th></tr></thead><tbody>
      ${S.perfiles.map((u) => `<tr>
        <td>${esc(u.email)}</td>
        <td><input data-nombre="${u.id}" value="${esc(u.nombre || '')}"></td>
        <td><select data-rol="${u.id}" ${u.id === S.perfil.id ? 'disabled title="No puedes cambiar tu propio rol"' : ''}>${ROLES.map((r) => `<option ${r === u.rol ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
        <td><input type="checkbox" data-activo="${u.id}" ${u.activo ? 'checked' : ''} ${u.id === S.perfil.id ? 'disabled' : ''}></td>
      </tr>`).join('')}
      </tbody></table></div>
    </section>

    <section class="card">
      <h2>Documentos requeridos</h2>
      <p class="muted chico">Segmento o material «Todos» = aplica a cualquier proyecto. Los obligatorios de cada etapa se piden antes de avanzar.</p>
      <div class="tabla-wrap"><table class="tabla compacta"><thead><tr><th>Etapa</th><th>Documento</th><th>Segmento</th><th>Material</th><th>Obligatorio</th><th>Orden</th><th></th></tr></thead><tbody>
      ${docsOrden.map((d) => `<tr>
        <td>${esc(d.etapa)}</td><td>${esc(d.nombre)}</td><td>${esc(d.segmento || 'Todos')}</td><td>${esc(d.material || 'Todos')}</td>
        <td><input type="checkbox" data-oblig="${d.id}" ${d.obligatorio ? 'checked' : ''}></td>
        <td><input type="number" class="corto" data-orden="${d.id}" value="${d.orden}"></td>
        <td><button class="link rojo" data-borrardoc="${d.id}">✕</button></td>
      </tr>`).join('')}
      </tbody></table></div>
      <form id="frmDoc" class="grid mini">
        <label class="full">Documento *<input name="nombre" required></label>
        <label>Etapa<select name="etapa">${etapasDoc.map((e) => `<option>${esc(e)}</option>`).join('')}</select></label>
        <label>Segmento<select name="segmento"><option value="">Todos</option>${SEGMENTOS.map((s) => `<option>${s}</option>`).join('')}</select></label>
        <label>Material<select name="material"><option value="">Todos</option>${MATERIALES.map((s) => `<option>${s}</option>`).join('')}</select></label>
        <label>Orden<input type="number" name="orden" value="100"></label>
        <label class="check"><input type="checkbox" name="obligatorio" checked> Obligatorio</label>
        <div class="full"><button class="btn sec chico">Agregar documento</button></div>
      </form>
    </section>

    <section class="card">
      <h2>Tiempos por etapa (semanas)</h2>
      ${S.ganttListo ? `<p class="muted chico">El Gantt parte de la fecha requerida de gas y resta estas semanas hacia atrás. «Cierre y as-built» se cuenta después de la puesta en servicio.</p>
      <div class="tabla-wrap"><table class="tabla compacta"><thead><tr><th>Etapa</th>${SEGMENTOS.map((s) => `<th>${s}</th>`).join('')}</tr></thead><tbody>
      ${[...ETAPAS_ANTES, ...ETAPAS_DESPUES].map(etapaPorNum).filter(Boolean).map((e) => `<tr><td>${esc(e)}</td>${SEGMENTOS.map((s) =>
        `<td><input type="number" class="corto" min="0" step="0.5" data-tseg="${s}" data-tetapa="${esc(e)}" value="${semanasDe(s, e)}"></td>`).join('')}</tr>`).join('')}
      <tr><td><b>Total hasta el gas</b></td>${SEGMENTOS.map((s) => `<td><b>${totalSemanas(s)}</b></td>`).join('')}</tr>
      </tbody></table></div>` : '<p class="muted">Ejecuta <b>supabase/002_gantt.sql</b> en Supabase para activar esta sección.</p>'}
    </section>

    <section class="card">
      <h2>Municipios</h2>
      <p class="muted chico">La clave es el inicio del folio. No uses claves que empiecen igual que otra seguida de R, C o I.</p>
      <div class="chips">${S.municipios.map((m) => `<span class="chip">${esc(m.nombre)} <b>${esc(m.clave)}</b></span>`).join('')}</div>
      <form id="frmMun" class="grid mini">
        <label>Municipio *<input name="nombre" required></label>
        <label>Clave *<input name="clave" required maxlength="3" pattern="[A-Za-z]{1,3}"></label>
        <div class="full"><button class="btn sec chico">Agregar municipio</button></div>
      </form>
    </section>`;

  const guardar = async (tabla, idCol, idVal, cambios, msg = 'Guardado') => {
    const { error } = await sb.from(tabla).update(cambios).eq(idCol, idVal);
    if (error) return fallo(error);
    toast(msg);
    await cargarCatalogos();
  };
  $$('[data-rol]', v).forEach((s) => (s.onchange = () => guardar('perfiles', 'id', s.dataset.rol, { rol: s.value }, 'Rol actualizado')));
  $$('[data-activo]', v).forEach((c) => (c.onchange = () => guardar('perfiles', 'id', c.dataset.activo, { activo: c.checked })));
  $$('[data-nombre]', v).forEach((i) => (i.onchange = () => guardar('perfiles', 'id', i.dataset.nombre, { nombre: i.value.trim() || null })));
  $$('[data-oblig]', v).forEach((c) => (c.onchange = () => guardar('config_documentos', 'id', Number(c.dataset.oblig), { obligatorio: c.checked })));
  $$('[data-orden]', v).forEach((i) => (i.onchange = () => guardar('config_documentos', 'id', Number(i.dataset.orden), { orden: Number(i.value) || 0 })));
  $$('[data-borrardoc]', v).forEach((b) => (b.onclick = async () => {
    if (!confirm('¿Eliminar este documento requerido? Los archivos ya subidos se conservan como «Otros archivos».')) return;
    const { error } = await sb.from('config_documentos').delete().eq('id', Number(b.dataset.borrardoc));
    if (error) return fallo(error);
    vistaAdmin();
  }));
  $('#frmDoc').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target));
    const { error } = await sb.from('config_documentos').insert({
      nombre: fd.nombre.trim(), etapa: fd.etapa, segmento: fd.segmento || null, material: fd.material || null,
      obligatorio: !!fd.obligatorio, orden: Number(fd.orden) || 0,
    });
    if (error) return fallo(error);
    toast('Documento agregado');
    vistaAdmin();
  };
  $$('[data-tseg]', v).forEach((i) => (i.onchange = async () => {
    const { error } = await sb.from('config_tiempos').upsert({ segmento: i.dataset.tseg, etapa: i.dataset.tetapa, semanas: Number(i.value) || 0 });
    if (error) return fallo(error);
    toast('Tiempo actualizado');
    vistaAdmin();
  }));
  $('#frmMun').onsubmit = async (ev) => {
    ev.preventDefault();
    if (!ev.target.reportValidity()) return;
    const fd = Object.fromEntries(new FormData(ev.target));
    const { error } = await sb.from('municipios').insert({ nombre: fd.nombre.trim(), clave: fd.clave.trim().toUpperCase() });
    if (error) return fallo(error);
    toast('Municipio agregado');
    vistaAdmin();
  };
}

// ---------------------------------------------------------------------
// Mi cuenta
// ---------------------------------------------------------------------
function vistaCuenta() {
  const v = vista();
  v.innerHTML = `<div class="titulo"><h1>Mi cuenta</h1></div>
    <section class="card angosta">
      <dl class="datos"><dt>Correo</dt><dd>${esc(S.perfil.email)}</dd><dt>Nombre</dt><dd>${esc(S.perfil.nombre || '—')}</dd><dt>Rol</dt><dd>${esc(S.perfil.rol)}</dd></dl>
      <form id="frmPass" class="grid mini">
        <label class="full">Nueva contraseña<input type="password" name="p1" minlength="8" required autocomplete="new-password"></label>
        <label class="full">Repite la contraseña<input type="password" name="p2" minlength="8" required autocomplete="new-password"></label>
        <div class="full"><button class="btn sec chico">Cambiar contraseña</button></div>
      </form>
    </section>`;
  $('#frmPass').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target));
    if (fd.p1 !== fd.p2) return toast('Las contraseñas no coinciden', 'error');
    const { error } = await sb.auth.updateUser({ password: fd.p1 });
    if (error) return fallo(error);
    ev.target.reset();
    toast('Contraseña actualizada');
  };
}

init();

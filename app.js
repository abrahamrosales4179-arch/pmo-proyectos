import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, NOMBRE_APP, ETAPAS } from './config.js';

// ---------------------------------------------------------------------
// Constantes y estado
// ---------------------------------------------------------------------
const ROLES = ['Administrador', 'Consulta', 'Comercial', 'Líder', 'Proyectista', 'Permisos', 'Construcción', 'Sin rol'];
const ESTATUS_ACT = ['Pendiente', 'En proceso', 'Hecha', 'No aplica'];
const SEGMENTOS = ['Residencial', 'Comercial', 'Industrial'];
const PUESTOS = ['KAM', 'Supervisor de ventas'];
// Quién aprueba el anteproyecto (etapa 3): Industrial → KAM; Comercial y Residencial → Supervisor de ventas
const aprobadorDe = (segmento) => (segmento === 'Industrial' ? 'KAM' : 'Supervisor de ventas');
const MATERIALES = ['Polietileno', 'Acero'];
const ESTATUS_LIC = ['Pendiente', 'En trámite', 'Aprobada', 'Rechazada'];
const BUCKET = 'expedientes';

const configurado = !SUPABASE_URL.includes('TU-PROYECTO') && !SUPABASE_ANON_KEY.includes('PEGA-AQUI');
const sb = configurado ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const app = document.getElementById('app');
const S = { session: null, perfil: null, municipios: [], configDocs: [], perfiles: [], tiempos: [], ganttListo: false, actividades: [], flujoListo: false, rendimientos: [], constListo: false };

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
const puedoAprobar = (p) => esAdmin() || (puedeEditar() && S.perfil?.puesto === aprobadorDe(p.segmento));
const firmaAprobacion = (p) => (p.aprobado_por
  ? `${esc(nombreDe(p.aprobado_por))} (${esc(p.aprobado_puesto || '—')}) · ${fecha(p.aprobado_en)}` : '');
const badgeEtapa = (e) => `<span class="badge e${num(e)}">${esc(e)}</span>`;
// Números clave del flujo (ver supabase/005_etapas.sql)
const N_FINAL = 14, N_CANCEL = 99, N_APROB = 3, N_PEP = 4, N_LIC_DESDE = 6, N_CONST = 11;
const activa = (p) => num(p.etapa) < N_FINAL;
const vencido = (p) => p.fecha_compromiso && p.fecha_compromiso < hoyISO() && activa(p);
const actividadesDe = (etapa) => S.actividades.filter((a) => a.etapa === etapa).sort((a, b) => a.orden - b.orden || a.id - b.id);
const cerrada = (st) => st === 'Hecha' || st === 'No aplica';

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
  const tip = $('#cxTip'); if (tip) tip.style.display = 'none';
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
    sb.from('perfiles').select('*').order('nombre'),
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
  // Actividades del flujograma (si aún no se ejecuta supabase/003_flujograma.sql, se usa el flujo anterior)
  const act = await sb.from('config_actividades').select('*').order('orden');
  S.flujoListo = !act.error;
  S.actividades = act.data || [];
  // Rendimientos para estimar construcción (supabase/004_construccion.sql)
  const rend = await sb.from('config_rendimientos').select('*').order('orden');
  S.constListo = !rend.error;
  S.rendimientos = rend.data || [];
}

// ---------------------------------------------------------------------
// Gantt: se calcula hacia atrás desde la fecha requerida de gas
// ---------------------------------------------------------------------
const ETAPAS_ANTES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]; // terminan el día que se requiere el gas
const ETAPAS_DESPUES = [];                                         // etapas que se cuentan después del gas
const DIA = 86400000;
function diaDe(x) {
  if (x instanceof Date) { const d = new Date(x); d.setHours(12, 0, 0, 0); return d; }
  if (typeof x === 'string' && x.length === 10) return new Date(x + 'T12:00:00');
  const d = new Date(x); d.setHours(12, 0, 0, 0); return d;
}
const sumaDias = (d, n) => new Date(d.getTime() + n * DIA);
const isoDe = (d) => d.toLocaleDateString('en-CA');
const semanasDe = (seg, etapa) => Number(S.tiempos.find((t) => t.segmento === seg && t.etapa === etapa)?.semanas ?? 0);
// ---------------------------------------------------------------------
// Estimación de construcción por tramos (material, diámetro, longitud)
// ---------------------------------------------------------------------
const diametrosDe = (mat) => S.rendimientos.filter((r) => r.material === mat).sort((a, b) => a.orden - b.orden);
const rendimiento = (mat, dia) => Number(S.rendimientos.find((r) => r.material === mat && r.diametro === dia)?.metros_dia || 0);
function calcConst(d) {
  let metros = 0, tendido = 0;
  for (const t of d.tramos || []) {
    const r = rendimiento(t.material, t.diametro), l = Number(t.longitud) || 0;
    if (r && l > 0) { metros += l; tendido += l / r; }
  }
  const cuadrillas = Math.max(1, Number(d.cuadrillas) || 1);
  const diasTendido = Math.ceil((tendido / cuadrillas) * 10) / 10;
  const dias = Math.ceil(diasTendido + (Number(d.dias_extra) || 0));
  const semanas = dias ? Math.ceil((dias / (Number(d.dias_semana) || 5)) * 2) / 2 : 0; // redondeo a media semana hacia arriba
  return { metros, diasTendido, dias, semanas };
}
const puedeEstimarConst = () => ['Construcción', 'Líder', 'Administrador'].includes(rol());

// Semanas de una etapa para un proyecto: en Construcción usa la estimación del supervisor si existe
const semanasPlan = (p, etapa) => (num(etapa) === N_CONST && p.const_semanas != null ? Number(p.const_semanas) : semanasDe(p.segmento, etapa));
const totalSemanas = (seg) => ETAPAS_ANTES.reduce((a, n) => a + semanasDe(seg, etapaPorNum(n)), 0);
const nombreCorto = (e) => e.replace(/^\d+\.\s*/, '');
const diasFlujo = (etapa) => {
  // El PEP (gestión con Inversiones) corre en paralelo al dictamen de diseño: no se suma
  const d = actividadesDe(etapa).filter((a) => !/Inversiones/.test(a.area)).reduce((t, a) => t + Number(a.dias || 0), 0);
  return d ? `${d} día${d === 1 ? '' : 's'} hábil${d === 1 ? '' : 'es'} ≈ ${Math.round(d / 5 * 10) / 10} sem` : '—';
};

function planDe(p) {
  if (!p.fecha_requerida_gas || !S.tiempos.length) return null;
  const req = diaDe(p.fecha_requerida_gas);
  const filas = [];
  let fin = req;
  for (const n of [...ETAPAS_ANTES].reverse()) {
    const etapa = etapaPorNum(n);
    if (!etapa) continue;
    const inicio = sumaDias(fin, -Math.round(semanasPlan(p, etapa) * 7));
    filas.unshift({ n, etapa, inicio, fin });
    fin = inicio;
  }
  let ini = req;
  for (const n of ETAPAS_DESPUES) {
    const etapa = etapaPorNum(n);
    if (!etapa) continue;
    const f = sumaDias(ini, Math.round(semanasPlan(p, etapa) * 7));
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
  if (n === N_CANCEL) return { clase: 'cancel', texto: 'Cancelado' };
  if (n >= N_FINAL) return { clase: 'ok', texto: 'Entregado' };
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
      ${S.ganttListo ? '<a href="#/capex" data-r="capex">CAPEX</a>' : ''}
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
  const [, ruta = 'inicio', id, pestana] = (location.hash || '#/inicio').split('/');
  $$('nav a, .usuario a').forEach((a) => a.classList.toggle('activo', a.dataset.r === ruta));
  if (ruta === 'nueva') return vistaNueva();
  if (ruta === 'gantt') return vistaGanttGeneral();
  if (ruta === 'capex') return vistaCapex();
  if (ruta === 'p' && id) return vistaDetalle(id, pestana);
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
  if (n === N_APROB && S.perfil.puesto && S.perfil.puesto === aprobadorDe(p.segmento)) return true;
  switch (rol()) {
    case 'Administrador':
    case 'Consulta': return true;
    case 'Comercial': return p.solicitante_id === me;
    case 'Líder': return n === 1 || n === 9;
    case 'Proyectista': return p.proyectista_id === me && [2, 4, 5, 6, 7, 10].includes(n);
    case 'Permisos': return n === 8 || n === 9;
    case 'Construcción': return n >= 11 && n <= 13;
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
        <td>${badgeEtapa(p.etapa)}${num(p.etapa) === N_APROB ? ` <span class="pill">Por aprobar ${esc(aprobadorDe(p.segmento))}</span>` : ''}</td>
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
      (f.entregados || activa(p)) && (!f.seg || p.segmento === f.seg) &&
      (!q || [p.folio, p.nombre, p.municipio].some((x) => (x || '').toLowerCase().includes(q))));
    const conPlan = base.filter((x) => x.plan);
    const sinFecha = base.filter((x) => !x.plan);
    const cuenta = (c) => conPlan.filter((x) => x.st?.clase === c && activa(x.p)).length;
    const kpi = (clave, n, txt, extra = '') => `<button class="kpi ${extra} ${f.estado === clave ? 'activo' : ''}" data-estado="${clave}"><b>${n}</b><span>${txt}</span></button>`;
    $('#ggKpis').innerHTML = kpi('', base.length, 'Proyectos') + kpi('ok', cuenta('ok'), 'A tiempo', 'gk-ok') +
      kpi('riesgo', cuenta('riesgo'), 'En riesgo', 'gk-riesgo') + kpi('mal', cuenta('mal'), 'Atrasados', 'alerta') +
      kpi('sin', sinFecha.length, 'Sin fecha de gas', 'k0');

    let filas = f.estado === 'sin' ? [] : conPlan.filter((x) => !f.estado || (x.st?.clase === f.estado && activa(x.p)));
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
    const actual = n >= N_FINAL ? 999 : Math.max(1, n);
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
// CAPEX: se reparte en el tiempo según el Gantt (etapa de Construcción)
// y según el avance de obra reportado por los supervisores
// ---------------------------------------------------------------------
const capexListo = (p) => p && 'capex' in p;
const fmtMXN = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }));
const fmtM = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toLocaleString('es-MX', { maximumFractionDigits: 1 })} M` : Math.abs(v) >= 1e3 ? `$${Math.round(v / 1e3).toLocaleString('es-MX')} mil` : `$${Math.round(v)}`);
const mesClave = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const mesNombre = (k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1, 12).toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }); };

// Reparte un monto de forma pareja entre dos fechas, por mes
function repartir(mapa, monto, ini, fin) {
  if (!(monto > 0)) return;
  const b = fin.getTime();
  if (b <= ini.getTime()) { const k = mesClave(ini); mapa[k] = (mapa[k] || 0) + monto; return; }
  const total = b - ini.getTime();
  let cur = new Date(ini);
  while (cur.getTime() < b) {
    const sig = new Date(cur.getFullYear(), cur.getMonth() + 1, 1, 12).getTime();
    const hasta = Math.min(sig, b);
    const k = mesClave(cur);
    mapa[k] = (mapa[k] || 0) + (monto * (hasta - cur.getTime())) / total;
    cur = new Date(hasta);
  }
}

// plan: CAPEX en las fechas de Construcción del Gantt · real: lo ejercido según los reportes de avance
// proy: lo que falta, desde hoy hasta el término proyectado al ritmo real (o con la duración del plan)
function capexDe(p, avances = [], inicioObra = null) {
  const c = Number(p.capex);
  const plan = planDe(p);
  const fc = plan?.filas.find((f) => f.n === N_CONST);
  if (!c || !fc || num(p.etapa) === N_CANCEL) return null;
  const hoy = diaDe(hoyISO());
  const out = { capex: c, plan: {}, real: {}, proy: {}, ejercido: 0, pct: 0, iniPlan: fc.inicio, finPlan: fc.fin, finProy: null };
  repartir(out.plan, c, fc.inicio, fc.fin);
  const dur = fc.fin - fc.inicio;
  const avs = [...avances].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id));
  const n = num(p.etapa);
  if (avs.length) {
    let prev = 0;
    for (const a of avs) {
      const pc = Math.min(100, Number(a.porcentaje));
      if (pc > prev) { const k = mesClave(diaDe(a.fecha)); out.real[k] = (out.real[k] || 0) + (c * (pc - prev)) / 100; prev = pc; }
    }
    out.pct = prev;
    const ult = diaDe(avs[avs.length - 1].fecha);
    if (prev < 100) {
      let fin;
      if (inicioObra && prev > 0) fin = sumaDias(ult, Math.round(((100 - prev) / prev) * Math.max(1, (ult - inicioObra) / DIA)));
      else fin = fc.fin > hoy ? fc.fin : new Date(hoy.getTime() + dur);
      const desde = ult > hoy ? ult : hoy;
      if (fin <= desde) fin = sumaDias(desde, 7);
      out.finProy = fin;
      repartir(out.proy, (c * (100 - prev)) / 100, desde, fin);
    } else out.finProy = ult;
  } else if (n > N_CONST && n <= N_FINAL) {
    // Obra terminada sin reportes: se asume que se ejerció según el plan
    Object.assign(out.real, out.plan); out.pct = 100; out.finProy = fc.fin;
  } else {
    // Obra sin iniciar: si el plan ya debía haber empezado, se recorre a partir de hoy
    const ini = inicioObra || (fc.inicio > hoy ? fc.inicio : hoy);
    const fin = new Date(Math.max(ini.getTime() + dur, hoy.getTime() + 7 * DIA));
    out.finProy = fin;
    repartir(out.proy, c, ini > hoy ? ini : hoy, fin);
  }
  out.ejercido = Object.values(out.real).reduce((t, x) => t + x, 0);
  return out;
}

function sumarCapex(lista) {
  const tot = { plan: {}, real: {}, proy: {} };
  for (const x of lista) for (const k of ['plan', 'real', 'proy']) for (const [m, v] of Object.entries(x[k])) tot[k][m] = (tot[k][m] || 0) + v;
  return tot;
}

// Dos gráficas con la misma escala en pesos: CAPEX por mes y curva acumulada
function capexGraficasHtml(tot) {
  const llaves = [...new Set([...Object.keys(tot.plan), ...Object.keys(tot.real), ...Object.keys(tot.proy)])].sort();
  if (!llaves.length) return '<p class="vacio">Sin CAPEX para graficar.</p>';
  const meses = [];
  for (let [y, m] = llaves[0].split('-').map(Number); ; m++) {
    if (m > 12) { m = 1; y++; }
    const k = `${y}-${String(m).padStart(2, '0')}`;
    meses.push(k);
    if (k >= llaves[llaves.length - 1]) break;
  }
  const hoyK = mesClave(diaDe(hoyISO()));
  const filas = meses.map((k) => ({ k, plan: tot.plan[k] || 0, real: tot.real[k] || 0, proy: tot.proy[k] || 0 }));
  let ap = 0, ar = 0;
  filas.forEach((f) => { ap += f.plan; ar += f.real + f.proy; f.acP = ap; f.acR = ar; });

  const W = 900, H = 240, L = 64, R = 12, T = 12, B = 34;
  const iw = W - L - R, ih = H - T - B, bw = iw / meses.length;
  const paso = meses.length > 24 ? 3 : meses.length > 12 ? 2 : 1;
  const eje = (max, y) => {
    const tope = max > 0 ? max * 1.08 : 1;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * tope);
    return { y: (v) => T + ih - (v / tope) * ih, ticks };
  };
  const ejeX = (cx) => meses.map((k, i) => (i % paso ? '' : `<text x="${cx(i)}" y="${H - 12}" text-anchor="middle" class="cx-t">${mesNombre(k)}</text>`)).join('');
  const grid = (e) => e.ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${e.y(t)}" y2="${e.y(t)}" class="cx-grid"/><text x="${L - 6}" y="${e.y(t) + 4}" text-anchor="end" class="cx-t">${fmtM(t)}</text>`).join('');
  const hoyI = meses.indexOf(hoyK);
  const lineaHoy = (cx) => (hoyI >= 0 ? `<line x1="${cx(hoyI)}" x2="${cx(hoyI)}" y1="${T}" y2="${T + ih}" class="cx-hoy"/><text x="${cx(hoyI) + 4}" y="${T + 10}" class="cx-t">Hoy</text>` : '');

  // Barras por mes (dos series, una junto a otra; la proyección es la parte clara de la barra naranja)
  const e1 = eje(Math.max(...filas.map((f) => Math.max(f.plan, f.real + f.proy))));
  const g = 2, w = Math.max(2, Math.min(18, (bw - 6) / 2 - g / 2));
  const cxB = (i) => L + bw * i + bw / 2;
  const barra = (x, v0, v1, cls) => (v1 - v0 > 0 ? `<rect x="${x}" y="${e1.y(v1)}" width="${w}" height="${Math.max(0.5, e1.y(v0) - e1.y(v1))}" rx="2" class="${cls}"/>` : '');
  const barras = filas.map((f, i) => {
    const x = cxB(i);
    return `<g class="cx-hit" data-tt="${esc(`<b>${mesNombre(f.k)}</b><br>Plan (Gantt): ${fmtMXN(f.plan)}<br>Real: ${fmtMXN(f.real)}<br>Proyección: ${fmtMXN(f.proy)}`)}">
      <rect x="${L + bw * i}" y="${T}" width="${bw}" height="${ih}" class="cx-zona"/>
      ${barra(x - w - g / 2, 0, f.plan, 'cx-plan')}
      ${barra(x + g / 2, 0, f.real, 'cx-real')}${barra(x + g / 2, f.real, f.real + f.proy, 'cx-proy')}</g>`;
  }).join('');

  // Curva acumulada
  const e2 = eje(Math.max(ap, ar));
  const cxL = (i) => L + bw * i + bw / 2;
  const linea = (campo, cls, desde = 0, hasta = filas.length - 1) => {
    const pts = filas.slice(desde, hasta + 1).map((f, j) => `${cxL(desde + j).toFixed(1)},${e2.y(f[campo]).toFixed(1)}`).join(' ');
    return pts.includes(' ') ? `<polyline points="${pts}" class="${cls}"/>` : '';
  };
  const corte = hoyI >= 0 ? hoyI : filas.findIndex((f) => f.k > hoyK) - 1;
  const lineaReal = corte < 0 ? linea('acR', 'cx-l-proy') : corte >= filas.length - 1 ? linea('acR', 'cx-l-real') : linea('acR', 'cx-l-real', 0, corte) + linea('acR', 'cx-l-proy', corte);
  const puntos = filas.map((f, i) => `<g class="cx-hit" data-tt="${esc(`<b>${mesNombre(f.k)}</b><br>Acumulado plan: ${fmtMXN(f.acP)}<br>Acumulado real y proyección: ${fmtMXN(f.acR)}`)}">
      <rect x="${L + bw * i}" y="${T}" width="${bw}" height="${ih}" class="cx-zona"/>
      <circle cx="${cxL(i)}" cy="${e2.y(f.acP)}" r="3" class="cx-pt-plan"/><circle cx="${cxL(i)}" cy="${e2.y(f.acR)}" r="3" class="cx-pt-real"/></g>`).join('');

  const tabla = `<details class="cx-tabla"><summary>Ver tabla por mes</summary><div class="tabla-wrap"><table class="tabla compacta">
    <thead><tr><th>Mes</th><th>Plan (Gantt)</th><th>Real</th><th>Proyección</th><th>Acum. plan</th><th>Acum. real + proy.</th></tr></thead><tbody>
    ${filas.map((f) => `<tr><td>${mesNombre(f.k)}</td><td>${fmtMXN(f.plan)}</td><td>${fmtMXN(f.real)}</td><td>${fmtMXN(f.proy)}</td><td>${fmtMXN(f.acP)}</td><td>${fmtMXN(f.acR)}</td></tr>`).join('')}
    </tbody></table></div></details>`;

  const leyenda = `<div class="g-leyenda"><span><i class="sw cx-sw-plan"></i>Plan según Gantt (fechas de Construcción)</span>
    <span><i class="sw cx-sw-real"></i>Real según avance de obra</span><span><i class="sw cx-sw-proy"></i>Proyección de lo que falta</span></div>`;
  return `<div class="cx-graf">
    <h3>CAPEX por mes</h3>${leyenda}
    <svg viewBox="0 0 ${W} ${H}" class="cx-svg" role="img" aria-label="CAPEX por mes: plan contra real y proyección">${grid(e1)}${lineaHoy(cxB)}${barras}<line x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}" class="cx-base"/>${ejeX(cxB)}</svg>
    <h3>CAPEX acumulado (curva S)</h3>
    <svg viewBox="0 0 ${W} ${H}" class="cx-svg" role="img" aria-label="CAPEX acumulado: plan contra real y proyección">${grid(e2)}${lineaHoy(cxL)}${linea('acP', 'cx-l-plan')}${lineaReal}${puntos}<line x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}" class="cx-base"/>${ejeX(cxL)}</svg>
    ${tabla}</div>`;
}

// Tooltip compartido de las gráficas
function activarTooltips(root) {
  let tip = $('#cxTip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'cxTip'; tip.className = 'cx-tip'; document.body.appendChild(tip); }
  $$('.cx-hit', root).forEach((g) => {
    g.onmousemove = (e) => {
      tip.innerHTML = g.dataset.tt; tip.style.display = 'block';
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      tip.style.left = `${x}px`; tip.style.top = `${e.clientY + 14}px`;
      g.classList.add('sobre');
    };
    g.onmouseleave = () => { tip.style.display = 'none'; g.classList.remove('sobre'); };
  });
}

async function vistaCapex() {
  const v = vista('Cargando CAPEX…');
  const etapaC = etapaPorNum(N_CONST);
  const [rp, rav, rh] = await Promise.all([
    sb.from('proyectos').select('*'),
    sb.from('avance_obra').select('proyecto_id,fecha,porcentaje,id'),
    sb.from('historial').select('proyecto_id,created_at').eq('etapa_nueva', etapaC),
  ]);
  if (rp.error) { v.innerHTML = `<p class="error">${esc(errorTxt(rp.error))}</p>`; return; }
  if (rp.data.length && !capexListo(rp.data[0])) { v.innerHTML = '<p class="muted">Falta ejecutar <b>supabase/008_capex.sql</b> en Supabase para activar el CAPEX.</p>'; return; }
  const avPor = {}; (rav.data || []).forEach((a) => (avPor[a.proyecto_id] = avPor[a.proyecto_id] || []).push(a));
  const iniPor = {}; (rh.data || []).forEach((h) => { const d = diaDe(h.created_at); if (!iniPor[h.proyecto_id] || d < iniPor[h.proyecto_id]) iniPor[h.proyecto_id] = d; });
  const todos = rp.data.filter((p) => num(p.etapa) !== N_CANCEL).map((p) => ({ p, cx: capexDe(p, avPor[p.id], iniPor[p.id]), st: estadoPlan(p) }));
  const f = { seg: '', anio: '' };

  v.innerHTML = `<div class="titulo"><h1>CAPEX</h1>
      <div class="gg-filtros"><select id="cxSeg"><option value="">Todos los segmentos</option>${SEGMENTOS.map((x) => `<option>${x}</option>`).join('')}</select></div></div>
    <p class="muted chico">El CAPEX de cada Elemento PEP se reparte en las fechas de <b>Construcción</b> del Gantt (plan) y, cuando hay reportes de avance de obra, en lo realmente ejercido más la proyección de lo que falta.</p>
    <div class="kpis" id="cxKpis"></div>
    <section class="card" id="cxGraf"></section>
    <section class="card"><h2>Por segmento</h2><div id="cxSegs"></div></section>
    <section class="card"><h2>Proyectos</h2><div id="cxLista"></div></section>`;

  const pintar = () => {
    const base = todos.filter((x) => !f.seg || x.p.segmento === f.seg);
    const con = base.filter((x) => x.cx);
    const sinCapex = base.filter((x) => num(x.p.etapa) >= N_PEP && num(x.p.etapa) <= N_FINAL && !x.p.capex);
    const total = con.reduce((t, x) => t + x.cx.capex, 0);
    const ejer = con.reduce((t, x) => t + x.cx.ejercido, 0);
    const anioK = String(new Date().getFullYear());
    const tot = sumarCapex(con.map((x) => x.cx));
    const planAnio = Object.entries(tot.plan).filter(([k]) => k.startsWith(anioK)).reduce((t, [, x]) => t + x, 0);
    $('#cxKpis').innerHTML = `
      <div class="kpi"><b>${fmtM(total)}</b><span>CAPEX registrado (${con.length} proyectos)</span></div>
      <div class="kpi"><b>${fmtM(ejer)}</b><span>Ejercido según avance (${total ? Math.round(ejer / total * 100) : 0}%)</span></div>
      <div class="kpi"><b>${fmtM(total - ejer)}</b><span>Por ejercer</span></div>
      <div class="kpi"><b>${fmtM(planAnio)}</b><span>Plan ${anioK} según Gantt</span></div>
      <div class="kpi ${sinCapex.length ? 'alerta' : ''}"><b>${sinCapex.length}</b><span>Con PEP pendiente o sin CAPEX</span></div>`;
    $('#cxGraf').innerHTML = capexGraficasHtml(tot);
    $('#cxSegs').innerHTML = `<div class="tabla-wrap"><table class="tabla compacta"><thead><tr><th>Segmento</th><th>Proyectos</th><th>CAPEX</th><th>Ejercido</th><th>Por ejercer</th></tr></thead><tbody>
      ${SEGMENTOS.map((sg) => { const l = con.filter((x) => x.p.segmento === sg); const c = l.reduce((t, x) => t + x.cx.capex, 0), e = l.reduce((t, x) => t + x.cx.ejercido, 0);
        return l.length ? `<tr><td>${sg}</td><td>${l.length}</td><td>${fmtMXN(c)}</td><td>${fmtMXN(e)}</td><td>${fmtMXN(c - e)}</td></tr>` : ''; }).join('')}
      </tbody></table></div>`;
    const orden = [...con].sort((a, b) => a.cx.iniPlan - b.cx.iniPlan);
    $('#cxLista').innerHTML = orden.length ? `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Folio</th><th>Proyecto</th><th>Etapa</th><th>Elemento PEP</th><th>CAPEX</th><th>Ejercido</th><th>Construcción (plan)</th><th>Término proyectado</th><th>Plan</th></tr></thead><tbody>
      ${orden.map(({ p, cx, st }) => `<tr data-id="${p.id}">
        <td><b>${esc(p.folio)}</b></td><td>${esc(p.nombre)}<br><small class="muted">${esc(p.segmento)} · ${esc(p.municipio)}</small></td>
        <td>${badgeEtapa(p.etapa)}</td><td>${esc(p.elemento_pep || '—')}</td><td>${fmtMXN(cx.capex)}</td>
        <td>${fmtMXN(cx.ejercido)} <small class="muted">(${Math.round(cx.pct)}%)</small></td>
        <td>${fecha(isoDe(cx.iniPlan))} – ${fecha(isoDe(cx.finPlan))}</td>
        <td class="${cx.finProy && cx.finProy > cx.finPlan ? 'vencido' : ''}">${cx.finProy ? fecha(isoDe(cx.finProy)) : '—'}</td>
        <td>${pillPlan(st)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vacio">Ningún proyecto tiene CAPEX y fecha requerida de gas todavía.</p>';
    if (sinCapex.length) $('#cxLista').innerHTML += `<p class="muted chico">Sin CAPEX: ${sinCapex.map(({ p }) => `<a href="#/p/${p.id}/capex">${esc(p.folio)}</a>`).join(', ')}</p>`;
    $$('#cxLista tr[data-id]').forEach((tr) => (tr.onclick = () => (location.hash = `#/p/${tr.dataset.id}/capex`)));
    activarTooltips(v);
  };
  $('#cxSeg').onchange = (e) => { f.seg = e.target.value; pintar(); };
  pintar();
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

// Avance de cada etapa a la siguiente: quién lo hace y qué se revisa antes
const AVANCES = {
  0: { roles: ['Comercial'], label: 'Reenviar al Líder', docs: '1. Solicitud' },
  1: { roles: ['Líder'], label: 'Asignar proyectista', id: 'asignar', sinDocs: true },
  2: { roles: ['Proyectista'], label: 'Enviar a aprobación comercial', omiteAct: 'Aprobación de factibilidad' },
  3: { roles: ['Aprobador'], label: 'Aprobar anteproyecto' },   // KAM o Supervisor de ventas según segmento
  4: { roles: ['Proyectista'], label: 'PEP obtenido: pasar a Dictamen de diseño', pep: true },
  5: { roles: ['Proyectista'], label: 'Dictamen obtenido: pasar a Expediente de permisos' },
  6: { roles: ['Proyectista'], label: 'Enviar expediente al DRO' },
  7: { roles: ['Proyectista'], label: 'DRO sin correcciones: enviar a Licencias' },
  8: { roles: ['Permisos'], label: 'Licencias obtenidas: pasar a Socialización', lic: true },
  9: { roles: ['Permisos', 'Líder'], label: 'Zona liberada: pasar a Carpeta técnica' },
  10: { roles: ['Proyectista'], label: 'Entregar carpeta técnica a Construcción' },
  11: { roles: ['Construcción'], label: 'Obra terminada: pasar a Cierre y as-built' },
  12: { roles: ['Construcción'], label: 'Pasar a Puesta en servicio' },
  13: { roles: ['Construcción'], label: 'Gas en servicio: entregar a O&M' },
};
// Regresos y cancelación (siempre con motivo)
const REGRESOS = [
  { de: 1, a: 0, roles: ['Líder'], id: 'devolver', label: 'Devolver a Comercial' },
  { de: 3, a: 2, roles: ['Aprobador'], label: 'Pedir cambios al anteproyecto' },
  { de: 3, a: N_CANCEL, roles: ['Aprobador'], id: 'cancelar', label: 'No aprobar (cancelar proyecto)', peligro: true },
  { de: 7, a: 6, roles: ['Proyectista'], label: 'DRO con correcciones: regresar a Expediente' },
  { de: 11, a: 10, roles: ['Construcción'], label: 'Carpeta incompleta: regresar a Proyectos' },
];

function accionesDe(p) {
  const r = rol(), me = S.perfil.id, n = num(p.etapa), adm = esAdmin(), out = [];
  // Proyectista solo en sus proyectos; Comercial solo en sus solicitudes
  const puede = (roles) => adm || (roles.includes('Aprobador') && puedoAprobar(p)) || (roles.includes(r)
    && (r !== 'Proyectista' || p.proyectista_id === me)
    && (r !== 'Comercial' || p.solicitante_id === me));
  const av = AVANCES[n];
  if (av && puede(av.roles)) {
    out.push({
      id: av.id || 'avanzar', label: av.label, destino: etapaPorNum(n + 1),
      revisaDocs: av.sinDocs ? null : (av.docs || p.etapa), revisaAct: av.sinDocs ? null : p.etapa, omiteAct: av.omiteAct,
      revisaLic: !!av.lic, revisaPep: !!av.pep,
    });
  }
  for (const g of REGRESOS.filter((x) => x.de === n && puede(x.roles)))
    out.push({ id: g.id || 'regresar', label: g.label, destino: etapaPorNum(g.a), sec: true, peligro: !!g.peligro });
  if (n >= N_PEP && n < N_FINAL && (adm || (r === 'Proyectista' && p.proyectista_id === me)))
    out.push({ id: 'pep', label: p.elemento_pep ? (capexListo(p) && p.capex == null ? 'Registrar CAPEX del PEP' : 'Corregir Elemento PEP / CAPEX') : 'Registrar Elemento PEP y CAPEX', sec: !!p.elemento_pep && !(capexListo(p) && p.capex == null) });
  if (adm) out.push({ id: 'mover', label: 'Mover a otra etapa', sec: true });
  if (puedeEditar()) out.push({ id: 'comentar', label: 'Agregar comentario', sec: true });
  return out;
}

const PESTANAS = [
  ['resumen', 'Resumen'], ['expediente', 'Expediente'], ['actividades', 'Actividades'],
  ['construccion', 'Construcción'], ['capex', 'CAPEX'], ['historial', 'Historial'],
];
async function vistaDetalle(id, pestana) {
  const v = vista('Cargando proyecto…');
  const [rp, rd, rh, rl, ra, rav] = await Promise.all([
    sb.from('proyectos').select('*').eq('id', id).maybeSingle(),
    sb.from('documentos').select('*').eq('proyecto_id', id).order('created_at'),
    sb.from('historial').select('*').eq('proyecto_id', id).order('created_at', { ascending: false }),
    sb.from('licencias').select('*').eq('proyecto_id', id).order('created_at'),
    S.flujoListo ? sb.from('proyecto_actividades').select('*').eq('proyecto_id', id) : Promise.resolve({ data: [] }),
    sb.from('avance_obra').select('*').eq('proyecto_id', id).order('fecha', { ascending: false }).order('id', { ascending: false }),
  ]);
  const avanceListo = !rav.error; // false si aún no se ejecuta supabase/006_avance_obra.sql
  const avances = rav.data || [];
  const err = rp.error || rd.error || rh.error || rl.error || ra.error;
  if (err) { v.innerHTML = `<p class="error">${esc(errorTxt(err))}</p>`; return; }
  const p = rp.data;
  if (!p) { v.innerHTML = '<p class="vacio">Proyecto no encontrado. <a href="#/inicio">Volver</a></p>'; return; }
  const docs = rd.data, hist = rh.data, lics = rl.data;
  const avance = new Map((ra.data || []).map((x) => [x.actividad_id, x]));
  const estAct = (a) => avance.get(a.id)?.estatus || 'Pendiente';
  const actPendientes = (etapa, omite) => actividadesDe(etapa).filter((a) => a.nombre !== omite && !cerrada(estAct(a)));
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
  const nVista = n === N_CANCEL ? N_APROB : Math.max(1, n); // un cancelado muestra hasta la aprobación comercial
  const etapasDocs = ETAPAS.filter((e) => num(e) >= 1 && num(e) <= Math.min(nVista, N_FINAL));
  const idsConfig = new Set();
  const bloqueDocs = etapasDocs.map((e) => {
    const lista = docsDe(e, p.segmento, p.material);
    lista.forEach((d) => idsConfig.add(d.id));
    if (!lista.length) return '';
    return `<h3>${esc(e)}</h3>` + lista.map((d) => filaDoc(d, docs.filter((x) => x.config_doc_id === d.id))).join('');
  }).join('');
  const sueltos = docs.filter((x) => !idsConfig.has(x.config_doc_id));

  function filaDoc(d, archivos, soloVer = false) {
    return `<div class="doc">
      <span class="estado ${archivos.length ? 'ok' : d.obligatorio ? 'pend' : 'opc'}">${archivos.length ? '✓' : d.obligatorio ? '!' : '·'}</span>
      <div class="doc-info"><b>${esc(d.nombre)}</b><small>${d.obligatorio ? 'Obligatorio' : 'Opcional'}</small>
        <div class="files">${archivos.map((a) => archivoHtml(a, soloVer)).join('')}</div></div>
      ${subir && !soloVer ? `<label class="btn sec chico">Subir<input type="file" multiple hidden data-subir="${d.id}"></label>` : ''}
    </div>`;
  }
  function archivoHtml(a, soloVer = false) {
    const borrar = !soloVer && (esAdmin() || a.subido_por === S.perfil.id);
    return `<div class="archivo">
      ${urls[a.ruta] ? `<a href="${esc(urls[a.ruta])}" target="_blank" rel="noopener">${esc(a.nombre_archivo)}</a>` : esc(a.nombre_archivo)}
      <small class="muted">${tamano(a.tamano)} · ${esc(nombreDe(a.subido_por))} · ${fecha(a.created_at)}</small>
      ${borrar ? `<button class="link rojo" data-borrar="${a.id}" title="Eliminar">✕</button>` : ''}
    </div>`;
  }

  const acciones = accionesDe(p);
  const stepper = ETAPAS.filter((e) => num(e) >= 1 && num(e) <= N_FINAL).map((e) => {
    const k = num(e);
    const cls = n === N_CANCEL ? (k < N_APROB ? 'hecho' : '') : n === 0 ? (k === 1 ? 'actual devuelto' : '') : k < n ? 'hecho' : k === n ? 'actual' : '';
    return `<li class="${cls}"><span>${k}</span><small>${esc(e.replace(/^\d+\.\s*/, ''))}</small></li>`;
  }).join('');

  // Pestaña inicial: la de la URL, la última usada o la natural para el rol
  S.pestanaDet = S.pestanaDet || {};
  const pestDefault = rol() === 'Construcción' && n >= 10 && n < N_FINAL ? 'construccion' : 'resumen';
  let pest = PESTANAS.some(([k]) => k === pestana) ? pestana : S.pestanaDet[id] || pestDefault;

  // Indicadores en las pestañas
  const faltanAhora = n >= 1 && n < N_FINAL ? faltantes(p.etapa).length : 0;
  const actAhora = n >= 1 && n <= N_FINAL ? actividadesDe(p.etapa) : [];
  const actHechas = actAhora.filter((x) => cerrada(estAct(x))).length;
  const ultAvance = avances[0];
  const marca = {
    expediente: faltanAhora ? `<span class="tab-n alerta">${faltanAhora}</span>` : '',
    actividades: actAhora.length ? `<span class="tab-n">${actHechas}/${actAhora.length}</span>` : '',
    construccion: ultAvance ? `<span class="tab-n">${Number(ultAvance.porcentaje)}%</span>` : '',
  };

  // Información para obra: documentos de diseño, permisos y carpeta técnica (solo consulta)
  const etapasObra = [5, 6, 8, 9, 10].map(etapaPorNum).filter(Boolean);
  const docsObra = etapasObra.map((e) => {
    const lista = docsDe(e, p.segmento, p.material);
    if (!lista.length) return '';
    return `<h3>${esc(nombreCorto(e))}</h3>` + lista.map((d) => filaDoc(d, docs.filter((x) => x.config_doc_id === d.id), true)).join('');
  }).join('');

  v.innerHTML = `
    <a class="volver" href="#/inicio">← Volver</a>
    <div class="titulo">
      <div><h1>${esc(p.folio)} · ${esc(p.nombre)}</h1><div>${badgeEtapa(p.etapa)} ${p.bloqueo ? '<span class="bloq">⚠ Bloqueado</span>' : ''}</div></div>
    </div>
    <ol class="stepper">${stepper}</ol>
    ${n === 0 ? `<div class="aviso">Devuelta a Comercial. Revisa el historial para ver el motivo, corrige y reenvía.</div>` : ''}
    ${n === N_CANCEL ? `<div class="aviso">Proyecto cancelado (factibilidad no aprobada por el área comercial). El motivo está en el historial.</div>` : ''}
    ${n === N_APROB ? `<div class="aviso">Factibilidad técnico-económica <b>en revisión por el ${esc(aprobadorDe(p.segmento))}</b> (tiempo objetivo: 2 días): lo aprueba, pide cambios al anteproyecto o cancela el proyecto.</div>` : ''}
    ${n >= N_PEP && n < N_FINAL && !p.elemento_pep ? `<div class="aviso">Falta el <b>Elemento PEP</b> (lo registra el proyectista tras gestionarlo con Inversiones). Sin él no se puede pasar a Dictamen de diseño.</div>` : ''}

    <nav class="tabs" role="tablist">${PESTANAS.map(([k, t]) => `<button role="tab" data-tab="${k}" class="${k === pest ? 'activa' : ''}">${t}${marca[k] || ''}</button>`).join('')}</nav>

    <div class="tab-panel" data-panel="resumen">
    <div class="cols">
      <div class="col">
        ${acciones.length ? `<section class="card"><h2>Acciones</h2>
          <div class="botones">${acciones.map((a, i) => `<button class="btn ${a.sec ? 'sec' : ''}" data-accion="${i}">${esc(a.label)}</button>`).join('')}</div>
          <div id="accionForm"></div></section>` : ''}
        <section class="card">
      <div class="card-h"><h2>Cronograma (Gantt)</h2>${pillPlan(estPlan)}</div>
      ${!S.ganttListo ? '<p class="muted">Falta ejecutar <b>supabase/002_gantt.sql</b> en Supabase para activar el Gantt.</p>'
        : !plan ? `<p class="muted">Captura la <b>fecha requerida de gas</b> en Seguimiento para calcular el cronograma.</p>`
        : `<p class="g-resumen">Gas requerido: <b>${fecha(p.fecha_requerida_gas)}</b> · Debía arrancar: <b>${fecha(isoDe(plan.inicioPlan))}</b> ·
            ${plan.holgura >= 0 ? `Holgura al recibir la solicitud: <b>${Math.round(plan.holgura / 7 * 10) / 10} semanas</b>` : `<span class="vencido">Llegó ${Math.round(-plan.holgura / 7 * 10) / 10} semanas tarde para los tiempos estándar</span>`}</p>
           ${ganttHtml(p, plan, realesDe(p, hist))}`}
    </section>
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
              ${S.flujoListo ? `<dt>Factibilidad</dt><dd>${esc(p.factibilidad || '—')}</dd>
              ${p.aprobado_por ? `<dt>Anteproyecto</dt><dd>Aprobado por: ${firmaAprobacion(p)}</dd>` : ''}
              <dt>Elemento PEP</dt><dd>${p.elemento_pep ? `${esc(p.elemento_pep)}${p.fecha_pep ? ` <small class="muted">(${fecha(p.fecha_pep)})</small>` : ''}` : '<span class="muted">Pendiente</span>'}</dd>
              ${capexListo(p) ? `<dt>CAPEX</dt><dd>${p.capex != null ? fmtMXN(p.capex) : '<span class="muted">Pendiente</span>'}</dd>` : ''}` : ''}
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
      </div>
    </div>
    </div>

    <div class="tab-panel" data-panel="expediente">
    <div class="cols">
      <div class="col">
        <section class="card">
          <div class="card-h"><h2>Expediente</h2></div>
          ${bloqueDocs || '<p class="muted">No hay documentos configurados.</p>'}
          <h3>Otros archivos</h3>
          <div class="doc"><span class="estado opc">+</span>
            <div class="doc-info"><div class="files">${sueltos.map((a) => archivoHtml(a)).join('') || '<small class="muted">Sin archivos</small>'}</div></div>
            ${subir ? '<label class="btn sec chico">Subir<input type="file" multiple hidden data-subir=""></label>' : ''}
          </div>
        </section>
      </div>
      <div class="col">
        ${(n >= N_LIC_DESDE && n !== N_CANCEL) || lics.length ? `<section class="card">
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
    </div>
    </div>

    <div class="tab-panel" data-panel="actividades">
      ${S.flujoListo ? `<section class="card" id="cardActividades"></section>` : '<p class="muted">Las actividades del flujograma no están configuradas.</p>'}
    </div>

    <div class="tab-panel" data-panel="construccion">
    <div class="cols">
      <div class="col">
        ${avanceListo ? '<section class="card" id="cardAvance"></section>' : '<section class="card"><h2>Avance de obra</h2><p class="muted">Falta ejecutar <b>supabase/006_avance_obra.sql</b> en Supabase.</p></section>'}
        ${S.constListo && n >= 1 && n <= N_FINAL ? '<section class="card" id="cardConst"></section>' : ''}
      </div>
      <div class="col">
        <section class="card">
          <h2>Información para obra</h2>
          <dl class="datos">
            <dt>Dirección</dt><dd>${esc(p.direccion) || '—'}</dd>
            <dt>Municipio</dt><dd>${esc(p.municipio)}</dd>
            <dt>Segmento / material</dt><dd>${esc(p.segmento)} · ${esc(p.material)}</dd>
            <dt>Proyectista</dt><dd>${p.proyectista_id ? esc(nombreDe(p.proyectista_id)) : '—'}</dd>
            <dt>Elemento PEP</dt><dd>${p.elemento_pep ? esc(p.elemento_pep) : '<span class="vencido">Pendiente</span>'}${capexListo(p) && p.capex != null ? ` · CAPEX ${fmtMXN(p.capex)}` : ''}</dd>
            <dt>Gas requerido</dt><dd>${fecha(p.fecha_requerida_gas) || '—'}</dd>
          </dl>
          <h3>Licencias</h3>
          ${lics.length ? `<ul class="lista-lic">${lics.map((l) => `<li><span class="lic ${esc(l.estatus.replace(' ', ''))}">${esc(l.estatus)}</span> ${esc(l.tipo)}${l.dependencia ? ` · <small class="muted">${esc(l.dependencia)}</small>` : ''}
            ${l.fecha_vencimiento ? `<small class="${l.fecha_vencimiento < hoyISO() ? 'vencido' : 'muted'}"> · vence ${fecha(l.fecha_vencimiento)}</small>` : ''}</li>`).join('')}</ul>` : '<p class="muted chico">Sin licencias registradas.</p>'}
          ${docsObra || '<p class="muted">No hay documentos configurados.</p>'}
        </section>
      </div>
    </div>
    </div>

    <div class="tab-panel" data-panel="capex">
      <section class="card" id="cardCapex"></section>
    </div>

    <div class="tab-panel" data-panel="historial">
        <section class="card">
          <h2>Historial</h2>
          <ul class="timeline">${hist.map((h) => `<li>
            <div class="t-h"><b>${esc(h.accion)}</b><small class="muted">${fechaHora(h.created_at)}</small></div>
            <small>${esc(nombreDe(h.usuario_id))}${h.etapa_nueva ? ` · ${h.etapa_anterior ? esc(h.etapa_anterior) + ' → ' : ''}${esc(h.etapa_nueva)}` : ''}</small>
            ${h.comentario ? `<p class="pre">${esc(h.comentario)}</p>` : ''}
          </li>`).join('') || '<li class="muted">Sin movimientos</li>'}</ul>
        </section>
    </div>`;

  // Pestañas
  const mostrar = (k) => {
    pest = k; S.pestanaDet[id] = k;
    $$('.tabs [data-tab]', v).forEach((b) => b.classList.toggle('activa', b.dataset.tab === k));
    $$('.tab-panel', v).forEach((x) => (x.hidden = x.dataset.panel !== k));
    history.replaceState(null, '', `#/p/${id}/${k}`);
  };
  $$('.tabs [data-tab]', v).forEach((b) => (b.onclick = () => mostrar(b.dataset.tab)));
  mostrar(pest);
  // En pantallas angostas, centrar la etapa actual en la barra de etapas
  const stp = $('.stepper', v), liAct = $('.stepper li.actual', v);
  if (stp && liAct) stp.scrollLeft = liAct.offsetLeft - stp.clientWidth / 2 + liAct.clientWidth / 2;

  const recargar = () => vistaDetalle(id);

  // --- Actividades del flujograma (checklist por etapa)
  const cardAct = $('#cardActividades');
  const filaAct = (a) => {
    const reg = avance.get(a.id), st = estAct(a);
    const icono = { Hecha: ['ok', '✓'], 'No aplica': ['opc', '–'], 'En proceso': ['curso', '…'] }[st] || ['opc', '·'];
    return `<div class="doc act ${st === 'Hecha' || st === 'No aplica' ? 'cerrada' : ''}">
      <span class="estado ${icono[0]}">${icono[1]}</span>
      <div class="doc-info"><b>${a.decision ? '<span class="rombo" title="Punto de decisión">◆</span> ' : ''}${esc(a.nombre)}</b>
        <small><span class="area">${esc(a.area)}</span>${a.dias != null ? ` · ${Number(a.dias)} día${Number(a.dias) === 1 ? '' : 's'}` : ''}${a.entregables ? ` · ${esc(a.entregables)}` : ''}</small>
        ${reg && st !== 'Pendiente' ? `<small class="muted">${esc(st)} · ${esc(nombreDe(reg.usuario_id))} · ${fecha(reg.updated_at)}</small>` : ''}
      </div>
      ${puedeEditar() && n !== N_CANCEL ? `<select class="act-sel" data-act="${a.id}">${ESTATUS_ACT.map((x) => `<option ${x === st ? 'selected' : ''}>${x}</option>`).join('')}</select>` : `<small class="muted">${esc(st)}</small>`}
    </div>`;
  };
  const pintarActividades = () => {
    if (!cardAct) return;
    const etapasAct = ETAPAS.filter((e) => num(e) >= 1 && num(e) <= Math.min(nVista, N_FINAL));
    const actual = n >= 1 && n <= N_FINAL ? p.etapa : null;
    const resumen = (lista) => `${lista.filter((x) => cerrada(estAct(x))).length}/${lista.length}`;
    const delActual = actual ? actividadesDe(actual) : [];
    const abiertas = new Set($$('details[open]', cardAct).map((d) => d.dataset.e));
    const primera = !cardAct.innerHTML;
    cardAct.innerHTML = `<div class="card-h"><h2>Actividades del proceso</h2>
        ${delActual.length ? `<span class="pill ${delActual.every((x) => cerrada(estAct(x))) ? 'ok' : ''}">${resumen(delActual)} de la etapa actual</span>` : ''}</div>
      <p class="muted chico">Según el Flujograma de Proyectos. Los días son el tiempo objetivo; ◆ = punto de decisión.</p>
      ${etapasAct.map((e) => {
        const lista = actividadesDe(e);
        if (!lista.length) return '';
        return `<details class="act-etapa" data-e="${esc(e)}" ${(primera ? e === actual : abiertas.has(e)) ? 'open' : ''}><summary><b>${esc(e)}</b> <small class="muted">${resumen(lista)}</small></summary>${lista.map(filaAct).join('')}</details>`;
      }).join('') || '<p class="muted">No hay actividades configuradas.</p>'}`;
    $$('select[data-act]', cardAct).forEach((sel) => (sel.onchange = async () => {
      const actividad_id = Number(sel.dataset.act);
      const fila = { proyecto_id: p.id, actividad_id, estatus: sel.value, usuario_id: S.perfil.id, updated_at: new Date().toISOString() };
      sel.disabled = true;
      const { error } = await sb.from('proyecto_actividades').upsert(fila, { onConflict: 'proyecto_id,actividad_id' });
      if (error) { sel.disabled = false; return fallo(error); }
      avance.set(actividad_id, fila);
      pintarActividades();
    }));
  };
  pintarActividades();

  // --- Acciones de flujo
  $$('[data-accion]', v).forEach((b) => (b.onclick = () => {
    const a = acciones[Number(b.dataset.accion)];
    const pendDocs = a.revisaDocs ? faltantes(a.revisaDocs) : [];
    const pendLic = a.revisaLic ? licPendientes : [];
    const pendPep = a.revisaPep && !p.elemento_pep;
    const pendAct = a.revisaAct ? actPendientes(a.revisaAct, a.omiteAct) : [];
    const bloqueado = (pendDocs.length || pendLic.length || pendPep) && !esAdmin();
    const proyectistas = S.perfiles.filter((x) => x.rol === 'Proyectista' && x.activo);

    let extra = '';
    if (a.id === 'asignar') extra = `<label>Proyectista *<select name="proyectista_id" required><option value="">Selecciona…</option>
      ${proyectistas.map((x) => `<option value="${x.id}" ${x.id === p.proyectista_id ? 'selected' : ''}>${esc(x.nombre || x.email)}</option>`).join('')}</select></label>
      ${proyectistas.length ? '' : '<p class="error">No hay usuarios con rol Proyectista.</p>'}`;
    if (a.id === 'pep') extra = `<label>Elemento PEP *<input name="elemento_pep" required maxlength="60" value="${esc(p.elemento_pep || '')}" placeholder="Ej. I-26-0123-001"></label>
      <label>Fecha de creación del PEP<input type="date" name="fecha_pep" value="${esc(p.fecha_pep || hoyISO())}"></label>
      ${capexListo(p) ? `<label>CAPEX del PEP (MXN) *<input type="number" name="capex" required min="0" step="0.01" value="${esc(p.capex ?? '')}" placeholder="Ej. 1250000"></label>` : ''}`;
    if (a.id === 'mover') extra = `<label>Nueva etapa *<select name="etapa" required>${ETAPAS.filter((e) => e !== p.etapa).map((e) => `<option>${esc(e)}</option>`).join('')}</select></label>`;

    const requiereComentario = ['devolver', 'comentar', 'cancelar', 'regresar'].includes(a.id);
    const etiquetaCom = { devolver: 'Motivo de la devolución *', cancelar: 'Motivo por el que no se aprueba *', regresar: 'Motivo / qué se debe corregir *' }[a.id] || (requiereComentario ? 'Comentario *' : 'Comentario (opcional)');
    $('#accionForm').innerHTML = `<form class="accion">
      <h3>${esc(a.label)}</h3>
      ${pendDocs.length ? `<div class="aviso">Faltan documentos obligatorios: <b>${pendDocs.map((d) => esc(d.nombre)).join(', ')}</b></div>` : ''}
      ${pendLic.length ? `<div class="aviso">Licencias sin aprobar: <b>${pendLic.map((l) => esc(l.tipo)).join(', ')}</b></div>` : ''}
      ${pendPep ? '<div class="aviso">Falta el <b>Elemento PEP</b>: pide al proyectista que lo registre (lo gestiona con Inversiones).</div>' : ''}
      ${pendAct.length ? `<div class="aviso">Actividades del flujograma sin terminar: <b>${pendAct.map((x) => esc(x.nombre)).join(', ')}</b></div>` : ''}
      ${bloqueado ? '' : extra}
      ${bloqueado ? '' : `<label>${etiquetaCom}
        <textarea name="comentario" rows="3" ${requiereComentario ? 'required' : ''}></textarea></label>`}
      <div class="botones">
        <button type="button" class="btn sec" data-cancelar>Cancelar</button>
        ${bloqueado ? '' : `<button class="btn ${a.peligro ? 'peligro' : ''}">${pendDocs.length || pendLic.length || pendPep || pendAct.length ? 'Continuar de todos modos' : 'Confirmar'}</button>`}
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
          else if (a.id === 'pep') {
            cambios.elemento_pep = fd.elemento_pep.trim(); cambios.fecha_pep = fd.fecha_pep || null;
            if (capexListo(p)) cambios.capex = fd.capex === '' ? null : Number(fd.capex);
          }
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

  // --- Tiempo estimado de construcción (supervisores)
  const cardConst = $('#cardConst');
  const pintarConst = (editando = false) => {
    if (!cardConst) return;
    const etapaC = etapaPorNum(N_CONST);
    const estandar = semanasDe(p.segmento, etapaC);
    const tiene = p.const_semanas != null;
    const det = p.const_detalle || {};
    const resumenCalc = tiene && p.const_metodo === 'Cálculo' ? (() => {
      const c = calcConst(det);
      return `<small class="muted">${c.metros.toLocaleString('es-MX')} m en ${(det.tramos || []).length} tramo(s) · ${det.cuadrillas || 1} cuadrilla(s) · tendido ${c.diasTendido} días + ${Number(det.dias_extra) || 0} adicionales = ${c.dias} días (${det.dias_semana || 5} días/semana)</small>`;
    })() : '';
    const encabezado = `<div class="card-h"><h2>Tiempo de construcción</h2>
      ${tiene ? `<span class="pill ok">${Number(p.const_semanas)} sem · ${esc(p.const_metodo || '')}</span>` : `<span class="pill">Estándar: ${estandar} sem</span>`}</div>`;
    if (!editando) {
      cardConst.innerHTML = encabezado + (tiene
        ? `<p>Estimado por supervisión: <b>${Number(p.const_semanas)} semanas</b> (estándar ${esc(p.segmento)}: ${estandar}; ${Number(p.const_semanas) - estandar >= 0 ? '+' : ''}${Math.round((Number(p.const_semanas) - estandar) * 10) / 10} sem). El Gantt ya usa este tiempo.</p>
           ${resumenCalc ? `<p>${resumenCalc}</p>` : ''}${p.const_nota ? `<p class="pre chico">${esc(p.const_nota)}</p>` : ''}`
        : `<p class="muted chico">El Gantt usa el tiempo estándar del segmento (${estandar} semanas). El supervisor de obra puede afinarlo con su estimación o con un cálculo por diámetro, material y longitud.</p>`) +
        (puedeEstimarConst() && n < N_FINAL ? `<div class="botones"><button class="btn sec chico" id="btnConst">${tiene ? 'Actualizar estimación' : 'Estimar tiempo de construcción'}</button></div>` : '');
      const b = $('#btnConst');
      if (b) b.onclick = () => pintarConst(true);
      return;
    }

    // Formulario
    const est = {
      metodo: p.const_metodo || 'Cálculo',
      tramos: (det.tramos && det.tramos.length ? det.tramos : [{ material: p.material, diametro: diametrosDe(p.material)[0]?.diametro || '', longitud: '' }]).map((t) => ({ ...t })),
      cuadrillas: det.cuadrillas || 1, dias_extra: det.dias_extra ?? 0, dias_semana: det.dias_semana || 5,
      manual: p.const_metodo === 'Manual' ? Number(p.const_semanas) : '',
      nota: p.const_nota || '',
    };
    const filaTramo = (t, i) => {
      const r = rendimiento(t.material, t.diametro), l = Number(t.longitud) || 0;
      return `<tr>
        <td><select data-t="${i}" data-c="material">${MATERIALES.map((m) => `<option ${m === t.material ? 'selected' : ''}>${m}</option>`).join('')}</select></td>
        <td><select data-t="${i}" data-c="diametro">${diametrosDe(t.material).map((d) => `<option ${d.diametro === t.diametro ? 'selected' : ''}>${esc(d.diametro)}</option>`).join('')}</select></td>
        <td><input type="number" min="0" step="1" data-t="${i}" data-c="longitud" value="${esc(t.longitud)}" placeholder="m"></td>
        <td class="muted">${r || '—'}</td>
        <td>${r && l ? Math.round((l / r) * 10) / 10 : '—'}</td>
        <td>${est.tramos.length > 1 ? `<button type="button" class="link rojo" data-quitar="${i}">✕</button>` : ''}</td>
      </tr>`;
    };
    const dibujar = () => {
      const c = calcConst(est);
      cardConst.innerHTML = encabezado + `<form id="frmConst" class="const">
        <div class="seg-ctrl">
          <label><input type="radio" name="metodo" value="Cálculo" ${est.metodo === 'Cálculo' ? 'checked' : ''}> Calcular por tramos</label>
          <label><input type="radio" name="metodo" value="Manual" ${est.metodo === 'Manual' ? 'checked' : ''}> Capturar manualmente</label>
        </div>
        ${est.metodo === 'Cálculo' ? `
          <div class="tabla-wrap"><table class="tabla compacta"><thead><tr><th>Material</th><th>Diámetro</th><th>Longitud (m)</th><th>m/día</th><th>Días</th><th></th></tr></thead>
            <tbody>${est.tramos.map(filaTramo).join('')}</tbody></table></div>
          <button type="button" class="link" id="btnTramo">+ Agregar tramo</button>
          <div class="grid mini">
            <label>Cuadrillas<input type="number" min="1" step="1" name="cuadrillas" value="${esc(est.cuadrillas)}"></label>
            <label>Días laborables por semana<select name="dias_semana">${[5, 6].map((x) => `<option ${x === Number(est.dias_semana) ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
            <label class="full">Días adicionales <small class="muted">(preparación, sondeos, cruces, interconexión, pruebas)</small><input type="number" min="0" step="0.5" name="dias_extra" value="${esc(est.dias_extra)}"></label>
          </div>
          <div class="nota ok">Tendido: <b>${c.metros.toLocaleString('es-MX')} m</b> en <b>${c.diasTendido} días</b> · Total: <b>${c.dias} días</b> → <b>${c.semanas} semanas</b></div>
          <p class="muted chico">Rendimientos en metros por día por cuadrilla (se ajustan en Administración).</p>`
        : `<div class="grid mini"><label>Semanas estimadas *<input type="number" min="0.5" step="0.5" name="manual" value="${esc(est.manual)}" required></label></div>`}
        <label class="full">Nota / supuestos<textarea name="nota" rows="2" placeholder="Ej. cruce de avenida, horario nocturno, permisos de cierre de calle…">${esc(est.nota)}</textarea></label>
        <div class="botones">
          <button type="button" class="btn sec chico" id="btnConstCancel">Cancelar</button>
          ${tiene ? '<button type="button" class="btn sec chico" id="btnConstQuitar">Usar el estándar</button>' : ''}
          <button class="btn chico">Guardar estimación</button>
        </div></form>`;

      const f = $('#frmConst');
      $$('input[name="metodo"]', f).forEach((r) => (r.onchange = () => { est.metodo = r.value; dibujar(); }));
      $$('[data-t]', f).forEach((el) => (el.onchange = el.oninput = (ev) => {
        const t = est.tramos[Number(el.dataset.t)];
        t[el.dataset.c] = el.value;
        if (el.dataset.c === 'material') t.diametro = diametrosDe(t.material)[0]?.diametro || '';
        if (ev.type === 'change') dibujar();
      }));
      $$('[data-quitar]', f).forEach((b) => (b.onclick = () => { est.tramos.splice(Number(b.dataset.quitar), 1); dibujar(); }));
      const bt = $('#btnTramo'); if (bt) bt.onclick = () => { const u = est.tramos[est.tramos.length - 1]; est.tramos.push({ material: u?.material || p.material, diametro: u?.diametro || '', longitud: '' }); dibujar(); };
      ['cuadrillas', 'dias_extra', 'dias_semana', 'manual', 'nota'].forEach((k) => { const el = f.elements[k]; if (el) el.onchange = () => { est[k] = el.value; if (k !== 'nota' && k !== 'manual') dibujar(); }; });
      $('#btnConstCancel').onclick = () => pintarConst(false);
      const guardar = async (cambios) => {
        const r = await sb.from('proyectos').update(cambios).eq('id', p.id).select('id');
        if (r.error) return fallo(r.error);
        if (!r.data?.length) return fallo(new Error('No tienes permiso para modificar este proyecto'));
        toast('Estimación guardada');
        recargar();
      };
      const q = $('#btnConstQuitar');
      if (q) q.onclick = () => { if (confirm('¿Quitar la estimación y volver al tiempo estándar del segmento?')) guardar({ const_semanas: null }); };
      f.onsubmit = (ev) => {
        ev.preventDefault();
        est.nota = f.elements.nota.value;
        if (est.metodo === 'Manual') {
          est.manual = f.elements.manual.value;
          const sem = Number(est.manual);
          if (!(sem > 0)) return toast('Captura las semanas estimadas', 'error');
          return guardar({ const_semanas: sem, const_metodo: 'Manual', const_detalle: null, const_nota: est.nota.trim() || null });
        }
        const c = calcConst(est);
        if (!c.metros) return toast('Captura al menos un tramo con longitud', 'error');
        const detalle = {
          tramos: est.tramos.filter((t) => Number(t.longitud) > 0).map((t) => ({ material: t.material, diametro: t.diametro, longitud: Number(t.longitud), metros_dia: rendimiento(t.material, t.diametro) })),
          cuadrillas: Number(est.cuadrillas) || 1, dias_extra: Number(est.dias_extra) || 0, dias_semana: Number(est.dias_semana) || 5,
        };
        guardar({ const_semanas: c.semanas, const_metodo: 'Cálculo', const_detalle: detalle, const_nota: est.nota.trim() || null });
      };
    };
    dibujar();
  };
  pintarConst();

  // --- Avance de obra (supervisores)
  const cardAvance = $('#cardAvance');
  const pintarAvance = (editando = false) => {
    if (!cardAvance) return;
    const tramos = (p.const_detalle?.tramos || []).filter((t) => Number(t.longitud) > 0);
    const ult = avances[0];
    const pctAct = ult ? Number(ult.porcentaje) : 0;
    const puedeReportar = ['Construcción', 'Líder', 'Administrador'].includes(rol()) && n >= 10 && n < N_FINAL;

    // Proyección: ritmo real desde que empezó la etapa de Construcción
    const etapaC = etapaPorNum(N_CONST);
    const inicioObra = realesDe(p, hist)[etapaC]?.inicio || null;
    const finPlan = plan?.filas.find((f) => f.n === N_CONST)?.fin || null;
    let proyeccion = '';
    if (ult && inicioObra && pctAct > 0 && pctAct < 100) {
      const dias = Math.max(1, Math.round((diaDe(ult.fecha) - inicioObra) / DIA));
      const finEst = sumaDias(diaDe(ult.fecha), Math.round(((100 - pctAct) / pctAct) * dias));
      const dif = finPlan ? Math.round((finEst - finPlan) / DIA / 7 * 10) / 10 : null;
      proyeccion = `<p>Al ritmo actual (${Math.round(pctAct / dias * 7 * 10) / 10} % por semana) la obra terminaría el <b>${fecha(isoDe(finEst))}</b>${dif == null ? '' : dif > 0
        ? ` · <span class="vencido">${dif} sem después del plan</span>` : ` · <span class="ok-txt">${-dif} sem antes del plan</span>`}.</p>`;
    } else if (pctAct >= 100) proyeccion = '<p class="ok-txt"><b>Obra terminada.</b></p>';
    else if (!inicioObra) proyeccion = '<p class="muted chico">La proyección se calcula cuando el proyecto entra a Construcción y se reporta el primer avance.</p>';

    const barra = `<div class="progreso"><div style="width:${Math.min(100, pctAct)}%"></div></div>`;
    const metrosTxt = ult?.detalle?.length ? (() => {
      const tot = ult.detalle.reduce((t, x) => t + Number(x.longitud || 0), 0);
      const ins = ult.detalle.reduce((t, x) => t + Math.min(Number(x.instalado || 0), Number(x.longitud || 0)), 0);
      return ` · ${ins.toLocaleString('es-MX')} de ${tot.toLocaleString('es-MX')} m`;
    })() : '';
    const encabezado = `<div class="card-h"><h2>Avance de obra</h2>${ult ? `<span class="pill ${pctAct >= 100 ? 'ok' : ''}">${pctAct}%</span>` : ''}</div>`;

    if (!editando) {
      cardAvance.innerHTML = encabezado + `${barra}
        <p>${ult ? `Último reporte: <b>${pctAct}%</b>${metrosTxt} · ${fecha(ult.fecha)} · ${esc(nombreDe(ult.usuario_id))}` : '<span class="muted">Sin reportes de avance.</span>'}</p>
        ${proyeccion}
        ${puedeReportar ? '<div class="botones"><button class="btn chico" id="btnAvance">Reportar avance</button></div>' : (n < 10 ? '<p class="muted chico">El avance se reporta a partir de la Carpeta técnica.</p>' : '')}
        ${avances.length ? `<h3>Reportes</h3><div class="tabla-wrap"><table class="tabla compacta"><thead><tr><th>Fecha</th><th>Avance</th><th>Quién</th><th>Nota</th>${esAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
          ${avances.map((x) => `<tr><td>${fecha(x.fecha)}</td><td><b>${Number(x.porcentaje)}%</b></td><td>${esc(nombreDe(x.usuario_id))}</td><td>${esc(x.nota || '')}</td>
            ${esAdmin() ? `<td><button class="link rojo" data-borraravance="${x.id}">✕</button></td>` : ''}</tr>`).join('')}
        </tbody></table></div>` : ''}`;
      const b = $('#btnAvance'); if (b) b.onclick = () => pintarAvance(true);
      $$('[data-borraravance]', cardAvance).forEach((x) => (x.onclick = async () => {
        if (!confirm('¿Eliminar este reporte de avance?')) return;
        const { error } = await sb.from('avance_obra').delete().eq('id', x.dataset.borraravance);
        if (error) return fallo(error);
        recargar();
      }));
      return;
    }

    // Formulario: por tramos (si hay estimación por tramos) o porcentaje directo
    const prev = new Map((ult?.detalle || []).map((x) => [`${x.material}|${x.diametro}|${x.longitud}`, Number(x.instalado || 0)]));
    cardAvance.innerHTML = encabezado + `<form id="frmAvance" class="grid mini">
      <label>Fecha del reporte<input type="date" name="fecha" value="${hoyISO()}" max="${hoyISO()}" required></label>
      ${tramos.length ? `<div class="full"><div class="tabla-wrap"><table class="tabla compacta"><thead><tr><th>Tramo</th><th>Longitud (m)</th><th>Instalado (m, acumulado)</th></tr></thead><tbody>
          ${tramos.map((t, i) => `<tr><td>${esc(t.material)} ${esc(t.diametro)}</td><td>${Number(t.longitud).toLocaleString('es-MX')}</td>
            <td><input type="number" min="0" max="${Number(t.longitud)}" step="1" data-inst="${i}" value="${prev.get(`${t.material}|${t.diametro}|${t.longitud}`) ?? ''}"></td></tr>`).join('')}
        </tbody></table></div>
        <p class="muted chico">El % se calcula con los metros instalados. Puedes ajustarlo si hay trabajos que no son tendido (pruebas, interconexión).</p></div>` : ''}
      <label>Avance (%) *<input type="number" name="porcentaje" min="0" max="100" step="0.1" value="${pctAct || ''}" required></label>
      <label class="full">Nota<textarea name="nota" rows="2" placeholder="Ej. tramo 2 en zanja, falta cruce de avenida"></textarea></label>
      <div class="full botones"><button type="button" class="btn sec chico" id="btnAvCancel">Cancelar</button><button class="btn chico">Guardar avance</button></div>
    </form>`;
    const f = $('#frmAvance');
    const recalcular = () => {
      const tot = tramos.reduce((t, x) => t + Number(x.longitud), 0);
      const ins = tramos.reduce((t, x, i) => t + Math.min(Number($(`[data-inst="${i}"]`, f).value || 0), Number(x.longitud)), 0);
      if (tot) f.elements.porcentaje.value = Math.round((ins / tot) * 1000) / 10;
    };
    $$('[data-inst]', f).forEach((x) => (x.oninput = recalcular));
    $('#btnAvCancel').onclick = () => pintarAvance(false);
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      if (!f.reportValidity()) return;
      const detalle = tramos.length ? tramos.map((t, i) => ({ material: t.material, diametro: t.diametro, longitud: Number(t.longitud), instalado: Number($(`[data-inst="${i}"]`, f).value || 0) })) : null;
      const { error } = await sb.from('avance_obra').insert({
        proyecto_id: p.id, fecha: f.elements.fecha.value, porcentaje: Number(f.elements.porcentaje.value),
        detalle, nota: f.elements.nota.value.trim() || null, usuario_id: S.perfil.id,
      });
      if (error) return fallo(error);
      toast('Avance guardado');
      recargar();
    };
  };
  pintarAvance();

  // --- CAPEX del proyecto
  const cardCapex = $('#cardCapex');
  if (cardCapex) {
    if (!capexListo(p)) cardCapex.innerHTML = '<h2>CAPEX</h2><p class="muted">Falta ejecutar <b>supabase/008_capex.sql</b> en Supabase.</p>';
    else if (p.capex == null) cardCapex.innerHTML = `<h2>CAPEX</h2><p class="muted">El CAPEX se registra junto con el <b>Elemento PEP</b> (lo captura el proyectista desde la pestaña Resumen → Acciones).</p>`;
    else if (!plan) cardCapex.innerHTML = `<h2>CAPEX</h2><p><b>${fmtMXN(p.capex)}</b></p><p class="muted">Captura la fecha requerida de gas para repartir el CAPEX según el Gantt.</p>`;
    else {
      const cx = capexDe(p, avances, realesDe(p, hist)[etapaPorNum(N_CONST)]?.inicio || null);
      if (!cx) cardCapex.innerHTML = `<h2>CAPEX</h2><p><b>${fmtMXN(p.capex)}</b></p><p class="muted">Proyecto cancelado: no se proyecta ejercicio.</p>`;
      else {
        cardCapex.innerHTML = `<div class="card-h"><h2>CAPEX</h2><span class="pill">${esc(p.elemento_pep || '')}</span></div>
          <div class="kpis">
            <div class="kpi"><b>${fmtM(cx.capex)}</b><span>CAPEX del PEP</span></div>
            <div class="kpi"><b>${fmtM(cx.ejercido)}</b><span>Ejercido según avance (${Math.round(cx.pct)}%)</span></div>
            <div class="kpi"><b>${fmtM(cx.capex - cx.ejercido)}</b><span>Por ejercer</span></div>
            <div class="kpi"><b>${fecha(isoDe(cx.iniPlan))}</b><span>Inicio de construcción (Gantt)</span></div>
            <div class="kpi ${cx.finProy && cx.finProy > cx.finPlan ? 'alerta' : ''}"><b>${cx.finProy ? fecha(isoDe(cx.finProy)) : '—'}</b><span>Término proyectado (plan: ${fecha(isoDe(cx.finPlan))})</span></div>
          </div>
          ${capexGraficasHtml(cx)}`;
        activarTooltips(cardCapex);
      }
    }
  }

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
  const etapasDoc = ETAPAS.filter((e) => num(e) >= 1 && num(e) < N_FINAL);
  const docsOrden = [...S.configDocs].sort((a, b) => ETAPAS.indexOf(a.etapa) - ETAPAS.indexOf(b.etapa) || a.orden - b.orden);

  v.innerHTML = `
    <div class="titulo"><h1>Administración</h1></div>

    <section class="card">
      <h2>Usuarios y roles</h2>
      <p class="muted chico">Para dar de alta a alguien: Supabase → Authentication → Users → <b>Add user</b> (correo + contraseña, marca «Auto confirm»). Después aparece aquí y le asignas su rol.
        El <b>puesto</b> define quién aprueba el anteproyecto: Industrial → KAM; Comercial y Residencial → Supervisor de ventas.</p>
      <div class="tabla-wrap"><table class="tabla compacta"><thead><tr><th>Correo</th><th>Nombre</th><th>Rol</th>${'puesto' in S.perfil ? '<th>Puesto</th>' : ''}<th>Activo</th></tr></thead><tbody>
      ${S.perfiles.map((u) => `<tr>
        <td>${esc(u.email)}</td>
        <td><input data-nombre="${u.id}" value="${esc(u.nombre || '')}"></td>
        <td><select data-rol="${u.id}" ${u.id === S.perfil.id ? 'disabled title="No puedes cambiar tu propio rol"' : ''}>${ROLES.map((r) => `<option ${r === u.rol ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
        ${'puesto' in S.perfil ? `<td><select data-puesto="${u.id}"><option value="">—</option>${PUESTOS.map((x) => `<option ${x === u.puesto ? 'selected' : ''}>${x}</option>`).join('')}</select></td>` : ''}
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
      ${S.ganttListo ? `<p class="muted chico">El Gantt parte de la fecha requerida de gas y resta estas semanas hacia atrás. La última, «Puesta en servicio», termina el día que se requiere el gas.</p>
      ${S.flujoListo ? '<p class="muted chico">«Flujograma» = suma de los días objetivo de las actividades de esa etapa (solo las que tienen días); úsalo como referencia para validar las semanas.</p>' : ''}
      <div class="tabla-wrap"><table class="tabla compacta"><thead><tr><th>Etapa</th>${SEGMENTOS.map((s) => `<th>${s}</th>`).join('')}${S.flujoListo ? '<th>Flujograma</th>' : ''}</tr></thead><tbody>
      ${[...ETAPAS_ANTES, ...ETAPAS_DESPUES].map(etapaPorNum).filter(Boolean).map((e) => `<tr><td>${esc(e)}</td>${SEGMENTOS.map((s) =>
        `<td><input type="number" class="corto" min="0" step="0.5" data-tseg="${s}" data-tetapa="${esc(e)}" value="${semanasDe(s, e)}"></td>`).join('')}${S.flujoListo ? `<td class="muted">${diasFlujo(e)}</td>` : ''}</tr>`).join('')}
      <tr><td><b>Total hasta el gas</b></td>${SEGMENTOS.map((s) => `<td><b>${totalSemanas(s)}</b></td>`).join('')}${S.flujoListo ? '<td></td>' : ''}</tr>
      </tbody></table></div>` : '<p class="muted">Ejecuta <b>supabase/002_gantt.sql</b> en Supabase para activar esta sección.</p>'}
    </section>

    ${S.constListo ? `<section class="card">
      <h2>Rendimientos de instalación</h2>
      <p class="muted chico">Metros por día por cuadrilla. Los usa el cálculo de tiempo de construcción (material, diámetro y longitud). Los valores iniciales son de ejemplo: valídalos con los supervisores.</p>
      <div class="tabla-wrap"><table class="tabla compacta"><thead><tr><th>Material</th><th>Diámetro</th><th>m/día</th><th>Orden</th><th></th></tr></thead><tbody>
      ${[...S.rendimientos].sort((a, b) => a.material.localeCompare(b.material) || a.orden - b.orden).map((r) => `<tr>
        <td>${esc(r.material)}</td><td>${esc(r.diametro)}</td>
        <td><input type="number" class="corto" min="0.1" step="0.5" data-rend="${esc(r.material)}|${esc(r.diametro)}" data-campo="metros_dia" value="${Number(r.metros_dia)}"></td>
        <td><input type="number" class="corto" data-rend="${esc(r.material)}|${esc(r.diametro)}" data-campo="orden" value="${r.orden}"></td>
        <td><button class="link rojo" data-borrarrend="${esc(r.material)}|${esc(r.diametro)}">✕</button></td>
      </tr>`).join('')}
      </tbody></table></div>
      <form id="frmRend" class="grid mini">
        <label>Material<select name="material">${MATERIALES.map((m) => `<option>${m}</option>`).join('')}</select></label>
        <label>Diámetro *<input name="diametro" required placeholder='Ej. 2" (63 mm)'></label>
        <label>m/día *<input type="number" name="metros_dia" min="0.1" step="0.5" required></label>
        <label>Orden<input type="number" name="orden" value="100"></label>
        <div class="full"><button class="btn sec chico">Agregar diámetro</button></div>
      </form>
    </section>` : ''}

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
  $$('[data-puesto]', v).forEach((s) => (s.onchange = async () => {
    await guardar('perfiles', 'id', s.dataset.puesto, { puesto: s.value || null }, 'Puesto actualizado');
    if (s.dataset.puesto === S.perfil.id) S.perfil.puesto = s.value || null;
  }));
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
  const llaveRend = (k) => { const i = k.indexOf('|'); return [k.slice(0, i), k.slice(i + 1)]; };
  $$('[data-rend]', v).forEach((i) => (i.onchange = async () => {
    const [material, diametro] = llaveRend(i.dataset.rend);
    const { error } = await sb.from('config_rendimientos').update({ [i.dataset.campo]: Number(i.value) || 0 }).eq('material', material).eq('diametro', diametro);
    if (error) return fallo(error);
    toast('Rendimiento actualizado');
    await cargarCatalogos();
  }));
  $$('[data-borrarrend]', v).forEach((b) => (b.onclick = async () => {
    const [material, diametro] = llaveRend(b.dataset.borrarrend);
    if (!confirm(`¿Eliminar ${material} ${diametro}?`)) return;
    const { error } = await sb.from('config_rendimientos').delete().eq('material', material).eq('diametro', diametro);
    if (error) return fallo(error);
    vistaAdmin();
  }));
  const frmRend = $('#frmRend');
  if (frmRend) frmRend.onsubmit = async (ev) => {
    ev.preventDefault();
    if (!frmRend.reportValidity()) return;
    const fd = Object.fromEntries(new FormData(frmRend));
    const { error } = await sb.from('config_rendimientos').insert({ material: fd.material, diametro: fd.diametro.trim(), metros_dia: Number(fd.metros_dia), orden: Number(fd.orden) || 0 });
    if (error) return fallo(error);
    toast('Diámetro agregado');
    vistaAdmin();
  };
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

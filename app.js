// ============================================================
// CONFIGURACIÓN — Pegá aquí la URL de tu Web App de Google
// ============================================================
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbwy2Vs5gdbXO_XQXKdcZf7SKg4VedmJr5bNEGypDNLk4rTI63jw47oji4ntgSfbafPJpw/exec';

// ============================================================
// CONSTANTES DE NEGOCIO
// ============================================================
const CASA    = ['Condominio','Electricidad','Relleno Sanitario','Teléfono','Internet','Digitel','Seguros Mercantil','Seguros Universitas','Supermercados','Chinos','Farmacias','Carro','Varios'];
const TRABAJO = ['Insumar','Tinito','Pepsi','Electricidad','Relleno Sanitario','Hacienda','Aseo Urbano','Condominio','Alquiler','Teléfono','Estacionamiento','Varios','Supermercados'];

// ============================================================
// CLAVES DE LOCALSTORAGE
// ============================================================
const LS_MOVIMIENTOS = 'mifondo_movimientos';  // { [fechaStr]: [ ...movs ] }
const LS_PENDIENTES  = 'mifondo_pendientes';   // cola de acciones sin sincronizar
const LS_TASA        = 'mifondo_tasa_';        // prefijo + fechaStr → número

// ============================================================
// ESTADO GLOBAL
// ============================================================
let fechaActiva = new Date();
let tipoSel = null, subSel = null, catSel = null, conSel = null;
let editIdx = null, editEsDolar = false;

// ============================================================
// INIT
// ============================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW:', e));
}

window.addEventListener('online',  actualizarEstadoRed);
window.addEventListener('offline', actualizarEstadoRed);

window.onload = async () => {
  actualizarFechaDisplay();
  actualizarEstadoRed();
  actualizarBtnSync();

  // Si hay internet, sincronizar pendientes Y descargar datos frescos de Sheets
  if (hayInternet()) {
    await sincronizarSilencioso();  // primero subir lo que haya pendiente
    await descargarDesdSheets();    // luego bajar el estado actual de Sheets
  }

  cargarDia();
};

// ============================================================
// CONECTIVIDAD
// ============================================================
function hayInternet() { return navigator.onLine; }

function actualizarEstadoRed() {
  document.getElementById('offlineBanner').classList.toggle('show', !hayInternet());
  actualizarBtnSync();
}

// ============================================================
// DESCARGAR DATOS COMPLETOS DESDE SHEETS (fuente de verdad)
// Llama a doGet con ?accion=bajar y recibe movimientos + tasas
// ============================================================
async function descargarDesdSheets() {
  try {
    mostrarSpin('Actualizando desde la nube...');
    const resp = await fetch(WEBAPP_URL + '?accion=bajar', { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();

    if (!data.ok) throw new Error(data.error || 'Error al bajar datos');

    // Reconstruir localStorage desde los datos de Sheets
    const movsPorFecha = {};
    for (const m of (data.movimientos || [])) {
      if (!movsPorFecha[m.fechaStr]) movsPorFecha[m.fechaStr] = [];
      movsPorFecha[m.fechaStr].push({
        tipo:       m.tipo,
        categoria:  m.categoria,
        concepto:   m.concepto,
        montoBs:    m.montoBs,
        montoDolar: m.montoDolar,
        _local:     false,
        _ts:        m.timestamp || 0
      });
    }
    localStorage.setItem(LS_MOVIMIENTOS, JSON.stringify(movsPorFecha));

    // Guardar tasas por fecha
    for (const t of (data.tasas || [])) {
      if (t.fechaStr && t.tasa) {
        localStorage.setItem(LS_TASA + t.fechaStr, String(t.tasa));
      }
    }

    ocultarSpin();
  } catch (err) {
    ocultarSpin();
    console.warn('descargarDesdSheets:', err.message);
    // No molestamos al usuario — usamos lo que hay en local
  }
}

// ============================================================
// BOTÓN SINCRONIZAR
// ============================================================
function actualizarBtnSync() {
  const btn  = document.getElementById('btnSync');
  const txt  = document.getElementById('syncTxt');
  const n    = obtenerPendientes().length;
  if (n === 0) {
    btn.className = 'btn-sync';
    txt.textContent = 'Sincronizar';
  } else {
    btn.className = 'btn-sync pendiente';
    txt.textContent = `Sincronizar (${n})`;
  }
}

// ============================================================
// FECHA HELPERS
// ============================================================
function fechaAStr(d) {
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

function actualizarFechaDisplay() {
  const hoyStr = fechaAStr(new Date());
  const actStr = fechaAStr(fechaActiva);
  const el = document.getElementById('fechaDisplay');
  el.textContent = actStr;
  el.className = 'fecha-display' + (actStr !== hoyStr ? ' pasado' : '');
}

function cambiarDia(delta) {
  fechaActiva = new Date(fechaActiva);
  fechaActiva.setDate(fechaActiva.getDate() + delta);
  actualizarFechaDisplay();
  cargarDia();
}

function aplicarFechaNativa(val) {
  if (!val) return;
  const [y,m,d] = val.split('-').map(Number);
  fechaActiva = new Date(y, m-1, d, 12, 0, 0);
  actualizarFechaDisplay();
  cargarDia();
}

function aplicarFecha() {
  const val = document.getElementById('dpInp').value;
  if (!val) return;
  const [y,m,d] = val.split('-').map(Number);
  fechaActiva = new Date(y, m-1, d, 12, 0, 0);
  actualizarFechaDisplay();
  cerrarModal('dpOverlay');
  cargarDia();
}

function irAFecha(fechaStr) {
  const p = fechaStr.split('-');
  fechaActiva = new Date(2000+parseInt(p[2]), parseInt(p[1])-1, parseInt(p[0]), 12, 0, 0);
  actualizarFechaDisplay();
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab')[0].classList.add('active');
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('active'));
  document.getElementById('tab-hoy').classList.add('active');
  cargarDia();
}

// ============================================================
// LOCALSTORAGE — ACCESO
// ============================================================
function obtenerMovimientosLocal(fechaStr) {
  try { return JSON.parse(localStorage.getItem(LS_MOVIMIENTOS)||'{}')[fechaStr] || []; }
  catch { return []; }
}

function guardarMovimientosLocal(fechaStr, movs) {
  try {
    const data = JSON.parse(localStorage.getItem(LS_MOVIMIENTOS)||'{}');
    data[fechaStr] = movs;
    localStorage.setItem(LS_MOVIMIENTOS, JSON.stringify(data));
  } catch(e) { console.error(e); }
}

function obtenerTasaLocal(fechaStr) {
  return parseFloat(localStorage.getItem(LS_TASA + fechaStr)||'0') || 0;
}

function guardarTasaLocal(fechaStr, tasa) {
  localStorage.setItem(LS_TASA + fechaStr, String(tasa));
}

function obtenerPendientes() {
  try { return JSON.parse(localStorage.getItem(LS_PENDIENTES)||'[]'); }
  catch { return []; }
}

function encolarPendiente(item) {
  const cola = obtenerPendientes();
  cola.push({ ...item, _ts: item._ts || Date.now() });
  localStorage.setItem(LS_PENDIENTES, JSON.stringify(cola));
  actualizarBtnSync();
}

function limpiarPendientes() {
  localStorage.removeItem(LS_PENDIENTES);
  actualizarBtnSync();
}

// ============================================================
// CARGAR DÍA
// ============================================================
function cargarDia() {
  const fechaStr = fechaAStr(fechaActiva);
  const movs     = obtenerMovimientosLocal(fechaStr);
  const tasa     = obtenerTasaLocal(fechaStr);

  document.getElementById('tasaInp').value = tasa > 0 ? String(tasa).replace('.',',') : '';

  let ingBs=0, ingDol=0, egCasa=0, egTrab=0;
  movs.forEach(m => {
    if (m.tipo==='Ingreso') { ingBs+=m.montoBs||0; ingDol+=m.montoDolar||0; }
    else {
      if (m.categoria==='Casa')    egCasa+=m.montoBs||0;
      if (m.categoria==='Trabajo') egTrab+=m.montoBs||0;
    }
  });
  const saldo = ingBs-(egCasa+egTrab);
  const hist  = calcularTotalesHistoricos();

  document.getElementById('cIngBs').textContent    = 'Bs '+fmt(ingBs);
  document.getElementById('cIngDol').textContent   = '$ ' +fmt(ingDol);
  document.getElementById('cEgCasa').textContent   = 'Bs '+fmt(egCasa);
  document.getElementById('cEgTrab').textContent   = 'Bs '+fmt(egTrab);
  document.getElementById('cSaldo').textContent    = 'Bs '+fmt(saldo);
  document.getElementById('cFondoDol').textContent = '$ ' +fmt(hist.fondoDol);
  document.getElementById('cIngDiaDol').textContent= '$ ' +fmt(ingDol);
  document.getElementById('cFondoBs').textContent  = 'Bs '+fmt(hist.fondoBs);

  document.getElementById('hTotalIng').textContent    = 'Bs '+fmt(hist.totalIngBs);
  document.getElementById('hTotalIngDol').textContent = '$ ' +fmt(hist.totalIngDol);
  document.getElementById('hTotalEg').textContent     = 'Bs '+fmt(hist.totalEgBs);
  document.getElementById('hTotalEgDol').textContent  = '$ ' +fmt(hist.totalEgDol);
  document.getElementById('hFondoDol').textContent    = '$ ' +fmt(hist.fondoDol);
  document.getElementById('hFondoBs').textContent     = 'Bs '+fmt(hist.fondoBs);

  renderMovimientos(movs);
}

function calcularTotalesHistoricos() {
  try {
    const data   = JSON.parse(localStorage.getItem(LS_MOVIMIENTOS)||'{}');
    const fechas = Object.keys(data).sort((a,b)=>{
      const t = s=>{ const p=s.split('-'); return new Date(2000+parseInt(p[2]),parseInt(p[1])-1,parseInt(p[0])); };
      return t(a)-t(b);
    });
    let totalIngBs=0, totalIngDol=0, totalEgBs=0, totalEgDol=0, fondoBs=0, fondoDol=0;
    fechas.forEach(fs=>{
      const movs=data[fs]||[]; const tasa=obtenerTasaLocal(fs);
      let ingBs=0, ingDol=0, egBs=0;
      movs.forEach(m=>{ if(m.tipo==='Ingreso'){ingBs+=m.montoBs||0;ingDol+=m.montoDolar||0;}else egBs+=m.montoBs||0; });
      fondoBs+=ingBs-egBs;
      fondoDol = tasa>0 ? (fondoBs/tasa)+ingDol : fondoDol+ingDol;
      totalIngBs+=ingBs; totalIngDol+= tasa>0?ingBs/tasa:0; totalIngDol+=ingDol;
      totalEgBs+=egBs;   totalEgDol+= tasa>0?egBs/tasa:0;
    });
    return {fondoBs, fondoDol, totalIngBs, totalIngDol, totalEgBs, totalEgDol};
  } catch { return {fondoBs:0,fondoDol:0,totalIngBs:0,totalIngDol:0,totalEgBs:0,totalEgDol:0}; }
}

// ============================================================
// RENDER MOVIMIENTOS
// ============================================================
function renderMovimientos(movs) {
  const lista = document.getElementById('movList');
  if (!movs.length) { lista.innerHTML='<div class="empty">Sin movimientos este día</div>'; return; }
  lista.innerHTML = movs.map((m,idx)=>{
    const esI = m.tipo==='Ingreso';
    const monto = m.montoDolar>0
      ? `<div class="mov-amt ${esI?'i':'e'}">$ ${fmt(m.montoDolar)}</div>`
      : `<div class="mov-amt ${esI?'i':'e'}">Bs ${fmt(m.montoBs)}</div>`;
    const local = m._local ? `<div class="mov-local">⏳ pendiente</div>` : '';
    return `<div class="mov">
      <div class="mov-ico ${esI?'i':'e'}">${esI?'📈':'📉'}</div>
      <div class="mov-info">
        <div class="mov-con">${m.concepto}</div>
        <div class="mov-meta">${m.categoria||m.tipo}</div>${local}
      </div>
      ${monto}
      <button class="btn-edit" onclick="abrirEditar(${idx},'${m.concepto}',${m.montoBs||0},${m.montoDolar||0})">✏️</button>
      <button class="btn-del"  onclick="eliminarMov(${idx})">🗑</button>
    </div>`;
  }).join('');
}

// ============================================================
// TASA
// ============================================================
function guardarTasa() {
  const val = parseFloat(document.getElementById('tasaInp').value.replace(',','.'));
  if (!val||val<=0) { toast('Ingresá una tasa válida',true); return; }
  const fechaStr = fechaAStr(fechaActiva);
  guardarTasaLocal(fechaStr, val);
  encolarPendiente({ accion:'tasa', fechaStr, tasa:val });
  toast('Tasa guardada ✓');
  cargarDia();
  if (hayInternet()) setTimeout(sincronizar, 400);
}

// ============================================================
// MODAL MOVIMIENTO
// ============================================================
function abrirModal() {
  tipoSel=null; subSel=null; catSel=null; conSel=null;
  ['p2i','p2e','p3e','pMonto'].forEach(id=>document.getElementById(id).style.display='none');
  document.getElementById('montoInp').value='';
  document.getElementById('btnIng').classList.remove('sel');
  document.getElementById('btnEgr').classList.remove('sel');
  document.getElementById('movOverlay').classList.add('open');
}

function cerrarModal(id) { document.getElementById(id).classList.remove('open'); }
function cerrarOverlayClick(e,id) { if(e.target.id===id) cerrarModal(id); }

function selTipo(tipo) {
  tipoSel=tipo; subSel=null; catSel=null; conSel=null;
  document.getElementById('btnIng').classList.toggle('sel', tipo==='Ingreso');
  document.getElementById('btnEgr').classList.toggle('sel', tipo==='Egreso');
  document.getElementById('p2i').style.display = tipo==='Ingreso'?'block':'none';
  document.getElementById('p2e').style.display = tipo==='Egreso' ?'block':'none';
  document.getElementById('p3e').style.display='none';
  document.getElementById('pMonto').style.display='none';
  document.querySelectorAll('.sbtn,.cbtn').forEach(b=>b.classList.remove('sel'));
}

function selSub(btn,sub) {
  subSel=sub;
  document.querySelectorAll('.sbtn').forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel');
  document.getElementById('montoLbl').textContent = sub==='Efectivo $'?'Monto en Dólares $':'Monto en Bolívares';
  document.getElementById('pMonto').style.display='block';
}

function selCat(cat) {
  catSel=cat; conSel=null;
  document.getElementById('btnCasa').classList.toggle('sel', cat==='Casa');
  document.getElementById('btnTrab').classList.toggle('sel', cat==='Trabajo');
  const lista = cat==='Casa'?CASA:TRABAJO;
  document.getElementById('p3lbl').textContent='Concepto — '+cat;
  document.getElementById('conGrid').innerHTML=lista.map(c=>`<button class="konbtn" onclick="selCon(this,'${c}')">${c}</button>`).join('');
  document.getElementById('p3e').style.display='block';
  document.getElementById('pMonto').style.display='none';
}

function selCon(btn,con) {
  conSel=con;
  document.querySelectorAll('.konbtn').forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel');
  document.getElementById('montoLbl').textContent='Monto en Bolívares';
  document.getElementById('pMonto').style.display='block';
}

// ============================================================
// GUARDAR MOVIMIENTO
// ============================================================
function guardarMov() {
  const monto = parseFloat(document.getElementById('montoInp').value.replace(',','.'));
  if (!monto||monto<=0) { toast('Ingresá un monto válido',true); return; }

  let concepto, montoBs=0, montoDolar=0, categoria;
  if (tipoSel==='Ingreso') {
    if (!subSel) { toast('Elegí el tipo de ingreso',true); return; }
    concepto=subSel; categoria='Ingreso';
    if (subSel==='Efectivo $') montoDolar=monto; else montoBs=monto;
  } else {
    if (!catSel) { toast('Elegí Casa o Trabajo',true); return; }
    if (!conSel) { toast('Elegí el concepto',true); return; }
    concepto=conSel; categoria=catSel; montoBs=monto;
  }

  const fechaStr = fechaAStr(fechaActiva);
  const tasa     = obtenerTasaLocal(fechaStr);
  const ts       = Date.now();

  const mov = { fechaStr, tipo:tipoSel, categoria, concepto, montoBs, montoDolar, tasa, _local:true, _ts:ts };

  const movs = obtenerMovimientosLocal(fechaStr);
  movs.push(mov);
  guardarMovimientosLocal(fechaStr, movs);
  encolarPendiente({ accion:'agregar', ...mov });

  cerrarModal('movOverlay');
  toast('Guardado ✓' + (!hayInternet()?' (offline)':''));
  cargarDia();
  if (hayInternet()) setTimeout(sincronizar, 400);
}

// ============================================================
// EDITAR MOVIMIENTO
// ============================================================
function abrirEditar(idx, concepto, montoBs, montoDolar) {
  editIdx=idx; editEsDolar=montoDolar>0;
  document.getElementById('editConcepto').textContent=concepto;
  document.getElementById('editLbl').textContent=editEsDolar?'Monto en Dólares $':'Monto en Bolívares';
  document.getElementById('editInp').value=editEsDolar?String(montoDolar).replace('.',','):String(montoBs).replace('.',',');
  document.getElementById('editOverlay').classList.add('open');
}

function guardarEdicion() {
  const monto = parseFloat(document.getElementById('editInp').value.replace(',','.'));
  if (!monto||monto<=0) { toast('Ingresá un monto válido',true); return; }
  const fechaStr = fechaAStr(fechaActiva);
  const movs     = obtenerMovimientosLocal(fechaStr);
  if (editIdx===null||!movs[editIdx]) { toast('Error al editar',true); return; }
  const mov = movs[editIdx];
  if (editEsDolar) { mov.montoDolar=monto; mov.montoBs=0; } else { mov.montoBs=monto; mov.montoDolar=0; }
  mov._local=true;
  guardarMovimientosLocal(fechaStr, movs);
  encolarPendiente({ accion:'editar', fechaStr, ts:mov._ts, nuevoMonto:monto, esDolar:editEsDolar, concepto:mov.concepto });
  cerrarModal('editOverlay');
  toast('Editado ✓');
  cargarDia();
  if (hayInternet()) setTimeout(sincronizar, 400);
}

// ============================================================
// ELIMINAR MOVIMIENTO
// ============================================================
function eliminarMov(idx) {
  if (!confirm('¿Eliminás este movimiento?')) return;
  const fechaStr = fechaAStr(fechaActiva);
  const movs     = obtenerMovimientosLocal(fechaStr);
  const [removido] = movs.splice(idx,1);
  guardarMovimientosLocal(fechaStr, movs);
  encolarPendiente({ accion:'eliminar', fechaStr, ts:removido._ts, concepto:removido.concepto });
  toast('Eliminado');
  cargarDia();
  if (hayInternet()) setTimeout(sincronizar, 400);
}

// ============================================================
// HISTORIAL
// ============================================================
function showTab(tab,el) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
  if (tab==='hist') cargarHistorial();
}

function cargarHistorial() {
  try {
    const data = JSON.parse(localStorage.getItem(LS_MOVIMIENTOS)||'{}');
    const fechas = Object.keys(data).sort((a,b)=>{
      const t=s=>{const p=s.split('-');return new Date(2000+parseInt(p[2]),parseInt(p[1])-1,parseInt(p[0]));};
      return t(b)-t(a);
    }).slice(0,30);
    renderHist(fechas.map(fs=>{
      const movs=data[fs]||[]; let ingBs=0,egBs=0,fondoAcumDolar=0;
      movs.forEach(m=>{if(m.tipo==='Ingreso'){ingBs+=m.montoBs||0;fondoAcumDolar+=m.montoDolar||0;}else egBs+=m.montoBs||0;});
      return {fecha:fs, ingresosBs:ingBs, totalEgresosBs:egBs, fondoAcumDolar};
    }));
  } catch {
    document.getElementById('histBody').innerHTML='<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:20px">Sin datos</td></tr>';
  }
}

function renderHist(datos) {
  const tb = document.getElementById('histBody');
  if (!datos.length) { tb.innerHTML='<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:20px">Sin datos</td></tr>'; return; }
  tb.innerHTML=datos.map(d=>{
    const saldo=(d.ingresosBs||0)-(d.totalEgresosBs||0);
    return `<tr onclick="irAFecha('${d.fecha}')">
      <td style="color:var(--muted)">${d.fecha}</td>
      <td style="color:var(--green)">Bs ${fmt(d.ingresosBs)}</td>
      <td style="color:var(--red)">Bs ${fmt(d.totalEgresosBs)}</td>
      <td style="color:${saldo>=0?'var(--green)':'var(--red)'}">${saldo>=0?'+':'-'}${fmt(Math.abs(saldo))}</td>
      <td style="color:var(--gold)">$${fmt(d.fondoAcumDolar)}</td>
    </tr>`;
  }).join('');
}

function recalcularTodo() {
  if (!confirm('¿Recalculás el resumen local?')) return;
  cargarHistorial(); toast('✓ Historial local actualizado');
}

// ============================================================
// SINCRONIZACIÓN — subir pendientes a Sheets
// ============================================================
async function sincronizar() {
  if (!hayInternet()) { toast('Sin conexión', true); return; }
  const pendientes = obtenerPendientes();
  if (pendientes.length===0) {
    await descargarDesdSheets();
    cargarDia();
    toast('Todo actualizado ✓');
    return;
  }
  const btn = document.getElementById('btnSync');
  btn.className='btn-sync sincronizando';
  document.getElementById('syncTxt').textContent='Sincronizando...';
  mostrarSpin('Sincronizando '+pendientes.length+' registro(s)...');
  try {
    const ok = await postAGAS(pendientes);
    if (!ok) throw new Error('No se pudo conectar con Google');
    marcarComoSincronizados();
    limpiarPendientes();
    ocultarSpin();
    toast(`✓ ${pendientes.length} registro(s) subidos`);
    await descargarDesdSheets();
    cargarDia();
  } catch(err) {
    ocultarSpin();
    toast('Error: '+err.message, true);
  }
  actualizarBtnSync();
}

async function sincronizarSilencioso() {
  const pendientes = obtenerPendientes();
  if (pendientes.length===0) return;
  try {
    const ok = await postAGAS(pendientes);
    if (ok) { marcarComoSincronizados(); limpiarPendientes(); }
  } catch { /* silencioso */ }
}

// ── Envío a Google Apps Script — usa GET para evitar el 405 en Safari ──
// GAS redirige POSTs con 302 y Safari convierte el redirect en GET → 405.
// Solución: enviamos todo como parámetro "payload" en la query string via GET.
// El límite de URL en GAS es ~8KB, más que suficiente para un lote típico.
async function postAGAS(pendientes) {
  const json    = JSON.stringify({ lote: pendientes });
  const encoded = encodeURIComponent(json);
  const url     = WEBAPP_URL + '?accion=subir&payload=' + encoded;

  const resp = await fetch(url, { method: 'GET', cache: 'no-store' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  try {
    const data = await resp.json();
    return data.ok !== false;
  } catch {
    return true; // GAS a veces no devuelve body en redirect — igual procesó
  }
}

function marcarComoSincronizados() {
  try {
    const data = JSON.parse(localStorage.getItem(LS_MOVIMIENTOS)||'{}');
    Object.keys(data).forEach(fs=>{ data[fs]=data[fs].map(m=>({...m,_local:false})); });
    localStorage.setItem(LS_MOVIMIENTOS, JSON.stringify(data));
  } catch {}
}

// ============================================================
// DIAGNÓSTICO — llamar desde la consola del iPhone:
//   probarConexion()
// Te muestra exactamente qué devuelve GAS y el status HTTP.
// Borrá esta función una vez que todo funcione.
// ============================================================
async function probarConexion() {
  toast('Probando conexión...', false);
  const pasos = [];
  try {
    // Paso 1: ping básico
    const r1 = await fetch(WEBAPP_URL, { method: 'GET', cache: 'no-store' });
    pasos.push('Ping status: ' + r1.status + ' / redirected: ' + r1.redirected + ' / url final: ' + r1.url);
    const t1 = await r1.text();
    pasos.push('Ping body: ' + t1.substring(0, 120));

    // Paso 2: bajar datos
    const r2 = await fetch(WEBAPP_URL + '?accion=bajar', { method: 'GET', cache: 'no-store' });
    pasos.push('Bajar status: ' + r2.status);
    const t2 = await r2.text();
    pasos.push('Bajar body: ' + t2.substring(0, 200));

    // Paso 3: subir prueba
    const testPayload = encodeURIComponent(JSON.stringify({ lote: [] }));
    const r3 = await fetch(WEBAPP_URL + '?accion=subir&payload=' + testPayload, { method: 'GET', cache: 'no-store' });
    pasos.push('Subir status: ' + r3.status);
    const t3 = await r3.text();
    pasos.push('Subir body: ' + t3.substring(0, 120));

  } catch(err) {
    pasos.push('ERROR: ' + err.message);
  }
  // Mostrar en alert (visible en iPhone)
  alert(pasos.join('\n\n'));
}


function fmt(n) { return Number(n||0).toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function mostrarSpin(msg) { document.getElementById('spinMsg').textContent=msg; document.getElementById('spin').classList.add('show'); }
function ocultarSpin()    { document.getElementById('spin').classList.remove('show'); }
function toast(msg,err=false) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast'+(err?' err':'');
  t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2800);
}

// ============================================================
// CONFIGURACIÓN — Pegá aquí la URL de tu Web App de Google
// ============================================================
const WEBAPP_URL = 'PEGAR_AQUI_LA_URL_DE_TU_WEBAPP_DE_GOOGLE';

// ============================================================
// CONSTANTES DE NEGOCIO
// ============================================================
const CASA    = ['Condominio','Electricidad','Relleno Sanitario','Teléfono','Internet','Digitel','Seguros Mercantil','Seguros Universitas','Supermercados','Chinos','Farmacias','Carro','Varios'];
const TRABAJO = ['Insumar','Tinito','Pepsi','Electricidad','Relleno Sanitario','Hacienda','Aseo Urbano','Condominio','Alquiler','Teléfono','Estacionamiento','Varios','Supermercados'];

// ============================================================
// CLAVES DE LOCALSTORAGE
// ============================================================
const LS_MOVIMIENTOS  = 'mifondo_movimientos';   // movimientos del día en memoria
const LS_PENDIENTES   = 'mifondo_pendientes';     // cola offline por sincronizar
const LS_RESUMEN      = 'mifondo_resumen';        // caché del resumen histórico
const LS_TASA         = 'mifondo_tasa_';          // prefijo + fechaStr

// ============================================================
// ESTADO GLOBAL
// ============================================================
let fechaActiva = new Date();
let tipoSel = null, subSel = null, catSel = null, conSel = null;
let editIdx = null, editEsDolar = false;         // índice local en lugar de fila remota

// ============================================================
// INIT
// ============================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW error', err));
}

window.addEventListener('online',  actualizarEstadoRed);
window.addEventListener('offline', actualizarEstadoRed);

window.onload = () => {
  actualizarFechaDisplay();
  actualizarEstadoRed();
  cargarDia();
  actualizarBtnSync();
};

// ============================================================
// CONECTIVIDAD
// ============================================================
function hayInternet() {
  return navigator.onLine;
}

function actualizarEstadoRed() {
  const banner = document.getElementById('offlineBanner');
  if (hayInternet()) {
    banner.classList.remove('show');
  } else {
    banner.classList.add('show');
  }
  actualizarBtnSync();
}

// ============================================================
// BOTÓN SINCRONIZAR
// ============================================================
function actualizarBtnSync() {
  const btn  = document.getElementById('btnSync');
  const txt  = document.getElementById('syncTxt');
  const pendientes = obtenerPendientes();

  if (pendientes.length === 0) {
    btn.className = 'btn-sync';
    txt.textContent = 'Sincronizar';
  } else {
    btn.className = 'btn-sync pendiente';
    txt.textContent = `Sincronizar (${pendientes.length})`;
  }
}

// ============================================================
// FECHA HELPERS
// ============================================================
function fechaAStr(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

function actualizarFechaDisplay() {
  const hoy = new Date();
  const hoyStr = fechaAStr(hoy);
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
  const [y, m, d] = val.split('-').map(Number);
  fechaActiva = new Date(y, m - 1, d, 12, 0, 0);
  actualizarFechaDisplay();
  cargarDia();
}

function abrirDP() {
  document.getElementById('dpOverlay').classList.add('open');
}

function aplicarFecha() {
  const val = document.getElementById('dpInp').value;
  if (!val) return;
  const [y, m, d] = val.split('-').map(Number);
  fechaActiva = new Date(y, m - 1, d, 12, 0, 0);
  actualizarFechaDisplay();
  cerrarModal('dpOverlay');
  cargarDia();
}

function irAFecha(fechaStr) {
  const p = fechaStr.split('-');
  fechaActiva = new Date(2000 + parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]), 12, 0, 0);
  actualizarFechaDisplay();
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab')[0].classList.add('active');
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  document.getElementById('tab-hoy').classList.add('active');
  cargarDia();
}

// ============================================================
// LOCALSTORAGE — MOVIMIENTOS DEL DÍA
// ============================================================
function obtenerMovimientosLocal(fechaStr) {
  try {
    const data = JSON.parse(localStorage.getItem(LS_MOVIMIENTOS) || '{}');
    return data[fechaStr] || [];
  } catch { return []; }
}

function guardarMovimientosLocal(fechaStr, movs) {
  try {
    const data = JSON.parse(localStorage.getItem(LS_MOVIMIENTOS) || '{}');
    data[fechaStr] = movs;
    localStorage.setItem(LS_MOVIMIENTOS, JSON.stringify(data));
  } catch (e) { console.error('LS error', e); }
}

function obtenerTasaLocal(fechaStr) {
  return parseFloat(localStorage.getItem(LS_TASA + fechaStr) || '0') || 0;
}

function guardarTasaLocal(fechaStr, tasa) {
  localStorage.setItem(LS_TASA + fechaStr, String(tasa));
}

// ============================================================
// LOCALSTORAGE — COLA PENDIENTES
// ============================================================
function obtenerPendientes() {
  try {
    return JSON.parse(localStorage.getItem(LS_PENDIENTES) || '[]');
  } catch { return []; }
}

function encolarPendiente(item) {
  const cola = obtenerPendientes();
  cola.push({ ...item, _ts: Date.now() });
  localStorage.setItem(LS_PENDIENTES, JSON.stringify(cola));
  actualizarBtnSync();
}

function limpiarPendientes() {
  localStorage.removeItem(LS_PENDIENTES);
  actualizarBtnSync();
}

// ============================================================
// CARGAR DÍA (desde LocalStorage)
// ============================================================
function cargarDia() {
  const fechaStr = fechaAStr(fechaActiva);
  const movs     = obtenerMovimientosLocal(fechaStr);
  const tasa     = obtenerTasaLocal(fechaStr);

  // Rellenar input de tasa
  document.getElementById('tasaInp').value = tasa > 0 ? String(tasa).replace('.', ',') : '';

  // Calcular totales del día
  let ingBs = 0, ingDol = 0, egCasa = 0, egTrab = 0;
  movs.forEach(m => {
    if (m.tipo === 'Ingreso') {
      ingBs  += m.montoBs  || 0;
      ingDol += m.montoDolar || 0;
    } else {
      if (m.categoria === 'Casa')    egCasa += m.montoBs || 0;
      if (m.categoria === 'Trabajo') egTrab += m.montoBs || 0;
    }
  });

  const saldo = ingBs - (egCasa + egTrab);

  // Fondo acumulado: calculado desde todos los días guardados localmente
  const { fondoBs, fondoDol, totalIngBs, totalIngDol, totalEgBs, totalEgDol } = calcularTotalesHistoricos();

  // Mostrar tarjetas
  document.getElementById('cIngBs').textContent    = 'Bs ' + fmt(ingBs);
  document.getElementById('cIngDol').textContent   = '$ '  + fmt(ingDol);
  document.getElementById('cEgCasa').textContent   = 'Bs ' + fmt(egCasa);
  document.getElementById('cEgTrab').textContent   = 'Bs ' + fmt(egTrab);
  document.getElementById('cSaldo').textContent    = 'Bs ' + fmt(saldo);
  document.getElementById('cFondoDol').textContent = '$ '  + fmt(fondoDol);
  document.getElementById('cIngDiaDol').textContent= '$ '  + fmt(ingDol);
  document.getElementById('cFondoBs').textContent  = 'Bs ' + fmt(fondoBs);

  document.getElementById('hTotalIng').textContent    = 'Bs ' + fmt(totalIngBs);
  document.getElementById('hTotalIngDol').textContent = '$ '  + fmt(totalIngDol);
  document.getElementById('hTotalEg').textContent     = 'Bs ' + fmt(totalEgBs);
  document.getElementById('hTotalEgDol').textContent  = '$ '  + fmt(totalEgDol);
  document.getElementById('hFondoDol').textContent    = '$ '  + fmt(fondoDol);
  document.getElementById('hFondoBs').textContent     = 'Bs ' + fmt(fondoBs);

  // Renderizar lista de movimientos
  renderMovimientos(movs);
}

function calcularTotalesHistoricos() {
  try {
    const data = JSON.parse(localStorage.getItem(LS_MOVIMIENTOS) || '{}');
    let totalIngBs = 0, totalIngDol = 0, totalEgBs = 0, totalEgDol = 0;
    let fondoBs = 0, fondoDol = 0;

    // Ordenar fechas
    const fechas = Object.keys(data).sort((a, b) => {
      const toDate = s => { const p=s.split('-'); return new Date(2000+parseInt(p[2]),parseInt(p[1])-1,parseInt(p[0])); };
      return toDate(a) - toDate(b);
    });

    fechas.forEach(fs => {
      const movs = data[fs] || [];
      const tasa = obtenerTasaLocal(fs);
      let ingBs=0, ingDol=0, egBs=0;
      movs.forEach(m => {
        if (m.tipo === 'Ingreso') { ingBs += m.montoBs||0; ingDol += m.montoDolar||0; }
        else egBs += m.montoBs || 0;
      });
      const saldo = ingBs - egBs;
      fondoBs  += saldo;
      fondoDol  = tasa > 0 ? (fondoBs / tasa) + ingDol : fondoDol + ingDol;
      totalIngBs  += ingBs;
      totalIngDol += tasa > 0 ? ingBs / tasa : 0;
      totalIngDol += ingDol;
      totalEgBs   += egBs;
      totalEgDol  += tasa > 0 ? egBs / tasa : 0;
    });

    return { fondoBs, fondoDol, totalIngBs, totalIngDol, totalEgBs, totalEgDol };
  } catch { return { fondoBs:0, fondoDol:0, totalIngBs:0, totalIngDol:0, totalEgBs:0, totalEgDol:0 }; }
}

// ============================================================
// RENDER LISTA DE MOVIMIENTOS
// ============================================================
function renderMovimientos(movs) {
  const lista = document.getElementById('movList');
  if (!movs.length) {
    lista.innerHTML = '<div class="empty">Sin movimientos este día</div>';
    return;
  }
  lista.innerHTML = movs.map((m, idx) => {
    const esIngreso = m.tipo === 'Ingreso';
    const ico       = esIngreso ? '📈' : '📉';
    const cls       = esIngreso ? 'i' : 'e';
    const monto     = m.montoDolar > 0
      ? `<div class="mov-amt ${cls}">$ ${fmt(m.montoDolar)}</div>`
      : `<div class="mov-amt ${cls}">Bs ${fmt(m.montoBs)}</div>`;
    const localTag  = m._local
      ? `<div class="mov-local">⏳ Pendiente de sync</div>`
      : '';
    return `
      <div class="mov">
        <div class="mov-ico ${cls}">${ico}</div>
        <div class="mov-info">
          <div class="mov-con">${m.concepto}</div>
          <div class="mov-meta">${m.categoria || m.tipo}</div>
          ${localTag}
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
  const val = parseFloat(document.getElementById('tasaInp').value.replace(',', '.'));
  if (!val || val <= 0) { toast('Ingresá una tasa válida', true); return; }
  const fechaStr = fechaAStr(fechaActiva);
  guardarTasaLocal(fechaStr, val);

  // Encolar para sincronización
  encolarPendiente({ accion: 'tasa', fechaStr, tasa: val });
  toast('Tasa guardada ✓');
  cargarDia();
}

// ============================================================
// MODAL MOVIMIENTO
// ============================================================
function abrirModal() {
  tipoSel=null; subSel=null; catSel=null; conSel=null;
  document.getElementById('p2i').style.display='none';
  document.getElementById('p2e').style.display='none';
  document.getElementById('p3e').style.display='none';
  document.getElementById('pMonto').style.display='none';
  document.getElementById('montoInp').value='';
  document.getElementById('btnIng').classList.remove('sel');
  document.getElementById('btnEgr').classList.remove('sel');
  document.getElementById('movOverlay').classList.add('open');
}

function cerrarModal(id) {
  document.getElementById(id).classList.remove('open');
}

function cerrarOverlayClick(e, id) {
  if (e.target.id === id) cerrarModal(id);
}

function selTipo(tipo) {
  tipoSel=tipo; subSel=null; catSel=null; conSel=null;
  document.getElementById('btnIng').classList.toggle('sel', tipo==='Ingreso');
  document.getElementById('btnEgr').classList.toggle('sel', tipo==='Egreso');
  document.getElementById('p2i').style.display = tipo==='Ingreso' ? 'block' : 'none';
  document.getElementById('p2e').style.display = tipo==='Egreso'  ? 'block' : 'none';
  document.getElementById('p3e').style.display='none';
  document.getElementById('pMonto').style.display='none';
  document.querySelectorAll('.sbtn').forEach(b=>b.classList.remove('sel'));
  document.querySelectorAll('.cbtn').forEach(b=>b.classList.remove('sel'));
}

function selSub(btn, sub) {
  subSel=sub;
  document.querySelectorAll('.sbtn').forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel');
  const esDol = sub==='Efectivo $';
  document.getElementById('montoLbl').textContent = esDol ? 'Monto en Dólares $' : 'Monto en Bolívares';
  document.getElementById('pMonto').style.display='block';
}

function selCat(cat) {
  catSel=cat; conSel=null;
  document.getElementById('btnCasa').classList.toggle('sel', cat==='Casa');
  document.getElementById('btnTrab').classList.toggle('sel', cat==='Trabajo');
  const lista = cat==='Casa' ? CASA : TRABAJO;
  document.getElementById('p3lbl').textContent = 'Concepto — '+cat;
  document.getElementById('conGrid').innerHTML = lista.map(c=>`
    <button class="konbtn" onclick="selCon(this,'${c}')">${c}</button>
  `).join('');
  document.getElementById('p3e').style.display='block';
  document.getElementById('pMonto').style.display='none';
}

function selCon(btn, con) {
  conSel=con;
  document.querySelectorAll('.konbtn').forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel');
  document.getElementById('montoLbl').textContent='Monto en Bolívares';
  document.getElementById('pMonto').style.display='block';
}

// ============================================================
// GUARDAR MOVIMIENTO (LOCAL + ENCOLAR)
// ============================================================
function guardarMov() {
  const monto = parseFloat(document.getElementById('montoInp').value.replace(',', '.'));
  if (!monto || monto <= 0) { toast('Ingresá un monto válido', true); return; }

  let concepto, montoBs=0, montoDolar=0, categoria;
  if (tipoSel === 'Ingreso') {
    if (!subSel) { toast('Elegí el tipo de ingreso', true); return; }
    concepto=subSel; categoria='Ingreso';
    if (subSel==='Efectivo $') montoDolar=monto; else montoBs=monto;
  } else {
    if (!catSel)  { toast('Elegí Casa o Trabajo', true); return; }
    if (!conSel)  { toast('Elegí el concepto', true); return; }
    concepto=conSel; categoria=catSel; montoBs=monto;
  }

  const fechaStr = fechaAStr(fechaActiva);
  const tasa     = obtenerTasaLocal(fechaStr);

  const mov = {
    fechaStr, tipo: tipoSel, categoria, concepto,
    montoBs, montoDolar, tasa,
    _local: true,
    _ts: Date.now()
  };

  // Guardar localmente
  const movs = obtenerMovimientosLocal(fechaStr);
  movs.push(mov);
  guardarMovimientosLocal(fechaStr, movs);

  // Encolar para sincronización
  encolarPendiente({ accion: 'agregar', ...mov });

  cerrarModal('movOverlay');
  toast('Guardado ✓' + (!hayInternet() ? ' (offline)' : ''));
  cargarDia();

  // Si hay internet, sincronizar automáticamente
  if (hayInternet()) {
    setTimeout(sincronizar, 500);
  }
}

// ============================================================
// EDITAR MOVIMIENTO (LOCAL)
// ============================================================
function abrirEditar(idx, concepto, montoBs, montoDolar) {
  editIdx     = idx;
  editEsDolar = montoDolar > 0;
  document.getElementById('editConcepto').textContent = concepto;
  document.getElementById('editLbl').textContent = editEsDolar ? 'Monto en Dólares $' : 'Monto en Bolívares';
  document.getElementById('editInp').value = editEsDolar
    ? String(montoDolar).replace('.', ',')
    : String(montoBs).replace('.', ',');
  document.getElementById('editOverlay').classList.add('open');
}

function guardarEdicion() {
  const monto = parseFloat(document.getElementById('editInp').value.replace(',', '.'));
  if (!monto || monto <= 0) { toast('Ingresá un monto válido', true); return; }

  const fechaStr = fechaAStr(fechaActiva);
  const movs     = obtenerMovimientosLocal(fechaStr);

  if (editIdx === null || !movs[editIdx]) { toast('Error al editar', true); return; }

  const mov = movs[editIdx];
  if (editEsDolar) { mov.montoDolar = monto; mov.montoBs = 0; }
  else             { mov.montoBs = monto;    mov.montoDolar = 0; }
  mov._local = true;
  mov._editado = true;

  guardarMovimientosLocal(fechaStr, movs);

  // Encolar: marcar edición por timestamp original
  encolarPendiente({ accion: 'editar', fechaStr, ts: mov._ts, nuevoMonto: monto, esDolar: editEsDolar, concepto: mov.concepto });

  cerrarModal('editOverlay');
  toast('Editado ✓');
  cargarDia();
}

// ============================================================
// ELIMINAR MOVIMIENTO (LOCAL)
// ============================================================
function eliminarMov(idx) {
  if (!confirm('¿Eliminás este movimiento?')) return;
  const fechaStr = fechaAStr(fechaActiva);
  const movs     = obtenerMovimientosLocal(fechaStr);

  const [removido] = movs.splice(idx, 1);
  guardarMovimientosLocal(fechaStr, movs);

  encolarPendiente({ accion: 'eliminar', fechaStr, ts: removido._ts, concepto: removido.concepto });

  toast('Eliminado');
  cargarDia();
}

// ============================================================
// HISTORIAL (desde LocalStorage)
// ============================================================
function showTab(tab, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab === 'hist') cargarHistorial();
}

function cargarHistorial() {
  try {
    const data   = JSON.parse(localStorage.getItem(LS_MOVIMIENTOS) || '{}');
    const fechas = Object.keys(data).sort((a, b) => {
      const toDate = s => { const p=s.split('-'); return new Date(2000+parseInt(p[2]),parseInt(p[1])-1,parseInt(p[0])); };
      return toDate(b) - toDate(a); // más reciente primero
    }).slice(0, 30);

    renderHist(fechas.map(fs => {
      const movs = data[fs] || [];
      const tasa = obtenerTasaLocal(fs);
      let ingBs=0, egBs=0, fondoAcumDolar=0;
      movs.forEach(m => {
        if (m.tipo === 'Ingreso') { ingBs += m.montoBs||0; fondoAcumDolar += m.montoDolar||0; }
        else egBs += m.montoBs || 0;
      });
      return { fecha:fs, ingresosBs:ingBs, totalEgresosBs:egBs, fondoAcumDolar };
    }));
  } catch {
    document.getElementById('histBody').innerHTML =
      '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:20px">Sin datos locales</td></tr>';
  }
}

function renderHist(datos) {
  const tb = document.getElementById('histBody');
  if (!datos.length) {
    tb.innerHTML='<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:20px">Sin datos</td></tr>';
    return;
  }
  tb.innerHTML = datos.map(d => {
    const saldo = (d.ingresosBs||0)-(d.totalEgresosBs||0);
    return `<tr onclick="irAFecha('${d.fecha}')">
      <td style="color:var(--muted)">${d.fecha}</td>
      <td style="color:var(--green)">Bs ${fmt(d.ingresosBs)}</td>
      <td style="color:var(--red)">Bs ${fmt(d.totalEgresosBs)}</td>
      <td style="color:${saldo>=0?'var(--green)':'var(--red)'}">${saldo>=0?'+':'-'}${fmt(Math.abs(saldo))}</td>
      <td style="color:var(--gold)">$${fmt(d.fondoAcumDolar)}</td>
    </tr>`;
  }).join('');
}

// ============================================================
// RECALCULAR (local)
// ============================================================
function recalcularTodo() {
  if (!confirm('¿Recalculás el resumen local?\n(No afecta Google Sheets directamente — usá Sincronizar para eso)')) return;
  cargarHistorial();
  toast('✓ Historial local actualizado');
}

// ============================================================
// SINCRONIZACIÓN CON GOOGLE SHEETS
// ============================================================
async function sincronizar() {
  if (!hayInternet()) {
    toast('Sin conexión — intentá cuando haya internet', true);
    return;
  }

  const pendientes = obtenerPendientes();
  if (pendientes.length === 0) {
    toast('Todo sincronizado ✓');
    return;
  }

  const btn = document.getElementById('btnSync');
  btn.className = 'btn-sync sincronizando';
  document.getElementById('syncTxt').textContent = 'Sincronizando...';
  mostrarSpin('Sincronizando ' + pendientes.length + ' registro(s)...');

  try {
    const resp = await fetch(WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },  // evita preflight CORS
      body: JSON.stringify({ lote: pendientes })
    });

    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    const resultado = await resp.json();

    if (resultado.ok) {
      // Marcar todos los movimientos locales como sincronizados
      marcarComoSincronizados();
      limpiarPendientes();
      ocultarSpin();
      toast(`✓ ${pendientes.length} registro(s) sincronizados`);
    } else {
      throw new Error(resultado.error || 'Error en servidor');
    }
  } catch (err) {
    ocultarSpin();
    toast('Error de sincronización: ' + err.message, true);
    console.error('Sync error', err);
  }

  actualizarBtnSync();
}

function marcarComoSincronizados() {
  try {
    const data = JSON.parse(localStorage.getItem(LS_MOVIMIENTOS) || '{}');
    Object.keys(data).forEach(fs => {
      data[fs] = data[fs].map(m => ({ ...m, _local: false }));
    });
    localStorage.setItem(LS_MOVIMIENTOS, JSON.stringify(data));
  } catch (e) { console.error(e); }
}

// ============================================================
// HELPERS UI
// ============================================================
function fmt(n) {
  return Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function mostrarSpin(msg) {
  document.getElementById('spinMsg').textContent = msg;
  document.getElementById('spin').classList.add('show');
}

function ocultarSpin() {
  document.getElementById('spin').classList.remove('show');
}

function toast(msg, err=false, warn=false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : warn ? ' warn' : '');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

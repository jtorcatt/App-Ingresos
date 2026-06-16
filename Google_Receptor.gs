// ============================================================
// CONFIGURACIÓN
// ============================================================
const SHEET_ID         = '1L24VZfSLkYuxUvzxR-bMR35mb3uQchyXFX6_JN1kSYI';
const HOJA_MOVIMIENTOS = 'Movimientos';
const HOJA_RESUMEN     = 'Resumen';
const TZ               = 'America/Caracas';

// ============================================================
// PUNTO DE ENTRADA GET — maneja TODAS las peticiones del iPhone
//
//  Sin parámetros              → ping de estado
//  ?accion=bajar               → devuelve movimientos + tasas
//  ?accion=subir&payload=<JSON>→ procesa lote de cambios
// ============================================================
function doGet(e) {
  const accion = e && e.parameter && e.parameter.accion;

  // ── BAJAR ─────────────────────────────────────────────────
  if (accion === 'bajar') {
    try {
      const ss   = SpreadsheetApp.openById(SHEET_ID);
      const hMov = ss.getSheetByName(HOJA_MOVIMIENTOS);
      const hRes = ss.getSheetByName(HOJA_RESUMEN);

      const movimientos = [];
      if (hMov && hMov.getLastRow() > 1) {
        const datos = hMov.getDataRange().getValues();
        for (let i = 1; i < datos.length; i++) {
          const f = datos[i];
          if (!f[0]) continue;
          movimientos.push({
            fechaStr:   fmtFecha(f[0]),
            tipo:       f[2],
            categoria:  f[3],
            concepto:   f[4],
            montoBs:    parseFloat(f[5]) || 0,
            montoDolar: parseFloat(f[6]) || 0,
            timestamp:  f[7] instanceof Date ? f[7].getTime() : 0
          });
        }
      }

      const tasas = [];
      if (hRes && hRes.getLastRow() > 1) {
        const datos = hRes.getDataRange().getValues();
        for (let i = 1; i < datos.length; i++) {
          if (!datos[i][0]) continue;
          tasas.push({
            fechaStr: fmtFecha(datos[i][0]),
            tasa:     parseFloat(datos[i][1]) || 0
          });
        }
      }

      return jsonResp({ ok: true, movimientos, tasas });
    } catch(err) {
      return jsonResp({ ok: false, error: err.message });
    }
  }

  // ── SUBIR ─────────────────────────────────────────────────
  if (accion === 'subir') {
    try {
      const raw = e.parameter.payload;
      if (!raw) return jsonResp({ ok: false, error: 'Sin payload' });

      const lote = JSON.parse(raw).lote || [];
      if (!lote.length) return jsonResp({ ok: true, procesados: 0 });

      const ss   = SpreadsheetApp.openById(SHEET_ID);
      const hMov = ss.getSheetByName(HOJA_MOVIMIENTOS);
      const hRes = ss.getSheetByName(HOJA_RESUMEN);
      if (!hMov || !hRes) return jsonResp({ ok: false, error: 'Hojas no encontradas. Ejecutá inicializarHojas() primero.' });

      const fechasAfectadas = new Set();

      for (const item of lote) {
        if (!item.accion || !item.fechaStr) continue;
        switch (item.accion) {
          case 'tasa':
            procesarTasa(hRes, item.fechaStr, parseFloat(item.tasa) || 0);
            break;
          case 'agregar':
            procesarAgregar(hMov, hRes, item);
            break;
          case 'editar':
            procesarEditar(hMov, item);
            break;
          case 'eliminar':
            procesarEliminar(hMov, item);
            break;
          default:
            Logger.log('Acción desconocida: ' + item.accion);
        }
        fechasAfectadas.add(item.fechaStr);
      }

      ordenarFechas([...fechasAfectadas]).forEach(fs => recalcularResumenFecha(hRes, hMov, fs));
      SpreadsheetApp.flush();
      return jsonResp({ ok: true, procesados: lote.length });

    } catch(err) {
      Logger.log('subir ERROR: ' + err.message);
      return jsonResp({ ok: false, error: err.message });
    }
  }

  // ── PING ──────────────────────────────────────────────────
  return jsonResp({ ok: true, msg: 'MiFondo API activa' });
}

// ============================================================
// doPost — fallback por compatibilidad (no se usa activamente)
// ============================================================
function doPost(e) {
  try {
    let raw;
    if (e.parameter && e.parameter.payload) raw = e.parameter.payload;
    else if (e.postData && e.postData.contents) raw = e.postData.contents;
    else return jsonResp({ ok: false, error: 'Sin datos' });
    const lote = JSON.parse(raw).lote || [];
    const ss   = SpreadsheetApp.openById(SHEET_ID);
    const hMov = ss.getSheetByName(HOJA_MOVIMIENTOS);
    const hRes = ss.getSheetByName(HOJA_RESUMEN);
    const fechasAfectadas = new Set();
    for (const item of lote) {
      if (!item.accion || !item.fechaStr) continue;
      switch (item.accion) {
        case 'tasa':    procesarTasa(hRes, item.fechaStr, parseFloat(item.tasa)||0); break;
        case 'agregar': procesarAgregar(hMov, hRes, item); break;
        case 'editar':  procesarEditar(hMov, item); break;
        case 'eliminar':procesarEliminar(hMov, item); break;
      }
      fechasAfectadas.add(item.fechaStr);
    }
    ordenarFechas([...fechasAfectadas]).forEach(fs => recalcularResumenFecha(hRes, hMov, fs));
    SpreadsheetApp.flush();
    return jsonResp({ ok: true, procesados: lote.length });
  } catch(err) {
    return jsonResp({ ok: false, error: err.message });
  }
}

// ============================================================
// PROCESAR TASA
// ============================================================
function procesarTasa(hRes, fechaStr, tasa) {
  let filaIdx = buscarFilaResumen(hRes, fechaStr);
  if (filaIdx === -1) {
    let fondoAntBs=0, fondoAntDol=0;
    if (hRes.getLastRow() > 1) {
      const ult = hRes.getRange(hRes.getLastRow(), 1, 1, 10).getValues()[0];
      fondoAntBs  = ult[8] || 0;
      fondoAntDol = ult[9] || 0;
    }
    hRes.appendRow([strAFecha(fechaStr), tasa, 0, 0, 0, 0, 0, 0, fondoAntBs, fondoAntDol]);
  } else {
    hRes.getRange(filaIdx, 2).setValue(tasa);
  }
}

// ============================================================
// PROCESAR AGREGAR
// ============================================================
function procesarAgregar(hMov, hRes, item) {
  const fechaStr = item.fechaStr;
  let tasa = parseFloat(item.tasa) || 0;
  if (tasa === 0) {
    const filaRes = buscarFilaResumen(hRes, fechaStr);
    if (filaRes > 0) tasa = parseFloat(hRes.getRange(filaRes, 2).getValue()) || 0;
  }
  if (buscarFilaResumen(hRes, fechaStr) === -1) {
    procesarTasa(hRes, fechaStr, tasa);
  }
  const ts = item._ts ? new Date(item._ts) : new Date();
  hMov.appendRow([
    strAFecha(fechaStr), tasa,
    item.tipo      || '',
    item.categoria || '',
    item.concepto  || '',
    parseFloat(item.montoBs)    || 0,
    parseFloat(item.montoDolar) || 0,
    ts
  ]);
}

// ============================================================
// PROCESAR EDITAR
// ============================================================
function procesarEditar(hMov, item) {
  if (hMov.getLastRow() < 2) return;
  const datos    = hMov.getDataRange().getValues();
  const fechaStr = item.fechaStr;
  const tsOrigen = item.ts;
  for (let i = datos.length-1; i >= 1; i--) {
    const f = datos[i];
    if (!f[0] || fmtFecha(f[0]) !== fechaStr) continue;
    const tsGuardado = f[7] instanceof Date ? f[7].getTime() : 0;
    const coincide   = tsOrigen
      ? Math.abs(tsGuardado - tsOrigen) < 10000
      : f[4] === item.concepto;
    if (coincide) {
      if (item.esDolar) { hMov.getRange(i+1,6).setValue(0); hMov.getRange(i+1,7).setValue(parseFloat(item.nuevoMonto)||0); }
      else              { hMov.getRange(i+1,6).setValue(parseFloat(item.nuevoMonto)||0); hMov.getRange(i+1,7).setValue(0); }
      return;
    }
  }
}

// ============================================================
// PROCESAR ELIMINAR
// ============================================================
function procesarEliminar(hMov, item) {
  if (hMov.getLastRow() < 2) return;
  const datos    = hMov.getDataRange().getValues();
  const fechaStr = item.fechaStr;
  const tsOrigen = item.ts;
  for (let i = datos.length-1; i >= 1; i--) {
    const f = datos[i];
    if (!f[0] || fmtFecha(f[0]) !== fechaStr) continue;
    const tsGuardado = f[7] instanceof Date ? f[7].getTime() : 0;
    const coincide   = tsOrigen
      ? Math.abs(tsGuardado - tsOrigen) < 10000
      : f[4] === item.concepto;
    if (coincide) { hMov.deleteRow(i+1); return; }
  }
}

// ============================================================
// RECALCULAR RESUMEN EN CASCADA
// ============================================================
function recalcularResumenFecha(hRes, hMov, fechaStr) {
  if (hRes.getLastRow() < 2) return;
  const movsPorFecha = {};
  if (hMov.getLastRow() > 1) {
    const movs = hMov.getDataRange().getValues();
    for (let i=1; i<movs.length; i++) {
      const m=movs[i]; if (!m[0]) continue;
      const fs=fmtFecha(m[0]);
      if (!movsPorFecha[fs]) movsPorFecha[fs]={ingBs:0,ingDol:0,egCasa:0,egTrab:0};
      const bs=parseFloat(m[5])||0, dol=parseFloat(m[6])||0;
      if (m[2]==='Ingreso') { movsPorFecha[fs].ingBs+=bs; movsPorFecha[fs].ingDol+=dol; }
      else {
        if (m[3]==='Casa')    movsPorFecha[fs].egCasa+=bs;
        if (m[3]==='Trabajo') movsPorFecha[fs].egTrab+=bs;
      }
    }
  }
  const resumen = hRes.getDataRange().getValues();
  let inicioIdx=-1;
  for (let i=1; i<resumen.length; i++) {
    if (!resumen[i][0]) continue;
    if (fmtFecha(resumen[i][0])===fechaStr) { inicioIdx=i; break; }
  }
  if (inicioIdx<0) return;
  let fondoBs  = inicioIdx>1 ? (parseFloat(resumen[inicioIdx-1][8])||0) : 0;
  let fondoDol = inicioIdx>1 ? (parseFloat(resumen[inicioIdx-1][9])||0) : 0;
  for (let i=inicioIdx; i<resumen.length; i++) {
    if (!resumen[i][0]) continue;
    const fs   = fmtFecha(resumen[i][0]);
    const tasa = parseFloat(resumen[i][1])||0;
    const d    = movsPorFecha[fs]||{ingBs:0,ingDol:0,egCasa:0,egTrab:0};
    const totalEg=d.egCasa+d.egTrab, saldo=d.ingBs-totalEg;
    fondoBs  += saldo;
    fondoDol  = tasa>0 ? (fondoBs/tasa)+d.ingDol : fondoDol+d.ingDol;
    hRes.getRange(i+1,3,1,8).setValues([[d.ingBs,d.ingDol,d.egCasa,d.egTrab,totalEg,saldo,fondoBs,fondoDol]]);
  }
}

// ============================================================
// INICIALIZAR HOJAS (ejecutar UNA sola vez desde el editor)
// ============================================================
function inicializarHojas() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let hMov = ss.getSheetByName(HOJA_MOVIMIENTOS);
  if (!hMov) hMov = ss.insertSheet(HOJA_MOVIMIENTOS);
  if (hMov.getLastRow()===0) {
    hMov.appendRow(['Fecha','Tasa Dólar','Tipo','Categoría','Concepto','Monto Bs','Monto $','Timestamp']);
    hMov.setFrozenRows(1);
  }
  let hRes = ss.getSheetByName(HOJA_RESUMEN);
  if (!hRes) hRes = ss.insertSheet(HOJA_RESUMEN);
  if (hRes.getLastRow()===0) {
    hRes.appendRow(['Fecha','Tasa Dólar','Total Ingresos Bs','Total Ingresos $','Total Egresos Casa Bs','Total Egresos Trabajo Bs','Total Egresos Bs','Saldo Bs','Fondo Acumulado Bs','Fondo Acumulado $']);
    hRes.setFrozenRows(1);
  }
  SpreadsheetApp.flush();
  return 'Hojas inicializadas correctamente.';
}

// ============================================================
// HELPERS
// ============================================================
function fmtFecha(d)      { return Utilities.formatDate(new Date(d), TZ, 'dd-MM-yy'); }
function strAFecha(s)     { const p=s.split('-'); return new Date(2000+parseInt(p[2]),parseInt(p[1])-1,parseInt(p[0]),12,0,0); }
function jsonResp(obj)    { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function buscarFilaResumen(hRes, fechaStr) {
  if (hRes.getLastRow()<2) return -1;
  const datos=hRes.getDataRange().getValues();
  for (let i=1; i<datos.length; i++) {
    if (!datos[i][0]) continue;
    if (fmtFecha(datos[i][0])===fechaStr) return i+1;
  }
  return -1;
}
function ordenarFechas(fechas) {
  return fechas.sort((a,b) => {
    const t=s=>{const p=s.split('-');return new Date(2000+parseInt(p[2]),parseInt(p[1])-1,parseInt(p[0]));};
    return t(a)-t(b);
  });
}

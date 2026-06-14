// ============================================================
// GOOGLE_RECEPTOR.gs
// Pegá este código en tu proyecto de Google Apps Script en la nube.
// Publicalo como Web App: "Ejecutar como yo" + "Cualquiera puede acceder".
// Luego copiá la URL generada y pegala en app.js → WEBAPP_URL
// ============================================================

const SHEET_ID         = '1L24VZfSLkYuxUvzxR-bMR35mb3uQchyXFX6_JN1kSYI'; // ← tu ID de hoja
const HOJA_MOVIMIENTOS = 'Movimientos';
const HOJA_RESUMEN     = 'Resumen';
const TZ               = 'America/Caracas';

// ============================================================
// PUNTO DE ENTRADA GET (mantiene la web app accesible)
// ============================================================
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, msg: 'MiFondo API activa' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// PUNTO DE ENTRADA POST — Receptor principal del iPhone
// Recibe: { lote: [ ...items ] }
// Cada item tiene: { accion, fechaStr, ... }
//   accion = 'tasa'    → { fechaStr, tasa }
//   accion = 'agregar' → { fechaStr, tipo, categoria, concepto, montoBs, montoDolar, tasa }
//   accion = 'editar'  → { fechaStr, ts, nuevoMonto, esDolar, concepto }
//   accion = 'eliminar'→ { fechaStr, ts, concepto }
// ============================================================
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const lote    = payload.lote || [];

    if (!Array.isArray(lote) || lote.length === 0) {
      return jsonResp({ ok: false, error: 'Lote vacío o inválido' });
    }

    const ss   = SpreadsheetApp.openById(SHEET_ID);
    const hMov = ss.getSheetByName(HOJA_MOVIMIENTOS);
    const hRes = ss.getSheetByName(HOJA_RESUMEN);

    if (!hMov || !hRes) {
      return jsonResp({ ok: false, error: 'Hojas no encontradas. Ejecutá inicializarHojas() primero.' });
    }

    const fechasAfectadas = new Set();

    for (const item of lote) {
      const accion    = item.accion;
      const fechaStr  = item.fechaStr;

      if (!accion || !fechaStr) continue;

      switch (accion) {
        case 'tasa':
          procesarTasa(hRes, fechaStr, parseFloat(item.tasa) || 0);
          fechasAfectadas.add(fechaStr);
          break;

        case 'agregar':
          procesarAgregar(hMov, hRes, item);
          fechasAfectadas.add(fechaStr);
          break;

        case 'editar':
          procesarEditar(hMov, item);
          fechasAfectadas.add(fechaStr);
          break;

        case 'eliminar':
          procesarEliminar(hMov, item);
          fechasAfectadas.add(fechaStr);
          break;

        default:
          Logger.log('Acción desconocida: ' + accion);
      }
    }

    // Recalcular resumen para todas las fechas afectadas (en cascada)
    const fechasOrdenadas = ordenarFechas([...fechasAfectadas]);
    for (const fs of fechasOrdenadas) {
      recalcularResumenFecha(hRes, hMov, fs);
    }

    SpreadsheetApp.flush();
    return jsonResp({ ok: true, procesados: lote.length });

  } catch (err) {
    Logger.log('doPost ERROR: ' + err.message);
    return jsonResp({ ok: false, error: err.message });
  }
}

// ============================================================
// PROCESAR TASA
// ============================================================
function procesarTasa(hRes, fechaStr, tasa) {
  let filaIdx = buscarFilaResumen(hRes, fechaStr);

  if (filaIdx === -1) {
    // Crear fila nueva
    let fondoAntBs = 0, fondoAntDol = 0;
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

  // Obtener tasa del resumen para esta fecha (o usar la enviada)
  let tasa = parseFloat(item.tasa) || 0;
  if (tasa === 0) {
    const filaRes = buscarFilaResumen(hRes, fechaStr);
    if (filaRes > 0) {
      tasa = parseFloat(hRes.getRange(filaRes, 2).getValue()) || 0;
    }
  }

  // Si no existe la fila de resumen para esta fecha, crearla
  if (buscarFilaResumen(hRes, fechaStr) === -1) {
    procesarTasa(hRes, fechaStr, tasa);
  }

  const fecha = strAFecha(fechaStr);
  const ts    = item._ts ? new Date(item._ts) : new Date();

  hMov.appendRow([
    fecha,
    tasa,
    item.tipo       || '',
    item.categoria  || '',
    item.concepto   || '',
    parseFloat(item.montoBs)     || 0,
    parseFloat(item.montoDolar)  || 0,
    ts
  ]);
}

// ============================================================
// PROCESAR EDITAR (busca por timestamp + concepto)
// ============================================================
function procesarEditar(hMov, item) {
  if (hMov.getLastRow() < 2) return;

  const datos     = hMov.getDataRange().getValues();
  const fechaStr  = item.fechaStr;
  const tsOrigen  = item.ts;

  // Buscar la fila que coincida con fechaStr y, si hay ts, por timestamp
  for (let i = datos.length - 1; i >= 1; i--) {
    const fila = datos[i];
    if (!fila[0]) continue;
    if (fmtFecha(fila[0]) !== fechaStr) continue;

    // Comparar por concepto como fallback si no hay timestamp exacto
    const tsGuardado = fila[7] instanceof Date ? fila[7].getTime() : 0;
    const coincide   = tsOrigen
      ? Math.abs(tsGuardado - tsOrigen) < 5000  // 5 segundos de margen
      : fila[4] === item.concepto;

    if (coincide) {
      if (item.esDolar) {
        hMov.getRange(i + 1, 6).setValue(0);
        hMov.getRange(i + 1, 7).setValue(parseFloat(item.nuevoMonto) || 0);
      } else {
        hMov.getRange(i + 1, 6).setValue(parseFloat(item.nuevoMonto) || 0);
        hMov.getRange(i + 1, 7).setValue(0);
      }
      return;
    }
  }
  Logger.log('Editar: fila no encontrada para fechaStr=' + fechaStr + ' concepto=' + item.concepto);
}

// ============================================================
// PROCESAR ELIMINAR (busca por timestamp + concepto)
// ============================================================
function procesarEliminar(hMov, item) {
  if (hMov.getLastRow() < 2) return;

  const datos    = hMov.getDataRange().getValues();
  const fechaStr = item.fechaStr;
  const tsOrigen = item.ts;

  for (let i = datos.length - 1; i >= 1; i--) {
    const fila = datos[i];
    if (!fila[0]) continue;
    if (fmtFecha(fila[0]) !== fechaStr) continue;

    const tsGuardado = fila[7] instanceof Date ? fila[7].getTime() : 0;
    const coincide   = tsOrigen
      ? Math.abs(tsGuardado - tsOrigen) < 5000
      : fila[4] === item.concepto;

    if (coincide) {
      hMov.deleteRow(i + 1);
      return;
    }
  }
  Logger.log('Eliminar: fila no encontrada para fechaStr=' + fechaStr + ' concepto=' + item.concepto);
}

// ============================================================
// RECALCULAR RESUMEN EN CASCADA (igual que el original)
// ============================================================
function recalcularResumenFecha(hRes, hMov, fechaStr) {
  if (hRes.getLastRow() < 2) return;

  const movsPorFecha = {};
  if (hMov.getLastRow() > 1) {
    const movs = hMov.getDataRange().getValues();
    for (let i = 1; i < movs.length; i++) {
      const m = movs[i];
      if (!m[0]) continue;
      const fs = fmtFecha(m[0]);
      if (!movsPorFecha[fs]) movsPorFecha[fs] = { ingBs:0, ingDol:0, egCasa:0, egTrab:0 };
      const montoBs  = parseFloat(m[5]) || 0;
      const montoDol = parseFloat(m[6]) || 0;
      if (m[2] === 'Ingreso') {
        movsPorFecha[fs].ingBs  += montoBs;
        movsPorFecha[fs].ingDol += montoDol;
      } else {
        if (m[3] === 'Casa')    movsPorFecha[fs].egCasa += montoBs;
        if (m[3] === 'Trabajo') movsPorFecha[fs].egTrab += montoBs;
      }
    }
  }

  const resumen = hRes.getDataRange().getValues();

  let inicioIdx = -1;
  for (let i = 1; i < resumen.length; i++) {
    if (!resumen[i][0]) continue;
    if (fmtFecha(resumen[i][0]) === fechaStr) { inicioIdx = i; break; }
  }
  if (inicioIdx < 0) return;

  let fondoAcumBs  = inicioIdx > 1 ? (parseFloat(resumen[inicioIdx-1][8]) || 0) : 0;
  let fondoAcumDol = inicioIdx > 1 ? (parseFloat(resumen[inicioIdx-1][9]) || 0) : 0;

  for (let i = inicioIdx; i < resumen.length; i++) {
    if (!resumen[i][0]) continue;
    const fs   = fmtFecha(resumen[i][0]);
    const tasa = parseFloat(resumen[i][1]) || 0;
    const d    = movsPorFecha[fs] || { ingBs:0, ingDol:0, egCasa:0, egTrab:0 };

    const totalEg = d.egCasa + d.egTrab;
    const saldo   = d.ingBs - totalEg;
    fondoAcumBs  += saldo;
    fondoAcumDol  = tasa > 0
      ? (fondoAcumBs / tasa) + d.ingDol
      : fondoAcumDol + d.ingDol;

    hRes.getRange(i + 1, 3, 1, 8).setValues([[
      d.ingBs, d.ingDol,
      d.egCasa, d.egTrab,
      totalEg, saldo,
      fondoAcumBs, fondoAcumDol
    ]]);
  }
}

// ============================================================
// HELPERS
// ============================================================
function fmtFecha(d) {
  return Utilities.formatDate(new Date(d), TZ, 'dd-MM-yy');
}

function strAFecha(fechaStr) {
  const p = fechaStr.split('-');
  return new Date(2000 + parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]), 12, 0, 0);
}

function buscarFilaResumen(hRes, fechaStr) {
  if (hRes.getLastRow() < 2) return -1;
  const datos = hRes.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    if (!datos[i][0]) continue;
    if (fmtFecha(datos[i][0]) === fechaStr) return i + 1;
  }
  return -1;
}

function ordenarFechas(fechas) {
  return fechas.sort((a, b) => {
    const toDate = s => {
      const p = s.split('-');
      return new Date(2000 + parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
    };
    return toDate(a) - toDate(b);
  });
}

function jsonResp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// INICIALIZAR HOJAS (ejecutar UNA sola vez desde el editor)
// ============================================================
function inicializarHojas() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  let hMov = ss.getSheetByName(HOJA_MOVIMIENTOS);
  if (!hMov) hMov = ss.insertSheet(HOJA_MOVIMIENTOS);
  if (hMov.getLastRow() === 0) {
    hMov.appendRow(['Fecha','Tasa Dólar','Tipo','Categoría','Concepto','Monto Bs','Monto $','Timestamp']);
    hMov.setFrozenRows(1);
  }

  let hRes = ss.getSheetByName(HOJA_RESUMEN);
  if (!hRes) hRes = ss.insertSheet(HOJA_RESUMEN);
  if (hRes.getLastRow() === 0) {
    hRes.appendRow(['Fecha','Tasa Dólar','Total Ingresos Bs','Total Ingresos $',
      'Total Egresos Casa Bs','Total Egresos Trabajo Bs',
      'Total Egresos Bs','Saldo Bs','Fondo Acumulado Bs','Fondo Acumulado $']);
    hRes.setFrozenRows(1);
  }

  SpreadsheetApp.flush();
  return 'Hojas inicializadas correctamente.';
}

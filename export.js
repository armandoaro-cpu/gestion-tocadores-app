/* ============================================================
 * export.js — descarga de reportes en Excel (.xlsx) con SheetJS
 * Hojas: Ventas, Abonos, Gastos (+ Resumen del periodo).
 * En modo trabajadora se excluyen costos y ganancias.
 * ============================================================ */

import { soles, fmtFecha, TIPOS_VENTA, ESTADOS, MEDIOS, totalAbonado } from "./ui.js";

function libroDisponible() {
  return typeof window.XLSX !== "undefined";
}

function filaVenta(v, abonos, esDueno) {
  const abonado = totalAbonado(abonos);
  const fila = {
    Fecha: fmtFecha(v.fecha),
    Tipo: TIPOS_VENTA[v.tipo] || v.tipo,
    Cliente: v.nombre || "",
    DNI: v.dni || "",
    Teléfono: v.telefono || "",
    Modelo: v.modelo || "",
    "Precio de venta": Number(v.precio_venta) || 0,
    Destino: (v.destino_tipo === "provincia" ? "Provincia" : "Lima") + (v.destino_lugar ? " — " + v.destino_lugar : ""),
    Estado: ESTADOS[v.estado] || v.estado,
    "Total abonado": abonado,
    "Saldo restante": Math.max(0, (Number(v.precio_venta) || 0) - abonado),
    "Costo de envío": Number(v.envio_costo) || 0,
    "Fecha de envío": fmtFecha(v.envio_fecha),
  };
  if (esDueno) {
    fila["Costo (proveedor)"] = v.costo == null ? "" : Number(v.costo);
    fila["Ganancia estimada"] =
      v.costo == null || v.estado === "anulada" ? "" : (Number(v.precio_venta) || 0) - Number(v.costo);
    if (v.estado === "anulada") {
      fila["Fecha anulación"] = fmtFecha(v.anulada_fecha);
      fila["Monto devuelto"] = Number(v.devolucion_monto) || 0;
      fila["Motivo anulación"] = v.anulada_motivo || "";
    }
  }
  return fila;
}

export async function exportarExcel({ db, esDueno, from, to, etiquetaPeriodo }) {
  if (!libroDisponible()) {
    throw new Error("La librería de Excel (SheetJS) no se cargó. Revisa tu conexión a internet.");
  }

  const ventas = (await db.ventas.list()).filter((v) => {
    const f = (v.fecha || "").slice(0, 10);
    return (!from || f >= from) && (!to || f <= to);
  });

  // Abonos del periodo (por fecha de abono) y gastos del periodo
  // Ojo: lo abonado en ventas anuladas se devolvió, así que NO suma al cobrado.
  const idsAnuladas = new Set(ventas.filter((v) => v.estado === "anulada").map((v) => v.id));
  let totalCobradoReal = 0;
  const abonosRows = [];
  for (const v of ventas) {
    const abs = await db.abonos.listByVenta(v.id);
    for (const a of abs) {
      const f = (a.fecha || "").slice(0, 10);
      if ((!from || f >= from) && (!to || f <= to)) {
        if (!idsAnuladas.has(v.id)) totalCobradoReal += Number(a.monto) || 0;
        abonosRows.push({
          Fecha: fmtFecha(a.fecha),
          Cliente: v.nombre || "",
          DNI: v.dni || "",
          Teléfono: v.telefono || "",
          Modelo: v.modelo || "",
          Monto: Number(a.monto) || 0,
          Medio: MEDIOS[a.medio] || a.medio,
          "Comprobante": a.comprobante ? "Sí" : "No",
        });
      }
    }
  }

  const gastos = await db.gastos.list(from, to);
  const gastosRows = gastos.map((g) => ({
    Fecha: fmtFecha(g.fecha),
    Categoría: g.categoria || "",
    Concepto: g.concepto || "",
    Monto: Number(g.monto) || 0,
  }));

  const ventasRows = [];
  for (const v of ventas) {
    const abs = await db.abonos.listByVenta(v.id);
    ventasRows.push(filaVenta(v, abs, esDueno));
  }

  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(ventasRows), "Ventas");
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(abonosRows), "Abonos");
  if (esDueno) {
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(gastosRows), "Gastos");
    const totalCobrado = totalCobradoReal;
    const totalGastos = gastosRows.reduce((s, r) => s + r.Monto, 0);
    const ganancia = ventasRows.reduce((s, r) => s + (Number(r["Ganancia estimada"]) || 0), 0);
    const resumen = [
      { Concepto: "Periodo", Valor: etiquetaPeriodo },
      { Concepto: "Tocadores vendidos", Valor: ventas.filter((v) => v.estado !== "anulada").length },
      { Concepto: "Total cobrado en abonos", Valor: totalCobrado },
      { Concepto: "Ganancia bruta estimada", Valor: ganancia },
      { Concepto: "Total gastos", Valor: totalGastos },
      { Concepto: "Resultado neto", Valor: ganancia - totalGastos },
    ];
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(resumen), "Resumen");
  }

  const nombre = `reporte_tocadores_${etiquetaPeriodo.replace(/[^0-9a-zA-Z]+/g, "_")}.xlsx`;
  window.XLSX.writeFile(wb, nombre);
}

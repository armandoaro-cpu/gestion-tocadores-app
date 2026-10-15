/* ============================================================
 * ui.js — utilidades de interfaz: formato, modal, toast, helpers
 * ============================================================ */

/** Formatea un monto en soles. */
export function soles(n) {
  const v = Number(n) || 0;
  return "S/ " + v.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Fecha YYYY-MM-DD -> DD/MM/YYYY */
export function fmtFecha(iso) {
  if (!iso) return "—";
  const d = String(iso).slice(0, 10).split("-");
  if (d.length !== 3) return String(iso);
  return `${d[2]}/${d[1]}/${d[0]}`;
}

/** Hoy en YYYY-MM-DD (zona local). */
export function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Primer y último día del mes dado (YYYY-MM). */
export function rangoMes(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const pad = (n) => String(n).padStart(2, "0");
  return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${last}`];
}

/** Lunes y domingo de la semana actual. */
export function rangoSemana() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // lunes = 0
  const lunes = new Date(now);
  lunes.setDate(now.getDate() - day);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return [f(lunes), f(domingo)];
}

/** Crea un elemento con atributos e hijos. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Muestra un aviso temporal. */
let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

/** Abre el modal con el contenido dado; devuelve función para cerrarlo. */
export function openModal(content) {
  const backdrop = document.getElementById("modal-backdrop");
  const box = document.getElementById("modal-box");
  box.innerHTML = "";
  if (content instanceof Node) box.append(content);
  else box.innerHTML = String(content);
  backdrop.hidden = false;
  const close = () => {
    backdrop.hidden = true;
    box.innerHTML = "";
  };
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  return close;
}

/** Mensaje de error simple dentro de un formulario. */
export function formError(form, msg) {
  let p = form.querySelector(".form-error");
  if (!p) {
    p = el("p", { class: "form-error" });
    form.prepend(p);
  }
  p.textContent = msg;
  p.hidden = !msg;
}

/* ---------------- Imágenes ---------------- */

/**
 * Comprime una imagen (File) en el cliente: máx 1200px, JPEG.
 * Devuelve un dataURL listo para subir.
 */
export function comprimirImagen(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Archivo no válido como imagen"));
      img.onload = () => {
        const MAX = 1200;
        let { width, height } = img;
        const scale = Math.min(1, MAX / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------- Constantes de negocio ---------------- */

export const TIPOS_VENTA = { separacion: "Separación", directa: "Venta directa" };
export const ESTADOS = {
  activa: "Separación activa",
  pagada: "Pagado completo",
  enviada: "Enviado",
  anulada: "Anulada",
};
export const MEDIOS = { yape: "Yape", transferencia: "Transferencia", efectivo: "Efectivo" };
export const CATEGORIAS_GASTO = [
  "Alquiler",
  "Sueldo / trabajadores",
  "Luz",
  "Agua",
  "Repuestos",
  "Limpieza",
  "Envíos",
  "Otros",
];

/** Suma de abonos (sin contar anuladas: los abonos se guardan igual, la venta se excluye). */
export function totalAbonado(abonos) {
  return abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0);
}

export function saldoRestante(venta, abonado) {
  return Math.max(0, (Number(venta.precio_venta) || 0) - abonado);
}

export function porcentajeAvance(venta, abonado) {
  const p = Number(venta.precio_venta) || 0;
  if (p <= 0) return 0;
  return Math.min(100, Math.round((abonado / p) * 100));
}

/**
 * Enlace de WhatsApp (wa.me) para un teléfono peruano.
 * Acepta números con espacios, con +51 o solo los 9 dígitos.
 * Si se pasa mensaje, va pre-cargado en el chat. Devuelve null si no hay número válido.
 */
export function enlaceWhatsApp(telefono, mensaje) {
  let n = String(telefono || "").replace(/\D/g, "");
  if (!n) return null;
  if (n.length === 9) n = "51" + n; // celular peruano sin código de país
  if (n.length < 11) return null;
  const base = `https://wa.me/${n}`;
  return mensaje ? `${base}?text=${encodeURIComponent(mensaje)}` : base;
}

/** Mensaje listo para enviar al cliente con su estado de cuenta (abonado y saldo). */
export function mensajeEstadoWhatsApp(venta, abonado) {
  const saldo = saldoRestante(venta, abonado);
  const lineas = [
    `Hola, ${venta.nombre || "gracias por tu compra"}. Te compartimos el estado de tu compra:`,
    `• Tocador: ${venta.modelo || "—"}`,
    `• Precio total: ${soles(venta.precio_venta)}`,
    `• Abonado: ${soles(abonado)}`,
    `• Saldo pendiente: ${soles(saldo)}`,
    saldo <= 0
      ? "Tu tocador ya está pagado por completo. ¡Gracias por tu compra!"
      : "Quedamos atentos a tu próximo abono. ¡Gracias por tu compra!",
  ];
  return lineas.join("\n");
}

/* ============================================================
 * app.js — lógica principal: sesión, roles, navegación y vistas.
 * ============================================================ */

import { createDB } from "./db.js";
import { sha256Hex } from "./crypto.js";
import {
  soles, fmtFecha, hoyISO, rangoMes, rangoSemana, el, toast, openModal,
  formError, comprimirImagen, TIPOS_VENTA, ESTADOS, MEDIOS,
  CATEGORIAS_GASTO, totalAbonado, saldoRestante, porcentajeAvance,
  enlaceWhatsApp, mensajeEstadoWhatsApp,
} from "./ui.js";
import { exportarExcel } from "./export.js";

const OWNER_TIMEOUT_MS = 5 * 60 * 1000; // el modo dueño se bloquea a los 5 min

const S = {
  db: null,
  supabase: null,
  user: null,          // { email }
  ownerMode: false,
  ownerUnlockedAt: 0,
  tab: "resumen",
  ventaId: null,
  mes: hoyISO().slice(0, 7),
  busqueda: "",
  filtroEstado: "",
};

function norm(t) {
  return (t || "").toString().toLowerCase().trim();
}

/* ---------------- Sesión ---------------- */

function guardarSesion(email) {
  sessionStorage.setItem("gta_session", JSON.stringify({ email }));
}
function leerSesion() {
  try {
    return JSON.parse(sessionStorage.getItem("gta_session") || "null");
  } catch {
    return null;
  }
}
function cerrarSesion() {
  sessionStorage.removeItem("gta_session");
  location.reload();
}

/* ---------------- Modo dueño ---------------- */

function ownerActivo() {
  return S.ownerMode && Date.now() - S.ownerUnlockedAt < OWNER_TIMEOUT_MS;
}

function actualizarBadge() {
  const badge = document.getElementById("mode-badge");
  const tabGastos = document.getElementById("tab-gastos");
  if (ownerActivo()) {
    badge.textContent = "Dueño";
    badge.className = "mode-badge mode-owner";
    tabGastos.hidden = false;
  } else {
    S.ownerMode = false;
    badge.textContent = "Trabajadora";
    badge.className = "mode-badge mode-worker";
    tabGastos.hidden = true;
    if (S.tab === "gastos") S.tab = "resumen";
  }
}

function modalPIN(onSuccess) {
  return (async () => {
    const tienePin = await S.db.ownerPin.hasPin();

    const box = el("div", { class: "pin-box" });
    if (!tienePin) {
      box.append(
        el("h3", { text: "Crear contraseña de dueño" }),
        el("p", { class: "muted", text: "Es la primera vez: crea una contraseña (mínimo 4 caracteres) que solo tú conocerás." })
      );
      const f = el("form", {},
        el("label", {}, "Nueva contraseña", el("input", { type: "password", id: "pin1", required: true, minlength: 4, autocomplete: "new-password" })),
        el("label", {}, "Repite la contraseña", el("input", { type: "password", id: "pin2", required: true, autocomplete: "new-password" })),
        el("div", { class: "modal-actions" },
          el("button", { type: "button", class: "btn btn-ghost", onclick: () => close() }, "Cancelar"),
          el("button", { type: "submit", class: "btn btn-primary" }, "Guardar"))
      );
      f.onsubmit = async (e) => {
        e.preventDefault();
        const p1 = f.querySelector("#pin1").value;
        const p2 = f.querySelector("#pin2").value;
        if (p1.length < 4) return formError(f, "La contraseña debe tener al menos 4 caracteres.");
        if (p1 !== p2) return formError(f, "Las contraseñas no coinciden.");
        await S.db.ownerPin.setHash(await sha256Hex("gta::" + p1));
        S.ownerMode = true;
        S.ownerUnlockedAt = Date.now();
        actualizarBadge();
        close();
        toast("Modo dueño activado");
        onSuccess && onSuccess();
      };
      box.append(f);
    } else {
      box.append(
        el("h3", { text: "Contraseña de dueño" }),
        el("p", { class: "muted", text: "Ingresa tu contraseña para continuar." })
      );
      const f = el("form", {},
        el("label", {}, "Contraseña", el("input", { type: "password", id: "pin", required: true, autocomplete: "current-password" })),
        el("div", { class: "modal-actions" },
          el("button", { type: "button", class: "btn btn-ghost", onclick: () => close() }, "Cancelar"),
          el("button", { type: "submit", class: "btn btn-primary" }, "Desbloquear"))
      );
      f.onsubmit = async (e) => {
        e.preventDefault();
        const hash = await sha256Hex("gta::" + f.querySelector("#pin").value);
        const real = await S.db.ownerPin.getHash();
        if (hash === real) {
          S.ownerMode = true;
          S.ownerUnlockedAt = Date.now();
          actualizarBadge();
          close();
          toast("Modo dueño activado");
          onSuccess && onSuccess();
        } else {
          formError(f, "Contraseña incorrecta.");
        }
      };
      box.append(f);
    }
    const close = openModal(box);
  })();
}

/** Ejecuta la acción solo si el modo dueño está activo; si no, pide el PIN. */
function requiereDueno(fn) {
  return (...args) => {
    if (ownerActivo()) {
      S.ownerUnlockedAt = Date.now();
      return fn(...args);
    }
    modalPIN(() => fn(...args));
  };
}

/* ---------------- Navegación ---------------- */

const view = () => document.getElementById("view");

function render() {
  actualizarBadge();
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === S.tab)
  );
  view().innerHTML = "";
  ({ resumen: renderResumen, ventas: renderVentas, gastos: renderGastos, exportar: renderExportar }[S.tab])();
}

document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    S.tab = t.dataset.tab;
    S.ventaId = null;
    render();
  });
});

document.getElementById("btn-owner-toggle").addEventListener("click", () => {
  if (ownerActivo()) {
    S.ownerMode = false;
    actualizarBadge();
    toast("Modo dueño desactivado");
    render();
  } else {
    modalPIN(() => render());
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  if (S.supabase) await S.supabase.auth.signOut();
  cerrarSesion();
});

/* ---------------- RESUMEN DEL MES ---------------- */

async function renderResumen() {
  const wrap = el("div", { class: "page" });
  const header = el("div", { class: "page-header" },
    el("h2", { text: "Resumen del mes" }),
    el("input", {
      type: "month", value: S.mes, class: "input-inline",
      oninput: (e) => { S.mes = e.target.value; render(); },
    })
  );
  wrap.append(header);

  const [from, to] = rangoMes(S.mes);
  const ventas = (await S.db.ventas.list()).filter(
    (v) => (v.fecha || "").slice(0, 10) >= from && (v.fecha || "").slice(0, 10) <= to && v.estado !== "anulada"
  );
  let cobrado = 0;
  const todasVentas = await S.db.ventas.list();
  const idsAnuladas = new Set(todasVentas.filter((v) => v.estado === "anulada").map((v) => v.id));
  for (const v of todasVentas) {
    if (idsAnuladas.has(v.id)) continue; // lo abonado en anuladas se devolvió: no cuenta como cobrado
    for (const a of await S.db.abonos.listByVenta(v.id)) {
      const f = (a.fecha || "").slice(0, 10);
      if (f >= from && f <= to) cobrado += Number(a.monto) || 0;
    }
  }

  const vendidos = ventas.length;
  const completados = ventas.filter((v) => v.estado === "pagada" || v.estado === "enviada").length;
  const enviados = ventas.filter((v) => v.estado === "enviada").length;

  const cards = el("div", { class: "cards" },
    card("Tocadores vendidos", String(vendidos)),
    card("Completados", String(completados)),
    card("Enviados", String(enviados)),
    card("Cobrado en abonos", soles(cobrado))
  );
  wrap.append(cards);

  if (ownerActivo()) {
    const conCosto = ventas.filter((v) => v.costo != null);
    const gananciaBruta = conCosto.reduce(
      (s, v) => s + ((Number(v.precio_venta) || 0) - (Number(v.costo) || 0)), 0
    );
    const gastos = await S.db.gastos.list(from, to);
    const totalGastos = gastos.reduce((s, g) => s + (Number(g.monto) || 0), 0);
    const neto = gananciaBruta - totalGastos;

    wrap.append(
      el("div", { class: "cards" },
        card("Ganancia bruta", soles(gananciaBruta), `de ${conCosto.length} ventas con costo cargado`),
        card("Gastos del mes", soles(totalGastos)),
        el("div", { class: "card " + (neto > 0 ? "card-ok" : neto < 0 ? "card-bad" : "") },
          el("div", { class: "card-label", text: "Resultado neto del mes" }),
          el("div", { class: "card-value", text: soles(neto) }),
          el("div", { class: "card-sub", text: neto > 0 ? "GANANCIA" : neto < 0 ? "PÉRDIDA" : "EN CERO / SIN RESULTADO" }))
      )
    );

    // Separaciones sin costo cargado (pendientes para el dueño)
    const sinCosto = ventas.filter((v) => v.costo == null && v.estado !== "anulada");
    if (sinCosto.length) {
      wrap.append(el("h3", { text: `Costo pendiente de cargar (${sinCosto.length})` }));
      const ul = el("ul", { class: "list" });
      for (const v of sinCosto) {
        ul.append(el("li", {},
          el("button", { class: "linklike", onclick: () => { S.tab = "ventas"; S.ventaId = v.id; render(); } },
            `${v.nombre} — ${v.modelo || "(sin modelo)"} — ${soles(v.precio_venta)}`)));
      }
      wrap.append(ul);
    }
  } else {
    wrap.append(el("p", { class: "muted", text: "Los costos, gastos y ganancias solo se ven en modo dueño." }));
  }

  // Separaciones activas con saldo (útil en el Live)
  const activas = [];
  for (const v of await S.db.ventas.list()) {
    if (v.estado !== "activa") continue;
    const abs = await S.db.abonos.listByVenta(v.id);
    const ab = totalAbonado(abs);
    if (saldoRestante(v, ab) > 0) activas.push({ v, ab });
  }
  if (activas.length) {
    wrap.append(el("h3", { text: `Abonando (${activas.length})` }));
    const ul = el("ul", { class: "list" });
    for (const { v, ab } of activas) {
      const saldo = saldoRestante(v, ab);
      ul.append(el("li", {},
        el("button", { class: "linklike", onclick: () => { S.tab = "ventas"; S.ventaId = v.id; render(); } },
          `${v.nombre} — saldo ${soles(saldo)} (${porcentajeAvance(v, ab)}%)`)));
    }
    wrap.append(ul);
  }

  view().append(wrap);
}

function card(label, value, sub) {
  return el("div", { class: "card" },
    el("div", { class: "card-label", text: label }),
    el("div", { class: "card-value", text: value }),
    sub ? el("div", { class: "card-sub", text: sub }) : null
  );
}

/* ---------------- VENTAS (lista + buscador) ---------------- */

async function renderVentas() {
  if (S.ventaId) return renderVentaDetalle(S.ventaId);

  const wrap = el("div", { class: "page" });
  const header = el("div", { class: "page-header" },
    el("h2", { text: "Ventas y separaciones" }),
    el("button", { class: "btn btn-primary", onclick: () => modalNuevaVenta() }, "+ Nueva")
  );
  wrap.append(header);

  const searchRow = el("div", { class: "search-row" },
    el("input", {
      type: "search", placeholder: "Buscar por nombre, teléfono o DNI…",
      value: S.busqueda, class: "search-input",
      oninput: (e) => { S.busqueda = e.target.value; renderVentas(); },
    }),
    el("select", { onchange: (e) => { S.filtroEstado = e.target.value; renderVentas(); } },
      el("option", { value: "" }, "Todos los estados"),
      ...Object.entries(ESTADOS).map(([k, v]) => el("option", { value: k, selected: S.filtroEstado === k ? true : null }, v))
    )
  );
  wrap.append(searchRow);

  const todas = await S.db.ventas.list();
  const q = norm(S.busqueda);
  const filtradas = todas.filter((v) => {
    if (S.filtroEstado && v.estado !== S.filtroEstado) return false;
    if (!q) return true;
    return [v.nombre, v.telefono, v.dni].some((x) => norm(x).includes(q));
  });

  if (!filtradas.length) {
    wrap.append(el("p", { class: "muted", text: "No hay registros. Toca «+ Nueva» para registrar la primera venta o separación." }));
  } else {
    const ul = el("ul", { class: "list list-cards" });
    for (const v of filtradas) {
      const abs = await S.db.abonos.listByVenta(v.id);
      const ab = totalAbonado(abs);
      const saldo = saldoRestante(v, ab);
      const waLink = enlaceWhatsApp(v.telefono);
      ul.append(el("li", { class: "sale-card" },
        el("button", { class: "sale-main", onclick: () => { S.ventaId = v.id; render(); } },
          el("div", { class: "sale-top" },
            el("strong", {}, v.nombre || "(sin nombre)"),
            el("span", { class: "badge badge-" + v.estado }, ESTADOS[v.estado] || v.estado)),
          el("div", { class: "sale-sub" },
            `${TIPOS_VENTA[v.tipo] || ""} · ${soles(v.precio_venta)} · saldo ${soles(saldo)}`),
          el("div", { class: "sale-sub muted" }, fmtFecha(v.fecha) + (v.modelo ? " · " + v.modelo : ""))
        ),
        waLink
          ? el("a", { class: "wa-chip", href: waLink, target: "_blank", rel: "noopener" }, "Abrir WhatsApp de la clienta")
          : null
      ));
    }
    wrap.append(ul);
  }
  view().append(wrap);
}

/* ---------------- Nueva / editar venta ---------------- */

function modalNuevaVenta() {
  const f = el("form", { class: "form" });
  f.innerHTML = `
    <h3>Nueva venta / separación</h3>
    <div class="row2">
      <label>Tipo
        <select name="tipo">
          <option value="separacion">Separación (paga en cuotas)</option>
          <option value="directa">Venta directa (paga al contado)</option>
        </select>
      </label>
      <label>Fecha
        <input type="date" name="fecha" value="${hoyISO()}" required />
      </label>
    </div>
    <label>Nombre del cliente <input name="nombre" required maxlength="120" /></label>
    <div class="row2">
      <label>DNI <input name="dni" maxlength="20" inputmode="numeric" /></label>
      <label>Teléfono <input name="telefono" required maxlength="30" inputmode="tel" /></label>
    </div>
    <label>Modelo del tocador (escríbelo libremente)
      <textarea name="modelo" rows="3" placeholder="Ej.: tocador con espejo redondo, luces y 3 cajones" required></textarea>
    </label>
    <div class="row2">
      <label>Precio de venta (S/) <input name="precio_venta" type="number" min="0" step="0.01" required /></label>
      <label>Destino
        <select name="destino_tipo">
          <option value="lima">Lima</option>
          <option value="provincia">Provincia</option>
        </select>
      </label>
    </div>
    <label>Distrito / departamento <input name="destino_lugar" maxlength="120" placeholder="Ej.: Los Olivos / Arequipa" /></label>
    ${ownerActivo() ? `<label>Costo del tocador — proveedor (S/) <input name="costo" type="number" min="0" step="0.01" /></label>` : `<p class="muted">Costo: pendiente — solo dueño</p>`}
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="cancel">Cancelar</button>
      <button type="submit" class="btn btn-primary">Guardar</button>
    </div>`;
  const close = openModal(f);
  f.querySelector("#cancel").onclick = close;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const tipo = fd.get("tipo");
    const row = {
      nombre: fd.get("nombre").trim(),
      dni: fd.get("dni").trim(),
      telefono: fd.get("telefono").trim(),
      tipo,
      modelo: fd.get("modelo").trim(),
      precio_venta: Number(fd.get("precio_venta")) || 0,
      fecha: fd.get("fecha"),
      destino_tipo: fd.get("destino_tipo"),
      destino_lugar: fd.get("destino_lugar").trim(),
      estado: tipo === "directa" ? "pagada" : "activa",
      costo: null,
    };
    if (ownerActivo() && fd.get("costo") !== "") row.costo = Number(fd.get("costo"));
    try {
      const creada = await S.db.ventas.create(row);
      close();
      toast(tipo === "directa" ? "Venta directa registrada" : "Separación registrada");
      S.ventaId = creada.id;
      render();
    } catch (err) {
      formError(f, "No se pudo guardar: " + err.message);
    }
  };
}

const modalEditarVenta = requiereDueno(async (venta) => {
  const f = el("form", { class: "form" });
  f.innerHTML = `
    <h3>Editar venta / separación</h3>
    <label>Nombre del cliente <input name="nombre" required maxlength="120" value="${esc(venta.nombre)}" /></label>
    <div class="row2">
      <label>DNI <input name="dni" maxlength="20" value="${esc(venta.dni)}" /></label>
      <label>Teléfono <input name="telefono" required maxlength="30" value="${esc(venta.telefono)}" /></label>
    </div>
    <label>Modelo del tocador
      <textarea name="modelo" rows="3" required>${esc(venta.modelo)}</textarea>
    </label>
    <div class="row2">
      <label>Precio de venta (S/) <input name="precio_venta" type="number" min="0" step="0.01" required value="${venta.precio_venta ?? ""}" /></label>
      <label>Costo del tocador — proveedor (S/) <input name="costo" type="number" min="0" step="0.01" value="${venta.costo ?? ""}" placeholder="Vacío = pendiente" /></label>
    </div>
    <div class="row2">
      <label>Destino
        <select name="destino_tipo">
          <option value="lima"${venta.destino_tipo === "lima" ? " selected" : ""}>Lima</option>
          <option value="provincia"${venta.destino_tipo === "provincia" ? " selected" : ""}>Provincia</option>
        </select>
      </label>
      <label>Distrito / departamento <input name="destino_lugar" maxlength="120" value="${esc(venta.destino_lugar)}" /></label>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="cancel">Cancelar</button>
      <button type="submit" class="btn btn-primary">Guardar cambios</button>
    </div>`;
  const close = openModal(f);
  f.querySelector("#cancel").onclick = close;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const patch = {
      nombre: fd.get("nombre").trim(),
      dni: fd.get("dni").trim(),
      telefono: fd.get("telefono").trim(),
      modelo: fd.get("modelo").trim(),
      precio_venta: Number(fd.get("precio_venta")) || 0,
      destino_tipo: fd.get("destino_tipo"),
      destino_lugar: fd.get("destino_lugar").trim(),
      costo: fd.get("costo") === "" ? null : Number(fd.get("costo")),
    };
    try {
      await S.db.ventas.update(venta.id, patch);
      close();
      toast("Cambios guardados");
      render();
    } catch (err) {
      formError(f, "No se pudo guardar: " + err.message);
    }
  };
});

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ---------------- Detalle de venta ---------------- */

async function renderVentaDetalle(id) {
  const wrap = el("div", { class: "page" });
  const v = await S.db.ventas.get(id);
  if (!v) {
    S.ventaId = null;
    return renderVentas();
  }
  const abonos = await S.db.abonos.listByVenta(id);
  const abonado = totalAbonado(abonos);
  const saldo = saldoRestante(v, abonado);
  const pct = porcentajeAvance(v, abonado);
  const pagadoCompleto = v.tipo === "directa" || saldo <= 0;

  wrap.append(el("button", { class: "btn btn-ghost btn-sm", onclick: () => { S.ventaId = null; render(); } }, "← Volver"));

  const head = el("div", { class: "detail-head" },
    el("h2", {}, v.nombre || "(sin nombre)"),
    el("span", { class: "badge badge-" + v.estado }, ESTADOS[v.estado] || v.estado)
  );
  wrap.append(head);

  const info = el("div", { class: "info-grid" },
    infoItem("DNI", v.dni || "—"),
    infoItem("Teléfono", v.telefono || "—"),
    infoItem("Tipo", TIPOS_VENTA[v.tipo] || "—"),
    infoItem("Fecha", fmtFecha(v.fecha)),
    infoItem("Destino", (v.destino_tipo === "provincia" ? "Provincia" : "Lima") + (v.destino_lugar ? " — " + v.destino_lugar : "")),
    infoItem("Precio de venta", soles(v.precio_venta)),
    infoItem("Costo (proveedor)", ownerActivo()
      ? (v.costo == null ? "Sin cargar" : soles(v.costo))
      : "Costo: pendiente — solo dueño"),
    infoItem("Modelo", v.modelo || "—", true)
  );
  if (ownerActivo() && v.costo != null && v.estado !== "anulada") {
    info.append(infoItem("Ganancia estimada", soles((Number(v.precio_venta) || 0) - (Number(v.costo) || 0))));
  }
  wrap.append(info);

  if (v.estado === "anulada") {
    wrap.append(el("div", { class: "alert alert-warn" },
      `Separación anulada el ${fmtFecha(v.anulada_fecha)}. Monto devuelto: ${soles(v.devolucion_monto)}. Motivo: ${v.anulada_motivo || "—"}`));
  }

  // ---- Abonos ----
  wrap.append(el("h3", { text: "Abonos" }));
  const prog = el("div", { class: "progress" },
    el("div", { class: "progress-bar", style: `width:${pct}%` })
  );
  wrap.append(prog);
  wrap.append(el("p", { class: "muted" }, `Abonado: ${soles(abonado)} · Saldo restante: ${soles(saldo)} · Avance: ${pct}%`));

  // Botón de WhatsApp con el estado de cuenta listo para enviar a la clienta.
  if (v.estado !== "anulada") {
    const waEstado = enlaceWhatsApp(v.telefono, mensajeEstadoWhatsApp(v, abonado));
    if (waEstado) {
      wrap.append(el("a", {
        class: "btn btn-whatsapp", href: waEstado, target: "_blank", rel: "noopener",
      }, "Enviar estado de cuenta por WhatsApp"));
    }
  }

  if (abonos.length) {
    const ul = el("ul", { class: "list" });
    for (const a of abonos) {
      const imgUrl = a.comprobante ? S.db.storage.url(a.comprobante) : null;
      ul.append(el("li", { class: "abono-row" },
        el("div", {},
          el("strong", {}, soles(a.monto)),
          el("span", { class: "muted" }, ` · ${fmtFecha(a.fecha)} · ${MEDIOS[a.medio] || a.medio}`),
          imgUrl ? el("button", {
            class: "linklike", onclick: () => openModal(el("img", { src: imgUrl, class: "comprobante-full", alt: "Comprobante" }))
          }, " · ver comprobante") : null),
        el("button", { class: "btn btn-ghost btn-sm btn-danger", onclick: requiereDueno(() => borrarAbono(v, a)) }, "Borrar")
      ));
    }
    wrap.append(ul);
  } else {
    wrap.append(el("p", { class: "muted", text: "Aún no hay abonos registrados." }));
  }

  if (v.estado === "activa") {
    wrap.append(formularioAbono(v, saldo));
  }

  // ---- Envío ----
  wrap.append(el("h3", { text: "Envío" }));
  if (!pagadoCompleto) {
    wrap.append(el("div", { class: "alert alert-info" },
      "Los datos de envío se habilitan cuando el tocador esté pagado por completo."));
  } else {
    const ef = el("form", { class: "form inline-form" });
    ef.innerHTML = `
      <div class="row3">
        <label>Costo de envío (S/) <input name="envio_costo" type="number" min="0" step="0.01" value="${v.envio_costo ?? ""}" /></label>
        <label>Fecha de envío <input name="envio_fecha" type="date" value="${(v.envio_fecha || "").slice(0, 10)}" /></label>
        <label>&nbsp;<button type="submit" class="btn btn-secondary">Guardar envío</button></label>
      </div>
      <p class="muted">El envío lo paga el comprador: se registra como dato, no se resta de la ganancia.</p>`;
    ef.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(ef);
      await S.db.ventas.update(v.id, {
        envio_costo: fd.get("envio_costo") === "" ? null : Number(fd.get("envio_costo")),
        envio_fecha: fd.get("envio_fecha") || null,
      });
      toast("Datos de envío guardados");
      render();
    };
    wrap.append(ef);
    if (v.estado === "pagada") {
      wrap.append(el("button", {
        class: "btn btn-primary", onclick: async () => {
          await S.db.ventas.update(v.id, { estado: "enviada" });
          toast("Marcado como enviado");
          render();
        }
      }, "Marcar como enviado"));
    }
  }

  // ---- Acciones de dueño ----
  const actions = el("div", { class: "owner-actions" },
    el("button", { class: "btn btn-ghost", onclick: requiereDueno(() => modalEditarVenta(v)) }, "Editar datos"),
    v.estado !== "anulada"
      ? el("button", { class: "btn btn-ghost btn-danger", onclick: requiereDueno(() => modalAnular(v, abonado)) }, "Anular separación")
      : null
  );
  wrap.append(actions);

  view().append(wrap);
}

function infoItem(label, value, full) {
  return el("div", { class: "info-item" + (full ? " info-full" : "") },
    el("div", { class: "info-label", text: label }),
    el("div", { class: "info-value", text: value })
  );
}

function formularioAbono(v, saldo) {
  const f = el("form", { class: "form inline-form abono-form" });
  f.innerHTML = `
    <h4>Registrar abono</h4>
    <p class="muted">Saldo pendiente: <strong>${soles(saldo)}</strong>. El abono no puede superar ese monto.</p>
    <div class="row3">
      <label>Monto (S/) <input name="monto" type="number" min="0.01" step="0.01" max="${saldo.toFixed(2)}" required /></label>
      <label>Fecha <input name="fecha" type="date" value="${hoyISO()}" required /></label>
      <label>Medio
        <select name="medio">
          <option value="yape">Yape</option>
          <option value="transferencia">Transferencia</option>
          <option value="efectivo">Efectivo</option>
        </select>
      </label>
    </div>
    <label class="file-label">Comprobante (foto de la captura) <span class="req">*</span>
      <input type="file" name="comprobante" accept="image/*" />
    </label>
    <p class="muted" id="nota-comp">Obligatorio para Yape y Transferencia. No se pide en efectivo.</p>
    <button type="submit" class="btn btn-primary">Guardar abono</button>`;

  const medioSel = f.querySelector('select[name="medio"]');
  const fileInput = f.querySelector('input[name="comprobante"]');
  const nota = f.querySelector("#nota-comp");
  medioSel.onchange = () => {
    const req = medioSel.value !== "efectivo";
    fileInput.required = req;
    nota.textContent = req
      ? "Obligatorio para Yape y Transferencia."
      : "En efectivo no se pide comprobante.";
  };
  fileInput.required = true;

  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const medio = fd.get("medio");
    const monto = Number(fd.get("monto"));
    // Validación de saldo: un abono nunca puede superar lo que falta pagar.
    // Se recalcula al momento de guardar, por si hubo cambios recientes.
    try {
      const actuales = await S.db.abonos.listByVenta(v.id);
      const saldoActual = saldoRestante(v, totalAbonado(actuales));
      if (!(monto > 0)) {
        formError(f, "Ingresa un monto válido, mayor a cero.");
        return;
      }
      if (monto - saldoActual > 0.005) {
        formError(f, `El abono de ${soles(monto)} supera el saldo pendiente de ${soles(saldoActual)}. Lo máximo que se puede registrar es el saldo.`);
        return;
      }
    } catch (err) {
      formError(f, "No se pudo verificar el saldo: " + err.message);
      return;
    }
    const file = fd.get("comprobante");
    if (medio !== "efectivo" && (!file || file.size === 0)) {
      formError(f, "Debes subir la imagen del comprobante para Yape o Transferencia.");
      return;
    }
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Guardando…";
    try {
      let comprobante = null;
      if (file && file.size > 0) {
        const dataUrl = await comprimirImagen(file);
        const tmpId = "tmp" + Date.now().toString(36);
        comprobante = await S.db.storage.uploadAbono(dataUrl, v.id, tmpId);
      }
      const creado = await S.db.abonos.create({
        venta_id: v.id,
        fecha: fd.get("fecha"),
        monto,
        medio,
        comprobante,
      });
      // En Supabase renombramos el archivo al id real del abono
      if (comprobante && !S.db.isDemo && file && file.size > 0) {
        try {
          const dataUrl = await comprimirImagen(file);
          const path = await S.db.storage.uploadAbono(dataUrl, v.id, creado.id);
          await S.supabase.from("abonos").update({ comprobante: path }).eq("id", creado.id);
        } catch { /* se conserva el archivo temporal */ }
      }
      toast("Abono registrado");
      render();
    } catch (err) {
      formError(f, "No se pudo guardar: " + err.message);
      btn.disabled = false;
      btn.textContent = "Guardar abono";
    }
  };
  return f;
}

const borrarAbono = requiereDueno(async (venta, abono) => {
  const close = openModal(el("div", {},
    el("h3", { text: "Borrar abono" }),
    el("p", {}, `¿Borrar el abono de ${soles(abono.monto)} del ${fmtFecha(abono.fecha)}? Esta acción queda bajo tu responsabilidad como dueño.`),
    el("div", { class: "modal-actions" },
      el("button", { class: "btn btn-ghost", onclick: () => close() }, "Cancelar"),
      el("button", { class: "btn btn-danger", onclick: async () => {
        await S.db.abonos.remove(abono.id);
        close();
        toast("Abono borrado");
        render();
      } }, "Sí, borrar"))
  ));
});

const modalAnular = requiereDueno(async (v, abonado) => {
  const f = el("form", { class: "form" });
  f.innerHTML = `
    <h3>Anular separación</h3>
    <p>Se registrará la fecha de hoy, el monto devuelto (<strong>${soles(abonado)}</strong> = todo lo abonado) y el motivo. La venta dejará de contar como vendida, pero el registro se conserva.</p>
    <label>Motivo de la anulación <textarea name="motivo" rows="3" required></textarea></label>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="cancel">Cancelar</button>
      <button type="submit" class="btn btn-danger">Anular y registrar devolución</button>
    </div>`;
  const close = openModal(f);
  f.querySelector("#cancel").onclick = close;
  f.onsubmit = async (e) => {
    e.preventDefault();
    await S.db.ventas.update(v.id, {
      estado: "anulada",
      anulada_fecha: hoyISO(),
      anulada_motivo: new FormData(f).get("motivo").trim(),
      devolucion_monto: abonado,
    });
    close();
    toast("Separación anulada con devolución registrada");
    render();
  };
});

/* ---------------- GASTOS (solo dueño) ---------------- */

async function renderGastos() {
  if (!ownerActivo()) {
    S.tab = "resumen";
    return render();
  }
  const wrap = el("div", { class: "page" });
  wrap.append(el("div", { class: "page-header" },
    el("h2", { text: "Gastos" }),
    el("button", { class: "btn btn-primary", onclick: () => modalNuevoGasto() }, "+ Nuevo gasto")
  ));
  const [from, to] = rangoMes(S.mes);
  wrap.append(el("p", { class: "muted", text: `Mostrando gastos de ${S.mes}. Cambia el mes desde la pestaña Resumen.` }));
  const gastos = await S.db.gastos.list(from, to);
  const total = gastos.reduce((s, g) => s + (Number(g.monto) || 0), 0);
  wrap.append(el("p", {}, el("strong", {}, "Total del mes: " + soles(total))));
  if (!gastos.length) {
    wrap.append(el("p", { class: "muted", text: "No hay gastos registrados en este mes." }));
  } else {
    const ul = el("ul", { class: "list" });
    for (const g of gastos) {
      ul.append(el("li", { class: "abono-row" },
        el("div", {},
          el("strong", {}, soles(g.monto)),
          el("span", { class: "muted" }, ` · ${fmtFecha(g.fecha)} · ${g.categoria}`),
          g.concepto ? el("div", { class: "muted" }, g.concepto) : null),
        el("button", { class: "btn btn-ghost btn-sm btn-danger", onclick: async () => {
          if (confirm("¿Borrar este gasto?")) {
            await S.db.gastos.remove(g.id);
            toast("Gasto borrado");
            render();
          }
        } }, "Borrar")
      ));
    }
    wrap.append(ul);
  }
  view().append(wrap);
}

function modalNuevoGasto() {
  const f = el("form", { class: "form" });
  f.innerHTML = `
    <h3>Nuevo gasto</h3>
    <div class="row2">
      <label>Fecha <input type="date" name="fecha" value="${hoyISO()}" required /></label>
      <label>Categoría
        <select name="categoria">${CATEGORIAS_GASTO.map((c) => `<option>${c}</option>`).join("")}</select>
      </label>
    </div>
    <label>Concepto <input name="concepto" maxlength="200" placeholder="Ej.: focos de repuesto para tocador" /></label>
    <label>Monto (S/) <input name="monto" type="number" min="0.01" step="0.01" required /></label>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="cancel">Cancelar</button>
      <button type="submit" class="btn btn-primary">Guardar</button>
    </div>`;
  const close = openModal(f);
  f.querySelector("#cancel").onclick = close;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    await S.db.gastos.create({
      fecha: fd.get("fecha"),
      categoria: fd.get("categoria"),
      concepto: fd.get("concepto").trim(),
      monto: Number(fd.get("monto")),
    });
    close();
    toast("Gasto registrado");
    render();
  };
}

/* ---------------- EXPORTAR ---------------- */

function renderExportar() {
  const wrap = el("div", { class: "page" });
  wrap.append(el("h2", { text: "Exportar a Excel" }));
  wrap.append(el("p", { class: "muted", text: "Descarga las Ventas, Abonos" + (ownerActivo() ? ", Gastos y un Resumen" : "") + " del periodo elegido." }));

  const f = el("form", { class: "form" });
  f.innerHTML = `
    <label>Periodo
      <select name="periodo">
        <option value="hoy">Hoy</option>
        <option value="semana">Esta semana</option>
        <option value="mes">Este mes</option>
        <option value="rango">Rango personalizado</option>
      </select>
    </label>
    <div class="row2" id="rango-fechas" hidden>
      <label>Desde <input type="date" name="desde" value="${hoyISO()}" /></label>
      <label>Hasta <input type="date" name="hasta" value="${hoyISO()}" /></label>
    </div>
    <button type="submit" class="btn btn-primary">Descargar Excel</button>`;
  const sel = f.querySelector('select[name="periodo"]');
  const rangoDiv = f.querySelector("#rango-fechas");
  sel.onchange = () => (rangoDiv.hidden = sel.value !== "rango");

  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const p = fd.get("periodo");
    let from, to, etiqueta;
    if (p === "hoy") {
      from = to = hoyISO();
      etiqueta = "hoy_" + from;
    } else if (p === "semana") {
      [from, to] = rangoSemana();
      etiqueta = "semana_" + from + "_al_" + to;
    } else if (p === "mes") {
      [from, to] = rangoMes(S.mes);
      etiqueta = "mes_" + S.mes;
    } else {
      from = fd.get("desde");
      to = fd.get("hasta");
      etiqueta = "del_" + from + "_al_" + to;
    }
    try {
      await exportarExcel({ db: S.db, esDueno: ownerActivo(), from, to, etiquetaPeriodo: etiqueta });
      toast("Excel descargado");
    } catch (err) {
      toast("Error: " + err.message, 4000);
    }
  };
  wrap.append(f);
  view().append(wrap);
}

/* ---------------- Arranque ---------------- */

function mostrarLogin() {
  const cfg = window.GTA_CONFIG || {};
  const hasCreds = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  document.getElementById("login-form").hidden = !hasCreds;
  document.getElementById("login-demo").hidden = hasCreds;
  document.getElementById("demo-banner").hidden = !(!hasCreds);
}

async function iniciar() {
  const { db, supabase } = createDB();
  S.db = db;
  S.supabase = supabase;
  mostrarLogin();

  const sesion = leerSesion();
  if (sesion) {
    entrar(sesion.email);
    return;
  }

  // Login real (Supabase Auth)
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const pass = document.getElementById("login-pass").value;
    const errBox = document.getElementById("login-error");
    errBox.hidden = true;
    try {
      const { error } = await S.supabase.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      guardarSesion(email);
      entrar(email);
    } catch (err) {
      errBox.textContent = "No se pudo ingresar: " + (err.message || err);
      errBox.hidden = false;
    }
  });

  // Login simulado (modo demostración)
  document.getElementById("btn-demo-login").addEventListener("click", () => {
    const email = document.getElementById("demo-email").value.trim() || "demo@local";
    guardarSesion(email);
    entrar(email);
  });

  // Sesión persistente de Supabase
  if (S.supabase) {
    const { data } = await S.supabase.auth.getSession();
    if (data.session && data.session.user) {
      guardarSesion(data.session.user.email || "usuario");
      entrar(data.session.user.email || "usuario");
    }
  }
}

function entrar(email) {
  S.user = { email };
  document.getElementById("view-login").hidden = true;
  document.getElementById("app").hidden = false;
  document.getElementById("session-user").textContent = email;
  render();
}

iniciar();

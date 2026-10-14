/* ============================================================
 * db.js — capa de datos con dos implementaciones:
 *   - DemoStore: localStorage (modo demostración, sin credenciales)
 *   - SupabaseStore: tablas de Supabase + Auth + Storage
 * Ambas exponen la misma interfaz, así la UI no cambia.
 * ============================================================ */

const LS_PREFIX = "gta_demo_";

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    /* almacenamiento lleno: se ignora en demo */
  }
}
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/* ---------------- Implementación DEMO (localStorage) ---------------- */
function createDemoStore() {
  const read = (k) => lsGet(k, []);
  const write = (k, v) => lsSet(k, v);

  return {
    isDemo: true,

    ventas: {
      async list() {
        return read("ventas").sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
      },
      async get(id) {
        return read("ventas").find((v) => v.id === id) || null;
      },
      async create(data) {
        const row = { id: newId(), created_at: new Date().toISOString(), ...data };
        const all = read("ventas");
        all.push(row);
        write("ventas", all);
        return row;
      },
      async update(id, patch) {
        const all = read("ventas");
        const i = all.findIndex((v) => v.id === id);
        if (i === -1) throw new Error("Venta no encontrada");
        all[i] = { ...all[i], ...patch };
        write("ventas", all);
        return all[i];
      },
    },

    abonos: {
      async listByVenta(ventaId) {
        return read("abonos")
          .filter((a) => a.venta_id === ventaId)
          .sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
      },
      async create(data) {
        // Candado de datos: ningún abono puede superar el saldo pendiente.
        const venta = read("ventas").find((v) => v.id === data.venta_id);
        if (venta) {
          const abonado = read("abonos")
            .filter((a) => a.venta_id === data.venta_id)
            .reduce((s, a) => s + (Number(a.monto) || 0), 0);
          const saldo = (Number(venta.precio_venta) || 0) - abonado;
          if ((Number(data.monto) || 0) - saldo > 0.005) {
            throw new Error(`El abono supera el saldo pendiente (S/ ${saldo.toFixed(2)}).`);
          }
        }
        const row = { id: newId(), created_at: new Date().toISOString(), ...data };
        const all = read("abonos");
        all.push(row);
        write("abonos", all);
        return row;
      },
      async remove(id) {
        write("abonos", read("abonos").filter((a) => a.id !== id));
      },
    },

    gastos: {
      async list(from, to) {
        let all = read("gastos").sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
        if (from) all = all.filter((g) => (g.fecha || "") >= from);
        if (to) all = all.filter((g) => (g.fecha || "") <= to);
        return all;
      },
      async create(data) {
        const row = { id: newId(), created_at: new Date().toISOString(), ...data };
        const all = read("gastos");
        all.push(row);
        write("gastos", all);
        return row;
      },
      async remove(id) {
        write("gastos", read("gastos").filter((g) => g.id !== id));
      },
    },

    ownerPin: {
      async hasPin() {
        return !!lsGet("owner_pin_hash", null);
      },
      async getHash() {
        return lsGet("owner_pin_hash", null);
      },
      async setHash(h) {
        lsSet("owner_pin_hash", h);
      },
    },

    storage: {
      // En demo, el comprobante se guarda como dataURL junto al abono.
      async uploadAbono(_dataUrl, _ventaId, _abonoId) {
        return _dataUrl;
      },
      url(stored) {
        return stored; // ya es un dataURL
      },
    },
  };
}

/* ---------------- Implementación SUPABASE ---------------- */
function createSupabaseStore(client) {
  return {
    isDemo: false,

    ventas: {
      async list() {
        const { data, error } = await client.from("ventas").select("*").order("fecha", { ascending: false });
        if (error) throw error;
        return data;
      },
      async get(id) {
        const { data, error } = await client.from("ventas").select("*").eq("id", id).single();
        if (error) throw error;
        return data;
      },
      async create(row) {
        const { data, error } = await client.from("ventas").insert(row).select().single();
        if (error) throw error;
        return data;
      },
      async update(id, patch) {
        const { data, error } = await client.from("ventas").update(patch).eq("id", id).select().single();
        if (error) throw error;
        return data;
      },
    },

    abonos: {
      async listByVenta(ventaId) {
        const { data, error } = await client
          .from("abonos")
          .select("*")
          .eq("venta_id", ventaId)
          .order("fecha", { ascending: true });
        if (error) throw error;
        return data;
      },
      async create(row) {
        // Candado de datos: ningún abono puede superar el saldo pendiente.
        const { data: venta } = await client
          .from("ventas")
          .select("precio_venta")
          .eq("id", row.venta_id)
          .single();
        if (venta) {
          const { data: abs } = await client.from("abonos").select("monto").eq("venta_id", row.venta_id);
          const abonado = (abs || []).reduce((s, a) => s + (Number(a.monto) || 0), 0);
          const saldo = (Number(venta.precio_venta) || 0) - abonado;
          if ((Number(row.monto) || 0) - saldo > 0.005) {
            throw new Error(`El abono supera el saldo pendiente (S/ ${saldo.toFixed(2)}).`);
          }
        }
        const { data, error } = await client.from("abonos").insert(row).select().single();
        if (error) throw error;
        return data;
      },
      async remove(id) {
        const { error } = await client.from("abonos").delete().eq("id", id);
        if (error) throw error;
      },
    },

    gastos: {
      async list(from, to) {
        let q = client.from("gastos").select("*").order("fecha", { ascending: false });
        if (from) q = q.gte("fecha", from);
        if (to) q = q.lte("fecha", to);
        const { data, error } = await q;
        if (error) throw error;
        return data;
      },
      async create(row) {
        const { data, error } = await client.from("gastos").insert(row).select().single();
        if (error) throw error;
        return data;
      },
      async remove(id) {
        const { error } = await client.from("gastos").delete().eq("id", id);
        if (error) throw error;
      },
    },

    ownerPin: {
      async hasPin() {
        return !!(await this.getHash());
      },
      async getHash() {
        const { data, error } = await client.from("configuracion").select("valor").eq("clave", "owner_pin_hash").maybeSingle();
        if (error) throw error;
        return data ? data.valor : null;
      },
      async setHash(h) {
        const { error } = await client
          .from("configuracion")
          .upsert({ clave: "owner_pin_hash", valor: h }, { onConflict: "clave" });
        if (error) throw error;
      },
    },

    storage: {
      async uploadAbono(dataUrl, ventaId, abonoId) {
        const blob = dataUrlToBlob(dataUrl);
        const path = `abonos/${ventaId}/${abonoId}.jpg`;
        const { error } = await client.storage.from("comprobantes").upload(path, blob, {
          contentType: "image/jpeg",
          upsert: true,
        });
        if (error) throw error;
        return path;
      },
      url(stored) {
        const { data } = client.storage.from("comprobantes").getPublicUrl(stored);
        return data.publicUrl;
      },
    },
  };
}

function dataUrlToBlob(dataUrl) {
  const [head, base64] = dataUrl.split(",");
  const mime = (head.match(/data:(.*?);/) || [])[1] || "image/jpeg";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* ---------------- Fábrica ---------------- */

/**
 * Crea la capa de datos. Si hay credenciales de Supabase, usa Supabase;
 * si no, usa el modo demostración (localStorage).
 * Devuelve { db, supabase }.
 */
export function createDB() {
  const cfg = window.GTA_CONFIG || {};
  const hasCreds = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  if (hasCreds && window.supabase) {
    const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return { db: createSupabaseStore(client), supabase: client };
  }
  return { db: createDemoStore(), supabase: null };
}

/* ============================================================
 * crypto.js — hash SHA-256 para el PIN del dueño
 * El PIN nunca se guarda en texto plano, solo su hash.
 * ============================================================ */

/** Devuelve el hash SHA-256 hexadecimal de un texto. */
export async function sha256Hex(text) {
  if (window.crypto && window.crypto.subtle) {
    const data = new TextEncoder().encode(text);
    const buf = await window.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Respaldo (contexts sin crypto.subtle): hash simple no criptográfico.
  // Solo se usa en entornos muy antiguos; en producción se usa SHA-256.
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

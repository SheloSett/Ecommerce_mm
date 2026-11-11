// Textos del panel de Mercado Libre (MercadoLibreSectionContent.jsx, AdminMercadoLibre.jsx).
// Ver backend/src/services/ml/.

export const MODES = [
  { id: "APAGADO",  label: "Apagado",   help: "No lee ni escribe nada en Mercado Libre." },
  { id: "OBSERVAR", label: "Observar",  help: "Lee Mercado Libre y anota lo que haría, sin cambiar ningún stock." },
  { id: "ACTIVO",   label: "Activo",    help: "Los vínculos activados comparten stock entre la página y Mercado Libre." },
];

const ACCOUNT_STATUS = {
  CONECTADA:    { text: "Conectada", tone: "ok" },
  DESCONECTADA: { text: "Sin conectar", tone: "off" },
  RECONECTAR:   { text: "Hay que volver a conectar", tone: "bad" },
};
export function accountStatus(status) {
  return ACCOUNT_STATUS[status] || { text: status || "Sin conectar", tone: "off" };
}

// Estado de un pozo (una publicación o grupo de publicaciones de Mercado Libre) en el panel.
export function poolStatus(pool) {
  if (!pool?.productId) return { text: "Sin vincular", tone: "off" };
  switch (pool.status) {
    case "REVISAR": return { text: "Para revisar", tone: "bad" };
    case "ERROR":   return { text: "Con error", tone: "bad" };
    case "ROTO":    return { text: "Vínculo roto", tone: "bad" };
    case "CERRADO": return { text: "Publicación cerrada", tone: "warn" };
    default:        return pool.active ? { text: "Compartiendo stock", tone: "ok" } : { text: "Vinculado (sin activar)", tone: "warn" };
  }
}

// ¿Coinciden los números de los dos lados? (solo tiene sentido si está vinculado y se leyó Mercado Libre)
export function numbersMatch(pool) {
  if (!pool?.unit || pool.unit.stockUnlimited || pool.mlQty == null) return null;
  return pool.unit.qty === pool.mlQty;
}

const CYCLE_KINDS = {
  OBSERVA:  "Observado",
  APLICA:   "Copiado a la página",
  ESCRIBE:  "Escrito en Mercado Libre",
  REVISAR:  "Para revisar",
  ERROR:    "Error",
  VINCULO:  "Vínculo activado",
  LECTURA:  "Lectura",
};
export function cycleKind(kind) {
  return CYCLE_KINDS[kind] || kind || "";
}

// Número que el admin escribe al activar o resolver: entero de 0 a 99999. Devuelve el número o null.
export function parseStockNumber(text) {
  const s = String(text ?? "").trim();
  if (!/^\d{1,5}$/.test(s)) return null;
  return parseInt(s, 10);
}

// "hace 5 min", "hace 2 h", "hace 3 días" (o "nunca").
export function since(date, now = new Date()) {
  if (!date) return "nunca";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "nunca";
  const secs = Math.max(0, Math.round((now - d) / 1000));
  if (secs < 60) return "recién";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} días`;
}

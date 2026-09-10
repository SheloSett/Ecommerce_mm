// ─── Registro de eventos de la tienda (búsquedas, vistas, presencia) ───────────
// Todo lo que sale de acá es "fire and forget": nunca bloquea la UI ni muestra errores al visitante.
// Se usa fetch con keepalive para que el evento llegue aunque el usuario cambie de página.
//
// sessionId: id anónimo por navegador, guardado en localStorage. No identifica a la persona; si el
// cliente está logueado se manda además su token y el backend lo asocia a la cuenta.

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const SID_KEY = "igwt_sid";

function randomId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  } catch { /* sin crypto */ }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 10)}`;
}

export function getSessionId() {
  try {
    let sid = localStorage.getItem(SID_KEY);
    if (!sid || !/^[A-Za-z0-9_-]{8,64}$/.test(sid)) {
      sid = randomId();
      localStorage.setItem(SID_KEY, sid);
    }
    return sid;
  } catch {
    // Sin localStorage (modo privado muy estricto): id efímero para esta carga
    if (!window.__igwtSid) window.__igwtSid = randomId();
    return window.__igwtSid;
  }
}

function headers() {
  const h = { "Content-Type": "application/json" };
  try {
    const token = localStorage.getItem("customer_token");
    if (token) h.Authorization = `Bearer ${token}`;
  } catch { /* nada */ }
  return h;
}

function post(path, body) {
  try {
    return fetch(`${API_URL}/api/events${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ ...body, sessionId: getSessionId() }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

// Búsqueda concreta (Enter, lupa o elegir una sugerencia). results = cuántos productos devolvió.
export function trackSearch(term, results) {
  const t = (term || "").trim();
  if (t.length < 2) return;
  post("", { type: "SEARCH", term: t, results: Number.isInteger(results) ? results : undefined });
}

// Vista de la ficha de un producto. Se deduplica por producto dentro de la misma carga de página
// para no contar dos veces un re-render.
const viewed = new Set();
export function trackProductView(productId) {
  const id = Number(productId);
  if (!id || viewed.has(id)) return;
  viewed.add(id);
  post("", { type: "PRODUCT_VIEW", productId: id });
}

// ── Presencia ("estoy mirando tal página") ──
let currentLabel = null;
export function setPresenceLabel(label) {
  currentLabel = label || null;
}

export function pingPresence(path) {
  let isAdmin = false;
  try { isAdmin = !!localStorage.getItem("admin_token"); } catch { /* nada */ }
  post("/ping", { path: path || window.location.pathname, label: currentLabel, isAdmin });
}

// ─── Eventos de la tienda + presencia en vivo ─────────────────────────────────
// Endpoints PÚBLICOS que llama el storefront:
//   POST /api/events       → guarda una búsqueda o una vista de producto en store_events
//   POST /api/events/ping  → "sigo acá": mantiene en memoria quién está mirando qué página
//
// La presencia NO se guarda en la base: es un mapa en memoria del proceso (sessionId → última
// señal). Cada visitante manda un ping al cambiar de página y cada ~25 s; si pasan más de
// PRESENCE_TTL_MS sin señal, se lo da por ido. Se reinicia con el backend, y eso está bien: es una
// foto del momento, no un histórico.
//
// El id de cliente NO se toma del body: si el navegador manda el token del cliente, se verifica y
// se usa; si no, el visitante es anónimo. Así nadie puede "firmar" eventos como otro cliente.
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");

const prisma = new PrismaClient();

const PRESENCE_TTL_MS = 75 * 1000;
const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;
const EVENT_TYPES = new Set(["SEARCH", "PRODUCT_VIEW"]);

// sessionId → { sessionId, customerId, customerName, customerEmail, customerType, path, label,
//               device, isAdmin, firstSeen, lastSeen }
const presence = new Map();

function customerFromReq(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    if (decoded?.role !== "CUSTOMER") return null;
    return { id: decoded.id, name: decoded.name, email: decoded.email, type: decoded.type };
  } catch {
    return null;
  }
}

function deviceFromUa(ua = "") {
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "celular";
  return "escritorio";
}

function cleanStr(v, max) {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s.length ? s : null;
}

// POST /api/events
async function track(req, res) {
  try {
    const { type, sessionId, productId, term, results } = req.body || {};
    if (!EVENT_TYPES.has(type)) return res.status(400).json({ error: "Tipo de evento inválido" });
    if (!SESSION_RE.test(sessionId || "")) return res.status(400).json({ error: "sessionId inválido" });
    const customer = customerFromReq(req);

    const data = { type, sessionId, customerId: customer?.id ?? null };
    if (type === "SEARCH") {
      const t = cleanStr(term, 100);
      if (!t) return res.status(400).json({ error: "Falta el término" });
      data.term = t.toLowerCase().replace(/\s+/g, " ");
      data.results = Number.isInteger(results) && results >= 0 ? Math.min(results, 100000) : null;
    } else {
      const pid = Number(productId);
      if (!Number.isInteger(pid) || pid <= 0) return res.status(400).json({ error: "productId inválido" });
      data.productId = pid;
    }
    await prisma.storeEvent.create({ data });
    res.status(201).json({ ok: true });
  } catch (err) {
    // Un producto borrado entre la vista y el registro no tiene que romper nada (no hay FK a propósito).
    console.error("events.track error:", err);
    res.status(500).json({ error: "No se pudo registrar el evento" });
  }
}

// POST /api/events/ping
function ping(req, res) {
  const { sessionId, path, label, isAdmin } = req.body || {};
  if (!SESSION_RE.test(sessionId || "")) return res.status(400).json({ error: "sessionId inválido" });
  const now = Date.now();
  const customer = customerFromReq(req);
  const prev = presence.get(sessionId);
  presence.set(sessionId, {
    sessionId,
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? null,
    customerEmail: customer?.email ?? null,
    customerType: customer?.type ?? null,
    path: cleanStr(path, 200) || "/",
    label: cleanStr(label, 120),
    device: deviceFromUa(req.headers["user-agent"]),
    isAdmin: isAdmin === true,
    firstSeen: prev?.firstSeen ?? now,
    lastSeen: now,
  });
  // Limpieza oportunista: cada tanto se barren las sesiones vencidas
  if (presence.size > 200 || Math.random() < 0.05) sweep(now);
  res.json({ ok: true });
}

function sweep(now = Date.now()) {
  for (const [k, v] of presence) if (now - v.lastSeen > PRESENCE_TTL_MS) presence.delete(k);
}

// Lo consume analytics.controller (GET /api/analytics/en-vivo, admin)
function livePresence() {
  const now = Date.now();
  sweep(now);
  return Array.from(presence.values())
    .map((p) => ({ ...p, secondsOnSite: Math.round((now - p.firstSeen) / 1000), secondsSinceSeen: Math.round((now - p.lastSeen) / 1000) }))
    .sort((a, b) => a.firstSeen - b.firstSeen);
}

module.exports = { track, ping, livePresence, PRESENCE_TTL_MS };

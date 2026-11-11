// Mercado Libre en el panel: conexión de la cuenta, modo, publicaciones y vínculos. Ver services/ml/.
// Ninguna respuesta trae tokens ni claves.
const crypto = require("crypto");

const prisma = require("../lib/prisma");
const { actorOf } = require("../services/stock.service");
const { mlConfig, missingForConnect } = require("../services/ml/mlConfig");
const mlAuth = require("../services/ml/mlAuth");
const mlPools = require("../services/ml/mlPools");
const { refreshListings, isRefreshing } = require("../services/ml/mlListings");
const mlWorker = require("../services/ml/mlWorker");

const MODES = new Set(["APAGADO", "OBSERVAR", "ACTIVO"]);

function send(res, r) {
  if (r && r.ok === false) return res.status(r.status || 400).json({ error: r.error });
  return res.json(r);
}

// ─── Cuenta ─────────────────────────────────────────────────────────────────

async function getStatus(req, res) {
  try {
    const cfg = mlConfig();
    const account = await prisma.mlAccount.findUnique({ where: { id: mlAuth.ACCOUNT_ID } });
    const pools = await prisma.mlPool.findMany({ where: { productId: { not: null } } });
    const count = (pred) => pools.filter(pred).length;
    res.json({
      enabled:        cfg.enabled,
      missing:        missingForConnect(cfg),
      webhookReady:   cfg.webhookToken.length >= 24,
      status:         account?.status || "DESCONECTADA",
      mode:           account?.mode || "APAGADO",
      nickname:       account?.nickname || null,
      connectedAt:    account?.connectedAt || null,
      connectedBy:    account?.connectedBy || null,
      pausedUntil:    account?.pausedUntil || null,
      lastWebhookAt:  account?.lastWebhookAt || null,
      lastPassAt:     account?.lastPassAt || null,
      lastRefreshAt:  account?.lastRefreshAt || null,
      lastError:      account?.lastError || null,
      lastErrorAt:    account?.lastErrorAt || null,
      listingsAt:     account?.listingsAt || null,
      listingsResult: account?.listingsResult || null,
      refreshing:     isRefreshing(),
      pools: {
        linked:  pools.length,
        active:  count((p) => p.active),
        review:  count((p) => p.status === "REVISAR"),
        errors:  count((p) => ["ERROR", "ROTO", "CERRADO"].includes(p.status)),
      },
    });
  } catch (err) {
    console.error("ml getStatus:", err);
    res.status(500).json({ error: "No se pudo leer el estado de Mercado Libre" });
  }
}

async function startOAuth(req, res) {
  try {
    send(res, await mlAuth.startOAuth({ user: req.user }));
  } catch (err) {
    console.error("ml startOAuth:", err.message);
    res.status(500).json({ error: "No se pudo empezar la conexión" });
  }
}

async function exchangeOAuth(req, res) {
  try {
    const { code, state } = req.body || {};
    send(res, await mlAuth.exchangeOAuth({ user: req.user, code, state, actor: actorOf(req.user) }));
  } catch (err) {
    console.error("ml exchangeOAuth:", err.message);
    res.status(500).json({ error: "No se pudo completar la conexión" });
  }
}

async function disconnect(req, res) {
  try {
    send(res, await mlAuth.disconnect());
  } catch (err) {
    console.error("ml disconnect:", err.message);
    res.status(500).json({ error: "No se pudo desconectar" });
  }
}

async function updateSettings(req, res) {
  try {
    const mode = String(req.body?.mode || "");
    if (!MODES.has(mode)) return res.status(400).json({ error: "Modo inválido" });
    await mlAuth.ensureAccount();
    await prisma.mlAccount.update({ where: { id: mlAuth.ACCOUNT_ID }, data: { mode } });
    if (mode !== "APAGADO") mlWorker.kick();
    res.json({ ok: true, mode });
  } catch (err) {
    console.error("ml updateSettings:", err.message);
    res.status(500).json({ error: "No se pudo guardar" });
  }
}

// ─── Publicaciones y vínculos ───────────────────────────────────────────────

async function refresh(req, res) {
  const running = isRefreshing();
  const job = refreshListings();
  // No se espera: con muchas publicaciones tarda más que el tiempo de espera del panel.
  job.catch(() => {});
  res.status(202).json({ ok: true, started: !running });
}

function wrap(fn) {
  return async (req, res) => {
    try {
      send(res, await fn(req));
    } catch (err) {
      console.error("ml:", err);
      res.status(500).json({ error: "Error inesperado" });
    }
  };
}

const listPools    = wrap(async () => ({ ok: true, pools: await mlPools.listPools() }));
const searchUnits  = wrap(async (req) => ({ ok: true, units: await mlPools.searchUnits(req.query.q) }));
const linkPool     = wrap((req) => mlPools.linkPool(req.params.id, req.body || {}, actorOf(req.user)));
const unlinkPool   = wrap((req) => mlPools.unlinkPool(req.params.id));
const activatePool = wrap((req) => mlPools.activatePool(req.params.id, req.body || {}, actorOf(req.user)));
const resolvePool  = wrap((req) => mlPools.resolvePool(req.params.id, req.body || {}, actorOf(req.user)));
const deactivate   = wrap((req) => mlPools.deactivatePool(req.params.id));
const checkPool    = wrap((req) => mlPools.checkPool(req.params.id));
const poolCycles   = wrap((req) => mlPools.poolCycles(req.params.id));

// ─── Avisos de Mercado Libre (público) ──────────────────────────────────────
// Mercado Libre no firma sus avisos: la dirección lleva una clave (ML_WEBHOOK_TOKEN). Sin la clave
// correcta responde 404 sin tocar la base. Con la clave, responde 200 enseguida (Mercado Libre pide
// menos de 500 ms) y recién después marca qué hay que releer. Nunca se confía en el contenido del aviso:
// solo dice QUÉ mirar; el número se le vuelve a pedir a la API.

function tokenMatches(given, expected) {
  if (typeof given !== "string" || !expected || expected.length < 24) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const STOCK_TOPICS = new Set(["stock-location", "stock-locations", "stock_locations"]);
let lastWebhookNoted = 0;

async function handleNotification(body, { cfg = mlConfig(), now = new Date() } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ignored: "formato" };
  const topic = typeof body.topic === "string" ? body.topic : "";
  const resource = typeof body.resource === "string" ? body.resource : "";
  if (String(body.user_id ?? "") !== cfg.expectedUserId) return { ignored: "usuario" };

  let where = null;
  let m;
  if (topic === "items" && (m = resource.match(/^\/items\/(MLA\d{6,15})$/))) {
    const listings = await prisma.mlListing.findMany({ where: { itemId: m[1] } });
    const ids = [...new Set(listings.map((l) => l.poolId).filter(Boolean))];
    if (ids.length) where = { id: { in: ids } };
  } else if (STOCK_TOPICS.has(topic) && (m = resource.match(/^\/user-products\/(MLAU\d{3,20})\/stock$/))) {
    where = { userProductId: m[1] };
  } else if (topic !== "orders_v2") {
    return { ignored: "tópico" };
  }

  if (now.getTime() - lastWebhookNoted > 60 * 1000) {
    lastWebhookNoted = now.getTime();
    await prisma.mlAccount.updateMany({ where: { id: mlAuth.ACCOUNT_ID }, data: { lastWebhookAt: now } });
  }
  if (!where) return { marked: 0 };
  const r = await prisma.mlPool.updateMany({ where: { ...where, productId: { not: null } }, data: { dirty: true } });
  if (r.count) mlWorker.kick();
  return { marked: r.count };
}

// Va antes de leer el cuerpo: sin la clave correcta no se lee nada ni se toca la base.
function webhookGate(req, res, next) {
  const cfg = mlConfig();
  if (!cfg.enabled || !tokenMatches(req.params.token, cfg.webhookToken)) {
    return res.status(404).json({ error: "Ruta no encontrada" });
  }
  next();
}

function webhook(req, res) {
  const cfg = mlConfig();
  if (!cfg.enabled || !tokenMatches(req.params.token, cfg.webhookToken)) {
    return res.status(404).json({ error: "Ruta no encontrada" });
  }
  res.status(200).json({ ok: true });
  return handleNotification(req.body, { cfg }).catch((err) => console.error("[mercadolibre] aviso:", err.message));
}

module.exports = {
  getStatus, startOAuth, exchangeOAuth, disconnect, updateSettings,
  refresh, listPools, searchUnits, linkPool, unlinkPool, activatePool, resolvePool, deactivate, checkPool, poolCycles,
  webhook, webhookGate, handleNotification, tokenMatches,
};

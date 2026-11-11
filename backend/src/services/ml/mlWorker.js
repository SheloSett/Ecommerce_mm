// Trabajador de la sincronización con Mercado Libre: decide qué unidades revisar y las pasa de a una
// por mlSync.syncUnit. Corre dentro del backend (un solo proceso), de a una pasada por vez.
//
// Qué despierta una pasada:
//   - un cambio de stock en la página (stock.onCommitted): marca los pozos activos de esa unidad;
//   - un aviso de Mercado Libre (webhook): marca los pozos de esa publicación;
//   - el tick de cron cada minuto: lo marcado, los reintentos vencidos (nextAttemptAt) y un barrido que
//     relee unos pocos pozos por minuto, de modo que todos se revisen cada ~25 minutos aunque se pierda
//     un aviso.
// La cola vive en la base (dirty y nextAttemptAt en ml_pools): un reinicio no pierde nada.
const prisma = require("../../lib/prisma");
const stock = require("../stock.service");
const { mlConfig } = require("./mlConfig");
const { syncUnit, makeCtx, FROZEN } = require("./mlSync");
const { ACCOUNT_ID } = require("./mlAuth");

const ML_REASONS = new Set([stock.REASONS.VENTA_ML, stock.REASONS.CAMBIO_ML]);
const SWEEP_EVERY_MS = 60 * 1000;
const SWEEP_ROUND_MIN = 25;
const KEEP_CYCLES_DAYS = 90;

let running = null;
let again = false;
// Contexto por defecto de las pasadas que despiertan los oyentes y el cron (los tests ponen acá su
// reloj y su Mercado Libre simulado).
let defaults = {};
function configure(ctx = {}) {
  defaults = ctx;
}

// Pozos que entran en una pasada según el modo: en OBSERVAR los activos quedan congelados.
function poolFilter(mode) {
  const base = { productId: { not: null }, status: { notIn: [...FROZEN] } };
  return mode === "ACTIVO" ? base : { ...base, active: false };
}

async function runPass(rawCtx = {}) {
  const ctx = makeCtx(rawCtx);
  if (!ctx.cfg.enabled) return { skipped: "deshabilitado" };
  const account = await prisma.mlAccount.findUnique({ where: { id: ACCOUNT_ID } });
  if (!account || account.status !== "CONECTADA" || account.mode === "APAGADO") return { skipped: "apagado" };
  const now = ctx.now();
  if (account.pausedUntil && account.pausedUntil > now) return { skipped: "frenada" };

  const where = poolFilter(account.mode);
  const due = await prisma.mlPool.findMany({ where: { ...where, OR: [{ dirty: true }, { nextAttemptAt: { lte: now } }] } });

  let sweep = [];
  if (!account.lastSweepAt || now - account.lastSweepAt >= SWEEP_EVERY_MS) {
    const linked = await prisma.mlPool.findMany({ where });
    const batch = Math.max(1, Math.ceil(linked.length / SWEEP_ROUND_MIN));
    sweep = linked
      .sort((a, b) => (a.lastReadAt ? new Date(a.lastReadAt).getTime() : 0) - (b.lastReadAt ? new Date(b.lastReadAt).getTime() : 0))
      .slice(0, batch);
    await prisma.mlAccount.update({ where: { id: ACCOUNT_ID }, data: { lastSweepAt: now } });
  }

  const units = new Map();
  for (const p of [...due, ...sweep]) {
    const key = `${p.productId}:${p.variantId ?? ""}`;
    if (!units.has(key)) units.set(key, { productId: p.productId, variantId: p.variantId ?? null });
  }

  const results = [];
  let stopped = null;
  for (const unit of units.values()) {
    let r;
    try {
      r = await syncUnit(unit, ctx);
    } catch (err) {
      // Un error inesperado en una unidad no frena a las demás; queda en el log y en la cuenta.
      console.error("[mercadolibre] error en la pasada de", unit, err);
      await prisma.mlAccount.update({ where: { id: ACCOUNT_ID }, data: { lastError: String(err?.message || err).slice(0, 300), lastErrorAt: ctx.now() } }).catch(() => {});
      r = { error: true };
    }
    results.push(r);
    if (r?.stopped || r?.skipped === "frenada" || r?.skipped === "token") { stopped = r.stopped || r.skipped; break; }
  }

  await prisma.mlAccount.update({
    where: { id: ACCOUNT_ID },
    // El freno crece con cada 429 seguido (1, 2, 4... minutos): solo vuelve a cero con una pasada que no
    // fue frenada.
    data: { lastPassAt: ctx.now(), ...(stopped === "rate_limit" || stopped === "frenada" ? {} : { pauseLevel: 0 }) },
  });
  return { units: units.size, stopped, results };
}

// Pide una pasada. Si ya hay una corriendo, se hace otra apenas termine (los avisos que llegaron
// mientras tanto ya dejaron su marca en la base). Devuelve la promesa de la pasada.
function kick(override = {}) {
  const ctx = { ...defaults, ...override };
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let last;
    do {
      again = false;
      last = await runPass(ctx);
    } while (again);
    return last;
  })()
    .catch((err) => { console.error("[mercadolibre] la pasada falló:", err); })
    .finally(() => { running = null; });
  return running;
}

// ─── Oyentes ────────────────────────────────────────────────────────────────

// Cambio de stock en la página: marcar los pozos activos de esas unidades. Lo que vino de Mercado
// Libre (VENTA_ML, CAMBIO_ML) no despierta a nadie: lo aplicó el propio motor.
async function onStockCommitted(units, cfg = defaults.cfg || mlConfig()) {
  if (!cfg.enabled) return;
  const relevant = units.filter((u) => !u.reasons?.length || u.reasons.some((r) => !ML_REASONS.has(r)));
  if (!relevant.length) return;
  const r = await prisma.mlPool.updateMany({
    where: { active: true, OR: relevant.map((u) => ({ productId: u.productId, variantId: u.variantId ?? null })) },
    data:  { dirty: true },
  });
  if (r.count) kick();
}

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  stock.onCommitted((units) => onStockCommitted(units).catch((err) => console.error("[mercadolibre] no se pudo marcar el cambio en la página:", err.message)));
}

// Tick de cron (cada minuto) y limpieza diaria de la bitácora.
async function tick() {
  if (!(defaults.cfg || mlConfig()).enabled) return;
  await kick();
}

async function cleanup(now = new Date()) {
  const before = new Date(now.getTime() - KEEP_CYCLES_DAYS * 24 * 60 * 60 * 1000);
  return prisma.mlCycle.deleteMany({ where: { createdAt: { lt: before } } });
}

module.exports = { runPass, kick, tick, cleanup, install, configure, onStockCommitted, poolFilter };

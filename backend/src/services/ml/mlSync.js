// Motor de la sincronización de stock con Mercado Libre: una pasada por unidad de la página (producto
// sin variantes, o variante), con todos sus pozos. Las reglas están en mlRules.js; acá se lee, se aplica
// y se escribe.
//
// Una pasada:
//   1. Lee cada pozo de la unidad en Mercado Libre (fuera de cualquier transacción).
//   2. En UNA transacción, con la fila de la unidad bloqueada: aplica a la página lo que cambió en
//      Mercado Libre (como movimientos VENTA_ML / CAMBIO_ML del historial) y guarda el estado de cada pozo.
//   3. Si la página quedó con otro número que Mercado Libre, se lo escribe, pero solo si el pozo está
//      quieto: relee justo antes y, si cambió algo, lo deja para la próxima pasada. Antes de llamar deja
//      anotado qué va a escribir, así un corte en el medio se puede cerrar después (ver mlRules.js).
//
// Pozos según su estado:
//   - activo (comparte stock): se sincroniza en modo ACTIVO; en OBSERVAR y APAGADO queda congelado (no
//     se lee), así al volver a ACTIVO aplica todo lo que pasó en el medio.
//   - vinculado sin activar: solo se observa (se anota en la bitácora lo que habría pasado).
//   - REVISAR, ROTO, CERRADO: frenado hasta que alguien lo resuelva desde el panel.
//   - ERROR: se sigue leyendo y copiando lo de Mercado Libre, pero no se le escribe.
// Nada de esto corre sin ML_SYNC_ENABLED=1 (lo controla mlAuth.getAccessToken).
const prisma = require("../../lib/prisma");
const stock = require("../stock.service");
const { reportError } = require("../errorAlerts.service");
const rules = require("./mlRules");
const adapter = require("./mlAdapter");
const { getAccessToken, ACCOUNT_ID } = require("./mlAuth");
const { mlConfig } = require("./mlConfig");
const { DbNull } = require("./mlJson");

const ACTOR = "Mercado Libre";
const FROZEN = new Set(["REVISAR", "ROTO", "CERRADO"]);

// Candado de los pozos: una pasada de una unidad y las acciones del panel sobre un pozo (activar,
// vincular, resolver) corren de a una. Sin esto, una pasada que leyó el pozo antes de que el admin lo
// activara podía guardar encima un estado viejo. Es en memoria porque el backend es un solo proceso.
// El trabajador lo toma de a una unidad, así una acción del panel espera como mucho esa unidad.
let lockChain = Promise.resolve();
function withLock(fn) {
  const run = lockChain.then(() => fn());
  lockChain = run.catch(() => {});
  return run;
}

function makeCtx(ctx = {}) {
  return { now: () => new Date(), fetchImpl: undefined, sleep: null, cfg: mlConfig(), opts: rules.DEFAULTS, ...ctx };
}

function backoffMs(attempts) {
  return Math.min(30 * 60 * 1000, 30 * 1000 * 2 ** Math.max(0, attempts - 1));
}

const clip = (text, max = 300) => (text == null ? null : String(text).slice(0, max));
const unitLabel = (unit) => (unit.variantId ? `variante #${unit.variantId} del producto #${unit.productId}` : `producto #${unit.productId}`);

async function log(db, poolId, kind, data = {}) {
  await db.mlCycle.create({ data: { poolId, kind, ...data, detail: clip(data.detail, 500), result: clip(data.result, 120) } });
}

async function noteAccountError(message, ctx) {
  await prisma.mlAccount.update({ where: { id: ACCOUNT_ID }, data: { lastError: clip(message), lastErrorAt: ctx.now() } });
}

// 429: se frena TODA la cuenta un rato, cada vez más largo (1, 2, 4... minutos, hasta una hora).
async function brake(ctx, retryAfterMs) {
  const account = await prisma.mlAccount.findUnique({ where: { id: ACCOUNT_ID } });
  const level = (account?.pauseLevel || 0) + 1;
  const wait = Math.min(60 * 60 * 1000, Math.max(retryAfterMs || 0, 60 * 1000 * 2 ** (level - 1)));
  await prisma.mlAccount.update({
    where: { id: ACCOUNT_ID },
    data: { pauseLevel: level, pausedUntil: new Date(ctx.now().getTime() + wait), lastError: "Mercado Libre pidió bajar el ritmo (429): se frena un rato", lastErrorAt: ctx.now() },
  });
}

// Qué hacer con un pozo que no se pudo leer. Devuelve true si hay que cortar toda la pasada.
async function readFailed(pool, r, ctx) {
  const now = ctx.now();
  if (r.kind === "rate_limit") { await brake(ctx, r.retryAfterMs); return true; }
  if (r.kind === "auth" || r.kind === "not_connected" || r.kind === "disabled") { await noteAccountError(r.message, ctx); return true; }
  if (r.kind === "closed") {
    await prisma.mlPool.update({ where: { id: pool.id }, data: { status: "CERRADO", lastError: clip(r.message), nextAttemptAt: null } });
    await log(prisma, pool.id, "ERROR", { result: "CERRADO", detail: r.message });
    return false;
  }
  if (r.kind === "foreign" || r.kind === "regrouped") {
    await prisma.mlPool.update({
      where: { id: pool.id },
      data: { status: "REVISAR", lastError: clip(r.message), review: { reason: r.message, at: now.toISOString() }, nextAttemptAt: null },
    });
    await log(prisma, pool.id, "REVISAR", { result: r.kind, detail: r.message });
    reportError("mercadolibre", `Pozo ${pool.key} frenado: ${r.message}`);
    return false;
  }
  // Corte, error de Mercado Libre, respuesta rara o publicaciones que no coinciden: reintentar más tarde.
  const attempts = (pool.attempts || 0) + 1;
  await prisma.mlPool.update({
    where: { id: pool.id },
    data: { attempts, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)), lastError: clip(r.message) },
  });
  if (attempts === 6) reportError("mercadolibre", `No se puede leer el pozo ${pool.key} hace rato: ${r.message}`);
  return false;
}

// Lee un pozo, renovando el token una vez si Mercado Libre dice que no sirve.
async function readOne(pool, account, tokenBox, ctx) {
  const members = await prisma.mlListing.findMany({ where: { poolId: pool.id } });
  const args = { pool, members, expectedUserId: account.mlUserId, fetchImpl: ctx.fetchImpl, sleep: ctx.sleep };
  let r = await adapter.readPool({ token: tokenBox.token, ...args });
  if (!r.ok && r.kind === "auth") {
    const again = await getAccessToken({ now: ctx.now, cfg: ctx.cfg, fetchImpl: ctx.fetchImpl, force: true });
    if (!again.ok) return again;
    tokenBox.token = again.token;
    r = await adapter.readPool({ token: tokenBox.token, ...args });
  }
  return r;
}

// Stock actual de la unidad: { qty, unlimited }, o { missing } si no existe o el producto tiene variantes.
async function webStock(unit, db = prisma) {
  if (unit.variantId) {
    const v = await db.productVariant.findUnique({ where: { id: unit.variantId } });
    if (!v || v.productId !== unit.productId) return { missing: true };
    return { qty: v.stock, unlimited: !!v.stockUnlimited };
  }
  const p = await db.product.findUnique({ where: { id: unit.productId } });
  if (!p) return { missing: true };
  const variants = await db.productVariant.count({ where: { productId: unit.productId } });
  if (variants > 0) return { missing: true, reason: "El producto ahora tiene variantes: hay que vincular cada variante" };
  return { qty: p.stock, unlimited: !!p.stockUnlimited };
}

/**
 * Una pasada para una unidad ({ productId, variantId }). ctx: { now, fetchImpl, sleep, cfg, opts }.
 * Devuelve un resumen para la bitácora del trabajador y los tests.
 */
function syncUnit(unit, rawCtx = {}) {
  return withLock(() => syncUnitLocked(unit, makeCtx(rawCtx)));
}

async function syncUnitLocked(unit, ctx) {
  const account = await prisma.mlAccount.findUnique({ where: { id: ACCOUNT_ID } });
  if (!account || account.mode === "APAGADO" || account.status !== "CONECTADA") return { skipped: "apagado" };
  if (account.pausedUntil && account.pausedUntil > ctx.now()) return { skipped: "frenada" };

  const pools = await prisma.mlPool.findMany({ where: { productId: unit.productId, variantId: unit.variantId ?? null } });
  const open = pools.filter((p) => !FROZEN.has(p.status));
  const syncing = account.mode === "ACTIVO" ? open.filter((p) => p.active) : [];
  const observed = open.filter((p) => !p.active);
  const all = [...syncing, ...observed];
  if (!all.length) return { skipped: "sin_pozos" };

  // Se baja la marca al empezar: un aviso que llegue durante la pasada vuelve a marcar y no se pierde.
  await prisma.mlPool.updateMany({ where: { id: { in: all.map((p) => p.id) } }, data: { dirty: false } });

  const t = await getAccessToken({ now: ctx.now, cfg: ctx.cfg, fetchImpl: ctx.fetchImpl });
  if (!t.ok) { await noteAccountError(t.message, ctx); return { skipped: "token" }; }
  const tokenBox = { token: t.token };

  // 1. Leer.
  const reads = new Map();
  for (const pool of all) {
    const r = await readOne(pool, account, tokenBox, ctx);
    if (!r.ok) {
      if (await readFailed(pool, r, ctx)) return { stopped: r.kind };
      continue;
    }
    reads.set(pool.id, { snap: { qty: r.qty, sold: r.sold }, target: r.target });
  }

  const summary = { observed: 0, applied: 0, written: 0, waiting: 0, review: 0 };

  // 2a. Los que solo se observan: bitácora y nada más.
  for (const pool of observed) {
    const rd = reads.get(pool.id);
    if (!rd) continue;
    const now = ctx.now();
    const o = rules.observe(pool, rd.snap);
    if (o.changed) {
      const web = await webStock(unit);
      const webBefore = Number.isInteger(web.qty) ? web.qty : null;
      await log(prisma, pool.id, "OBSERVA", {
        readQty: rd.snap.qty, delta: o.dq, webBefore,
        webAfter: webBefore !== null && !web.unlimited ? Math.max(0, webBefore + o.dq) : null,
        detail: `Mercado Libre: ${pool.agreed} → ${rd.snap.qty}` + (o.ds ? ` (vendidos +${o.ds})` : "") + ". Sin escribir: el vínculo no está activo.",
      });
      summary.observed++;
    }
    await prisma.mlPool.update({
      where: { id: pool.id },
      data: { agreed: rd.snap.qty, agreedSold: rd.snap.sold, ...rules.afterRead(pool, rd.snap, now), attempts: 0, lastError: null, nextAttemptAt: null, lastSyncAt: now },
    });
  }

  // 2b. Los que comparten stock: decidir y aplicar en una transacción.
  const now = ctx.now();
  const plans = [];
  for (const pool of syncing) {
    const rd = reads.get(pool.id);
    if (!rd) continue;
    plans.push({ pool, ...rd, d: rules.decide(pool, rd.snap, now, ctx.opts), book: rules.afterRead(pool, rd.snap, now) });
  }
  if (!plans.length) return summary;

  const outcome = await stock.transaction(async (tx) => {
    await stock.lockUnits(tx, [unit]);
    const web = await webStock(unit, tx);
    if (web.missing) {
      for (const p of plans) {
        await tx.mlPool.update({ where: { id: p.pool.id }, data: { status: "ROTO", lastError: web.reason || `Ya no existe la ${unitLabel(unit)}`, nextAttemptAt: null } });
        await log(tx, p.pool.id, "ERROR", { result: "ROTO", detail: web.reason || "La unidad vinculada ya no existe" });
      }
      return { broken: true };
    }

    const unitArgs = { productId: unit.productId, variantId: unit.variantId ?? undefined };
    const keys = plans.map((p) => p.pool.key).join(",");
    let current = web.qty;
    let shortfall = 0;
    const sales = plans.reduce((s, p) => s + (p.d.kind === "apply" ? p.d.sales : 0), 0);
    const other = plans.reduce((s, p) => s + (p.d.kind === "apply" ? p.d.other : 0), 0);
    const conservative = plans.reduce((s, p) => s + (p.d.kind === "review" ? p.d.conservative : 0), 0);

    if (!web.unlimited) {
      const move = async (delta, reason, note) => {
        const r = await stock.adjustStock({ ...unitArgs, delta, reason, ref: { type: "ml", id: keys }, actor: ACTOR, note, tx });
        if (r.ok) { current = r.after; shortfall += r.shortfall || 0; }
      };
      if (sales > 0) await move(-sales, stock.REASONS.VENTA_ML, sales === 1 ? "Venta en Mercado Libre" : `${sales} ventas en Mercado Libre`);
      if (other !== 0) await move(other, stock.REASONS.CAMBIO_ML, "Cambio hecho en Mercado Libre (carga a mano, cancelación o publicador)");
      if (conservative < 0) await move(conservative, stock.REASONS.CAMBIO_ML, "Número más bajo mientras se revisa una diferencia con Mercado Libre");
    }

    const reviews = [];
    for (const p of plans) {
      const { pool, snap, d, book } = p;
      const data = { ...book, attempts: 0, lastError: web.unlimited ? "Stock ilimitado en la página: no se sincroniza" : null, nextAttemptAt: null, lastSyncAt: now };
      if (d.kind === "apply" || d.kind === "same" || d.kind === "baseline") {
        Object.assign(data, { agreed: snap.qty, agreedSold: snap.sold, heldQty: null, heldAt: null });
        if (d.afterWrite) Object.assign(data, { writeTarget: null, writeBase: DbNull, writeStartedAt: null, writeOutcome: null });
        if (d.kind === "apply" && (d.sales || d.other || d.afterWrite)) {
          await log(tx, pool.id, "APLICA", {
            readQty: snap.qty, delta: -d.sales + d.other, webBefore: web.qty, webAfter: web.unlimited ? null : current,
            result: d.afterWrite ? "cierre de escritura" : "cambio en Mercado Libre",
            detail: `Mercado Libre: ${d.afterWrite ? `escrito ${pool.writeTarget}` : pool.agreed} → ${snap.qty}; ventas ${d.sales}, otros ${d.other}`,
          });
        }
      } else if (d.kind === "hold") {
        Object.assign(data, { heldQty: d.heldQty, heldAt: d.heldAt, nextAttemptAt: new Date(new Date(d.heldAt).getTime() + ctx.opts.confirmMs) });
        if (pool.heldQty !== d.heldQty) {
          await log(tx, pool.id, "LECTURA", { readQty: snap.qty, result: "cambio grande en espera", detail: `Mercado Libre pasó de ${pool.agreed} a ${snap.qty} sin ventas que lo expliquen: se aplica si otra lectura lo confirma` });
        }
      } else if (d.kind === "wait") {
        data.nextAttemptAt = d.retryAt;
      } else if (d.kind === "review") {
        const review = {
          reason: d.reason, ml: snap.qty, web: web.unlimited ? null : current, wrote: pool.writeTarget ?? null,
          before: pool.writeBase?.qty ?? null, sold: snap.sold, at: now.toISOString(),
        };
        Object.assign(data, { status: "REVISAR", review, lastError: clip(d.reason) });
        await log(tx, pool.id, "REVISAR", { readQty: snap.qty, delta: d.conservative, webBefore: web.qty, webAfter: web.unlimited ? null : current, detail: d.reason });
        reviews.push({ pool, review });
      }
      await tx.mlPool.update({ where: { id: pool.id }, data });
    }
    return { web: web.unlimited ? null : current, unlimited: web.unlimited, shortfall, reviews, sales, other };
  });

  if (outcome.broken) {
    reportError("mercadolibre", `Vínculo roto: ya no existe la ${unitLabel(unit)} vinculada a Mercado Libre`);
    return summary;
  }
  summary.applied = outcome.sales || outcome.other ? 1 : 0;
  summary.review = outcome.reviews.length;
  for (const r of outcome.reviews) {
    reportError("mercadolibre", `Pozo ${r.pool.key} en REVISAR: ${r.review.reason} (Mercado Libre ${r.review.ml}, página ${r.review.web})`);
  }
  if (outcome.shortfall > 0) {
    reportError("mercadolibre", `Sobreventa: se vendió en Mercado Libre más de lo que había en la página (${unitLabel(unit)}, faltan ${outcome.shortfall}). El stock quedó en 0.`);
  }
  if (outcome.unlimited) return summary;

  // 3. Escribir donde haga falta.
  for (const p of plans) {
    if (!["apply", "same", "baseline"].includes(p.d.kind)) { if (p.d.kind === "wait" || p.d.kind === "hold") summary.waiting++; continue; }
    const res = await writeIfNeeded(unit, p, account, tokenBox, ctx);
    if (res === "stop") break;
    if (res === "written") summary.written++;
    if (res === "waiting") summary.waiting++;
  }
  return summary;
}

// Escribe el número de la página en el pozo, si hace falta y si está quieto.
// Devuelve "written" | "waiting" | "skip" | "stop".
async function writeIfNeeded(unit, plan, account, tokenBox, ctx) {
  const pool = await prisma.mlPool.findUnique({ where: { id: plan.pool.id } });
  if (!pool || !pool.active || pool.status !== "OK" || pool.writeTarget !== null) return "skip";
  const web = await webStock(unit);
  if (web.missing || web.unlimited || web.qty === plan.snap.qty) return "skip";

  const now = ctx.now();
  const quietSince = pool.lastChangeAt ? now - new Date(pool.lastChangeAt) : Infinity;
  if (quietSince < ctx.opts.settleMs) {
    await prisma.mlPool.update({ where: { id: pool.id }, data: { nextAttemptAt: new Date(new Date(pool.lastChangeAt).getTime() + ctx.opts.settleMs) } });
    return "waiting";
  }

  // Releer justo antes de escribir: si cambió algo, se deja para la próxima pasada.
  const fresh = await readOne(pool, account, tokenBox, ctx);
  if (!fresh.ok) return (await readFailed(pool, fresh, ctx)) ? "stop" : "skip";
  const snap = { qty: fresh.qty, sold: fresh.sold };
  if (!rules.sameRead(pool.lastRead, snap)) {
    await prisma.mlPool.update({
      where: { id: pool.id },
      data: { ...rules.afterRead(pool, snap, ctx.now()), dirty: true, nextAttemptAt: new Date(ctx.now().getTime() + ctx.opts.settleMs) },
    });
    return "waiting";
  }

  // El número de la página justo ahora (pudo cambiar desde la transacción).
  const latest = await webStock(unit);
  if (latest.missing || latest.unlimited || latest.qty === snap.qty) return "skip";
  const W = latest.qty;

  // Anotar ANTES de llamar: si se corta en el medio, la próxima pasada cierra las cuentas igual.
  const startedAt = ctx.now();
  await prisma.mlPool.update({
    where: { id: pool.id },
    data: { writeTarget: W, writeBase: snap, writeStartedAt: startedAt, writeOutcome: "DESCONOCIDA" },
  });
  const w = await adapter.writePool({ token: tokenBox.token, target: fresh.target, quantity: W, fetchImpl: ctx.fetchImpl });
  const after = ctx.now();
  const settleAt = new Date(after.getTime() + ctx.opts.settleMs + 1000);

  if (w.ok) {
    if (w.stored === null || w.stored === W) {
      await prisma.mlPool.update({ where: { id: pool.id }, data: { writeOutcome: "APLICADA", agreed: W, nextAttemptAt: settleAt } });
      await log(prisma, pool.id, "ESCRIBE", { readQty: snap.qty, writeQty: W, storedQty: w.stored, result: "ok", detail: `Mercado Libre: ${snap.qty} → ${W}` });
      return "written";
    }
    // Guardó otro número (tope de la publicación, por ejemplo): no insistir.
    const message = `Mercado Libre guardó ${w.stored} en vez de ${W}`;
    await prisma.mlPool.update({
      where: { id: pool.id },
      data: { writeOutcome: "APLICADA", writeTarget: w.stored, agreed: w.stored, status: "ERROR", lastError: message, nextAttemptAt: settleAt },
    });
    await log(prisma, pool.id, "ESCRIBE", { readQty: snap.qty, writeQty: W, storedQty: w.stored, result: "otro número", detail: message });
    reportError("mercadolibre", `Pozo ${pool.key}: ${message}. No se vuelve a escribir hasta revisarlo en el panel.`);
    return "written";
  }

  if (w.kind === "transient" || w.kind === "bad_response") {
    // Resultado desconocido: queda anotado y se cierra con la próxima lectura quieta.
    const attempts = (pool.attempts || 0) + 1;
    await prisma.mlPool.update({ where: { id: pool.id }, data: { attempts, lastError: clip(w.message), nextAttemptAt: settleAt } });
    await log(prisma, pool.id, "ESCRIBE", { readQty: snap.qty, writeQty: W, result: "sin respuesta", detail: w.message });
    return "written";
  }

  // Mercado Libre dijo que no: no se escribió nada.
  const clear = { writeTarget: null, writeBase: DbNull, writeStartedAt: null, writeOutcome: null };
  if (w.kind === "rate_limit") {
    await prisma.mlPool.update({ where: { id: pool.id }, data: { ...clear, dirty: true } });
    await brake(ctx, w.retryAfterMs);
    return "stop";
  }
  if (w.kind === "auth") {
    await prisma.mlPool.update({ where: { id: pool.id }, data: { ...clear, dirty: true } });
    await noteAccountError(w.message, ctx);
    return "stop";
  }
  await prisma.mlPool.update({ where: { id: pool.id }, data: { ...clear, status: "ERROR", lastError: clip(`Mercado Libre no aceptó el cambio: ${w.message}`) } });
  await log(prisma, pool.id, "ESCRIBE", { readQty: snap.qty, writeQty: W, result: "rechazado", detail: w.message });
  reportError("mercadolibre", `Pozo ${pool.key}: Mercado Libre no aceptó el stock ${W}: ${w.message}`);
  return "skip";
}

module.exports = { syncUnit, withLock, webStock, readOne, brake, makeCtx, backoffMs, ACTOR, FROZEN };

// Acciones del panel sobre los pozos de Mercado Libre: vincular a un producto o variante de la página,
// activar (empezar a compartir stock eligiendo qué número queda), desactivar, resolver un REVISAR y
// reintentar uno frenado. Quién lo hizo sale de la sesión.
const prisma = require("../../lib/prisma");
const stock = require("../stock.service");
const rules = require("./mlRules");
const { getAccessToken, ACCOUNT_ID } = require("./mlAuth");
const { makeCtx, readOne, webStock, withLock } = require("./mlSync");
const { linkableUnits, suggestionsFor } = require("./mlListings");
const { DbNull } = require("./mlJson");

const toId = (v) => {
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const fail = (error, status = 400) => ({ ok: false, error, status });
const CLEAR_SYNC = {
  agreed: null, agreedSold: DbNull, writeTarget: null, writeBase: DbNull, writeStartedAt: null, writeOutcome: null,
  heldQty: null, heldAt: null, review: DbNull, attempts: 0, nextAttemptAt: null, lastError: null,
};

async function getPool(id) {
  const poolId = toId(id);
  if (!poolId) return null;
  return prisma.mlPool.findUnique({ where: { id: poolId } });
}

async function unitInfo(productId, variantId) {
  if (variantId) {
    const v = await prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!v || v.productId !== productId) return null;
    const p = await prisma.product.findUnique({ where: { id: productId } });
    const combo = Array.isArray(v.combination) ? v.combination.map((c) => c?.value).filter(Boolean).join(" / ") : "";
    return { productId, variantId, name: `${p?.name || `Producto #${productId}`}${combo ? ` — ${combo}` : ""}`, qty: v.stock, stockUnlimited: !!v.stockUnlimited };
  }
  const p = await prisma.product.findUnique({ where: { id: productId } });
  if (!p) return null;
  return { productId, variantId: null, name: p.name, qty: p.stock, stockUnlimited: !!p.stockUnlimited };
}

// ─── Listado ────────────────────────────────────────────────────────────────

async function listPools() {
  const [pools, listings, units] = await Promise.all([
    prisma.mlPool.findMany({}),
    prisma.mlListing.findMany({}),
    linkableUnits(),
  ]);
  const byPool = new Map();
  for (const l of listings) {
    if (!l.poolId) continue;
    if (!byPool.has(l.poolId)) byPool.set(l.poolId, []);
    byPool.get(l.poolId).push(l);
  }
  const unitByKey = new Map(units.map((u) => [`${u.productId}:${u.variantId ?? ""}`, u]));
  const linkedKeys = new Set(pools.filter((p) => p.productId).map((p) => `${p.productId}:${p.variantId ?? ""}`));
  return pools
    .filter((p) => byPool.has(p.id) || p.productId)
    .map((p) => {
      const ls = byPool.get(p.id) || [];
      const unit = p.productId ? unitByKey.get(`${p.productId}:${p.variantId ?? ""}`) || null : null;
      return {
        id: p.id, key: p.key, userProductId: p.userProductId,
        productId: p.productId, variantId: p.variantId, active: p.active, status: p.status,
        unit: unit ? { name: unit.name, qty: unit.qty, stockUnlimited: unit.stockUnlimited } : null,
        mlQty: p.lastRead?.qty ?? null, lastReadAt: p.lastReadAt, lastSyncAt: p.lastSyncAt,
        lastError: p.lastError, review: p.review, pendingWrite: p.writeTarget,
        listings: ls.map((l) => ({
          itemId: l.itemId, variationId: l.variationId || null, title: l.title, sku: l.sku,
          permalink: l.permalink, thumbnail: l.thumbnail, status: l.status, quantity: l.quantity, sold: l.sold,
        })),
        suggestions: p.productId ? [] : suggestionsFor(ls, units).map((s) => ({
          productId: s.productId, variantId: s.variantId, name: s.name, sku: s.sku, qty: s.qty, by: s.by,
          linked: linkedKeys.has(`${s.productId}:${s.variantId ?? ""}`),
        })),
      };
    })
    .sort((a, b) => (a.listings[0]?.title || a.key).localeCompare(b.listings[0]?.title || b.key, "es"));
}

// Buscador de unidades para vincular (productos sin variantes y variantes).
async function searchUnits(q) {
  const text = String(q || "").trim().toLowerCase();
  const units = await linkableUnits();
  const found = (text
    ? units.filter((u) => u.name.toLowerCase().includes(text) || (u.sku && u.sku.toLowerCase().includes(text)))
    : units).slice(0, 30);
  const linked = await prisma.mlPool.findMany({ where: { productId: { not: null } } });
  const linkedKeys = new Set(linked.map((p) => `${p.productId}:${p.variantId ?? ""}`));
  return found.map((u) => ({ ...u, linked: linkedKeys.has(`${u.productId}:${u.variantId ?? ""}`) }));
}

// ─── Vincular ───────────────────────────────────────────────────────────────

function linkPool(id, body, actor) {
  return withLock(() => linkPoolLocked(id, body || {}, actor));
}
async function linkPoolLocked(id, { productId, variantId }, actor) {
  const pool = await getPool(id);
  if (!pool) return fail("No existe ese pozo", 404);
  if (pool.active) return fail("Primero desactivá el vínculo actual");
  const pid = toId(productId);
  const vid = variantId == null || variantId === "" ? null : toId(variantId);
  if (!pid || (variantId != null && variantId !== "" && !vid)) return fail("Elegí un producto de la página");

  if (!vid) {
    const variants = await prisma.productVariant.count({ where: { productId: pid } });
    if (variants > 0) return fail("Ese producto tiene variantes: vinculá la variante que corresponde");
  }
  const unit = await unitInfo(pid, vid);
  if (!unit) return fail("No existe ese producto o variante");

  await prisma.mlPool.update({
    where: { id: pool.id },
    data: { ...CLEAR_SYNC, productId: pid, variantId: vid, active: false, status: "OK", linkedAt: new Date(), linkedBy: actor ? String(actor).slice(0, 120) : null, dirty: true },
  });
  return { ok: true, unit };
}

function unlinkPool(id) {
  return withLock(() => unlinkPoolLocked(id));
}
async function unlinkPoolLocked(id) {
  const pool = await getPool(id);
  if (!pool) return fail("No existe ese pozo", 404);
  await prisma.mlPool.update({
    where: { id: pool.id },
    data: { ...CLEAR_SYNC, productId: null, variantId: null, active: false, status: "OK", linkedAt: null, linkedBy: null, dirty: false },
  });
  return { ok: true };
}

// ─── Activar / resolver ─────────────────────────────────────────────────────

/**
 * Empieza (o vuelve) a compartir stock. choice: "web" (queda el número de la página), "ml" (queda el de
 * Mercado Libre) o "number" (queda number). Lee Mercado Libre en el momento, deja la página en el
 * número elegido y el motor se encarga de escribirlo en Mercado Libre si hace falta.
 */
function activatePool(id, body, actor, rawCtx = {}) {
  return withLock(() => activatePoolLocked(id, body || {}, actor, rawCtx));
}
async function activatePoolLocked(id, { choice, number } = {}, actor, rawCtx = {}) {
  const ctx = makeCtx(rawCtx);
  const pool = await getPool(id);
  if (!pool) return fail("No existe ese pozo", 404);
  if (!pool.productId) return fail("Primero vinculá el pozo a un producto de la página");
  if (!["web", "ml", "number"].includes(choice)) return fail("Elegí qué número queda");
  const typed = choice === "number" ? parseInt(number, 10) : null;
  if (choice === "number" && (!Number.isInteger(typed) || typed < 0 || typed > 99999 || String(number).trim() !== String(typed))) {
    return fail("El número tiene que ser un entero entre 0 y 99999");
  }

  const account = await prisma.mlAccount.findUnique({ where: { id: ACCOUNT_ID } });
  if (!account || account.status !== "CONECTADA") return fail("Mercado Libre no está conectado");
  const unit = { productId: pool.productId, variantId: pool.variantId ?? null };
  const before = await webStock(unit);
  if (before.missing) return fail(before.reason || "El producto vinculado ya no existe");
  if (before.unlimited) return fail("El producto tiene stock ilimitado en la página: sacale el ilimitado para compartir stock");

  const t = await getAccessToken({ now: ctx.now, cfg: ctx.cfg, fetchImpl: ctx.fetchImpl });
  if (!t.ok) return fail(t.message);
  const r = await readOne(pool, account, { token: t.token }, ctx);
  if (!r.ok) return fail(`No se pudo leer Mercado Libre: ${r.message}`);
  const snap = { qty: r.qty, sold: r.sold };
  const N = choice === "web" ? before.qty : choice === "ml" ? snap.qty : typed;
  const now = ctx.now();

  const result = await stock.transaction(async (tx) => {
    await stock.lockUnits(tx, [unit]);
    const web = await webStock(unit, tx);
    if (web.missing || web.unlimited) return { error: "El producto cambió mientras tanto: probá de nuevo" };
    // Si se eligió "la página", vale el número de AHORA (pudo entrar una venta en el medio).
    const target = choice === "web" ? web.qty : N;
    const adj = await stock.adjustStock({
      productId: unit.productId, variantId: unit.variantId ?? undefined, setTo: target,
      reason: stock.REASONS.VINCULO_ML, ref: { type: "ml", id: pool.key }, actor,
      note: `Vínculo con Mercado Libre activado (Mercado Libre tenía ${snap.qty})`, tx,
    });
    await tx.mlPool.update({
      where: { id: pool.id },
      data: {
        ...CLEAR_SYNC, active: true, status: "OK",
        agreed: snap.qty, agreedSold: snap.sold, ...rules.afterRead(pool, snap, now), dirty: true,
      },
    });
    await tx.mlCycle.create({
      data: { poolId: pool.id, kind: "VINCULO", readQty: snap.qty, webBefore: web.qty, webAfter: adj.ok ? adj.after : web.qty, result: choice, detail: `Activado por ${actor || "el panel"}: queda ${target}` },
    });
    return { number: target };
  });
  if (result.error) return fail(result.error, 409);

  // El motor escribe el número en Mercado Libre en la próxima pasada (si hace falta).
  require("./mlWorker").kick(rawCtx);
  return { ok: true, number: result.number, ml: snap.qty };
}

function resolvePool(id, body, actor, ctx) {
  return withLock(async () => {
    const pool = await getPool(id);
    if (!pool) return fail("No existe ese pozo", 404);
    if (pool.status !== "REVISAR" && pool.status !== "ERROR") return fail("Ese pozo no está para revisar");
    return activatePoolLocked(id, body || {}, actor, ctx);
  });
}

function deactivatePool(id) {
  return withLock(() => deactivatePoolLocked(id));
}
async function deactivatePoolLocked(id) {
  const pool = await getPool(id);
  if (!pool) return fail("No existe ese pozo", 404);
  await prisma.mlPool.update({ where: { id: pool.id }, data: { ...CLEAR_SYNC, active: false, status: pool.productId ? "OK" : pool.status, dirty: true } });
  return { ok: true };
}

// Reintentar un pozo frenado por un error (ERROR, CERRADO, ROTO). REVISAR se resuelve eligiendo número
// (resolvePool, que también sirve para un ERROR).
function checkPool(id) {
  return withLock(() => checkPoolLocked(id));
}
async function checkPoolLocked(id) {
  const pool = await getPool(id);
  if (!pool) return fail("No existe ese pozo", 404);
  if (pool.status === "REVISAR") return fail("Este pozo necesita que elijas el número correcto");
  if (!pool.productId) return fail("El pozo no está vinculado");
  await prisma.mlPool.update({ where: { id: pool.id }, data: { status: "OK", attempts: 0, nextAttemptAt: null, lastError: null, dirty: true } });
  require("./mlWorker").kick();
  return { ok: true };
}

async function poolCycles(id, take = 50) {
  const pool = await getPool(id);
  if (!pool) return fail("No existe ese pozo", 404);
  const cycles = await prisma.mlCycle.findMany({ where: { poolId: pool.id }, orderBy: { id: "desc" }, take: Math.min(200, Math.max(1, take)) });
  return { ok: true, cycles };
}

module.exports = { listPools, searchUnits, linkPool, unlinkPool, activatePool, resolvePool, deactivatePool, checkPool, poolCycles, unitInfo };

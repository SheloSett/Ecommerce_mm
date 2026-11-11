// Publicaciones de la cuenta de Mercado Libre y sus pozos (solo lectura: no toca stock).
//
// refreshListings trae los ids de las publicaciones activas y pausadas, pide cada una (de a una, con
// pausa entre pedidos) y guarda una fila por publicación o variación en ml_listings, agrupadas en
// pozos (ml_pools) por user_product_id. Nunca vincula nada solo: los vínculos se hacen en el panel.
// Si una publicación de un pozo vinculado pasa a otro pozo, el vinculado se frena en REVISAR.
//
// suggestionsFor propone productos de la página para un pozo sin vincular: primero por SKU igual,
// después por título parecido.
const prisma = require("../../lib/prisma");
const { reportError } = require("../errorAlerts.service");
const { normalizeText } = require("../../utils/searchRelevance");
const api = require("./mlApi");
const { getAccessToken, ACCOUNT_ID } = require("./mlAuth");
const { makeCtx, brake, withLock } = require("./mlSync");

const MAX_ITEMS = 3000;

function skuOf(obj) {
  if (typeof obj?.seller_custom_field === "string" && obj.seller_custom_field.trim()) return obj.seller_custom_field.trim().slice(0, 80);
  const attrs = Array.isArray(obj?.attributes) ? obj.attributes : [];
  const a = attrs.find((x) => x && x.id === "SELLER_SKU");
  const v = a?.value_name ?? a?.values?.[0]?.name;
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null;
}

function safeUrl(value, hostPattern) {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && hostPattern.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}
const ML_IMG = /(^|\.)mlstatic\.com$/i;
const ML_SITE = /(^|\.)mercadolibre\.com\.ar$/i;

function variationName(v) {
  const combos = Array.isArray(v?.attribute_combinations) ? v.attribute_combinations : [];
  return combos.map((c) => [c?.name, c?.value_name].filter(Boolean).join(": ")).filter(Boolean).join(", ");
}

// Filas de ml_listings que salen de una publicación: una, o una por variación.
function rowsOf(item) {
  const base = {
    itemId:    String(item.id),
    title:     String(item.title || item.family_name || item.id).slice(0, 200),
    permalink: safeUrl(item.permalink, ML_SITE),
    thumbnail: safeUrl(item.secure_thumbnail || item.thumbnail, ML_IMG),
    status:    String(item.status || "").slice(0, 30),
  };
  const variations = Array.isArray(item.variations) ? item.variations.filter((v) => v && api.isId("variation", String(v.id))) : [];
  if (!variations.length) {
    const up = typeof item.user_product_id === "string" && api.isId("userProduct", item.user_product_id) ? item.user_product_id : null;
    return [{
      ...base, variationId: "", userProductId: up, sku: skuOf(item),
      quantity: Number.isInteger(item.available_quantity) ? item.available_quantity : null,
      sold: Number.isInteger(item.sold_quantity) ? item.sold_quantity : null,
      poolKey: up ? `UP:${up}` : `IT:${item.id}`,
    }];
  }
  return variations.map((v) => {
    const up = typeof v.user_product_id === "string" && api.isId("userProduct", v.user_product_id) ? v.user_product_id : null;
    const name = variationName(v);
    return {
      ...base, variationId: String(v.id), userProductId: up, sku: skuOf(v) || skuOf(item),
      title: (name ? `${base.title} — ${name}` : base.title).slice(0, 200),
      quantity: Number.isInteger(v.available_quantity) ? v.available_quantity : null,
      sold: Number.isInteger(v.sold_quantity) ? v.sold_quantity : null,
      poolKey: up ? `UP:${up}` : `IV:${item.id}:${v.id}`,
    };
  });
}

// Ids de publicaciones de un estado, con paginado común hasta 1000 y por "scan" si hay más.
async function listIds(token, userId, status, ctx) {
  const ids = [];
  let offset = 0;
  let total = Infinity;
  while (offset < Math.min(total, 1000)) {
    const r = await api.searchItemIds(token, userId, { status, offset }, { fetchImpl: ctx.fetchImpl });
    if (!r.ok) return r;
    const chunk = Array.isArray(r.data?.results) ? r.data.results.filter((id) => api.isId("item", id)) : [];
    total = Number(r.data?.paging?.total) || 0;
    ids.push(...chunk);
    if (!chunk.length) break;
    offset += 100;
    if (ctx.sleep) await ctx.sleep(150);
  }
  if (total > 1000) {
    ids.length = 0;
    let r = await api.searchItemIds(token, userId, { status, offset: "scan" }, { fetchImpl: ctx.fetchImpl });
    while (r.ok) {
      const chunk = Array.isArray(r.data?.results) ? r.data.results.filter((id) => api.isId("item", id)) : [];
      if (!chunk.length || ids.length >= MAX_ITEMS) break;
      ids.push(...chunk);
      if (ctx.sleep) await ctx.sleep(150);
      r = await api.searchItemIds(token, userId, { status, scrollId: String(r.data?.scroll_id || "") }, { fetchImpl: ctx.fetchImpl });
    }
    if (!r.ok) return r;
  }
  return { ok: true, ids };
}

let running = null;

async function doRefresh(ctx) {
  const account = await prisma.mlAccount.findUnique({ where: { id: ACCOUNT_ID } });
  if (!account || account.status !== "CONECTADA") return { ok: false, error: "Mercado Libre no está conectado" };
  if (account.pausedUntil && account.pausedUntil > ctx.now()) return { ok: false, error: "Mercado Libre pidió bajar el ritmo: probá en unos minutos" };
  const t = await getAccessToken({ now: ctx.now, cfg: ctx.cfg, fetchImpl: ctx.fetchImpl });
  if (!t.ok) return { ok: false, error: t.message };

  const started = ctx.now();
  const ids = [];
  for (const status of ["active", "paused"]) {
    const r = await listIds(t.token, account.mlUserId, status, ctx);
    if (!r.ok) {
      if (r.kind === "rate_limit") await brake(ctx, r.retryAfterMs);
      return { ok: false, error: `No se pudo traer la lista de publicaciones: ${r.message}` };
    }
    ids.push(...r.ids);
  }
  const unique = [...new Set(ids)].slice(0, MAX_ITEMS);

  let saved = 0;
  let failed = 0;
  let cut = false;
  const pools = new Set();
  for (const id of unique) {
    if (ctx.sleep && saved + failed > 0) await ctx.sleep(150);
    const r = await api.getItem(t.token, id, { fetchImpl: ctx.fetchImpl });
    if (!r.ok) {
      if (r.kind === "rate_limit") { await brake(ctx, r.retryAfterMs); cut = true; break; }
      failed++;
      continue;
    }
    if (String(r.data?.seller_id) !== String(account.mlUserId)) continue;
    for (const row of rowsOf(r.data)) {
      pools.add(await saveRow(row, ctx));
      saved++;
    }
  }

  // Las que ya no aparecen (cerradas o borradas) quedan como "sin_ver" para el panel. Solo si se
  // pudieron leer todas: si la lista se cortó, las que faltaron no están cerradas.
  if (!cut && !failed) {
    await prisma.mlListing.updateMany({ where: { lastSeenAt: { lt: started }, status: { in: ["active", "paused"] } }, data: { status: "sin_ver" } });
  }
  const result = `${saved} publicaciones en ${pools.size} pozos${failed ? `, ${failed} no se pudieron leer` : ""}${cut ? " (se cortó: Mercado Libre pidió bajar el ritmo)" : ""}`;
  await prisma.mlAccount.update({ where: { id: ACCOUNT_ID }, data: { listingsAt: ctx.now(), listingsResult: result } });
  return { ok: true, saved, pools: pools.size, failed, result };
}

// Guarda una fila (publicación o variación) con su pozo. Devuelve el id del pozo.
async function saveRow(row, ctx) {
  const pool = await prisma.mlPool.upsert({
    where:  { key: row.poolKey },
    update: { userProductId: row.userProductId },
    create: { key: row.poolKey, userProductId: row.userProductId },
  });
  const existing = await prisma.mlListing.findUnique({ where: { itemId_variationId: { itemId: row.itemId, variationId: row.variationId } } });
  if (existing && existing.poolId && existing.poolId !== pool.id) await withLock(() => regrouped(existing, pool, row, ctx));
  const { poolKey, ...data } = row;
  await prisma.mlListing.upsert({
    where:  { itemId_variationId: { itemId: row.itemId, variationId: row.variationId } },
    update: { ...data, poolId: pool.id, lastSeenAt: ctx.now() },
    create: { ...data, poolId: pool.id, lastSeenAt: ctx.now() },
  });
  return pool.id;
}

// Aviso de una publicación que todavía no está en la base (la creó el dueño o el publicador después de
// la última vez que se trajeron): se pide y se guarda con su pozo, así sus ventas se cuentan desde ya.
// Devuelve los ids de los pozos donde quedó, o [] si no corresponde.
const attaching = new Set();
async function attachItem(itemId, rawCtx = {}) {
  if (!api.isId("item", itemId) || attaching.has(itemId)) return [];
  attaching.add(itemId);
  try {
    const ctx = makeCtx(rawCtx);
    const account = await prisma.mlAccount.findUnique({ where: { id: ACCOUNT_ID } });
    if (!account || account.status !== "CONECTADA" || account.mode === "APAGADO") return [];
    if (account.pausedUntil && account.pausedUntil > ctx.now()) return [];
    const t = await getAccessToken({ now: ctx.now, cfg: ctx.cfg, fetchImpl: ctx.fetchImpl });
    if (!t.ok) return [];
    const r = await api.getItem(t.token, itemId, { fetchImpl: ctx.fetchImpl });
    if (!r.ok) {
      if (r.kind === "rate_limit") await brake(ctx, r.retryAfterMs);
      return [];
    }
    if (String(r.data?.seller_id) !== String(account.mlUserId)) return [];
    const ids = [];
    for (const row of rowsOf(r.data)) ids.push(await saveRow(row, ctx));
    return [...new Set(ids)];
  } finally {
    attaching.delete(itemId);
  }
}

// Una publicación cambió de pozo: si el viejo estaba vinculado, se frena y se avisa.
async function regrouped(listing, newPool, row, ctx) {
  const old = await prisma.mlPool.findUnique({ where: { id: listing.poolId } });
  if (!old || old.productId === null) return;
  const reason = `La publicación ${row.itemId}${row.variationId ? `:${row.variationId}` : ""} pasó a otro producto de Mercado Libre (${newPool.key})`;
  await prisma.mlPool.update({ where: { id: old.id }, data: { status: "REVISAR", lastError: reason, review: { reason, at: ctx.now().toISOString() } } });
  reportError("mercadolibre", `Pozo ${old.key} frenado: ${reason}`);
}

/** Trae las publicaciones. Una sola vez a la vez: si ya está corriendo devuelve la misma promesa. */
function refreshListings(rawCtx = {}) {
  if (!running) {
    const ctx = makeCtx(rawCtx);
    running = doRefresh(ctx)
      .catch((err) => {
        console.error("[mercadolibre] error al traer publicaciones:", err);
        return { ok: false, error: "Error inesperado al traer las publicaciones" };
      })
      .finally(() => { running = null; });
  }
  return running;
}

function isRefreshing() {
  return running !== null;
}

// ─── Sugerencias de vínculo ─────────────────────────────────────────────────

const normSku = (s) => String(s || "").toUpperCase().replace(/[\s_-]+/g, "");
function wordsOf(text) {
  return new Set(normalizeText(text).split(/\s+/).filter((w) => w.length >= 3));
}
function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / Math.min(a.size, b.size);
}

/**
 * Unidades de la página que se pueden vincular (productos sin variantes y variantes), con nombre
 * legible. units: [{ productId, variantId, name, sku, qty, stockUnlimited }]
 */
async function linkableUnits() {
  const products = await prisma.product.findMany({
    select: { id: true, name: true, sku: true, stock: true, stockUnlimited: true, variants: { select: { id: true, sku: true, stock: true, stockUnlimited: true, combination: true, active: true } } },
  });
  const units = [];
  for (const p of products) {
    if (!p.variants?.length) {
      units.push({ productId: p.id, variantId: null, name: p.name, sku: p.sku, qty: p.stock, stockUnlimited: p.stockUnlimited });
      continue;
    }
    for (const v of p.variants) {
      const combo = Array.isArray(v.combination) ? v.combination.map((c) => c?.value).filter(Boolean).join(" / ") : "";
      units.push({ productId: p.id, variantId: v.id, name: combo ? `${p.name} — ${combo}` : p.name, sku: v.sku || null, qty: v.stock, stockUnlimited: v.stockUnlimited });
    }
  }
  return units;
}

// Hasta 3 sugerencias para un pozo: SKU igual primero, después título parecido.
function suggestionsFor(listings, units) {
  const skus = new Set(listings.map((l) => normSku(l.sku)).filter(Boolean));
  const titleWords = wordsOf(listings.map((l) => l.title).join(" "));
  const scored = [];
  for (const u of units) {
    const bySku = u.sku && skus.has(normSku(u.sku));
    const score = bySku ? 2 : similarity(titleWords, wordsOf(u.name));
    if (bySku || score >= 0.5) scored.push({ ...u, score, by: bySku ? "sku" : "titulo" });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 3);
}

module.exports = { refreshListings, isRefreshing, attachItem, rowsOf, skuOf, linkableUnits, suggestionsFor };

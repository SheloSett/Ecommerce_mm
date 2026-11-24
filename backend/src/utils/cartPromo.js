// Descuento por monto de compra (model CartPromo): "desde $100.000, 5% off; desde $200.000, 10% off".
// Lo pidió la clienta para Black Friday (23/11/2026). Funciones puras: las usan computeOrderTotals (el
// cálculo del pedido) y services/cartPromo.service.js (qué promo le toca a un pedido). El frontend tiene
// una copia de estas mismas reglas en src/utils/cartPromo.js para mostrar el descuento en el carrito;
// si cambia una, cambiar la otra.
//
// REGLAS:
// - El monto que cuenta es el SUBTOTAL DE PRODUCTOS EN PESOS: lo que el cliente paga por las líneas, con
//   las ofertas de cada producto ya aplicadas, sin el envío y antes del IVA.
// - Si la promo es para algunas categorías o productos (CartPromo.categoryIds / productIds, 24/11/2026),
//   el monto se mide y el % se descuenta SOLO sobre las líneas de esos productos (productIds ya resuelto:
//   la lista de ids de producto que entran; null = todos). El resto del carrito se cobra normal.
// - Las líneas en dólares no suman ni se descuentan: los escalones están en pesos y el sistema no
//   convierte monedas (mismo criterio que el cupón de monto fijo y el mínimo mayorista).
// - Aplica el escalón más alto alcanzado. Si hay dos promos vigentes para el mismo cliente, la que más
//   descuento da con ese monto.
// - PENDIENTE de confirmar con la clienta (quedó en avisar):
//   (a) si los productos que ya tienen oferta cuentan para el monto y reciben el descuento → hoy SÍ;
//   (b) si se combina con un cupón → hoy SÍ: primero la promo y el cupón sobre lo que quedó
//       (ver computeOrderTotals).

// Escalones limpios: números válidos, % entre 0 y 100, ordenados de menor a mayor monto. Lo que venga
// roto (de la base o del panel) se descarta en vez de romper el cálculo de un pedido.
function normalizePromoTiers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => ({ minAmount: Number(t?.minAmount), percent: Number(t?.percent) }))
    .filter((t) => Number.isFinite(t.minAmount) && t.minAmount >= 0 && Number.isFinite(t.percent) && t.percent > 0 && t.percent <= 100)
    .sort((a, b) => a.minAmount - b.minAmount);
}

// El escalón que alcanza ese monto (el de mayor minAmount que no lo supere), o null.
function promoTierFor(tiers, amount) {
  let hit = null;
  for (const t of normalizePromoTiers(tiers)) {
    if (amount >= t.minAmount) hit = t;
  }
  return hit;
}

// El próximo escalón que todavía no alcanza (para el "Te faltan $X para el 10%"), o null.
function nextPromoTier(tiers, amount) {
  return normalizePromoTiers(tiers).find((t) => t.minAmount > amount) || null;
}

// promo.appliesTo: MINORISTA | MAYORISTA | AMBOS. customerType: el del pedido (MINORISTA | MAYORISTA).
function promoAppliesTo(promo, customerType) {
  const tipo = customerType === "MAYORISTA" ? "MAYORISTA" : "MINORISTA";
  return promo?.appliesTo === "AMBOS" || promo?.appliesTo === tipo;
}

// Vigente: prendida y con la fecha de hoy entre el inicio y el fin.
function isPromoLive(promo, now = new Date()) {
  return !!promo?.active && new Date(promo.startsAt) <= now && now < new Date(promo.endsAt);
}

// Lo que cuenta para una promo: la suma de las líneas en pesos (precio × cantidad) de los productos que
// entran. productIds: los ids que entran, o null/undefined = todos (incluidos los ítems libres del panel).
function promoBaseAmount(items, productIds) {
  const set = Array.isArray(productIds) ? new Set(productIds.map(Number)) : null;
  const total = (items || []).reduce((sum, i) => {
    if ((i.currency || "ARS") === "USD") return sum;
    if (set && !set.has(Number(i.productId))) return sum;
    return sum + i.price * i.quantity;
  }, 0);
  return Math.round(total * 100) / 100;
}

// Entre varias promos, la que más % da con lo que el pedido tiene de cada una: { promo, tier, base } o
// null si ninguna llega. promo.eligibleProductIds: los ids que entran (los pone cartPromo.service), o
// null = todos.
function bestPromoForItems(promos, items) {
  let best = null;
  for (const promo of promos || []) {
    const base = promoBaseAmount(items, promo.eligibleProductIds);
    const tier = promoTierFor(promo.tiers, base);
    if (tier && (!best || tier.percent > best.tier.percent)) best = { promo, tier, base };
  }
  return best;
}

// Entre varias promos, la que más % da con ese monto: { promo, tier } o null si ninguna llega.
function bestPromoFor(promos, amount) {
  let best = null;
  for (const promo of promos || []) {
    const tier = promoTierFor(promo.tiers, amount);
    if (tier && (!best || tier.percent > best.tier.percent)) best = { promo, tier };
  }
  return best;
}

// Lo que se guarda en Order.promoRule: el nombre, los escalones y, si es para algunos productos, cuáles
// entraban en ese momento (así "Modificar pedido" la recalcula igual aunque después cambie la promo).
// Antes: return { name, tiers }.
function promoSnapshot(promo) {
  const snap = { name: String(promo?.name || "Promo"), tiers: normalizePromoTiers(promo?.tiers) };
  if (Array.isArray(promo?.eligibleProductIds)) snap.productIds = promo.eligibleProductIds;
  return snap;
}

module.exports = { normalizePromoTiers, promoTierFor, nextPromoTier, promoAppliesTo, isPromoLive, bestPromoFor, bestPromoForItems, promoBaseAmount, promoSnapshot };

// Descuento por monto de compra (model CartPromo): "desde $100.000, 5% off; desde $200.000, 10% off".
// Lo pidió la clienta para Black Friday (23/11/2026). Funciones puras: las usan computeOrderTotals (el
// cálculo del pedido) y services/cartPromo.service.js (qué promo le toca a un pedido). El frontend tiene
// una copia de estas mismas reglas en src/utils/cartPromo.js para mostrar el descuento en el carrito;
// si cambia una, cambiar la otra.
//
// REGLAS:
// - El monto que cuenta es el SUBTOTAL DE PRODUCTOS EN PESOS: lo que el cliente paga por las líneas, con
//   las ofertas de cada producto ya aplicadas, sin el envío y antes del IVA.
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

// Entre varias promos, la que más % da con ese monto: { promo, tier } o null si ninguna llega.
function bestPromoFor(promos, amount) {
  let best = null;
  for (const promo of promos || []) {
    const tier = promoTierFor(promo.tiers, amount);
    if (tier && (!best || tier.percent > best.tier.percent)) best = { promo, tier };
  }
  return best;
}

// Lo que se guarda en Order.promoRule: el nombre y los escalones de ese momento.
function promoSnapshot(promo) {
  return { name: String(promo?.name || "Promo"), tiers: normalizePromoTiers(promo?.tiers) };
}

module.exports = { normalizePromoTiers, promoTierFor, nextPromoTier, promoAppliesTo, isPromoLive, bestPromoFor, promoSnapshot };

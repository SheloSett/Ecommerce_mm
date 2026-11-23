// Descuento por monto de compra ("desde $100.000, 5% off; desde $200.000, 10% off"), del lado del
// navegador: lo usan el carrito, el checkout y la venta manual del panel para MOSTRAR el descuento y el
// "Te faltan $X". Es una copia de las reglas de backend/src/utils/cartPromo.js: el total que se cobra lo
// calcula siempre el servidor con esa otra copia. Si cambia una, cambiar la otra.
//
// El monto que cuenta es el subtotal de productos EN PESOS (sin envío, antes del IVA). Las líneas en
// dólares no suman ni se descuentan.

const round2 = (n) => Math.round((n || 0) * 100) / 100;

export function normalizePromoTiers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => ({ minAmount: Number(t?.minAmount), percent: Number(t?.percent) }))
    .filter((t) => Number.isFinite(t.minAmount) && t.minAmount >= 0 && Number.isFinite(t.percent) && t.percent > 0 && t.percent <= 100)
    .sort((a, b) => a.minAmount - b.minAmount);
}

// El escalón que alcanza ese monto (el de mayor minAmount que no lo supere), o null.
export function promoTierFor(tiers, amount) {
  let hit = null;
  for (const t of normalizePromoTiers(tiers)) {
    if (amount >= t.minAmount) hit = t;
  }
  return hit;
}

export function promoAppliesTo(promo, customerType) {
  const tipo = customerType === "MAYORISTA" ? "MAYORISTA" : "MINORISTA";
  return promo?.appliesTo === "AMBOS" || promo?.appliesTo === tipo;
}

// Todo lo que necesita una pantalla, para un subtotal en pesos y un tipo de cliente:
//   promo / percent / discount → lo que se descuenta hoy (promo null y 0 si no llega a ningún escalón)
//   next → el próximo escalón que da MÁS que el actual: { promo, percent, minAmount, missing } o null
//   available → hay alguna promo vigente para este cliente (aunque todavía no llegue)
// Entre varias promos, la que más da con ese monto (igual que el servidor).
export function cartPromoSummary(promos, subtotalArs, customerType, now = new Date()) {
  const amount = subtotalArs || 0;
  const vigentes = (promos || []).filter((p) =>
    promoAppliesTo(p, customerType) && (!p.endsAt || new Date(p.endsAt) > now));

  let promo = null;
  let percent = 0;
  for (const p of vigentes) {
    const tier = promoTierFor(p.tiers, amount);
    if (tier && tier.percent > percent) { promo = p; percent = tier.percent; }
  }

  // El escalón más cercano que todavía no alcanza y que mejora el % actual
  let next = null;
  for (const p of vigentes) {
    for (const t of normalizePromoTiers(p.tiers)) {
      if (t.minAmount > amount && t.percent > percent && (!next || t.minAmount < next.minAmount)) {
        next = { promo: p, percent: t.percent, minAmount: t.minAmount, missing: round2(t.minAmount - amount) };
      }
    }
  }

  return { promo, percent, discount: round2((amount * percent) / 100), next, available: vigentes.length > 0 };
}

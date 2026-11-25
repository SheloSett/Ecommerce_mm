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

// La versión de la promo que le toca a un tipo de cliente (igual que promoForCustomer del servidor,
// 25/11/2026): en una promo para los dos con escalones propios para mayoristas (wholesaleTiers), un
// mayorista usa esos y la promo queda como solo para mayoristas ("Exclusivo para mayoristas"). El servidor
// ya se la manda resuelta a la tienda; el panel la recibe entera y la resuelve acá según el cliente de la
// venta. Aplicarla dos veces da lo mismo.
export function promoForCustomer(promo, customerType) {
  if (!promo) return promo;
  const { wholesaleTiers, ...rest } = promo;
  const own = normalizePromoTiers(wholesaleTiers);
  if (customerType === "MAYORISTA" && promo.appliesTo === "AMBOS" && own.length > 0) {
    return { ...rest, tiers: own, appliesTo: "MAYORISTA" };
  }
  return rest;
}

// Lo que cuenta para una promo (igual que el servidor, promoBaseAmount de backend/src/utils/cartPromo.js):
// la suma de las líneas en pesos de los productos que entran. lines: [{ productId, price, quantity,
// currency }]; productIds: los ids que entran (promo.productIds), o null/undefined = todos.
export function promoBaseAmount(lines, productIds) {
  const set = Array.isArray(productIds) ? new Set(productIds.map(Number)) : null;
  return round2((lines || []).reduce((sum, l) => {
    if ((l.currency || "ARS") === "USD") return sum;
    if (set && !set.has(Number(l.productId))) return sum;
    return sum + (Number(l.price) || 0) * (Number(l.quantity) || 0);
  }, 0));
}

// Todo lo que necesita una pantalla, para el carrito y un tipo de cliente:
//   promo / percent / discount → lo que se descuenta hoy (promo null y 0 si no llega a ningún escalón)
//   base → lo que cuenta para la promo aplicada (solo sus productos, si es para algunos)
//   next → el próximo escalón que da MÁS que el actual: { promo, percent, minAmount, missing } o null
//   available → hay alguna promo vigente para este cliente (aunque todavía no llegue)
// Entre varias promos, la que más da con lo que el carrito tiene de cada una (igual que el servidor).
//
// itemsOrSubtotal: las líneas del carrito ([{ productId, price, quantity, currency }]): cada promo mide
// solo sus productos (24/11/2026, promos para algunas categorías o productos). Con un número, todo ese
// monto cuenta para todas, como antes (la vista previa del panel).
// Antes: cartPromoSummary(promos, subtotalArs, customerType), siempre con todo el carrito en pesos.
export function cartPromoSummary(promos, itemsOrSubtotal, customerType, now = new Date()) {
  const baseOf = (p) => (Array.isArray(itemsOrSubtotal) ? promoBaseAmount(itemsOrSubtotal, p.productIds) : (itemsOrSubtotal || 0));
  // Antes: sin el .map (cada promo con un solo juego de escalones)
  const vigentes = (promos || []).filter((p) =>
    promoAppliesTo(p, customerType) && (!p.endsAt || new Date(p.endsAt) > now))
    .map((p) => promoForCustomer(p, customerType));

  let promo = null;
  let percent = 0;
  let base = 0;
  for (const p of vigentes) {
    const b = baseOf(p);
    const tier = promoTierFor(p.tiers, b);
    if (tier && tier.percent > percent) { promo = p; percent = tier.percent; base = b; }
  }

  // El escalón que menos falta para alcanzar y que mejora el % actual
  let next = null;
  for (const p of vigentes) {
    const b = baseOf(p);
    for (const t of normalizePromoTiers(p.tiers)) {
      if (t.minAmount > b && t.percent > percent && (!next || t.minAmount - b < next.missing)) {
        next = { promo: p, percent: t.percent, minAmount: t.minAmount, missing: round2(t.minAmount - b) };
      }
    }
  }

  return { promo, percent, base, discount: round2((base * percent) / 100), next, available: vigentes.length > 0 };
}

// Las líneas del carrito (CartContext: id = productId) en la forma que espera cartPromoSummary.
export function promoLinesFromCart(items) {
  return (items || []).map((i) => ({ productId: i.id, price: i.price, quantity: i.quantity, currency: i.currency }));
}

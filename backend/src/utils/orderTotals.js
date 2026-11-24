// Totales de un pedido SEPARADOS POR MONEDA.
//
// POR QUÉ EXISTE ESTE ARCHIVO:
// El sistema no convierte monedas en ningún punto: un pedido puede tener líneas en pesos y líneas
// en dólares, y cada una se suma por su lado. Hasta ahora el backend acumulaba UN solo `total`
// sumando las dos monedas como si fueran la misma unidad, y encima calculaba el cupón y el IVA
// sobre ese número mezclado. Un pedido de $11.000 + USD 100 quedaba con total 11.100, y un cupón
// del 10% descontaba 1.110 "de algo" que no era ni pesos ni dólares.
//
// Acá se calcula todo por moneda. Lo usan las cuatro rutas que arman o modifican un pedido
// (createOrder, createManualOrder, modifyOrder y applyCouponToOrder) para que las cuatro den el
// mismo número.
//
// REGLAS DEL CUPÓN (decididas con el cliente):
// - PORCENTAJE: se aplica a cada moneda por separado. 10% off = 10% de la parte en pesos y 10% de
//   la parte en dólares.
// - MONTO FIJO: `Coupon.discountValue` está expresado EN PESOS (ver schema.prisma), así que se
//   descuenta solo de la parte en pesos. La parte en dólares queda sin descuento: aplicarle un
//   número en pesos exigiría una conversión que el sistema no hace.
//
// DESCUENTO POR MONTO (promo, ej. Black Friday — ver utils/cartPromo.js): va PRIMERO, sobre el subtotal
// en pesos, y el cupón y el descuento del vendedor se aplican después sobre lo que quedó. Solo la parte
// en pesos: los escalones están en pesos.

const { promoTierFor, promoBaseAmount } = require("./cartPromo");

// Redondeo a 2 decimales, igual que el resto del código de precios.
function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}

// La moneda de una línea. Las líneas viejas (anteriores al selector de moneda) no la tienen → ARS.
function lineCurrency(item) {
  return (item.currency || "ARS") === "USD" ? "USD" : "ARS";
}

// Suma precio × cantidad de las líneas de UNA moneda.
function sumItems(items, currency) {
  return round2(
    (items || [])
      .filter((i) => lineCurrency(i) === currency)
      .reduce((sum, i) => sum + i.price * i.quantity, 0)
  );
}

/**
 * Calcula los totales del pedido separados por moneda.
 *
 * @param {Array}  items    - líneas con { price, quantity, currency, productId }
 * @param {Object} coupon   - cupón YA VALIDADO ({ discountType, discountValue }) o null
 * @param {Object} ivaRates - null = sin factura. Si viene, es un mapa { [productId]: porcentaje }
 *                            con la alícuota de cada producto (21, 10.5, ...).
 * @param {Object} manualDiscount - descuento que puso el vendedor sobre toda la venta:
 *                            { type: "PERCENTAGE" | "FIXED", value } o null. Se aplica DESPUÉS del
 *                            cupón (sobre lo que queda) y con las mismas reglas de moneda.
 * @param {number} shippingCost - costo de envío, siempre en pesos. Se suma al total en pesos después
 *                            de todo: ni el cupón ni los descuentos lo bajan, y no lleva IVA.
 * @param {Object} promo    - descuento por monto que le toca al pedido: { tiers: [{ minAmount, percent }] }
 *                            (Order.promoRule) o null. El % sale del escalón que alcanza el subtotal en
 *                            pesos, así que si cambian los ítems el % se recalcula solo.
 * @returns {Object} subtotal / descuentos / IVA / total, por moneda.
 */
// Antes: function computeOrderTotals({ items, coupon = null, ivaRates = null, manualDiscount = null, shippingCost = 0 }) {
function computeOrderTotals({ items, coupon = null, ivaRates = null, manualDiscount = null, shippingCost = 0, promo = null }) {
  const subtotalArs = sumItems(items, "ARS");
  const subtotalUsd = sumItems(items, "USD");

  // ── Descuento por monto (promo) ────────────────────────────────────────────
  // El escalón se mide contra el subtotal de productos en pesos (sin envío, antes del IVA). Si la promo
  // es para algunos productos (promo.productIds), solo contra las líneas de esos, y el % se descuenta
  // solo de ellas. Antes: promoTierFor(promo.tiers, subtotalArs) y el % sobre subtotalArs.
  // El IVA reparte el descuento en proporción sobre todas las líneas en pesos (factorArs, abajo): con
  // productos de distinta alícuota adentro y afuera de la promo puede diferir unos centavos.
  const promoBase = promo ? (Array.isArray(promo.productIds) ? promoBaseAmount(items, promo.productIds) : subtotalArs) : 0;
  const promoTier = promo ? promoTierFor(promo.tiers, promoBase) : null;
  const promoPercent = promoTier ? promoTier.percent : 0;
  const promoDiscountArs = round2((promoBase * promoPercent) / 100);
  // Lo que queda en pesos después de la promo: sobre esto van el cupón y el descuento del vendedor.
  const despuesPromoArs = Math.max(0, subtotalArs - promoDiscountArs);

  // ── Cupón ──────────────────────────────────────────────────────────────────
  let couponDiscountArs = 0;
  let couponDiscountUsd = 0;
  if (coupon) {
    if (coupon.discountType === "PERCENTAGE") {
      // Antes: couponDiscountArs = round2((subtotalArs * coupon.discountValue) / 100);
      // Ahora sobre lo que dejó la promo (sin promo es lo mismo que antes: despuesPromoArs = subtotalArs).
      couponDiscountArs = round2((despuesPromoArs * coupon.discountValue) / 100);
      couponDiscountUsd = round2((subtotalUsd * coupon.discountValue) / 100);
    } else {
      // Monto fijo: el valor está en pesos → solo afecta la parte en pesos.
      // Nunca puede descontar más de lo que suma esa parte (no deja el total en negativo).
      // Antes: couponDiscountArs = round2(Math.min(coupon.discountValue, subtotalArs));
      couponDiscountArs = round2(Math.min(coupon.discountValue, despuesPromoArs));
      couponDiscountUsd = 0;
    }
  }

  // ── Descuento manual del vendedor ──────────────────────────────────────────
  // Va después del cupón y sobre lo que quedó, así entre los dos nunca superan el subtotal.
  let manualDiscountArs = 0;
  let manualDiscountUsd = 0;
  if (manualDiscount && manualDiscount.value > 0) {
    // Antes: const restanteArs = Math.max(0, subtotalArs - couponDiscountArs);
    // Ahora también descuenta la promo, que va primero.
    const restanteArs = Math.max(0, despuesPromoArs - couponDiscountArs);
    const restanteUsd = Math.max(0, subtotalUsd - couponDiscountUsd);
    if (manualDiscount.type === "PERCENTAGE") {
      const pct = Math.min(100, manualDiscount.value);
      manualDiscountArs = round2((restanteArs * pct) / 100);
      manualDiscountUsd = round2((restanteUsd * pct) / 100);
    } else {
      // Monto fijo: está en pesos, igual que los cupones de monto → no toca la parte en dólares.
      manualDiscountArs = round2(Math.min(manualDiscount.value, restanteArs));
      manualDiscountUsd = 0;
    }
  }

  // ── IVA ────────────────────────────────────────────────────────────────────
  // ORDEN DE LAS OPERACIONES (importante): primero se descuenta el cupón del subtotal y RECIÉN
  // AHÍ se calcula el IVA sobre esa base ya descontada.
  //
  // Antes el IVA se calculaba sobre el precio de lista y después se le restaba el cupón al total.
  // Eso equivale a regalarle al cliente también el IVA del descuento: si un pedido de $100.000 con
  // 21% llevaba 10% off, se facturaba 100.000 − 10.000 + 21.000 = $111.000, cuando la factura real
  // es sobre $90.000 → 90.000 + 18.900 = $108.900. La tienda terminaba poniendo de su bolsillo el
  // IVA de la parte descontada.
  //
  // El descuento se reparte proporcionalmente entre las líneas de la misma moneda. Hace falta
  // prorratear (y no aplicar el % suelto) porque cada producto puede tener su propia alícuota
  // (21% o 10,5%): la base de cada línea tiene que bajar en la misma proporción que el total.
  // Los dos descuentos (cupón y el manual del vendedor) bajan la base imponible.
  // La promo también: es un descuento más sobre la parte en pesos.
  // Antes: const factorArs = subtotalArs > 0 ? (subtotalArs - couponDiscountArs - manualDiscountArs) / subtotalArs : 1;
  const factorArs = subtotalArs > 0 ? (subtotalArs - promoDiscountArs - couponDiscountArs - manualDiscountArs) / subtotalArs : 1;
  const factorUsd = subtotalUsd > 0 ? (subtotalUsd - couponDiscountUsd - manualDiscountUsd) / subtotalUsd : 1;

  let ivaAmountArs = 0;
  let ivaAmountUsd = 0;
  if (ivaRates) {
    for (const item of items || []) {
      const rate   = (ivaRates[item.productId] ?? 21) / 100;
      const esUsd  = lineCurrency(item) === "USD";
      // Base imponible de la línea = precio × cantidad, ya bajada por su parte del descuento.
      const base   = item.price * item.quantity * (esUsd ? factorUsd : factorArs);
      const monto  = round2(base * rate);
      if (esUsd) ivaAmountUsd += monto;
      else ivaAmountArs += monto;
    }
    ivaAmountArs = round2(ivaAmountArs);
    ivaAmountUsd = round2(ivaAmountUsd);
  }

  // ── Totales ────────────────────────────────────────────────────────────────
  // (subtotal − cupón) + IVA — en ese orden, ver la explicación de arriba.
  // Math.max(0, ...) por las dudas: un cupón nunca puede dejar un total negativo.
  // El envío va afuera del Math.max: un cupón del 100% deja en 0 los productos, no el envío.
  // Antes: round2(Math.max(0, subtotalArs - couponDiscountArs - manualDiscountArs + ivaAmountArs))
  // Antes (sin la promo): const totalArs = round2(Math.max(0, subtotalArs - couponDiscountArs - manualDiscountArs + ivaAmountArs) + (shippingCost || 0));
  const totalArs = round2(Math.max(0, subtotalArs - promoDiscountArs - couponDiscountArs - manualDiscountArs + ivaAmountArs) + (shippingCost || 0));
  const totalUsd = round2(Math.max(0, subtotalUsd - couponDiscountUsd - manualDiscountUsd + ivaAmountUsd));

  return {
    subtotalArs, subtotalUsd,
    promoPercent, promoDiscountArs,
    couponDiscountArs, couponDiscountUsd,
    manualDiscountArs, manualDiscountUsd,
    ivaAmountArs, ivaAmountUsd,
    totalArs, totalUsd,
    hasUsd: subtotalUsd > 0 || (items || []).some((i) => lineCurrency(i) === "USD"),
  };
}

module.exports = { computeOrderTotals, sumItems, lineCurrency, round2 };

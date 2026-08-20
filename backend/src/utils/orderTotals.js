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
 * @returns {Object} subtotal / descuento / IVA / total, por moneda.
 */
function computeOrderTotals({ items, coupon = null, ivaRates = null }) {
  const subtotalArs = sumItems(items, "ARS");
  const subtotalUsd = sumItems(items, "USD");

  // ── Cupón ──────────────────────────────────────────────────────────────────
  let couponDiscountArs = 0;
  let couponDiscountUsd = 0;
  if (coupon) {
    if (coupon.discountType === "PERCENTAGE") {
      couponDiscountArs = round2((subtotalArs * coupon.discountValue) / 100);
      couponDiscountUsd = round2((subtotalUsd * coupon.discountValue) / 100);
    } else {
      // Monto fijo: el valor está en pesos → solo afecta la parte en pesos.
      // Nunca puede descontar más de lo que suma esa parte (no deja el total en negativo).
      couponDiscountArs = round2(Math.min(coupon.discountValue, subtotalArs));
      couponDiscountUsd = 0;
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
  const factorArs = subtotalArs > 0 ? (subtotalArs - couponDiscountArs) / subtotalArs : 1;
  const factorUsd = subtotalUsd > 0 ? (subtotalUsd - couponDiscountUsd) / subtotalUsd : 1;

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
  const totalArs = round2(Math.max(0, subtotalArs - couponDiscountArs + ivaAmountArs));
  const totalUsd = round2(Math.max(0, subtotalUsd - couponDiscountUsd + ivaAmountUsd));

  return {
    subtotalArs, subtotalUsd,
    couponDiscountArs, couponDiscountUsd,
    ivaAmountArs, ivaAmountUsd,
    totalArs, totalUsd,
    hasUsd: subtotalUsd > 0 || (items || []).some((i) => lineCurrency(i) === "USD"),
  };
}

module.exports = { computeOrderTotals, sumItems, lineCurrency, round2 };

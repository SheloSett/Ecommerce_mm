// Tests de los totales de un pedido (utils/orderTotals.js): cupón por moneda, descuento del vendedor e
// IVA sobre la base ya descontada. Funciones puras. Correr con: npm test
// (M9 de la auditoría: la cuenta que usan el checkout, las cotizaciones y las ventas manuales no tenía tests)

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { computeOrderTotals } = require("../src/utils/orderTotals");

const ars = (price, quantity = 1, productId = 1) => ({ price, quantity, currency: "ARS", productId });
const usd = (price, quantity = 1, productId = 2) => ({ price, quantity, currency: "USD", productId });

describe("cupón", () => {
  test("porcentaje: se aplica a cada moneda por separado", () => {
    const t = computeOrderTotals({ items: [ars(10000), usd(100)], coupon: { discountType: "PERCENTAGE", discountValue: 10 } });
    assert.deepEqual([t.couponDiscountArs, t.couponDiscountUsd, t.totalArs, t.totalUsd], [1000, 10, 9000, 90]);
  });

  test("monto fijo mayor que la parte en pesos: pesos en 0 y los dólares intactos", () => {
    const t = computeOrderTotals({ items: [ars(3000), usd(50)], coupon: { discountType: "FIXED", discountValue: 5000 } });
    assert.deepEqual([t.couponDiscountArs, t.totalArs, t.couponDiscountUsd, t.totalUsd], [3000, 0, 0, 50]);
  });
});

describe("IVA", () => {
  test("21% y 10,5% con cupón del 10%: el IVA va sobre la base ya descontada", () => {
    const t = computeOrderTotals({
      items: [ars(100000, 1, 1), ars(100000, 1, 2)],
      coupon: { discountType: "PERCENTAGE", discountValue: 10 },
      ivaRates: { 1: 21, 2: 10.5 },
    });
    assert.equal(t.ivaAmountArs, 28350);  // 90.000 × 21% + 90.000 × 10,5%
    assert.equal(t.totalArs, 208350);     // 200.000 − 20.000 + 28.350
  });

  test("sin factura no suma IVA", () => {
    assert.equal(computeOrderTotals({ items: [ars(1000)] }).ivaAmountArs, 0);
  });
});

describe("descuento del vendedor", () => {
  test("va después del cupón y sobre lo que quedó", () => {
    const t = computeOrderTotals({
      items: [ars(10000)],
      coupon: { discountType: "PERCENTAGE", discountValue: 10 },
      manualDiscount: { type: "FIXED", value: 2000 },
    });
    assert.equal(t.totalArs, 7000);
  });

  test("un porcentaje de más del 100% se acota: el total no queda negativo", () => {
    const t = computeOrderTotals({ items: [ars(5000), usd(20)], manualDiscount: { type: "PERCENTAGE", value: 150 } });
    assert.deepEqual([t.totalArs, t.totalUsd], [0, 0]);
  });
});

test("las líneas viejas sin moneda cuentan como pesos", () => {
  const t = computeOrderTotals({ items: [{ price: 1500, quantity: 2, productId: 1 }] });
  assert.deepEqual([t.totalArs, t.totalUsd, t.hasUsd], [3000, 0, false]);
});

// Tests del desglose de un pedido ya guardado (orderTotals.js) con el descuento por monto (Black Friday,
// 23/11/2026): el subtotal se reconstruye desde el total sumando los descuentos, así que si la promo no
// se sumara, el "Subtotal" de las pantallas saldría más bajo que lo que de verdad costaban los productos.
// Correr con: npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getOrderTotals, getTotalsBreakdown, promoLabel } from "./orderTotals.js";

const pedido = (fields) => ({
  items: [{ price: 100000, quantity: 2, currency: "ARS" }],
  total: 180000, couponDiscount: null, manualDiscount: null, ivaAmount: 0, shippingCost: 0, ...fields,
});

describe("descuento por monto en el desglose", () => {
  test("pedido en pesos: el subtotal vuelve a dar lo que costaban los productos", () => {
    const T = getOrderTotals(pedido({ promoDiscount: 20000, promoPercent: 10 }));
    assert.deepEqual([T.ars.subtotal, T.ars.promo, T.ars.discount, T.ars.total], [200000, 20000, 20000, 180000]);
  });

  test("con cupón y envío: cada descuento por separado y el envío afuera", () => {
    const T = getOrderTotals(pedido({ promoDiscount: 20000, couponDiscount: 18000, shippingCost: 6000, total: 168000 }));
    assert.deepEqual([T.ars.subtotal, T.ars.promo, T.ars.coupon, T.ars.discount], [200000, 20000, 18000, 38000]);
  });

  test("pedido mixto: la promo solo está en los pesos", () => {
    const T = getOrderTotals(pedido({
      items: [{ price: 100000, quantity: 2, currency: "ARS" }, { price: 50, quantity: 1, currency: "USD" }],
      promoDiscount: 20000, totalUsd: 50,
    }));
    assert.deepEqual([T.ars.subtotal, T.ars.promo, T.usd.promo, T.usd.total], [200000, 20000, 0, 50]);
  });

  test("pedido sin promo: igual que antes", () => {
    const T = getOrderTotals(pedido({ total: 200000 }));
    assert.deepEqual([T.ars.subtotal, T.ars.promo, T.ars.discount], [200000, 0, 0]);
  });

  test("las impresiones incluyen la promo en el descuento del bloque en pesos", () => {
    const { blocks } = getTotalsBreakdown(pedido({ promoDiscount: 20000 }));
    assert.equal(blocks[0].discount, 20000);
  });

  test("nombre para mostrar", () => {
    assert.equal(promoLabel({ promoRule: { name: "Black Friday" }, promoPercent: 10 }), "Black Friday (10%)");
    assert.equal(promoLabel({ promoRule: null, promoPercent: null }), "Promo");
  });
});

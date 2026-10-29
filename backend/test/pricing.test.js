// Tests del precio unitario (utils/pricing.js), el que usan el carrito, el checkout y las cotizaciones.
// Correr con: npm test
//
// Caso que los motivó (auditoría 28/10/2026): con una campaña activa, el precio por cantidad pisaba a
// la oferta aunque fuera más caro. Un mayorista con precio $10.000, tramo x10 a $9.500 y campaña del
// 20% ($8.000) pagaba 9 unidades $72.000 y 10 unidades $95.000.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { effectiveUnitPrice } = require("../src/utils/pricing");

const product = (fields) => ({
  price: 10000, salePrice: null, priceTiers: null,
  wholesalePrice: 10000, wholesaleSalePrice: null, wholesalePriceTiers: null,
  ...fields,
});

describe("precio por cantidad y oferta", () => {
  const conCampana = product({ wholesaleSalePrice: 8000, wholesalePriceTiers: [{ minQty: 10, price: 9500 }] });

  test("con campaña, llevar más unidades no sale más caro por unidad", () => {
    const precio9  = effectiveUnitPrice({ product: conCampana, variant: null, isMayorista: true, quantity: 9 });
    const precio10 = effectiveUnitPrice({ product: conCampana, variant: null, isMayorista: true, quantity: 10 });
    assert.equal(precio9, 8000);
    assert.equal(precio10, 8000);
    assert.ok(precio10 * 10 >= precio9 * 9);
  });

  test("si el tramo es más barato que la oferta, gana el tramo", () => {
    const p = product({ salePrice: 9000, priceTiers: [{ minQty: 5, price: 8500 }] });
    assert.equal(effectiveUnitPrice({ product: p, variant: null, isMayorista: false, quantity: 5 }), 8500);
    assert.equal(effectiveUnitPrice({ product: p, variant: null, isMayorista: false, quantity: 4 }), 9000);
  });

  test("sin oferta, el tramo se aplica como siempre", () => {
    const p = product({ priceTiers: [{ minQty: 3, price: 9000 }, { minQty: 10, price: 8000 }] });
    assert.equal(effectiveUnitPrice({ product: p, variant: null, isMayorista: false, quantity: 2 }), 10000);
    assert.equal(effectiveUnitPrice({ product: p, variant: null, isMayorista: false, quantity: 3 }), 9000);
    assert.equal(effectiveUnitPrice({ product: p, variant: null, isMayorista: false, quantity: 12 }), 8000);
  });

  test("con variante, la oferta y los tramos son los de la variante", () => {
    const p = product({ salePrice: 1, priceTiers: [{ minQty: 1, price: 1 }] }); // los del padre no se heredan
    const variant = { price: 5000, salePrice: 4000, priceTiers: [{ minQty: 10, price: 4500 }] };
    assert.equal(effectiveUnitPrice({ product: p, variant, isMayorista: false, quantity: 10 }), 4000);
  });
});

// Tests del cálculo de las campañas de oferta (services/offers.service.js): descuento distinto por
// público y descuento propio por producto. Solo funciones de cálculo: no toca la base.
// Correr con: npm test

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { planProduct, discountFor } = require("../src/services/offers.service");

const product = (extra = {}) => ({
  id: 1, currency: "ARS",
  price: 1000, salePrice: null,
  wholesalePrice: 800, wholesaleSalePrice: null,
  variants: [],
  ...extra,
});
const offer = (extra = {}) => ({ discountType: "PERCENTAGE", discountValue: 10, wholesaleDiscountValue: null, appliesTo: "AMBOS", ...extra });

describe("descuento por público", () => {
  test("sin descuento mayorista propio, los dos públicos usan el mismo (como antes)", () => {
    const plan = planProduct(offer(), product(), null);
    assert.equal(plan.salePrice, 900);
    assert.equal(plan.wholesaleSalePrice, 720);
  });

  test("10% minoristas y 15% mayoristas", () => {
    const plan = planProduct(offer({ wholesaleDiscountValue: 15 }), product(), null);
    assert.equal(plan.salePrice, 900);
    assert.equal(plan.wholesaleSalePrice, 680);
  });

  test("solo mayorista: usa el descuento general y no toca el precio minorista", () => {
    const plan = planProduct(offer({ appliesTo: "MAYORISTA" }), product(), null);
    assert.equal(plan.salePrice, null);
    assert.equal(plan.wholesaleSalePrice, 720);
  });

  test("monto fijo distinto por público", () => {
    const plan = planProduct(offer({ discountType: "FIXED", discountValue: 100, wholesaleDiscountValue: 50 }), product(), null);
    assert.equal(plan.salePrice, 900);
    assert.equal(plan.wholesaleSalePrice, 750);
  });
});

describe("descuento propio de un producto", () => {
  test("el del producto le gana al de la campaña, en cada público por separado", () => {
    const camp = offer({ wholesaleDiscountValue: 15 });
    const soloMin = planProduct(camp, product(), null, { discountValue: 20, wholesaleDiscountValue: null });
    assert.equal(soloMin.salePrice, 800);          // 20% propio
    assert.equal(soloMin.wholesaleSalePrice, 680); // 15% de la campaña
    const soloMay = planProduct(camp, product(), null, { discountValue: null, wholesaleDiscountValue: 25 });
    assert.equal(soloMay.salePrice, 900);          // 10% de la campaña
    assert.equal(soloMay.wholesaleSalePrice, 600); // 25% propio
  });

  test("al aplicar la campaña se usan los del OfferItem guardado", () => {
    const item = { productId: 1, discountValue: 30, wholesaleDiscountValue: null, appliedVariants: null };
    const plan = planProduct(offer(), product(), item); // sin 4º parámetro: toma los del item
    assert.equal(plan.salePrice, 700);
    assert.equal(plan.wholesaleSalePrice, 720);
  });

  test("las variantes usan el mismo descuento que su producto", () => {
    const p = product({ variants: [{ id: 5, price: 2000, salePrice: null, wholesalePrice: 1500, wholesaleSalePrice: null }] });
    const plan = planProduct(offer({ wholesaleDiscountValue: 20 }), p, null, { discountValue: 25, wholesaleDiscountValue: null });
    assert.deepEqual(plan.variants, [{ variantId: 5, salePrice: 1500, wholesaleSalePrice: 1200 }]);
  });

  test("discountFor: producto > campaña para ese público > general", () => {
    const camp = offer({ discountValue: 10, wholesaleDiscountValue: 15 });
    assert.equal(discountFor(camp, null, "retail"), 10);
    assert.equal(discountFor(camp, null, "wholesale"), 15);
    assert.equal(discountFor(offer(), null, "wholesale"), 10);
    assert.equal(discountFor(camp, { discountValue: 5 }, "retail"), 5);
    assert.equal(discountFor(camp, { discountValue: 5 }, "wholesale"), 15);
  });
});

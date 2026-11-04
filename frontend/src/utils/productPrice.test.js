// Tests del precio de lista y de oferta que usan la venta manual y "Modificar pedido" (utils/productPrice.js).
// Correr con: npm test (en frontend)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { priceParts, activeOfferName } from "./productPrice.js";

const product = { price: 14999.99, salePrice: 13499.99, wholesalePrice: 12000, wholesaleSalePrice: 10800 };

describe("priceParts", () => {
  test("minorista: lista y oferta del producto", () => {
    assert.deepEqual(priceParts(product, null, false), { list: 14999.99, offer: 13499.99, price: 13499.99 });
  });

  test("mayorista: lista y oferta mayoristas", () => {
    assert.deepEqual(priceParts(product, null, true), { list: 12000, offer: 10800, price: 10800 });
  });

  test("mayorista sin precio mayorista: el de lista minorista, sin la oferta minorista (como el checkout)", () => {
    assert.deepEqual(priceParts({ price: 100, salePrice: 80 }, null, true), { list: 100, offer: null, price: 100 });
  });

  test("una oferta que no es más barata no cuenta", () => {
    assert.deepEqual(priceParts({ price: 100, salePrice: 100 }, null, false), { list: 100, offer: null, price: 100 });
    assert.deepEqual(priceParts({ price: 100, salePrice: null }, null, false), { list: 100, offer: null, price: 100 });
  });

  test("variante: su precio y su oferta; sin precio propio cae al producto y su oferta no se hereda", () => {
    assert.deepEqual(priceParts(product, { price: 20000, salePrice: 18000 }, false), { list: 20000, offer: 18000, price: 18000 });
    assert.deepEqual(priceParts(product, { price: null, salePrice: null }, false), { list: 14999.99, offer: null, price: 14999.99 });
    assert.deepEqual(priceParts(product, { wholesalePrice: 9000, wholesaleSalePrice: null }, true), { list: 9000, offer: null, price: 9000 });
  });

  test("precios como texto o faltantes no rompen", () => {
    assert.deepEqual(priceParts({ price: "100", salePrice: "90" }, null, false), { list: 100, offer: 90, price: 90 });
    assert.deepEqual(priceParts({}, null, false), { list: 0, offer: null, price: 0 });
    assert.deepEqual(priceParts(null, null, true), { list: 0, offer: null, price: 0 });
  });
});

describe("activeOfferName", () => {
  const cyber = { offer: { id: 4, name: "Cyber Week" }, appliedSalePrice: 13499.99, appliedWholesaleSalePrice: null, appliedVariants: null };

  test("la campaña que escribió el precio de ese público", () => {
    assert.equal(activeOfferName({ offerItems: [cyber] }, false), "Cyber Week");
    assert.equal(activeOfferName({ offerItems: [cyber] }, true), null); // a mayoristas no les escribió nada
    assert.equal(activeOfferName({ offerItems: [{ ...cyber, appliedSalePrice: null, appliedVariants: [{ variantId: 1 }] }] }, true), "Cyber Week");
  });

  test("sin campaña (oferta cargada a mano) no hay nombre", () => {
    assert.equal(activeOfferName({ offerItems: [] }, false), null);
    assert.equal(activeOfferName({}, false), null);
  });
});

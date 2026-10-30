// Tests del ajuste masivo de precios (bulkPriceAdjust) con variantes (B9 de la auditoría): los precios y
// tramos PROPIOS de las variantes también se ajustan, y la campaña sigue reconociendo como suyos los
// precios de oferta que escribió en ellas. Base simulada. Correr con: npm test

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
let db;
function resetDb() {
  db = {
    products: {
      1: { id: 1, name: "Remera", currency: "ARS", price: 10000, salePrice: null, wholesalePrice: 7000, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null },
      2: { id: 2, name: "Notebook", currency: "USD", price: 900, salePrice: null, wholesalePrice: null, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null },
    },
    variants: {
      // XXL con precio y tramo propios; la campaña le escribió el precio de oferta
      11: { id: 11, productId: 1, price: 12000, salePrice: 10800, wholesalePrice: 8500, wholesaleSalePrice: null, priceTiers: [{ minQty: 6, price: 11000 }], wholesalePriceTiers: null },
      // M hereda todo del producto
      12: { id: 12, productId: 1, price: null, salePrice: null, wholesalePrice: null, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null },
      // variante de un producto en dólares: el ajuste (pensado para la inflación en pesos) no la toca
      21: { id: 21, productId: 2, price: 950, salePrice: null, wholesalePrice: null, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null },
    },
    offerItems: {
      5: { id: 5, productId: 1, appliedSalePrice: null, appliedWholesaleSalePrice: null, appliedVariants: [{ variantId: 11, salePrice: 10800, wholesaleSalePrice: null }] },
    },
  };
}
class FakePrismaClient {
  constructor() {
    this.product = {
      findMany: async ({ where }) => Object.values(db.products).filter((p) => p.currency === where.currency).map(clone),
      update: async ({ where, data }) => clone(Object.assign(db.products[where.id], clone(data))),
    };
    this.productVariant = {
      findMany: async ({ where }) => Object.values(db.variants)
        .filter((v) => db.products[v.productId].currency === where.product.currency).map(clone),
      update: async ({ where, data }) => clone(Object.assign(db.variants[where.id], clone(data))),
    };
    this.offerItem = {
      findMany: async ({ where }) => Object.values(db.offerItems)
        .filter((i) => db.products[i.productId].currency === where.product.currency).map(clone),
      update: async ({ where, data }) => clone(Object.assign(db.offerItems[where.id], clone(data))),
    };
    this.offer = { findMany: async () => [] }; // syncOffers: sin campañas que re-sincronizar
    this.$transaction = (ops) => Promise.all(ops);
  }
}
const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient, Prisma: {} });

const { bulkPriceAdjust } = require("../src/controllers/product.controller");

async function adjust(type, percent) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await bulkPriceAdjust({ body: { type, percent } }, res);
  return res;
}

describe("ajuste masivo +10% minorista", () => {
  beforeEach(resetDb);

  test("la variante con precio propio también sube, y su tramo por cantidad", async () => {
    assert.equal((await adjust("MINORISTA", 10)).code, 200);
    assert.equal(db.products[1].price, 11000);
    assert.equal(db.variants[11].price, 13200, "antes seguía en $12.000");
    assert.deepEqual(db.variants[11].priceTiers, [{ minQty: 6, price: 12100 }]);
    assert.equal(db.variants[11].wholesalePrice, 8500, "el mayorista no se toca en un ajuste minorista");
    assert.equal(db.variants[12].price, null, "la que hereda sigue heredando");
  });

  test("la campaña sigue reconociendo el precio de oferta que escribió en la variante", async () => {
    await adjust("MINORISTA", 10);
    assert.equal(db.variants[11].salePrice, 11880);
    assert.equal(db.offerItems[5].appliedVariants[0].salePrice, 11880, "si no coincide, al terminar la campaña el descuento queda pegado");
  });

  test("los productos en dólares y sus variantes quedan afuera", async () => {
    await adjust("AMBOS", 10);
    assert.equal(db.products[2].price, 900);
    assert.equal(db.variants[21].price, 950);
  });
});

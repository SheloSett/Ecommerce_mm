// Tests del RMA de Caja (POST /api/gastos con subtype "RMA", routes/gasto.routes.js): valida producto y
// variante antes de guardar, descuenta stock y actualiza la visibilidad del producto. Base simulada.
// Correr con: npm test
//
// Antes: una variante de OTRO producto descontaba stock de ese otro producto; un producto con variantes sin
// variante elegida guardaba el gasto sin tocar stock; y descontar de una variante nunca despublicaba el
// producto aunque fuera la última con stock.

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
let db;
let synced;
function resetDb() {
  db = {
    products: {
      1: { id: 1, name: "Parlante", stock: 5, stockUnlimited: false, active: true, cost: 100 },
      2: { id: 2, name: "Funda", stock: 0, stockUnlimited: false, active: true, cost: 50 }, // con variantes
      3: { id: 3, name: "Cargador", stock: 0, stockUnlimited: false, active: true, cost: 70 }, // con variantes
    },
    variants: {
      21: { id: 21, productId: 2, active: true, stock: 4, stockUnlimited: false, cost: 60 },
      22: { id: 22, productId: 2, active: false, stock: 9, stockUnlimited: false, cost: null },
      31: { id: 31, productId: 3, active: true, stock: 8, stockUnlimited: false, cost: null },
    },
    gastos: [],
  };
  synced = [];
}
class FakePrismaClient {
  constructor() {
    this.product = {
      findUnique: async ({ where }) => clone(db.products[where.id]) || null,
      update: async ({ where, data }) => clone(Object.assign(db.products[where.id], data)),
    };
    this.productVariant = {
      findUnique: async ({ where }) => clone(db.variants[where.id]) || null,
      update: async ({ where, data }) => clone(Object.assign(db.variants[where.id], data)),
      count: async ({ where }) => Object.values(db.variants).filter((v) => v.productId === where.productId && v.active === where.active).length,
    };
    this.gasto = {
      create: async ({ data }) => { const g = { id: db.gastos.length + 1, ...clone(data) }; db.gastos.push(g); return clone(g); },
    };
  }
}
const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient, Prisma: {} });
stub(path.join(root, "src/controllers/product.controller.js"), { syncProductVisibility: async (id) => { synced.push(id); } });

const router = require("../src/routes/gasto.routes");
const layer = router.stack.find((l) => l.route?.path === "/" && l.route.methods.post);
const handler = layer.route.stack[layer.route.stack.length - 1].handle;

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function rma(fields) {
  const res = fakeRes();
  await handler({ body: { amount: "100", description: "RMA: x", type: "NEGOCIO", subtype: "RMA", quantity: 1, ...fields } }, res);
  return res;
}

describe("RMA de Caja", () => {
  beforeEach(resetDb);

  test("producto sin variantes: descuenta stock y sincroniza la visibilidad", async () => {
    const res = await rma({ productId: 1, quantity: 2 });
    assert.equal(res.code, 201);
    assert.equal(db.products[1].stock, 3);
    assert.deepEqual(synced, [1]);
    assert.equal(db.gastos.length, 1);
  });

  test("variante del producto: descuenta de la variante y sincroniza el producto", async () => {
    const res = await rma({ productId: 2, variantId: 21, quantity: 3 });
    assert.equal(res.code, 201);
    assert.equal(db.variants[21].stock, 1);
    assert.equal(db.products[2].stock, 0, "el padre no se toca");
    assert.deepEqual(synced, [2], "antes no se llamaba y el producto quedaba publicado sin stock");
  });

  test("variante de OTRO producto: 400 sin guardar ni tocar stock", async () => {
    const res = await rma({ productId: 2, variantId: 31 });
    assert.equal(res.code, 400);
    assert.match(res.body.error, /Variante inválida para "Funda"/);
    assert.equal(db.variants[31].stock, 8, "antes descontaba del cargador");
    assert.equal(db.gastos.length, 0);
    assert.deepEqual(synced, []);
  });

  test("variante desactivada: 400", async () => {
    const res = await rma({ productId: 2, variantId: 22 });
    assert.equal(res.code, 400);
    assert.equal(db.variants[22].stock, 9);
    assert.equal(db.gastos.length, 0);
  });

  test("producto con variantes sin variante elegida: 400 pidiendo la variante", async () => {
    const res = await rma({ productId: 2 });
    assert.equal(res.code, 400);
    assert.match(res.body.error, /Elegí la variante de "Funda"/);
    assert.equal(db.gastos.length, 0, "antes guardaba el gasto sin descontar nada");
  });

  test("producto inexistente: 400", async () => {
    const res = await rma({ productId: 99 });
    assert.equal(res.code, 400);
    assert.equal(db.gastos.length, 0);
  });

  test("un gasto común no valida ni toca productos", async () => {
    const res = await rma({ subtype: "GASTO", productId: 2, variantId: 31 });
    assert.equal(res.code, 201);
    assert.equal(db.gastos[0].productId, null);
    assert.equal(db.variants[31].stock, 8);
    assert.deepEqual(synced, []);
  });
});

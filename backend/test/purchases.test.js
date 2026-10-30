// Tests de editar y borrar compras (purchase.controller): stock y costo promedio (B11 de la auditoría).
// Base simulada. Correr con: npm test
//
// Antes, editar una compra revertía todas sus líneas y las volvía a aplicar: si parte de lo comprado ya se
// había vendido, el stock volvía al total comprado, y el costo volvía al de antes de la compra aunque
// después hubiera habido otras compras (con solo corregir el proveedor).

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
let db;
function resetDb() {
  db = {
    products: { 1: { id: 1, name: "Cable USB", sku: "CAB-1", stock: 0, cost: 80 } },
    variants: {},
    purchases: {},
    items: {},
    nextId: 1,
  };
}
const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if ("gt" in v) return row[k] > v.gt;
    if ("not" in v) return row[k] !== v.not;
    if ("in" in v) return v.in.includes(row[k]);
  }
  return row[k] === v;
});
const purchaseWithItems = (p) => p && { ...clone(p), items: Object.values(db.items).filter((i) => i.purchaseId === p.id).map(clone) };
function createItems(purchaseId, list = []) {
  for (const data of list) { const id = db.nextId++; db.items[id] = { id, purchaseId, ...clone(data) }; }
}

class FakePrismaClient {
  constructor() {
    this.product = {
      findFirst: async ({ where }) => clone(Object.values(db.products).find((p) => matches(p, where))) || null,
      findUnique: async ({ where }) => clone(db.products[where.id]) || null,
      update: async ({ where, data }) => clone(Object.assign(db.products[where.id], data)),
      create: async ({ data }) => { const id = db.nextId++; db.products[id] = { id, ...clone(data) }; return clone(db.products[id]); },
      delete: async ({ where }) => { delete db.products[where.id]; return {}; },
    };
    this.productVariant = {
      findFirst: async ({ where }) => clone(Object.values(db.variants).find((v) => matches(v, where))) || null,
      findUnique: async ({ where }) => clone(db.variants[where.id]) || null,
      update: async ({ where, data }) => clone(Object.assign(db.variants[where.id], data)),
    };
    this.purchase = {
      findUnique: async ({ where }) => purchaseWithItems(db.purchases[where.id]) || null,
      create: async ({ data }) => {
        const id = db.nextId++;
        const { items, ...rest } = data;
        db.purchases[id] = { id, ...clone(rest) };
        createItems(id, items?.create);
        return purchaseWithItems(db.purchases[id]);
      },
      update: async ({ where, data }) => {
        const { items, ...rest } = data;
        Object.assign(db.purchases[where.id], clone(rest));
        createItems(where.id, items?.create);
        return purchaseWithItems(db.purchases[where.id]);
      },
      delete: async ({ where }) => {
        for (const i of Object.values(db.items)) if (i.purchaseId === where.id) delete db.items[i.id];
        delete db.purchases[where.id];
        return {};
      },
    };
    this.purchaseItem = {
      count: async ({ where }) => Object.values(db.items).filter((i) => matches(i, where)).length,
      update: async ({ where, data }) => clone(Object.assign(db.items[where.id], data)),
      deleteMany: async ({ where }) => {
        for (const i of Object.values(db.items)) if (matches(i, where)) delete db.items[i.id];
        return {};
      },
    };
    this.orderItem = { count: async () => 0 };
    this.supplier = { findUnique: async () => null };
    this.$transaction = (fn) => fn(this);
  }
}
const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient });
stub(require.resolve(path.join(root, "src/controllers/product.controller.js")), { deleteProductImages: async () => {} });

const { createPurchase, updatePurchase, deletePurchase } = require("../src/controllers/purchase.controller");

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function call(fn, req) { const res = fakeRes(); await fn(req, res); return res; }
const line = (quantity, cost) => ({ sku: "CAB-1", productName: "Cable USB", quantity, cost });
async function buy(quantity, cost, supplier = "Mayorista SA") {
  const res = await call(createPurchase, { body: { supplier, date: "2026-10-01", items: [line(quantity, cost)] } });
  assert.equal(res.code, 201);
  return res.body.id;
}
const edit = (id, items, supplier = "Mayorista SA") => call(updatePurchase, { params: { id: String(id) }, body: { supplier, date: "2026-10-01", items } });
const sell = (units) => { db.products[1].stock -= units; };

describe("editar una compra aplica solo la diferencia", () => {
  beforeEach(resetDb);

  test("corregir el costo con 8 de 10 ya vendidos no inventa stock", async () => {
    const id = await buy(10, 100);
    sell(8);
    assert.equal((await edit(id, [line(10, 110)])).code, 200);
    assert.equal(db.products[1].stock, 2, "antes volvía a 10");
    assert.equal(db.products[1].cost, 110);
  });

  test("corregir solo el proveedor no toca el costo promediado por una compra posterior", async () => {
    const first = await buy(10, 100);  // costo 100
    sell(8);                           // quedan 2
    await buy(10, 200);                // (100×2 + 200×10) / 12 = 183,34
    assert.equal(db.products[1].cost, 183.34);
    assert.equal((await edit(first, [line(10, 100)], "Otro proveedor")).code, 200);
    assert.equal(db.products[1].cost, 183.34, "antes bajaba a 96,67");
    assert.equal(db.products[1].stock, 12);
  });

  test("cambiar la cantidad suma o resta la diferencia", async () => {
    const id = await buy(10, 100);
    sell(3);
    assert.equal((await edit(id, [line(12, 100)])).code, 200);
    assert.equal(db.products[1].stock, 9);
  });

  test("con una compra posterior, cambiar el costo se rechaza sin tocar nada", async () => {
    const first = await buy(10, 100);
    await buy(10, 200);
    const res = await edit(first, [line(10, 150)]);
    assert.equal(res.code, 400);
    assert.match(res.body.error, /después hubo otra compra/);
    assert.equal(db.products[1].cost, 150, "sigue el promedio de las dos compras: (100×10 + 200×10) / 20");
    assert.equal(db.products[1].stock, 20);
  });

  test("sacar una línea devuelve su stock", async () => {
    db.products[2] = { id: 2, name: "Funda", sku: "FUN-1", stock: 0, cost: 50 };
    const res = await call(createPurchase, { body: { supplier: "Mayorista SA", items: [line(5, 100), { sku: "FUN-1", productName: "Funda", quantity: 4, cost: 60 }] } });
    assert.equal((await edit(res.body.id, [line(5, 100)])).code, 200);
    assert.equal(db.products[2].stock, 0);
    assert.equal(db.products[2].cost, 50, "vuelve al costo de antes (no hubo compras posteriores)");
    assert.equal(db.products[1].stock, 5);
  });
});

describe("borrar una compra", () => {
  beforeEach(resetDb);

  test("sin compras posteriores: resta el stock y vuelve al costo de antes", async () => {
    const id = await buy(10, 100);
    assert.equal((await call(deletePurchase, { params: { id: String(id) }, body: {} })).code, 200);
    assert.equal(db.products[1].stock, 0);
    assert.equal(db.products[1].cost, 80);
  });

  test("con una compra posterior: resta el stock pero no borra el promedio", async () => {
    const first = await buy(10, 100);
    await buy(10, 200);
    await call(deletePurchase, { params: { id: String(first) }, body: {} });
    assert.equal(db.products[1].stock, 10);
    assert.equal(db.products[1].cost, 150, "antes volvía a 80");
  });
});

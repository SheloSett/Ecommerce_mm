// Tests de la publicación automática de productos según el stock (B12 de la auditoría): lo que el admin
// ocultó a mano no vuelve a la tienda solo. Base simulada. Correr con: npm test

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { withStockSupport } = require("./helpers/fakeStock");

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
let db;
function resetDb() {
  db = {
    products: {
      // Tablet con stock que el admin despublicó porque el precio quedó mal cargado
      1: { id: 1, name: "Tablet", stock: 10, stockUnlimited: false, active: false, hiddenByAdmin: true, price: 1000 },
      // Pendrive que se ocultó solo, por quedarse sin stock
      2: { id: 2, name: "Pendrive", stock: 0, stockUnlimited: false, active: false, hiddenByAdmin: false, price: 500 },
    },
    movements: [],
  };
}
class FakePrismaClient {
  constructor() {
    this.product = {
      findUnique: async ({ where, include }) => {
        const p = clone(db.products[where.id]);
        if (p && include?.variants) p.variants = [];
        return p || null;
      },
      update: async ({ where, data }) => Object.assign(db.products[where.id], clone(data)),
    };
    this.productVariant = { count: async () => 0 };
    // El stock pasa por services/stock.service.js (transacción + historial)
    withStockSupport(this, { movements: () => db.movements });
  }
}
const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient, Prisma: {} });

const { syncProductVisibility, quickUpdateProduct, getProduct } = require("../src/controllers/product.controller");

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function quickUpdate(id, body) {
  const res = fakeRes();
  await quickUpdateProduct({ params: { id: String(id) }, body }, res);
  return res;
}

describe("syncProductVisibility", () => {
  beforeEach(resetDb);

  test("no republica lo que el admin ocultó a mano, aunque tenga stock", async () => {
    await syncProductVisibility(1);
    assert.equal(db.products[1].active, false);
  });

  test("sí republica lo que se ocultó solo por falta de stock, cuando vuelve el stock", async () => {
    db.products[2].stock = 5;
    await syncProductVisibility(2);
    assert.equal(db.products[2].active, true);
  });
});

describe("el switch 'Publicado' del admin", () => {
  beforeEach(resetDb);

  test("despublicar a mano lo marca como oculto por el admin, y publicar lo desmarca", async () => {
    db.products[1] = { ...db.products[1], active: true, hiddenByAdmin: false };
    await quickUpdate(1, { active: false });
    assert.deepEqual([db.products[1].active, db.products[1].hiddenByAdmin], [false, true]);
    await quickUpdate(1, { active: true });
    assert.deepEqual([db.products[1].active, db.products[1].hiddenByAdmin], [true, false]);
  });

  test("cargarle stock a un producto oculto a mano no lo republica", async () => {
    assert.equal((await quickUpdate(1, { stock: 20 })).code, 200);
    assert.equal(db.products[1].stock, 20);
    assert.equal(db.products[1].active, false);
  });

  test("cargarle stock a uno oculto por falta de stock sí lo republica (como antes)", async () => {
    await quickUpdate(2, { stock: 3 });
    assert.equal(db.products[2].active, true);
    assert.equal(db.products[2].hiddenByAdmin, false);
  });
});

describe("ficha de un producto agotado (M8)", () => {
  beforeEach(resetDb);
  async function view(id) {
    const res = fakeRes();
    await getProduct({ params: { id: String(id) }, query: {}, headers: {} }, res);
    return res;
  }

  test("se despublicó solo por falta de stock: se ve, marcado como agotado", async () => {
    const r = await view(2);
    assert.equal(r.code, 200);
    assert.equal(r.body.soldOut, true);
    assert.equal(r.body.hiddenByAdmin, undefined, "el motivo es un dato interno del panel");
  });

  test("lo ocultó el admin: sigue dando 404", async () => {
    assert.equal((await view(1)).code, 404);
  });

  test("despublicado pero con stock (todavía no se republicó): 404 como antes", async () => {
    db.products[2].stock = 4;
    assert.equal((await view(2)).code, 404);
  });
});

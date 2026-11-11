// Tests del servicio de stock (services/stock.service.js): la única puerta para cambiar el stock.
// Base simulada. Correr con: npm test
//
// La transacción simulada corre una sola a la vez, como el candado de la fila en Postgres: si el
// servicio leyera el stock FUERA de la transacción, el test de "cinco ventas a la vez" lo descubre.

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { withStockSupport } = require("./helpers/fakeStock");

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
let db;
let txCalls;
function resetDb() {
  txCalls = 0;
  db = {
    products: {
      // Parlante sin variantes, publicado
      1: { id: 1, name: "Parlante", stock: 10, stockUnlimited: false, active: true, hiddenByAdmin: false },
      // Funda con variantes (el stock vive en las variantes)
      2: { id: 2, name: "Funda", stock: 0, stockUnlimited: false, active: true, hiddenByAdmin: false },
      // Servicio de instalación, ilimitado
      3: { id: 3, name: "Instalación", stock: 0, stockUnlimited: true, active: true, hiddenByAdmin: false },
      // Tablet que el admin ocultó a mano, sin stock
      4: { id: 4, name: "Tablet", stock: 0, stockUnlimited: false, active: false, hiddenByAdmin: true },
      // Pendrive que se ocultó solo por quedarse sin stock
      5: { id: 5, name: "Pendrive", stock: 0, stockUnlimited: false, active: false, hiddenByAdmin: false },
    },
    variants: {
      21: { id: 21, productId: 2, active: true, stock: 1, stockUnlimited: false },
      22: { id: 22, productId: 2, active: true, stock: 0, stockUnlimited: false },
      23: { id: 23, productId: 2, active: false, stock: 9, stockUnlimited: false }, // inactiva: no cuenta
    },
    movements: [],
  };
}

class FakePrismaClient {
  constructor() {
    const table = (name) => ({
      findUnique: async ({ where }) => clone(db[name][where.id]) || null,
      update: async ({ where, data }) => {
        const row = db[name][where.id];
        if (!row) { const e = new Error("Record to update not found"); e.code = "P2025"; throw e; }
        Object.assign(row, clone(data));
        return clone(row);
      },
    });
    this.product = table("products");
    this.productVariant = table("variants");
    // Una transacción por vez, como si todas tocaran la misma fila.
    let chain = Promise.resolve();
    this.$transaction = (fn) => {
      txCalls++;
      const run = chain.then(() => fn(this));
      chain = run.catch(() => {});
      return run;
    };
    withStockSupport(this, {
      movements: () => db.movements,
      variantsOf: (pid) => Object.values(db.variants).filter((v) => v.productId === pid),
    });
  }
}

const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient, Prisma: {} });

const stock = require("../src/services/stock.service");
const prisma = require("../src/lib/prisma");
const { REASONS } = stock;

describe("adjustStock: sumar y restar", () => {
  beforeEach(resetDb);

  test("resta y deja anotado el antes, el después, el motivo y el pedido", async () => {
    const r = await stock.adjustStock({ productId: 1, delta: -3, reason: REASONS.VENTA, ref: { type: "order", id: 55 }, actor: "Mercado Pago" });
    assert.deepEqual([r.ok, r.before, r.after, r.applied, r.shortfall], [true, 10, 7, -3, 0]);
    assert.equal(db.products[1].stock, 7);
    assert.equal(db.movements.length, 1);
    const m = db.movements[0];
    assert.deepEqual(
      [m.productId, m.variantId, m.requested, m.delta, m.before, m.after, m.reason, m.refType, m.refId, m.actor],
      [1, null, -3, -3, 10, 7, "VENTA", "order", "55", "Mercado Pago"]
    );
    assert.equal(r.movementId, m.id);
  });

  test("no baja de 0: lo que faltó queda anotado", async () => {
    db.products[1].stock = 2;
    const r = await stock.adjustStock({ productId: 1, delta: -5, reason: REASONS.VENTA });
    assert.deepEqual([r.after, r.applied, r.shortfall], [0, -2, 3]);
    assert.deepEqual([db.movements[0].requested, db.movements[0].delta], [-5, -2]);
  });

  test("vender sin stock no cambia el número pero queda anotado el faltante", async () => {
    db.products[1].stock = 0;
    const r = await stock.adjustStock({ productId: 1, delta: -1, reason: REASONS.VENTA });
    assert.deepEqual([r.ok, r.after, r.applied, r.shortfall], [true, 0, 0, 1]);
    assert.equal(db.movements.length, 1);
  });

  test("cargar un número a mano: queda ese número y el pedido es null", async () => {
    const r = await stock.adjustStock({ productId: 1, setTo: 4, reason: REASONS.AJUSTE, actor: "Ana" });
    assert.deepEqual([r.before, r.after, r.applied], [10, 4, -6]);
    assert.deepEqual([db.movements[0].requested, db.movements[0].delta, db.movements[0].actor], [null, -6, "Ana"]);
  });

  test("cargar el mismo número que ya había no escribe ni anota nada", async () => {
    const r = await stock.adjustStock({ productId: 1, setTo: 10, reason: REASONS.AJUSTE });
    assert.deepEqual([r.ok, r.applied, r.movementId], [true, 0, null]);
    assert.equal(db.movements.length, 0);
  });

  test("con variante, el stock que cambia es el de la variante y no el del producto", async () => {
    db.variants[21].stock = 5;
    const r = await stock.adjustStock({ productId: 2, variantId: 21, delta: -2, reason: REASONS.VENTA });
    assert.deepEqual([r.productId, r.variantId, r.after], [2, 21, 3]);
    assert.equal(db.variants[21].stock, 3);
    assert.equal(db.products[2].stock, 0);
    assert.deepEqual([db.movements[0].productId, db.movements[0].variantId], [2, 21]);
  });

  test("alcanza con el id de la variante: el producto sale de la variante", async () => {
    const r = await stock.adjustStock({ variantId: 21, delta: 4, reason: REASONS.COMPRA });
    assert.deepEqual([r.ok, r.productId, r.after], [true, 2, 5]);
  });

  test("una variante de otro producto no toca nada", async () => {
    const r = await stock.adjustStock({ productId: 1, variantId: 21, delta: -1, reason: REASONS.VENTA });
    assert.deepEqual([r.ok, r.skipped], [false, "not_found"]);
    assert.equal(db.variants[21].stock, 1);
    assert.equal(db.movements.length, 0);
  });

  test("un producto que no existe no toca nada", async () => {
    const r = await stock.adjustStock({ productId: 999, delta: -1, reason: REASONS.VENTA });
    assert.deepEqual([r.ok, r.skipped], [false, "not_found"]);
  });

  test("los ilimitados no se tocan, salvo que se pida (las compras siempre sumaron)", async () => {
    const skipped = await stock.adjustStock({ productId: 3, delta: -1, reason: REASONS.VENTA });
    assert.deepEqual([skipped.ok, skipped.skipped], [false, "unlimited"]);
    assert.equal(db.products[3].stock, 0);
    const forced = await stock.adjustStock({ productId: 3, delta: 6, reason: REASONS.COMPRA, respectUnlimited: false });
    assert.deepEqual([forced.ok, forced.after], [true, 6]);
  });
});

describe("adjustStock: publicar y despublicar", () => {
  beforeEach(resetDb);

  test("un producto sin variantes que llega a 0 se despublica", async () => {
    db.products[1].stock = 1;
    await stock.adjustStock({ productId: 1, delta: -1, reason: REASONS.VENTA });
    assert.equal(db.products[1].active, false);
  });

  test("al volver el stock se republica lo que se había ocultado solo", async () => {
    await stock.adjustStock({ productId: 5, delta: 2, reason: REASONS.CANCELACION });
    assert.equal(db.products[5].active, true);
  });

  test("lo que el admin ocultó a mano no vuelve solo", async () => {
    await stock.adjustStock({ productId: 4, delta: 2, reason: REASONS.CANCELACION });
    assert.equal(db.products[4].stock, 2);
    assert.equal(db.products[4].active, false);
  });

  test("con variantes: se despublica cuando la última variante activa se queda sin stock", async () => {
    await stock.adjustStock({ productId: 2, variantId: 21, delta: -1, reason: REASONS.VENTA });
    assert.equal(db.products[2].active, false, "la variante inactiva con stock no cuenta");
  });

  test("visibility: none deja la publicación como estaba", async () => {
    db.products[1].stock = 1;
    await stock.adjustStock({ productId: 1, delta: -1, reason: REASONS.VENTA, visibility: "none" });
    assert.equal(db.products[1].stock, 0);
    assert.equal(db.products[1].active, true);
  });
});

describe("adjustStock: transacciones y avisos", () => {
  beforeEach(resetDb);

  test("cinco ventas a la vez de un producto con 3: quedan 0, tres se aplican y dos quedan como faltante", async () => {
    db.products[1].stock = 3;
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) =>
      stock.adjustStock({ productId: 1, delta: -1, reason: REASONS.VENTA, ref: { type: "order", id: n } })));
    assert.equal(db.products[1].stock, 0);
    assert.equal(results.filter((r) => r.applied === -1).length, 3);
    assert.equal(results.filter((r) => r.shortfall === 1).length, 2);
    assert.equal(db.movements.reduce((s, m) => s + m.delta, 0), -3, "el historial suma exactamente lo que bajó");
  });

  test("sin tx abre su propia transacción y avisa una vez, con la unidad", async () => {
    const seen = [];
    const off = stock.onCommitted((units) => seen.push(units));
    await stock.adjustStock({ productId: 2, variantId: 21, delta: 3, reason: REASONS.COMPRA });
    off();
    assert.equal(txCalls, 1);
    assert.deepEqual(seen, [[{ productId: 2, variantId: 21, reasons: [REASONS.COMPRA] }]]);
  });

  test("con la transacción de quien llama no abre otra, y avisa recién al terminar transaction()", async () => {
    const seen = [];
    const off = stock.onCommitted((units) => seen.push(units));
    await stock.transaction(async (tx) => {
      await stock.adjustStock({ productId: 1, delta: -1, reason: REASONS.VENTA_MANUAL, tx });
      await stock.adjustStock({ productId: 1, delta: -1, reason: REASONS.VENTA_MANUAL, tx });
      await stock.adjustStock({ productId: 2, variantId: 21, delta: -1, reason: REASONS.VENTA_MANUAL, tx });
      assert.deepEqual(seen, [], "nada se avisa antes de confirmar");
    });
    off();
    assert.equal(txCalls, 1, "una sola transacción, la de transaction()");
    assert.deepEqual(seen, [[
      { productId: 1, variantId: null, reasons: [REASONS.VENTA_MANUAL] },
      { productId: 2, variantId: 21, reasons: [REASONS.VENTA_MANUAL] },
    ]]);
  });

  test("un cambio que no movió nada no avisa", async () => {
    const seen = [];
    const off = stock.onCommitted((units) => seen.push(units));
    await stock.adjustStock({ productId: 1, setTo: 10, reason: REASONS.AJUSTE });
    await stock.adjustStock({ productId: 3, delta: -1, reason: REASONS.VENTA }); // ilimitado
    off();
    assert.deepEqual(seen, []);
  });

  test("un oyente que falla no rompe el cambio", async () => {
    const off = stock.onCommitted(() => { throw new Error("falla del oyente"); });
    const r = await stock.adjustStock({ productId: 1, delta: -1, reason: REASONS.VENTA });
    off();
    assert.equal(r.ok, true);
    assert.equal(db.products[1].stock, 9);
  });
});

describe("adjustStock: errores del que llama", () => {
  beforeEach(resetDb);

  test("delta y setTo juntos, o ninguno", async () => {
    await assert.rejects(stock.adjustStock({ productId: 1, delta: 1, setTo: 3, reason: REASONS.AJUSTE }));
    await assert.rejects(stock.adjustStock({ productId: 1, reason: REASONS.AJUSTE }));
  });

  test("números que no son enteros", async () => {
    await assert.rejects(stock.adjustStock({ productId: 1, delta: 1.5, reason: REASONS.AJUSTE }));
    await assert.rejects(stock.adjustStock({ productId: 1, setTo: "7", reason: REASONS.AJUSTE }));
  });

  test("un motivo que no existe", async () => {
    await assert.rejects(stock.adjustStock({ productId: 1, delta: 1, reason: "PORQUE_SI" }));
  });
});

describe("historial", () => {
  beforeEach(resetDb);

  test("recordInitial anota el stock con el que nace un producto, y nada si nace en 0", async () => {
    await stock.recordInitial({ productId: 1, stock: 10, actor: "Ana" });
    await stock.recordInitial({ productId: 1, stock: 0 });
    assert.equal(db.movements.length, 1);
    assert.deepEqual([db.movements[0].before, db.movements[0].after, db.movements[0].reason], [0, 10, "ALTA"]);
  });

  test("recordRemoved anota el stock que se va con una variante borrada", async () => {
    await stock.recordRemoved({ productId: 2, variantId: 21, stock: 4 });
    assert.deepEqual([db.movements[0].delta, db.movements[0].after, db.movements[0].reason], [-4, 0, "VARIANTES"]);
  });

  test("listMovements trae el historial del producto, el más nuevo primero", async () => {
    await stock.adjustStock({ productId: 1, delta: -1, reason: REASONS.VENTA });
    await stock.adjustStock({ productId: 1, delta: 5, reason: REASONS.COMPRA });
    await stock.adjustStock({ productId: 5, delta: 1, reason: REASONS.COMPRA });
    const list = await stock.listMovements(1);
    assert.deepEqual(list.map((m) => m.reason), ["COMPRA", "VENTA"]);
  });

  test("actorOf: quién, sacado de la sesión", () => {
    assert.equal(stock.actorOf({ role: "ADMIN", id: 2, name: "Ana", email: "ana@example.com" }), "Ana");
    assert.equal(stock.actorOf({ role: "SUPERADMIN", id: 1, email: "duenio@example.com" }), "duenio@example.com");
    assert.equal(stock.actorOf({ role: "CUSTOMER", id: 12 }), "Cliente #12");
    assert.equal(stock.actorOf(null), null);
  });
});

// El cliente de Prisma que usa el servicio es el mismo de toda la app (lib/prisma.js).
test("usa el cliente compartido", () => {
  assert.ok(prisma instanceof FakePrismaClient);
});

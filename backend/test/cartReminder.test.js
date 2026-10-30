// Tests del recordatorio automático de carrito abandonado (services/cartReminder.service.js, M5 de la
// auditoría): a quién le llega, con qué precios, y que no se repita. Base y envío simulados.
// Correr con: npm test

process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-prueba";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-11-27T15:30:00.000Z"); // Black Friday
const ago = (h) => new Date(NOW.getTime() - h * HOUR);
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

let db;
function resetDb() {
  db = {
    enabled: true,
    customers: {
      1: { id: 1, name: "Ana", email: "ana@example.com", type: "MINORISTA", status: "APPROVED", unsubscribeMarketing: false },
      2: { id: 2, name: "Beto", email: "beto@example.com", type: "MINORISTA", status: "APPROVED", unsubscribeMarketing: false },
    },
    products: {
      10: { id: 10, active: true, stock: 5, stockUnlimited: false, currency: "ARS", ivaRate: 21, price: 90000, salePrice: 80000, wholesalePrice: null, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null },
      11: { id: 11, active: false, stock: 0, stockUnlimited: false, currency: "ARS", ivaRate: 21, price: 5000, salePrice: null, wholesalePrice: null, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null },
    },
    carts: {},
    orders: [],
  };
}
function addCart(id, customerId, updatedAt, items, extra = {}) {
  db.carts[id] = { id, customerId, updatedAt, reminderSentAt: null, ...extra,
    items: items.map((it, i) => ({ id: id * 10 + i, cartId: id, variantId: null, name: `Producto ${it.productId}`, image: null, ...it })) };
}
const inRange = (d, r) => (!r.lte || d <= r.lte) && (!r.gte || d >= r.gte);
class FakePrismaClient {
  constructor() {
    this.siteConfig = { findUnique: async () => (db.enabled ? { key: "emailAbandonedCart", value: "true" } : null) };
    this.cart = {
      findMany: async ({ where }) => Object.values(db.carts)
        .filter((c) => inRange(c.updatedAt, where.updatedAt) && c.items.length > 0)
        .filter((c) => {
          const cu = db.customers[c.customerId];
          return cu.unsubscribeMarketing === where.customer.unsubscribeMarketing && cu.status !== where.customer.status.not;
        })
        .map((c) => ({ ...c, items: clone(c.items), customer: clone(db.customers[c.customerId]) })),
      update: async ({ where, data }) => Object.assign(db.carts[where.id], data),
    };
    this.order = { count: async ({ where }) => db.orders.filter((o) => o.customerId === where.customerId && o.createdAt > where.createdAt.gt).length };
    this.product = { findMany: async ({ where }) => where.id.in.map((id) => clone(db.products[id])).filter(Boolean) };
    this.productVariant = { findMany: async () => [] };
  }
}
const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient });
stub(path.join(root, "src/services/email.service.js"), new Proxy({}, { get: () => async () => true }));

const { runAbandonedCartReminders, PER_RUN } = require("../src/services/cartReminder.service");

let sent;
const send = async (customer, items, opts) => { sent.push({ to: customer.email, items, opts }); return true; };
const run = (extra = {}) => runAbandonedCartReminders({ now: NOW, send, ...extra });

describe("recordatorio de carrito abandonado", () => {
  beforeEach(() => { resetDb(); sent = []; });

  test("un carrito de hace 30 h recibe el aviso, con el precio de hoy y sin lo agotado", async () => {
    addCart(1, 1, ago(30), [{ productId: 10, quantity: 1, price: 90000 }, { productId: 11, quantity: 2, price: 5000 }]);
    await run();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "ana@example.com");
    assert.deepEqual(sent[0].items.map((i) => [i.productId, i.price]), [[10, 80000]], "precio con la oferta vigente, sin el agotado");
    assert.match(sent[0].opts.unsubscribe.page, /desuscribirse/, "lleva el link de baja");
    assert.equal(db.carts[1].reminderSentAt, NOW);
    assert.equal(db.carts[1].updatedAt.getTime(), ago(30).getTime(), "marcarlo no lo hace parecer recién tocado");
  });

  test("no se repite: la próxima hora no vuelve a mandar por el mismo carrito", async () => {
    addCart(1, 1, ago(30), [{ productId: 10, quantity: 1, price: 90000 }]);
    await run();
    await run({ now: new Date(NOW.getTime() + HOUR) });
    assert.equal(sent.length, 1);
  });

  test("si el cliente lo vuelve a tocar y lo deja, puede llegar otro", async () => {
    addCart(1, 1, ago(30), [{ productId: 10, quantity: 1, price: 90000 }], { reminderSentAt: ago(50) });
    await run();
    assert.equal(sent.length, 1);
  });

  test("menos de 24 h, o más de 7 días: no", async () => {
    addCart(1, 1, ago(5), [{ productId: 10, quantity: 1, price: 90000 }]);
    addCart(2, 2, ago(24 * 9), [{ productId: 10, quantity: 1, price: 90000 }]);
    await run();
    assert.equal(sent.length, 0);
  });

  test("dado de baja de las promociones, o hizo un pedido después: no", async () => {
    db.customers[1].unsubscribeMarketing = true;
    addCart(1, 1, ago(30), [{ productId: 10, quantity: 1, price: 90000 }]);
    addCart(2, 2, ago(30), [{ productId: 10, quantity: 1, price: 90000 }]);
    db.orders.push({ customerId: 2, createdAt: ago(28) });
    await run();
    assert.equal(sent.length, 0);
    assert.equal(db.carts[2].reminderSentAt, NOW, "el salteado queda marcado para no revisarlo cada hora");
  });

  test("si el email no sale (SMTP caído), no lo marca: se reintenta", async () => {
    addCart(1, 1, ago(30), [{ productId: 10, quantity: 1, price: 90000 }]);
    await runAbandonedCartReminders({ now: NOW, send: async () => false });
    assert.equal(db.carts[1].reminderSentAt, null);
  });

  test("apagado (como arranca): no manda nada", async () => {
    db.enabled = false;
    addCart(1, 1, ago(30), [{ productId: 10, quantity: 1, price: 90000 }]);
    assert.deepEqual(await run(), { skipped: true });
    assert.equal(sent.length, 0);
  });

  test(`a lo sumo ${PER_RUN} por hora`, async () => {
    for (let i = 1; i <= PER_RUN + 5; i++) {
      db.customers[100 + i] = { id: 100 + i, name: `C${i}`, email: `c${i}@example.com`, type: "MINORISTA", status: "APPROVED", unsubscribeMarketing: false };
      addCart(100 + i, 100 + i, ago(30), [{ productId: 10, quantity: 1, price: 90000 }]);
    }
    await run();
    assert.equal(sent.length, PER_RUN);
  });
});

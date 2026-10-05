// Tests del carrito al pagar y del webhook de MercadoPago, con MP y la base simulados.
// Correr con: npm test
//
// Casos reales que los motivaron: un cliente pagó con MP desde incógnito, MP lo devolvió al Chrome
// normal y el carrito quedó cargado; y la pestaña de incógnito mostró "Pago rechazado" con el
// pedido ya cobrado.

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

delete process.env.MP_WEBHOOK_SECRET; // sin firma: el webhook se procesa sin validarla

// ── Base simulada ────────────────────────────────────────────────────────────
let db;
function resetDb() {
  db = {
    orders: {
      10: {
        id: 10, status: "PENDING", customerId: 7, couponId: null, stockDeducted: false, mpPaymentId: null,
        customerEmail: "rayo@example.com",
        items: [{ productId: 1, variantId: null, quantity: 1 }], // el cable de $1.000
      },
    },
    carts: {
      // carrito del cliente 7: el cable (comprado) y otra cosa que agregó después (no comprada)
      7: { id: 70, customerId: 7, items: [{ id: 701, productId: 1, variantId: null }, { id: 702, productId: 2, variantId: null }] },
    },
  };
}
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

class FakePrismaClient {
  constructor() {
    this.order = {
      findUnique: async ({ where }) => clone(db.orders[where.id]) || null,
      update: async ({ where, data }) => Object.assign(db.orders[where.id], data),
    };
    this.product = {
      findUnique: async () => ({ stockUnlimited: true }), // sin stock que descontar
      update: async () => ({}),
    };
    this.productVariant = { findUnique: async () => null, update: async () => ({}) };
    this.couponUsage = { findFirst: async () => null, create: async () => ({}) };
    this.cart = {
      findUnique: async ({ where }) => clone(db.carts[where.customerId]) || null,
      delete: async ({ where }) => {
        for (const k of Object.keys(db.carts)) if (db.carts[k].id === where.id) delete db.carts[k];
      },
    };
    this.cartItem = {
      deleteMany: async ({ where }) => {
        for (const c of Object.values(db.carts)) c.items = c.items.filter((i) => !where.id.in.includes(i.id));
      },
    };
  }
}

// ── MercadoPago simulado ─────────────────────────────────────────────────────
const mp = { payments: {}, searchResults: [] };
class Payment {
  async get({ id }) { return mp.payments[id]; }
  async search() { return { results: mp.searchResults }; }
}

function stub(modulePath, exportsObj) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}
const root = path.join(__dirname, "..");
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient });
stub(require.resolve("mercadopago", { paths: [root] }), { MercadoPagoConfig: class {}, Preference: class {}, Payment });
stub(path.join(root, "src/services/email.service.js"), {
  sendOrderNotificationToAdmin: async () => {},
  sendOrderConfirmationToCustomer: async () => {},
});

const { handleWebhook, getOrderPaymentStatus } = require("../src/controllers/payment.controller");
const { removeOrderedItemsFromCart } = require("../src/utils/cartCleanup");

const webhookReq = (paymentId) => ({ query: { type: "payment", "data.id": String(paymentId) }, body: Buffer.from("{}"), headers: {} });
const fakeRes = () => ({ code: null, body: null, sendStatus(c) { this.code = c; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const cartProducts = () => (db.carts[7] ? db.carts[7].items.map((i) => i.productId) : null);

describe("removeOrderedItemsFromCart", () => {
  beforeEach(resetDb);

  test("saca solo lo comprado y deja lo que se agregó aparte", async () => {
    assert.equal(await removeOrderedItemsFromCart(new FakePrismaClient(), 10), 1);
    assert.deepEqual(cartProducts(), [2]);
  });

  test("si compró todo, el carrito se borra", async () => {
    db.carts[7].items = [{ id: 701, productId: 1, variantId: null }];
    await removeOrderedItemsFromCart(new FakePrismaClient(), 10);
    assert.equal(db.carts[7], undefined);
  });

  test("respeta la variante: otra variante del mismo producto queda en el carrito", async () => {
    db.orders[10].items = [{ productId: 1, variantId: 5, quantity: 1 }];
    db.carts[7].items = [{ id: 701, productId: 1, variantId: 5 }, { id: 703, productId: 1, variantId: 6 }];
    await removeOrderedItemsFromCart(new FakePrismaClient(), 10);
    assert.deepEqual(db.carts[7].items.map((i) => i.variantId), [6]);
  });

  test("pedido sin cuenta: no toca nada", async () => {
    db.orders[10].customerId = null;
    assert.equal(await removeOrderedItemsFromCart(new FakePrismaClient(), 10), 0);
    assert.deepEqual(cartProducts(), [1, 2]);
  });
});

describe("webhook de MercadoPago", () => {
  beforeEach(() => { resetDb(); mp.payments = {}; mp.searchResults = []; });

  test("pago aprobado: el pedido queda abonado y lo comprado sale del carrito", async () => {
    mp.payments[111] = { id: 111, status: "approved", external_reference: "10" };
    const res = fakeRes();
    await handleWebhook(webhookReq(111), res);
    assert.equal(res.code, 200);
    assert.equal(db.orders[10].status, "APPROVED");
    assert.equal(db.orders[10].mpPaymentId, "111");
    assert.deepEqual(cartProducts(), [2]);
  });

  test("el aviso de OTRO intento rechazado no pisa un pedido ya abonado", async () => {
    Object.assign(db.orders[10], { status: "APPROVED", mpPaymentId: "111" });
    mp.payments[222] = { id: 222, status: "rejected", external_reference: "10" };
    await handleWebhook(webhookReq(222), fakeRes());
    assert.equal(db.orders[10].status, "APPROVED");
    assert.equal(db.orders[10].mpPaymentId, "111");
  });

  test("pago rechazado de un pedido pendiente: queda rechazado y el carrito no se toca", async () => {
    mp.payments[333] = { id: 333, status: "rejected", external_reference: "10" };
    await handleWebhook(webhookReq(333), fakeRes());
    assert.equal(db.orders[10].status, "REJECTED");
    assert.deepEqual(cartProducts(), [1, 2]);
  });
});

describe("estado del pago consultado desde la pantalla de resultado", () => {
  beforeEach(() => { resetDb(); mp.payments = {}; mp.searchResults = []; });

  test("con un intento aprobado y otro rechazado más nuevo, manda el aprobado", async () => {
    mp.searchResults = [
      { id: 444, status: "approved", external_reference: "10", date_created: "2026-10-01T10:00:00Z" },
      { id: 555, status: "rejected", external_reference: "10", date_created: "2026-10-01T10:05:00Z" },
    ];
    const res = fakeRes();
    await getOrderPaymentStatus({ params: { orderId: "10" }, query: {} }, res);
    assert.equal(res.body.status, "APPROVED");
    assert.equal(db.orders[10].status, "APPROVED");
    assert.deepEqual(cartProducts(), [2]);
  });
});

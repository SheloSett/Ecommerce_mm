// Tests del checkout y del cobro por Mercado Pago, con la base, MP, los emails y Meta simulados.
// Correr con: npm test
//
// Cada caso es un ataque o un error real que encontró la auditoría del 28/10/2026 y que ya no tiene
// que poder pasar:
//  - comprar un producto caro con la variante de uno barato (el precio salía de la variante ajena);
//  - conseguir precio mayorista mandando el id o el email de un mayorista, sin su sesión;
//  - Mercado Pago cobraba la suma de los productos sin el cupón, el descuento ni el IVA;
//  - el aviso de pago aprobaba el pedido sin mirar cuánto se pagó;
//  - el estado de pago público mostraba nombre, productos y total de cualquier pedido.

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.FRONTEND_URL = "https://tienda.test"; // pública: así las preferencias llevan back_urls
delete process.env.MP_WEBHOOK_SECRET; // sin firma: el webhook se procesa sin validarla

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

// ── Base simulada ────────────────────────────────────────────────────────────
let db;
function resetDb() {
  db = {
    customers: {
      5: { id: 5, email: "mayo@example.com", type: "MAYORISTA", status: "APPROVED" },
      6: { id: 6, email: "rech@example.com", type: "MAYORISTA", status: "REJECTED" },
      7: { id: 7, email: "mini@example.com", type: "MINORISTA", status: "APPROVED" },
    },
    products: {
      // Notebook cara, sin variantes
      1: { id: 1, name: "Notebook", active: true, visibility: "AMBOS", currency: "ARS", price: 2000000, salePrice: null,
           wholesalePrice: 1600000, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null, stock: 5, stockUnlimited: false, images: [] },
      // Cable barato, con variantes (Negro y Blanco activas, Rojo inactiva)
      2: { id: 2, name: "Cable", active: true, visibility: "AMBOS", currency: "ARS", price: 500, salePrice: null,
           wholesalePrice: 400, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null, stock: 0, stockUnlimited: false, images: [] },
      // Funda con variantes que solo ven los minoristas
      3: { id: 3, name: "Funda", active: true, visibility: "AMBOS", currency: "ARS", price: 3000, salePrice: null,
           wholesalePrice: 2000, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null, stock: 0, stockUnlimited: false, images: [] },
    },
    variants: {
      21: { id: 21, productId: 2, active: true, visibility: "AMBOS", combination: [{ name: "Color", value: "Negro" }], stock: 50, stockUnlimited: false, sku: "CAB-N", price: 500 },
      22: { id: 22, productId: 2, active: false, visibility: "AMBOS", combination: [{ name: "Color", value: "Rojo" }], stock: 50, stockUnlimited: false, sku: "CAB-R", price: 1 },
      23: { id: 23, productId: 2, active: true, visibility: "AMBOS", combination: [{ name: "Color", value: "Blanco" }], stock: 40, stockUnlimited: false, sku: "CAB-B", price: 500 },
      31: { id: 31, productId: 3, active: true, visibility: "MINORISTA", combination: [{ name: "Color", value: "Azul" }], stock: 10, stockUnlimited: false, sku: "FUN-A", price: 3000 },
    },
    coupons: {
      1: { id: 1, code: "PERSONAL10", active: true, discountType: "PERCENTAGE", discountValue: 10, customerId: 7, expiresAt: null, minPurchase: null, maxUses: null, maxUsesPerCustomer: null },
      2: { id: 2, code: "TODOS10", active: true, discountType: "PERCENTAGE", discountValue: 10, customerId: null, expiresAt: null, minPurchase: null, maxUses: null, maxUsesPerCustomer: null },
      3: { id: 3, code: "UNAVEZ", active: true, discountType: "PERCENTAGE", discountValue: 50, customerId: null, expiresAt: null, minPurchase: null, maxUses: 1, maxUsesPerCustomer: null },
    },
    couponUsages: [],
    orders: {},
    nextOrderId: 100,
    nextItemId: 1000,
  };
}

function applyData(target, data) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !Array.isArray(v) && ("decrement" in v || "increment" in v)) {
      target[k] = (target[k] || 0) - (v.decrement || 0) + (v.increment || 0);
    } else target[k] = v;
  }
  return target;
}
const itemsWithProduct = (order) => order.items.map((i) => ({ ...clone(i), product: i.productId ? clone(db.products[i.productId]) : null }));

class FakePrismaClient {
  constructor() {
    this.customer = {
      findUnique: async ({ where }) => clone(db.customers[where.id]) || null,
      // La búsqueda por email que hacía el checkout viejo (para comparar contra el código anterior)
      findFirst: async ({ where }) => clone(Object.values(db.customers)
        .find((c) => c.email === String(where.email?.equals || "").toLowerCase())) || null,
    };
    this.product = {
      findUnique: async ({ where }) => clone(db.products[where.id]) || null,
      findMany: async ({ where }) => Object.values(db.products).filter((p) => !where?.id?.in || where.id.in.includes(p.id)).map(clone),
      update: async ({ where, data }) => clone(applyData(db.products[where.id], data)),
    };
    this.productVariant = {
      findMany: async ({ where }) => Object.values(db.variants)
        .filter((v) => v.productId === where.productId && (where.active === undefined || v.active === where.active)).map(clone),
      findUnique: async ({ where }) => clone(db.variants[where.id]) || null,
      update: async ({ where, data }) => clone(applyData(db.variants[where.id], data)),
      count: async ({ where }) => Object.values(db.variants).filter((v) => v.productId === where.productId && (where.active === undefined || v.active === where.active)).length,
    };
    this.siteConfig = { findMany: async () => [], findUnique: async () => null };
    this.coupon = {
      findUnique: async ({ where }) => {
        const c = Object.values(db.coupons).find((x) => x.code === where.code);
        return c ? { ...clone(c), customer: c.customerId ? { email: db.customers[c.customerId].email } : null } : null;
      },
    };
    this.couponUsage = {
      count: async ({ where }) => db.couponUsages.filter((u) => u.couponId === where.couponId && (!where.customerEmail || u.customerEmail === where.customerEmail)).length,
      findFirst: async ({ where }) => clone(db.couponUsages.find((u) => u.orderId === where.orderId)) || null,
      create: async ({ data }) => { db.couponUsages.push({ ...data }); return data; },
    };
    this.order = {
      create: async ({ data }) => {
        const id = db.nextOrderId++;
        const { items, ...rest } = data;
        db.orders[id] = { id, status: "PENDING", stockDeducted: false, mpPaymentId: null, ...clone(rest),
          items: (items?.create || []).map((i) => ({ id: db.nextItemId++, orderId: id, ...clone(i) })) };
        return { ...clone(db.orders[id]), items: itemsWithProduct(db.orders[id]), coupon: null };
      },
      findUnique: async ({ where }) => {
        const o = db.orders[where.id];
        return o ? { ...clone(o), items: itemsWithProduct(o), coupon: o.couponId ? clone(db.coupons[o.couponId]) || null : null } : null;
      },
      update: async ({ where, data }) => clone(applyData(db.orders[where.id], data)),
      // claimApproval: aprueba solo si todavía no estaba aprobado (una sola operación)
      updateMany: async ({ where, data }) => {
        const o = db.orders[where.id];
        if (!o || (where.status?.not && o.status === where.status.not)) return { count: 0 };
        applyData(o, data);
        return { count: 1 };
      },
    };
    this.orderItem = { findMany: async ({ where }) => itemsWithProduct(db.orders[where.orderId]) };
    this.cart = { findUnique: async () => null };
    this.$executeRawUnsafe = async () => 0;
  }
}

// ── Mercado Pago simulado ────────────────────────────────────────────────────
const mp = { payments: {}, searchResults: [], preferences: [] };
class Payment {
  async get({ id }) { return clone(mp.payments[id]); }
  async search() { return { results: clone(mp.searchResults) }; }
}
class Preference {
  async create({ body }) { mp.preferences.push(clone(body)); return { id: `pref-${mp.preferences.length}`, init_point: "https://mp.test/pagar" }; }
}

function stub(modulePath, exportsObj) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}
const root = path.join(__dirname, "..");
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient, Prisma: {} });
stub(require.resolve("mercadopago", { paths: [root] }), { MercadoPagoConfig: class {}, Preference, Payment });
// Ningún email sale: cualquier función del servicio solo anota que se la llamó.
const emailsSent = [];
stub(path.join(root, "src/services/email.service.js"), new Proxy({}, { get: (_t, name) => async () => { emailsSent.push(String(name)); } }));
stub(path.join(root, "src/services/meta.service.js"), { browserDataFromRequest: () => null, sendPurchaseEvent: async () => ({}) });
stub(path.join(root, "src/controllers/product.controller.js"), { syncProductVisibility: async () => {} });
stub(path.join(root, "src/config/cloudinary.js"), { uploadBuffer: async () => ({}) });
stub(path.join(root, "src/sse/notificationSSE.js"), { pushToClient: () => {} });

const { createOrder } = require("../src/controllers/order.controller");
const { createPreference, handleWebhook, getOrderPaymentStatus } = require("../src/controllers/payment.controller");

// ── Helpers ──────────────────────────────────────────────────────────────────
const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, sendStatus(c) { this.code = c; return this; } });
const tokenOf = (id) => jwt.sign({ id, role: "CUSTOMER" }, process.env.JWT_SECRET);
const auth = (token) => (token ? { authorization: `Bearer ${token}` } : {});

async function placeOrder(body, token) {
  const res = fakeRes();
  await createOrder({
    body: { customerName: "Ana Test", customerEmail: "ana@example.com", customerPhone: "1122334455", paymentMethod: "MERCADOPAGO", ...body },
    headers: auth(token),
  }, res);
  return res;
}
const orderCount = () => Object.keys(db.orders).length;
const webhookReq = (paymentId) => ({ query: { type: "payment", "data.id": String(paymentId) }, body: Buffer.from("{}"), headers: {} });
function seedOrder(fields) {
  const id = db.nextOrderId++;
  db.orders[id] = { id, status: "PENDING", paymentMethod: "MERCADOPAGO", stockDeducted: false, mpPaymentId: null, customerId: null,
    customerName: "Ana Test", customerEmail: "ana@example.com", couponId: null, total: 2000000,
    items: [{ id: db.nextItemId++, orderId: id, productId: 1, variantId: null, quantity: 1, price: 2000000, currency: "ARS" }], ...fields };
  return id;
}

// ── Variantes ────────────────────────────────────────────────────────────────
describe("checkout: la variante tiene que ser del producto", () => {
  beforeEach(resetDb);

  test("la variante de OTRO producto se rechaza (antes la notebook salía al precio del cable)", async () => {
    const res = await placeOrder({ items: [{ productId: 1, variantId: 21, quantity: 1 }] });
    assert.equal(res.code, 400);
    assert.equal(orderCount(), 0);
  });

  test("una variante inactiva se rechaza", async () => {
    const res = await placeOrder({ items: [{ productId: 2, variantId: 22, quantity: 1 }] });
    assert.equal(res.code, 400);
    assert.equal(orderCount(), 0);
  });

  test("con la variante correcta, el precio sale de ella y la etiqueta la arma el servidor", async () => {
    const res = await placeOrder({ items: [{ productId: 2, variantId: 21, quantity: 2, variantLabel: "<b>inventada</b>" }] });
    assert.equal(res.code, 201);
    const [item] = db.orders[res.body.id].items;
    assert.equal(item.price, 500);
    assert.equal(item.variantId, 21);
    assert.equal(item.variantLabel, "Color: Negro");
  });

  test("un producto con opciones no se compra sin elegir una", async () => {
    const res = await placeOrder({ items: [{ productId: 2, quantity: 1 }] });
    assert.equal(res.code, 400);
    assert.equal(orderCount(), 0);
  });

  test("la cotización de un mayorista sí va sin variante si no ve las opciones (se las asigna el admin)", async () => {
    const res = await placeOrder({ customerId: 5, paymentMethod: "COTIZACION", items: [{ productId: 3, quantity: 1 }] }, tokenOf(5));
    assert.equal(res.code, 201);
  });

  test("se mira el stock de la variante elegida, no la suma de todas", async () => {
    // Negro tiene 50 y Blanco 40: antes 60 negros pasaban porque la suma daba 90.
    const res = await placeOrder({ items: [{ productId: 2, variantId: 21, quantity: 60 }] });
    assert.equal(res.code, 400);
    assert.equal(orderCount(), 0);
  });
});

// ── Quién compra ─────────────────────────────────────────────────────────────
describe("checkout: quién compra sale de la sesión, no de lo que manda el navegador", () => {
  beforeEach(resetDb);

  test("el customerId de un mayorista sin su sesión se rechaza", async () => {
    const res = await placeOrder({ customerId: 5, items: [{ productId: 1, quantity: 1 }] });
    assert.equal(res.code, 401);
    assert.equal(orderCount(), 0);
  });

  test("el customerId de OTRO cliente con mi sesión se rechaza", async () => {
    const res = await placeOrder({ customerId: 5, items: [{ productId: 1, quantity: 1 }] }, tokenOf(7));
    assert.equal(res.code, 401);
  });

  test("el email de un mayorista sin sesión: precio minorista y el pedido no queda en su cuenta", async () => {
    const res = await placeOrder({ customerEmail: "mayo@example.com", items: [{ productId: 1, quantity: 1 }] });
    assert.equal(res.code, 201);
    const order = db.orders[res.body.id];
    assert.equal(order.items[0].price, 2000000);
    assert.equal(order.customerType, "MINORISTA");
    assert.equal(order.customerId, null);
  });

  test("un mayorista aprobado con su sesión compra a precio mayorista", async () => {
    const res = await placeOrder({ customerId: 5, paymentMethod: "COTIZACION", items: [{ productId: 1, quantity: 1 }] }, tokenOf(5));
    assert.equal(res.code, 201);
    const order = db.orders[res.body.id];
    assert.equal(order.items[0].price, 1600000);
    assert.equal(order.customerType, "MAYORISTA");
    assert.equal(order.customerId, 5);
  });

  // Antes: "un mayorista rechazado paga precio minorista" (201 a precio minorista). Desde A5 una cuenta
  // RECHAZADA ya no tiene sesión válida (el login tampoco la deja entrar): el checkout pide volver a
  // iniciar sesión, y en ningún caso sale a precio mayorista.
  test("una cuenta rechazada ya no tiene sesión: no compra, y menos a precio mayorista", async () => {
    const res = await placeOrder({ customerId: 6, items: [{ productId: 1, quantity: 1 }] }, tokenOf(6));
    assert.equal(res.code, 401);
    assert.equal(orderCount(), 0);
  });

  test("el cupón personal de otro cliente no se aplica escribiendo su email", async () => {
    const res = await placeOrder({ customerEmail: "mini@example.com", couponCode: "PERSONAL10", items: [{ productId: 1, quantity: 1 }] });
    assert.equal(res.code, 201);
    assert.equal(db.orders[res.body.id].couponId, undefined);
    assert.equal(db.orders[res.body.id].total, 2000000);
  });

  test("el dueño del cupón personal sí lo usa con su sesión", async () => {
    const res = await placeOrder({ customerId: 7, customerEmail: "mini@example.com", couponCode: "PERSONAL10", items: [{ productId: 1, quantity: 1 }] }, tokenOf(7));
    assert.equal(res.code, 201);
    assert.equal(db.orders[res.body.id].couponId, 1);
    assert.equal(db.orders[res.body.id].total, 1800000);
  });
});

// ── Preferencia de Mercado Pago ──────────────────────────────────────────────
describe("Mercado Pago cobra el total del pedido", () => {
  beforeEach(() => { resetDb(); mp.preferences = []; });

  const prefTotal = (pref) => pref.items.reduce((s, i) => s + i.unit_price * i.quantity, 0);

  test("con cupón, la preferencia suma el total ya descontado", async () => {
    const order = await placeOrder({ couponCode: "TODOS10", items: [{ productId: 1, quantity: 1 }] });
    assert.equal(db.orders[order.body.id].total, 1800000);
    const res = fakeRes();
    await createPreference({ body: { orderId: order.body.id } }, res);
    assert.equal(res.code, 200);
    assert.equal(prefTotal(mp.preferences[0]), 1800000);
  });

  test("sin descuentos, van los productos tal cual", async () => {
    const order = await placeOrder({ items: [{ productId: 2, variantId: 21, quantity: 2 }] });
    await createPreference({ body: { orderId: order.body.id } }, fakeRes());
    assert.deepEqual(mp.preferences[0].items.map((i) => [i.title, i.unit_price, i.quantity]), [["Cable", 500, 2]]);
  });

  test("con envío en moto, el envío va como una línea más y se cobra el total", async () => {
    const order = await placeOrder({
      items: [{ productId: 2, variantId: 21, quantity: 2 }],
      shippingMethod: "MOTO",
      shippingAddress: { streetName: "Rivadavia", streetNumber: "100", city: "Morón", provinceCode: "B", postalCode: "1708" },
    });
    assert.equal(order.code, 201);
    assert.equal(db.orders[order.body.id].total, 7200);
    await createPreference({ body: { orderId: order.body.id } }, fakeRes());
    assert.deepEqual(mp.preferences[0].items.map((i) => [i.title, i.unit_price, i.quantity]), [["Cable", 500, 2], ["Envío", 6200, 1]]);
    assert.equal(prefTotal(mp.preferences[0]), 7200);
  });

  test("con cupón y envío, una sola línea con el total", async () => {
    const order = await placeOrder({
      couponCode: "TODOS10",
      items: [{ productId: 1, quantity: 1 }],
      shippingMethod: "MOTO",
      shippingAddress: { streetName: "Rivadavia", streetNumber: "100", city: "Morón", provinceCode: "B", postalCode: "1708" },
    });
    assert.equal(db.orders[order.body.id].total, 1806200, "el cupón no le descuenta al envío");
    await createPreference({ body: { orderId: order.body.id } }, fakeRes());
    assert.equal(mp.preferences[0].items.length, 1);
    assert.equal(prefTotal(mp.preferences[0]), 1806200);
  });

  test("un pedido que no es de Mercado Pago no genera link de pago", async () => {
    const id = seedOrder({ paymentMethod: "COTIZACION" });
    const res = fakeRes();
    await createPreference({ body: { orderId: id } }, res);
    assert.equal(res.code, 400);
    assert.equal(mp.preferences.length, 0);
  });
});

// ── Aviso de pago ────────────────────────────────────────────────────────────
describe("aviso de pago: el monto tiene que coincidir con el pedido", () => {
  beforeEach(() => { resetDb(); mp.payments = {}; });

  test("un pago aprobado por menos plata no aprueba el pedido ni descuenta stock", async () => {
    const id = seedOrder({ total: 2000000 });
    mp.payments[900] = { id: 900, status: "approved", external_reference: String(id), transaction_amount: 100, currency_id: "ARS" };
    await handleWebhook(webhookReq(900), fakeRes());
    assert.equal(db.orders[id].status, "PAYMENT_REVIEW");
    assert.equal(db.orders[id].seenByAdmin, false);
    assert.equal(db.products[1].stock, 5);
  });

  test("un pago aprobado de un pedido cancelado queda para revisar", async () => {
    const id = seedOrder({ status: "CANCELLED" });
    mp.payments[901] = { id: 901, status: "approved", external_reference: String(id), transaction_amount: 2000000, currency_id: "ARS" };
    await handleWebhook(webhookReq(901), fakeRes());
    assert.equal(db.orders[id].status, "PAYMENT_REVIEW");
    assert.equal(db.products[1].stock, 5);
  });

  test("el monto justo lo aprueba y descuenta el stock", async () => {
    const id = seedOrder({});
    mp.payments[902] = { id: 902, status: "approved", external_reference: String(id), transaction_amount: 2000000, currency_id: "ARS" };
    await handleWebhook(webhookReq(902), fakeRes());
    assert.equal(db.orders[id].status, "APPROVED");
    assert.equal(db.products[1].stock, 4);
  });

  test("con variante, el pago descuenta de la variante y no del producto", async () => {
    const id = seedOrder({ total: 1000, items: [{ id: 5001, orderId: 0, productId: 2, variantId: 21, quantity: 2, price: 500, currency: "ARS" }] });
    db.orders[id].items[0].orderId = id;
    mp.payments[910] = { id: 910, status: "approved", external_reference: String(id), transaction_amount: 1000, currency_id: "ARS" };
    await handleWebhook(webhookReq(910), fakeRes());
    assert.equal(db.orders[id].status, "APPROVED");
    assert.equal(db.variants[21].stock, 48);
    assert.equal(db.products[2].stock, 0);
    assert.equal(db.orders[id].stockDeducted, true);
  });

  test("volver de MP antes que el aviso: igual se registra el cupón y salen los emails", async () => {
    const id = seedOrder({ couponId: 2, total: 1800000 });
    mp.searchResults = [{ id: 906, status: "approved", external_reference: String(id), transaction_amount: 1800000, currency_id: "ARS", date_created: "2026-10-30T10:00:00Z" }];
    emailsSent.length = 0;
    await getOrderPaymentStatus({ params: { orderId: String(id) }, query: {}, headers: {} }, fakeRes());
    assert.equal(db.orders[id].status, "APPROVED");
    assert.equal(db.couponUsages.length, 1);
    assert.ok(emailsSent.includes("sendOrderNotificationToAdmin"), "email al admin");
    assert.ok(emailsSent.includes("sendOrderConfirmationToCustomer"), "email al cliente");
  });

  test("el aviso y la pantalla de resultado a la vez: el stock se descuenta una sola vez", async () => {
    const id = seedOrder({});
    const payment = { id: 907, status: "approved", external_reference: String(id), transaction_amount: 2000000, currency_id: "ARS", date_created: "2026-10-30T10:00:00Z" };
    mp.payments[907] = payment;
    mp.searchResults = [payment];
    emailsSent.length = 0;
    await Promise.all([
      handleWebhook(webhookReq(907), fakeRes()),
      getOrderPaymentStatus({ params: { orderId: String(id) }, query: {}, headers: {} }, fakeRes()),
      handleWebhook(webhookReq(907), fakeRes()), // MP a veces repite el aviso
    ]);
    assert.equal(db.orders[id].status, "APPROVED");
    assert.equal(db.products[1].stock, 4);
    assert.equal(emailsSent.filter((n) => n === "sendOrderNotificationToAdmin").length, 1);
  });

  test("si ya no queda stock cuando llega el pago, queda para revisar (no se venden unidades que no hay)", async () => {
    const id = seedOrder({ total: 12000000, items: [{ id: 5000, orderId: 0, productId: 1, variantId: null, quantity: 6, price: 2000000, currency: "ARS" }] });
    db.orders[id].items[0].orderId = id;
    mp.payments[908] = { id: 908, status: "approved", external_reference: String(id), transaction_amount: 12000000, currency_id: "ARS" };
    await handleWebhook(webhookReq(908), fakeRes());
    assert.equal(db.orders[id].status, "PAYMENT_REVIEW");
    assert.equal(db.products[1].stock, 5);
  });

  test("un cupón de un solo uso que ya se usó en otro pedido: el segundo pago queda para revisar", async () => {
    db.couponUsages.push({ couponId: 3, orderId: 1, customerEmail: "otro@example.com" });
    const id = seedOrder({ couponId: 3, total: 1000000 });
    mp.payments[909] = { id: 909, status: "approved", external_reference: String(id), transaction_amount: 1000000, currency_id: "ARS" };
    await handleWebhook(webhookReq(909), fakeRes());
    assert.equal(db.orders[id].status, "PAYMENT_REVIEW");
    assert.equal(db.couponUsages.length, 1, "no se registra un segundo uso");
  });

  test("la consulta desde la pantalla de resultado aplica el mismo control", async () => {
    const id = seedOrder({ total: 2000000 });
    mp.searchResults = [{ id: 903, status: "approved", external_reference: String(id), transaction_amount: 100, currency_id: "ARS", date_created: "2026-10-29T10:00:00Z" }];
    await getOrderPaymentStatus({ params: { orderId: String(id) }, query: {}, headers: {} }, fakeRes());
    assert.equal(db.orders[id].status, "PAYMENT_REVIEW");
    assert.equal(db.products[1].stock, 5);
  });
});

// ── Estado del pago ──────────────────────────────────────────────────────────
describe("estado del pago: el detalle solo con la clave del pedido o la sesión del dueño", () => {
  beforeEach(() => { resetDb(); mp.preferences = []; mp.searchResults = []; });

  async function status(orderId, query = {}, token) {
    const res = fakeRes();
    await getOrderPaymentStatus({ params: { orderId: String(orderId) }, query, headers: auth(token) }, res);
    return res.body;
  }
  async function keyFromPreference(orderId) {
    await createPreference({ body: { orderId } }, fakeRes());
    return new URL(mp.preferences.at(-1).back_urls.success).searchParams.get("k");
  }

  test("probando números de pedido solo se ve el estado", async () => {
    const id = seedOrder({ status: "APPROVED" });
    assert.deepEqual(await status(id), { id, status: "APPROVED" });
  });

  test("con la clave del link de vuelta de MP se ve el detalle", async () => {
    const id = seedOrder({});
    const body = await status(id, { k: await keyFromPreference(id) });
    assert.equal(body.customerName, "Ana Test");
    assert.ok(Array.isArray(body.items));
    assert.equal(body.customerId, undefined);
  });

  test("la clave de otro pedido no sirve", async () => {
    const a = seedOrder({});
    const b = seedOrder({ status: "APPROVED" });
    assert.deepEqual(await status(b, { k: await keyFromPreference(a) }), { id: b, status: "APPROVED" });
  });

  test("el dueño del pedido, con su sesión, también ve el detalle", async () => {
    const id = seedOrder({ status: "APPROVED", customerId: 7 });
    assert.equal((await status(id, {}, tokenOf(7))).customerName, "Ana Test");
    assert.deepEqual(await status(id, {}, tokenOf(5)), { id, status: "APPROVED" });
  });
});

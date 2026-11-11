// Tests de cada lugar que mueve stock y que no tenía test propio: venta manual, edición de líneas de un
// pedido, la cotización que cancela o cambia el cliente, el RMA de la Caja, el editor de variantes y la
// edición rápida de productos. Base, emails y Meta simulados. Correr con: npm test
//
// Fijan cómo se comporta cada lugar (cuánto baja o sube, qué se publica o despublica) para que pasar el
// stock por services/stock.service.js no cambie nada sin querer. Lo que sí cambia a propósito tiene su
// propio test, marcado como "arreglo".

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { withStockSupport } = require("./helpers/fakeStock");

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

// ── Base simulada ────────────────────────────────────────────────────────────
let db;
function resetDb() {
  const product = (id, name, fields = {}) => ({
    id, name, price: 1000, cost: 500, wholesalePrice: 800, salePrice: null, wholesaleSalePrice: null,
    currency: "ARS", visibility: "AMBOS", images: [], stock: 10, stockUnlimited: false,
    active: true, hiddenByAdmin: false, priceTiers: null, wholesalePriceTiers: null, ...fields,
  });
  db = {
    products: {
      1: product(1, "Parlante"),
      2: product(2, "Pendrive"),
      3: product(3, "Funda", { stock: 0 }),                         // con variantes
      4: product(4, "Instalación", { stock: 0, stockUnlimited: true }),
      5: product(5, "Mouse", { stock: 1 }),
      6: product(6, "Tablet", { stock: 10, active: false, hiddenByAdmin: true }), // oculta a mano
      7: product(7, "Cable", { stock: 0, active: false }),          // con variantes, oculto por falta de stock
    },
    variants: {
      31: { id: 31, productId: 3, active: true, stock: 30, stockUnlimited: false, sku: "FUN-N", combination: [{ name: "Color", value: "Negro" }] },
      32: { id: 32, productId: 3, active: true, stock: 30, stockUnlimited: false, sku: "FUN-R", combination: [{ name: "Color", value: "Rojo" }] },
      71: { id: 71, productId: 7, active: true, stock: 0, stockUnlimited: false, sku: "CAB-N", combination: [{ name: "Color", value: "Negro" }] },
    },
    attributes: [],
    orders: {},
    gastos: [],
    movements: [],
    nextId: 1000,
  };
}

function applyData(target, data) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && ("decrement" in v || "increment" in v)) {
      target[k] = (target[k] || 0) - (v.decrement || 0) + (v.increment || 0);
    } else target[k] = clone(v);
  }
  return target;
}
const withProduct = (i) => ({ ...clone(i), product: i.productId ? clone(db.products[i.productId]) : null });
const orderOut = (o, include) => (o ? { ...clone(o), items: include?.items ? o.items.map(withProduct) : clone(o.items), coupon: null } : null);
const allItems = () => Object.values(db.orders).flatMap((o) => o.items);
const matchWhere = (row, where = {}) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if ("in" in v) return v.in.includes(row[k]);
    if ("not" in v) return row[k] !== v.not;
  }
  return v === undefined || row[k] === v;
});

function addOrder(id, fields, items) {
  db.orders[id] = {
    id, status: "PENDING", paymentMethod: "EFECTIVO", stockDeducted: false, customerId: null, customerType: "MINORISTA",
    customerEmail: "cliente@example.com", couponId: null, total: 0, wantsInvoice: false, manualDiscountType: null,
    manualDiscountValue: null, shippingCost: 0, ivaAmount: 0, originalSnapshot: null, ...fields,
    items: items.map((i) => ({ id: db.nextId++, orderId: id, variantId: null, price: 1000, currency: "ARS", ...i })),
  };
  return db.orders[id];
}

class FakePrismaClient {
  constructor() {
    this.product = {
      findUnique: async ({ where }) => clone(db.products[where.id]) || null,
      findMany: async ({ where }) => Object.values(db.products).filter((p) => matchWhere(p, where)).map(clone),
      update: async ({ where, data }) => ({ ...clone(applyData(db.products[where.id], data)), categories: [], supplier: null }),
    };
    this.productVariant = {
      findUnique: async ({ where, include }) => {
        const v = clone(db.variants[where.id]);
        if (v && include?.product) v.product = clone(db.products[v.productId]);
        return v || null;
      },
      findMany: async ({ where }) => Object.values(db.variants).filter((v) => matchWhere(v, where)).map(clone),
      update: async ({ where, data }) => clone(applyData(db.variants[where.id], data)),
      count: async ({ where }) => Object.values(db.variants).filter((v) => matchWhere(v, where)).length,
      deleteMany: async ({ where }) => {
        for (const v of Object.values(db.variants)) if (matchWhere(v, where)) delete db.variants[v.id];
        return {};
      },
      createMany: async ({ data }) => {
        for (const d of data) { const id = db.nextId++; db.variants[id] = { id, active: true, stock: 0, stockUnlimited: false, ...clone(d) }; }
        return { count: data.length };
      },
    };
    this.productAttribute = {
      findMany: async ({ where }) => clone(db.attributes.filter((a) => a.productId === where.productId)),
    };
    this.order = {
      findUnique: async ({ where, include }) => orderOut(db.orders[where.id], include),
      findFirst: async ({ where, include }) => orderOut(Object.values(db.orders).find((o) => matchWhere(o, where)), include),
      update: async ({ where, data, include }) => orderOut(applyData(db.orders[where.id], data), include),
      create: async ({ data, include }) => {
        const id = db.nextId++;
        const { items, ...rest } = data;
        db.orders[id] = { id, ...clone(rest), items: (items?.create || []).map((i) => ({ id: db.nextId++, orderId: id, ...clone(i) })) };
        return orderOut(db.orders[id], include);
      },
    };
    this.orderItem = {
      findFirst: async ({ where }) => clone(allItems().find((i) => matchWhere(i, where))) || null,
      findMany: async ({ where }) => allItems().filter((i) => matchWhere(i, where)).map(withProduct),
      update: async ({ where, data }) => clone(applyData(allItems().find((i) => i.id === where.id), data)),
      delete: async ({ where }) => {
        for (const o of Object.values(db.orders)) o.items = o.items.filter((i) => i.id !== where.id);
        return {};
      },
      create: async ({ data }) => {
        const { order, product, supplier, ...rest } = clone(data);
        const it = { id: db.nextId++, variantId: null, ...rest, orderId: rest.orderId ?? order?.connect?.id, productId: rest.productId ?? product?.connect?.id ?? null };
        db.orders[it.orderId].items.push(it);
        return clone(it);
      },
    };
    this.gasto = { create: async ({ data }) => { const g = { id: db.nextId++, ...clone(data) }; db.gastos.push(g); return g; } };
    this.notification = { create: async ({ data }) => ({ id: 1, ...data }) };
    this.customer = { findUnique: async () => null };
    this.cart = { findUnique: async () => null };
    withStockSupport(this, {
      movements: () => db.movements,
      variantsOf: (pid) => Object.values(db.variants).filter((v) => v.productId === pid),
    });
  }
}

function stub(modulePath, exportsObj) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}
const root = path.join(__dirname, "..");
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient, Prisma: {} });
stub(path.join(root, "src/services/email.service.js"), new Proxy({}, { get: () => async () => {} }));
stub(path.join(root, "src/services/meta.service.js"), { browserDataFromRequest: () => null, sendPurchaseEvent: async () => ({}) });
stub(path.join(root, "src/config/cloudinary.js"), { uploadBuffer: async () => ({}), uploadVideoBuffer: async () => ({}), deleteByUrl: async () => {} });
stub(path.join(root, "src/sse/notificationSSE.js"), { pushToClient: () => {} });

const orders = require("../src/controllers/order.controller");
const { quickUpdateProduct, updateProduct } = require("../src/controllers/product.controller");
const variantRoutes = require("../src/routes/variant.routes");
const gastoRoutes = require("../src/routes/gasto.routes");

// El último handler de una ruta del router (los anteriores son los controles de sesión y permisos).
function handlerOf(router, method, routePath) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
const putVariant = handlerOf(variantRoutes, "put", "/:id");
const generateVariants = handlerOf(variantRoutes, "post", "/product/:productId/generate");
const createGasto = handlerOf(gastoRoutes, "post", "/");

const admin = { id: 1, role: "SUPERADMIN", name: "Ana", email: "ana@example.com", permissions: [] };
const customer = (id) => ({ id, role: "CUSTOMER" });
const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function call(fn, req) {
  const res = fakeRes();
  await fn({ params: {}, query: {}, headers: {}, user: admin, body: {}, ...req }, res);
  return res;
}
const stockOf = (id) => db.products[id].stock;
const variantStock = (id) => db.variants[id].stock;

// ── Venta manual ─────────────────────────────────────────────────────────────
describe("venta manual", () => {
  beforeEach(resetDb);
  const sell = (items, extra = {}) => call(orders.createManualOrder, { body: { customerName: "Mostrador", customerId: 9, items, ...extra } });

  test("descuenta del producto y de la variante, el ítem libre no toca nada, y queda marcada como descontada", async () => {
    const res = await sell([
      { productId: 1, quantity: 2, price: 1000 },
      { productId: 3, variantId: 31, quantity: 3, price: 3000 },
      { productName: "Flete", quantity: 1, price: 500 },
    ]);
    assert.equal(res.code, 201);
    assert.equal(stockOf(1), 8);
    assert.equal(variantStock(31), 27);
    assert.equal(stockOf(3), 0, "con variante no se toca el stock del producto");
    assert.equal(db.orders[res.body.id].stockDeducted, true);
  });

  test("una venta registrada como Pendiente también descuenta", async () => {
    const res = await sell([{ productId: 2, quantity: 4, price: 1000 }], { status: "PENDING" });
    assert.equal(res.code, 201);
    assert.equal(stockOf(2), 6);
    assert.equal(db.orders[res.body.id].stockDeducted, true);
  });

  test("una cotización armada por el vendedor no descuenta nada", async () => {
    const res = await sell([{ productId: 1, quantity: 2, price: 1000 }], { paymentMethod: "COTIZACION" });
    assert.equal(res.code, 201);
    assert.equal(stockOf(1), 10);
    assert.equal(db.orders[res.body.id].stockDeducted, false);
  });

  test("sin stock suficiente no registra nada", async () => {
    const res = await sell([{ productId: 1, quantity: 2, price: 1000 }, { productId: 5, quantity: 3, price: 1000 }]);
    assert.equal(res.code, 400);
    assert.deepEqual([stockOf(1), stockOf(5)], [10, 1]);
    assert.equal(Object.keys(db.orders).length, 0);
  });

  test("vender la última unidad despublica el producto", async () => {
    await sell([{ productId: 5, quantity: 1, price: 1000 }]);
    assert.equal(stockOf(5), 0);
    assert.equal(db.products[5].active, false);
  });

  test("un producto ilimitado no se descuenta", async () => {
    await sell([{ productId: 4, quantity: 3, price: 1000 }]);
    assert.equal(stockOf(4), 0);
  });

  test("queda en el historial con el número de la venta", async () => {
    const res = await sell([{ productId: 1, quantity: 2, price: 1000 }, { productId: 3, variantId: 31, quantity: 1, price: 3000 }]);
    assert.deepEqual(db.movements.map((m) => [m.productId, m.variantId, m.reason, m.delta, m.refId, m.actor]), [
      [1, null, "VENTA_MANUAL", -2, String(res.body.id), "Ana"],
      [3, 31, "VENTA_MANUAL", -1, String(res.body.id), "Ana"],
    ]);
  });

  test("arreglo: dos ventas a la vez de la última unidad dejan el stock en 0, no en -1, y anotan el faltante", async () => {
    await Promise.all([
      sell([{ productId: 5, quantity: 1, price: 1000 }]),
      sell([{ productId: 5, quantity: 1, price: 1000 }]),
    ]);
    assert.equal(stockOf(5), 0, "antes el decrement sin piso lo dejaba en -1");
    assert.deepEqual(db.movements.map((m) => [m.delta, m.after, m.requested]), [[-1, 0, -1], [0, 0, -1]]);
  });
});

// ── Editar líneas de un pedido ───────────────────────────────────────────────
describe("editar las líneas de un pedido", () => {
  beforeEach(resetDb);
  const approved = (items) => addOrder(500, { status: "APPROVED", stockDeducted: true }, items);
  const editLine = (orderId, itemId, quantity) => call(orders.updateOrderItem, { params: { orderId: String(orderId), itemId: String(itemId) }, body: { quantity } });
  const removeLine = (orderId, itemId) => call(orders.deleteOrderItem, { params: { orderId: String(orderId), itemId: String(itemId) } });
  const addLine = (orderId, body) => call(orders.addItemToOrder, { params: { id: String(orderId) }, body });

  test("pedido abonado: subir la cantidad descuenta la diferencia y bajarla la devuelve", async () => {
    const o = approved([{ productId: 1, quantity: 2 }]);
    assert.equal((await editLine(500, o.items[0].id, 5)).code, 200);
    assert.equal(stockOf(1), 7);
    assert.equal((await editLine(500, o.items[0].id, 1)).code, 200);
    assert.equal(stockOf(1), 11);
  });

  test("con variante, la diferencia sale de la variante", async () => {
    const o = approved([{ productId: 3, variantId: 31, quantity: 2 }]);
    await editLine(500, o.items[0].id, 6);
    assert.equal(variantStock(31), 26);
  });

  test("cada cambio de línea queda en el historial con el pedido y quién lo hizo", async () => {
    const o = approved([{ productId: 1, quantity: 2 }]);
    await editLine(500, o.items[0].id, 3);
    await removeLine(500, o.items[0].id);
    assert.deepEqual(db.movements.map((m) => [m.reason, m.delta, m.refId, m.actor]), [
      ["EDICION_PEDIDO", -1, "500", "Ana"],
      ["EDICION_PEDIDO", 3, "500", "Ana"],
    ]);
  });

  test("bajar la cantidad de lo último que había vuelve a publicar el producto", async () => {
    db.products[5] = { ...db.products[5], stock: 0, active: false };
    const o = approved([{ productId: 5, quantity: 2 }]);
    await editLine(500, o.items[0].id, 1);
    assert.equal(stockOf(5), 1);
    assert.equal(db.products[5].active, true);
  });

  test("un pedido pendiente que no descontó: cambiar la cantidad no mueve stock", async () => {
    const o = addOrder(501, { status: "PENDING", paymentMethod: "TRANSFERENCIA" }, [{ productId: 1, quantity: 2 }]);
    await editLine(501, o.items[0].id, 5);
    assert.equal(stockOf(1), 10);
  });

  test("sacar una línea de un pedido abonado devuelve sus unidades", async () => {
    const o = approved([{ productId: 1, quantity: 2 }, { productId: 3, variantId: 32, quantity: 4 }]);
    assert.equal((await removeLine(500, o.items[0].id)).code, 200);
    assert.equal((await removeLine(500, o.items[0].id)).code, 200); // la de la variante (ahora es la primera)
    assert.equal(stockOf(1), 12);
    assert.equal(variantStock(32), 34);
  });

  test("agregar un producto a un pedido abonado lo descuenta", async () => {
    approved([{ productId: 1, quantity: 1 }]);
    assert.equal((await addLine(500, { productId: 2, quantity: 3 })).code, 200);
    assert.equal((await addLine(500, { productId: 3, variantId: 31, quantity: 5 })).code, 200);
    assert.equal(stockOf(2), 7);
    assert.equal(variantStock(31), 25);
  });

  test("agregar más de lo que hay se rechaza sin tocar nada", async () => {
    approved([{ productId: 1, quantity: 1 }]);
    const res = await addLine(500, { productId: 5, quantity: 2 });
    assert.equal(res.code, 400);
    assert.equal(stockOf(5), 1);
    assert.equal(db.orders[500].items.length, 1);
  });

  test("agregar a una cotización pendiente no descuenta", async () => {
    addOrder(502, { status: "PENDING", paymentMethod: "COTIZACION" }, [{ productId: 1, quantity: 1 }]);
    await addLine(502, { productId: 2, quantity: 3 });
    assert.equal(stockOf(2), 10);
  });
});

// ── La cotización del cliente ────────────────────────────────────────────────
describe("cotización que cancela o cambia el cliente", () => {
  beforeEach(resetDb);

  test("una cotización vieja (que había reservado stock) devuelve todo al cancelarse", async () => {
    addOrder(600, { status: "QUOTE_APPROVED", paymentMethod: "COTIZACION", customerId: 9, stockDeducted: true }, [
      { productId: 1, quantity: 2 }, { productId: 3, variantId: 31, quantity: 3 }, { productId: null, productName: "Flete", quantity: 1 },
    ]);
    const res = await call(orders.cancelByCustomer, { params: { id: "600" }, body: { reason: "Ya no lo necesito" }, user: customer(9) });
    assert.equal(res.code, 200);
    assert.equal(stockOf(1), 12);
    assert.equal(variantStock(31), 33);
    assert.equal(db.orders[600].status, "CANCELLED");
    assert.equal(db.orders[600].stockDeducted, false);
  });

  test("arreglo: devolver el stock de una cotización vieja no republica lo que el admin ocultó a mano", async () => {
    addOrder(604, { status: "QUOTE_APPROVED", paymentMethod: "COTIZACION", customerId: 9, stockDeducted: true }, [{ productId: 6, quantity: 2 }]);
    await call(orders.cancelByCustomer, { params: { id: "604" }, body: {}, user: customer(9) });
    assert.equal(stockOf(6), 12);
    assert.equal(db.products[6].active, false, "antes la republicaba siempre (active: true)");
    assert.equal(db.movements.at(-1).actor, "Cliente #9");
  });

  test("una cotización nueva (no reserva nada) se cancela sin tocar el stock", async () => {
    addOrder(601, { status: "QUOTE_APPROVED", paymentMethod: "COTIZACION", customerId: 9 }, [{ productId: 1, quantity: 2 }]);
    await call(orders.cancelByCustomer, { params: { id: "601" }, body: {}, user: customer(9) });
    assert.equal(stockOf(1), 10);
  });

  test("el cliente cambia la cantidad de una cotización vieja: se mueve solo la diferencia", async () => {
    const o = addOrder(602, { status: "QUOTE_APPROVED", paymentMethod: "COTIZACION", customerId: 9, stockDeducted: true }, [{ productId: 1, quantity: 2 }]);
    const res = await call(orders.updateMyQuoteItems, { params: { id: "602" }, body: { items: [{ id: o.items[0].id, quantity: 5 }] }, user: customer(9) });
    assert.equal(res.code, 200);
    assert.equal(stockOf(1), 7);
  });

  test("en una cotización nueva cambiar cantidades no mueve stock", async () => {
    const o = addOrder(603, { status: "QUOTE_APPROVED", paymentMethod: "COTIZACION", customerId: 9 }, [{ productId: 1, quantity: 2 }]);
    await call(orders.updateMyQuoteItems, { params: { id: "603" }, body: { items: [{ id: o.items[0].id, quantity: 5 }] }, user: customer(9) });
    assert.equal(stockOf(1), 10);
  });
});

// ── RMA desde la Caja ────────────────────────────────────────────────────────
describe("RMA en la Caja", () => {
  beforeEach(resetDb);
  const rma = (body) => call(createGasto, { body: { amount: 100, description: "Falla", type: "NEGOCIO", subtype: "RMA", ...body } });

  test("da de baja unidades del producto", async () => {
    assert.equal((await rma({ productId: 1, quantity: 2 })).code, 201);
    assert.equal(stockOf(1), 8);
    assert.equal(db.products[1].active, true);
  });

  test("dar de baja la última unidad despublica el producto", async () => {
    await rma({ productId: 5, quantity: 1 });
    assert.equal(stockOf(5), 0);
    assert.equal(db.products[5].active, false);
  });

  test("con variante, la baja sale de la variante", async () => {
    await rma({ productId: 3, variantId: 31, quantity: 4 });
    assert.equal(variantStock(31), 26);
    assert.equal(stockOf(3), 0);
  });

  test("arreglo: dar de baja lo último de la única variante con stock despublica el producto", async () => {
    db.variants[31].stock = 1;
    db.variants[32].stock = 0;
    await rma({ productId: 3, variantId: 31, quantity: 1 });
    assert.equal(variantStock(31), 0);
    assert.equal(db.products[3].active, false, "antes quedaba publicado sin nada para vender");
  });

  test("un gasto común no toca el stock", async () => {
    await call(createGasto, { body: { amount: 100, description: "Luz", type: "NEGOCIO", productId: 1, quantity: 2 } });
    assert.equal(stockOf(1), 10);
  });
});

// ── Panel de productos y editor de variantes ─────────────────────────────────
describe("panel de productos y editor de variantes", () => {
  beforeEach(resetDb);

  test("editor de variantes: carga el número y publica el producto si estaba oculto por falta de stock", async () => {
    const res = await call(putVariant, { params: { id: "71" }, body: { stock: 6 } });
    assert.equal(res.code, 200);
    assert.equal(variantStock(71), 6);
    assert.equal(db.products[7].active, true);
  });

  test("edición rápida: poner 0 despublica", async () => {
    await call(quickUpdateProduct, { params: { id: "1" }, body: { stock: 0 } });
    assert.equal(stockOf(1), 0);
    assert.equal(db.products[1].active, false);
  });

  test("edición rápida de un producto con variantes no toca su stock", async () => {
    await call(quickUpdateProduct, { params: { id: "3" }, body: { stock: 50 } });
    assert.equal(stockOf(3), 0);
  });

  test("generar variantes por primera vez deja el stock del producto en 0", async () => {
    db.attributes = [{ id: 1, productId: 2, name: "Color", position: 0, values: [{ value: "Azul", position: 0 }, { value: "Verde", position: 1 }] }];
    const res = await call(generateVariants, { params: { productId: "2" } });
    assert.equal(res.code, 200);
    assert.equal(stockOf(2), 0);
    assert.deepEqual(Object.values(db.variants).filter((v) => v.productId === 2).map((v) => v.stock), [0, 0]);
  });
});

// ── El panel ya no pisa ventas ───────────────────────────────────────────────
// El panel manda el número que escribió el admin (stock) y el que veía al abrir (stockBase). Se aplica
// la diferencia: si mientras tenía el formulario abierto entró una venta, no se deshace.
describe("el panel aplica la diferencia con lo que el admin veía", () => {
  beforeEach(resetDb);
  // Ana abrió la edición cuando había 10; mientras tanto se vendieron 2 (quedaron 8).
  const sellTwoMeanwhile = () => { db.products[1].stock = 8; };

  test("edición rápida: escribió 15 donde veía 10 → suma 5 a lo que hay (13), y avisa", async () => {
    sellTwoMeanwhile();
    const res = await call(quickUpdateProduct, { params: { id: "1" }, body: { stock: 15, stockBase: 10 } });
    assert.equal(res.code, 200);
    assert.equal(stockOf(1), 13);
    assert.equal(res.body.stock, 13, "la respuesta ya trae el stock nuevo");
    assert.deepEqual(res.body.stockNotice, { typed: 15, after: 13 });
    const m = db.movements.at(-1);
    assert.deepEqual([m.reason, m.delta, m.before, m.after, m.actor], ["AJUSTE", 5, 8, 13, "Ana"]);
  });

  test("edición rápida sin tocar el stock (solo el precio): no lo pisa", async () => {
    sellTwoMeanwhile();
    await call(quickUpdateProduct, { params: { id: "1" }, body: { price: 1200 } });
    assert.equal(stockOf(1), 8);
    assert.equal(db.products[1].price, 1200);
    assert.equal(db.movements.length, 0);
  });

  test("edición completa sin tocar el stock: antes lo volvía a 10, ahora queda en 8", async () => {
    sellTwoMeanwhile();
    db.products[1].slug = "parlante";
    const res = await call(updateProduct, { params: { id: "1" }, body: { name: "Parlante grande", description: "Nuevo" } });
    assert.equal(res.code, 200);
    assert.equal(stockOf(1), 8);
    assert.equal(db.products[1].name, "Parlante grande");
  });

  test("edición completa con el stock cambiado: aplica la diferencia", async () => {
    sellTwoMeanwhile();
    db.products[1].slug = "parlante";
    const res = await call(updateProduct, { params: { id: "1" }, body: { stock: "6", stockBase: "10" } });
    assert.equal(res.code, 200);
    assert.equal(stockOf(1), 4);
    assert.deepEqual(res.body.stockNotice, { typed: 6, after: 4 });
  });

  test("bajar más de lo que hay deja 0, nunca negativo", async () => {
    sellTwoMeanwhile();
    await call(quickUpdateProduct, { params: { id: "1" }, body: { stock: 0, stockBase: 10 } });
    assert.equal(stockOf(1), 0);
  });

  test("editor de variantes: la diferencia sale de la variante", async () => {
    db.variants[31].stock = 25; // abrió con 30, se vendieron 5
    const res = await call(putVariant, { params: { id: "31" }, body: { stock: 40, stockBase: 30 } });
    assert.equal(res.code, 200);
    assert.equal(variantStock(31), 35);
    assert.equal(res.body.stock, 35);
  });

  test("una pantalla vieja que no manda stockBase: carga el número tal cual, como antes", async () => {
    sellTwoMeanwhile();
    await call(quickUpdateProduct, { params: { id: "1" }, body: { stock: 15 } });
    assert.equal(stockOf(1), 15);
    assert.equal(db.movements.at(-1).requested, null, "fue una carga a mano, no una suma");
  });

  test("el RMA queda en el historial con el número de gasto", async () => {
    const res = await call(createGasto, { body: { amount: 100, description: "Falla", type: "NEGOCIO", subtype: "RMA", productId: 1, quantity: 2 } });
    const m = db.movements.at(-1);
    assert.deepEqual([m.reason, m.delta, m.refType, m.refId], ["RMA", -2, "gasto", String(res.body.id)]);
  });
});

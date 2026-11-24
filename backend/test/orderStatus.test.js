// Tests del cambio de estado de un pedido desde el panel (updateOrderStatus): stock al aprobar y al
// cancelar; y de "Modificar pedido" (modifyOrder). Base, emails y Meta simulados. Correr con: npm test
//
// Casos de la auditoría del 28/10/2026:
//  - un ítem libre (o de un producto borrado) cortaba la aprobación o la cancelación a la mitad, con
//    el estado nuevo ya guardado: stock devuelto a medias, sin cupón ni email;
//  - aprobar una cotización con surtido (una línea sin variante de un producto con variantes)
//    descontaba del stock del producto padre (0) y con eso le sacaba el producto a los pedidos
//    pendientes de OTROS clientes y los cancelaba.

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { withStockSupport } = require("./helpers/fakeStock");

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

let db;
function resetDb() {
  db = {
    products: {
      1: { id: 1, name: "Parlante", stock: 10, stockUnlimited: false, active: true },
      2: { id: 2, name: "Pendrive", stock: 10, stockUnlimited: false, active: true },
      3: { id: 3, name: "Funda", stock: 0, stockUnlimited: false, active: true }, // con variantes
      4: { id: 4, name: "Cargador", stock: 0, stockUnlimited: false, active: true }, // con variantes
      5: { id: 5, name: "Mouse", stock: 0, stockUnlimited: false, active: true }, // sin variantes, agotado
    },
    variants: {
      31: { id: 31, productId: 3, active: true, stock: 30, stockUnlimited: false, sku: "FUN-N", combination: [{ name: "Color", value: "Negro" }] },
      32: { id: 32, productId: 3, active: true, stock: 30, stockUnlimited: false, sku: "FUN-R", combination: [{ name: "Color", value: "Rojo" }] },
      // Variante de OTRO producto (para probar que no se puede asignar)
      41: { id: 41, productId: 4, active: true, stock: 30, stockUnlimited: false, sku: "OTRO", combination: [{ name: "Color", value: "Azul" }] },
    },
    orders: {},
    couponUsages: [],
    movements: [],
    cartPromos: [], // descuento por monto (Black Friday)
    nextItemId: 1000,
  };
}
function addOrder(id, fields, items) {
  db.orders[id] = {
    id, status: "PENDING", paymentMethod: "EFECTIVO", fulfillmentStatus: "PENDIENTE", stockDeducted: false,
    customerId: null, customerEmail: "cliente@example.com", couponId: null, adminNotes: null, ...fields,
    items: items.map((i) => ({ id: db.nextItemId++, orderId: id, variantId: null, price: 1000, currency: "ARS", ...i })),
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
const allItems = () => Object.values(db.orders).flatMap((o) => o.items);
const withProduct = (i) => ({ ...clone(i), product: i.productId ? clone(db.products[i.productId]) : null });

class FakePrismaClient {
  constructor() {
    this.order = {
      findUnique: async ({ where }) => {
        const o = db.orders[where.id];
        return o ? { ...clone(o), items: o.items.map(withProduct) } : null;
      },
      update: async ({ where, data, include }) => {
        if (include) db.lastOrderInclude = include; // lo que pide la respuesta de "Modificar pedido"
        return clone(applyData(db.orders[where.id], data));
      },
      // Reclamo del movimiento de stock: cambia solo si el pedido sigue como dice el where
      updateMany: async ({ where, data }) => {
        const o = db.orders[where.id];
        const matches = (k, v) => (v && typeof v === "object" && Array.isArray(v.in) ? v.in.includes(o[k]) : o[k] === v);
        if (!o || Object.entries(where).some(([k, v]) => k !== "id" && !matches(k, v))) return { count: 0 };
        applyData(o, data);
        return { count: 1 };
      },
      // cancelByCustomer busca por id + cliente + método de pago
      findFirst: async ({ where }) => {
        const o = db.orders[where.id];
        if (!o || (where.customerId !== undefined && o.customerId !== where.customerId) ||
          (where.paymentMethod && o.paymentMethod !== where.paymentMethod)) return null;
        return { ...clone(o), items: o.items.map(clone) };
      },
      findMany: async ({ where }) => Object.values(db.orders).filter((o) =>
        (!where.id?.not || o.id !== where.id.not) &&
        (!where.status?.in || where.status.in.includes(o.status)) &&
        (!where.items?.none || o.items.length === 0)).map(clone),
    };
    this.orderItem = {
      findFirst: async ({ where }) => clone(allItems().find((i) => i.id === where.id && (!where.orderId || i.orderId === where.orderId))) || null,
      findMany: async ({ where }) => {
        if (where.orderId) return db.orders[where.orderId].items.map(withProduct);
        // Ítems de OTROS pedidos con este producto (ajuste por falta de stock)
        return allItems().filter((i) => {
          const o = db.orders[i.orderId];
          return i.productId === where.productId && o.id !== where.order.id.not &&
            where.order.status.in.includes(o.status) && o.paymentMethod !== where.order.paymentMethod.not;
        }).map(clone);
      },
      update: async ({ where, data }) => clone(applyData(allItems().find((i) => i.id === where.id), data)),
      create: async ({ data }) => {
        // modifyOrder usa order/product: { connect: { id } } en vez de orderId/productId
        const { order, product, supplier, ...rest } = clone(data);
        const it = { id: db.nextItemId++, ...rest, orderId: rest.orderId ?? order?.connect?.id, productId: rest.productId ?? product?.connect?.id ?? null };
        db.orders[it.orderId].items.push(it);
        return clone(it);
      },
      delete: async ({ where }) => {
        for (const o of Object.values(db.orders)) o.items = o.items.filter((i) => i.id !== where.id);
        return {};
      },
    };
    this.product = {
      findUnique: async ({ where }) => {
        if (where.id == null) throw new Error("Prisma: id null no es válido"); // como el cliente real
        return clone(db.products[where.id]) || null;
      },
      update: async ({ where, data }) => clone(applyData(db.products[where.id], data)),
      findMany: async ({ where }) => Object.values(db.products).filter((p) => !where?.id?.in || where.id.in.includes(p.id)).map(clone),
    };
    this.notification = { create: async ({ data }) => ({ id: 1, ...data }) };
    this.productVariant = {
      findUnique: async ({ where }) => clone(db.variants[where.id]) || null,
      findMany: async ({ where }) => Object.values(db.variants).filter((v) => where.id?.in
        ? where.id.in.includes(v.id)
        : v.productId === where.productId && (where.active === undefined || v.active === where.active)).map(clone),
      update: async ({ where, data }) => clone(applyData(db.variants[where.id], data)),
      count: async ({ where }) => {
        if (where.productId == null) throw new Error("Prisma: productId null no es válido");
        return Object.values(db.variants).filter((v) => v.productId === where.productId && v.active).length;
      },
    };
    this.couponUsage = { findFirst: async () => null, create: async ({ data }) => { db.couponUsages.push(data); return data; } };
    this.customer = { findUnique: async () => null };
    this.cart = { findUnique: async () => null };
    // Promos vigentes (services/cartPromo.service.js): prendidas y con la fecha dentro del rango
    this.cartPromo = {
      findMany: async ({ where }) => db.cartPromos.filter((p) =>
        p.active === where.active && p.startsAt <= where.startsAt.lte && p.endsAt > where.endsAt.gt).map((p) => ({ ...p })),
    };
    // Venta a mano: crea el pedido dentro de la transacción (la de withStockSupport, más abajo)
    this.order.create = async ({ data }) => {
      const id = 500 + Object.keys(db.orders).length;
      const { items, ...rest } = clone(data);
      db.orders[id] = { id, ...rest, items: (items?.create || []).map((i) => ({ id: db.nextItemId++, orderId: id, ...i })) };
      return clone(db.orders[id]);
    };
    // El stock pasa por services/stock.service.js (transacción + historial + variantes del producto)
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
stub(path.join(root, "src/controllers/product.controller.js"), { syncProductVisibility: async () => {} });
stub(path.join(root, "src/config/cloudinary.js"), { uploadBuffer: async () => ({}) });
stub(path.join(root, "src/sse/notificationSSE.js"), { pushToClient: () => {} });

const { updateOrderStatus, approveCotizacion, modifyOrder, addItemToOrder, deleteOrderItem, cancelByCustomer, createManualOrder } = require("../src/controllers/order.controller");

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function call(fn, req) { const res = fakeRes(); await fn(req, res); return res; }

async function setStatus(id, status) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await updateOrderStatus({ params: { id: String(id) }, body: { status } }, res);
  return res;
}
async function modify(id, items) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await modifyOrder({ params: { id: String(id) }, body: { items } }, res);
  return res;
}

describe("aprobar y cancelar pedidos con ítems libres", () => {
  beforeEach(resetDb);

  test("cancelar una venta abonada con un ítem libre devuelve TODO el stock", async () => {
    addOrder(50, { status: "APPROVED", stockDeducted: true }, [
      { productId: 1, quantity: 1 },
      { productId: null, productName: "Cable especial", quantity: 1 },
      { productId: 2, quantity: 2 },
    ]);
    const res = await setStatus(50, "CANCELLED");
    assert.equal(res.code, 200);
    assert.equal(db.orders[50].status, "CANCELLED");
    assert.equal(db.products[1].stock, 11);
    assert.equal(db.products[2].stock, 12, "los pendrives que estaban después del ítem libre también vuelven");
  });

  test("dos clics seguidos en Abonado descuentan una sola vez; dos en Cancelado devuelven una sola vez", async () => {
    addOrder(53, {}, [{ productId: 1, quantity: 2 }]);
    await Promise.all([setStatus(53, "APPROVED"), setStatus(53, "APPROVED")]);
    assert.equal(db.products[1].stock, 8, "antes quedaba en 6");
    await Promise.all([setStatus(53, "CANCELLED"), setStatus(53, "CANCELLED")]);
    assert.equal(db.products[1].stock, 10, "antes quedaba en 12");
    assert.equal(db.orders[53].stockDeducted, false);
  });

  test("aprobar y cancelar quedan en el historial de stock con el número de pedido", async () => {
    addOrder(52, {}, [{ productId: 1, quantity: 2 }]);
    await setStatus(52, "APPROVED");
    await setStatus(52, "CANCELLED");
    assert.deepEqual(db.movements.map((m) => [m.reason, m.delta, m.after, m.refId]), [
      ["VENTA", -2, 8, "52"],
      ["CANCELACION", 2, 10, "52"],
    ]);
  });

  test("aprobar un pedido con un ítem libre descuenta el resto y termina bien", async () => {
    addOrder(51, {}, [
      { productId: null, productName: "Instalación", quantity: 1 },
      { productId: 1, quantity: 3 },
    ]);
    const res = await setStatus(51, "APPROVED");
    assert.equal(res.code, 200);
    assert.equal(db.products[1].stock, 7);
    assert.equal(db.orders[51].stockDeducted, true);
  });
});

describe("cotización con surtido de variantes", () => {
  beforeEach(resetDb);

  test("aprobarla no le saca productos ni cancela pedidos de otros clientes", async () => {
    // Cotización con 20 fundas repartidas entre dos colores: una sola línea sin variante
    addOrder(60, { status: "PAYMENT_REVIEW", paymentMethod: "TRANSFERENCIA", customerId: 9 }, [
      { productId: 3, variantId: null, quantity: 20, variantLabel: "Surtido: Negro × 10, Rojo × 10", variantByAdmin: true },
    ]);
    // Pedido de OTRO cliente, por transferencia, con 2 fundas negras
    addOrder(61, { status: "QUOTE_APPROVED", paymentMethod: "TRANSFERENCIA", customerId: 10 }, [
      { productId: 3, variantId: 31, quantity: 2 },
    ]);
    const res = await setStatus(60, "APPROVED");
    assert.equal(res.code, 200);
    assert.equal(db.orders[61].status, "QUOTE_APPROVED", "el pedido del otro cliente no se cancela");
    assert.equal(db.orders[61].items.length, 1, "y conserva su producto");
    assert.equal(db.products[3].active, true, "la funda sigue publicada");
  });
});

describe("aprobar una cotización con surtido: una línea por variante", () => {
  beforeEach(resetDb);

  async function approve(id, variantAssignments) {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await approveCotizacion({ params: { id: String(id) }, body: { variantAssignments, notify: false } }, res);
    return res;
  }

  test("el reparto queda en líneas separadas y al cobrarla baja el stock de cada variante", async () => {
    addOrder(70, { paymentMethod: "COTIZACION", customerId: 9 }, [{ productId: 3, quantity: 20, price: 3000 }]);
    const itemId = db.orders[70].items[0].id;
    const res = await approve(70, [{ itemId, variantId: 31, quantity: 10 }, { itemId, variantId: 32, quantity: 10 }]);
    assert.equal(res.code, 200);
    const lines = db.orders[70].items.map((i) => [i.variantId, i.quantity, i.variantLabel, i.price]);
    assert.deepEqual(lines, [[31, 10, "Color: Negro", 3000], [32, 10, "Color: Rojo", 3000]]);
    assert.equal(db.orders[70].status, "QUOTE_APPROVED");

    // El cliente paga y el admin la marca abonada
    db.orders[70].paymentMethod = "TRANSFERENCIA";
    assert.equal((await setStatus(70, "APPROVED")).code, 200);
    assert.equal(db.variants[31].stock, 20);
    assert.equal(db.variants[32].stock, 20);
  });

  test("asignar dos veces la misma variante se suma en una sola línea", async () => {
    addOrder(71, { paymentMethod: "COTIZACION" }, [{ productId: 3, quantity: 6 }]);
    const itemId = db.orders[71].items[0].id;
    await approve(71, [{ itemId, variantId: 31, quantity: 4 }, { itemId, variantId: 31, quantity: 2 }]);
    assert.deepEqual(db.orders[71].items.map((i) => [i.variantId, i.quantity]), [[31, 6]]);
  });

  test("no se puede asignar la variante de otro producto", async () => {
    addOrder(72, { paymentMethod: "COTIZACION" }, [{ productId: 3, quantity: 5 }]);
    const itemId = db.orders[72].items[0].id;
    const res = await approve(72, [{ itemId, variantId: 41, quantity: 5 }]);
    assert.equal(res.code, 400);
    assert.equal(db.orders[72].items[0].variantId, null);
  });
});

describe("Modificar pedido: el stock se mueve solo si el pedido ya lo descontó (B6)", () => {
  beforeEach(resetDb);

  // 2 parlantes y 1 pendrive; el cliente pide 3 parlantes y sin pendrive
  function setUp(id, fields) {
    addOrder(id, fields, [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }]);
    const [parlante] = db.orders[id].items;
    return [{ itemId: parlante.id, productId: 1, quantity: 3, price: 1000 }];
  }

  test("pedido por transferencia sin pagar: no toca el stock ni lo marca modificado", async () => {
    const items = setUp(80, { status: "QUOTE_APPROVED", paymentMethod: "TRANSFERENCIA" });
    const res = await modify(80, items);
    assert.equal(res.code, 200);
    assert.equal(db.products[1].stock, 10);
    assert.equal(db.products[2].stock, 10, "el pendrive nunca salió: no se suma una unidad fantasma");
    assert.deepEqual(db.orders[80].items.map((i) => [i.productId, i.quantity]), [[1, 3]]);
    assert.notEqual(db.orders[80].isModified, true);

    // Al marcarlo abonado se descuentan los 3 parlantes una sola vez
    assert.equal((await setStatus(80, "APPROVED")).code, 200);
    assert.equal(db.products[1].stock, 7);
    assert.equal(db.products[2].stock, 10);
  });

  test("pedido aprobado (stock ya descontado): ajusta por la diferencia y queda como modificado", async () => {
    const items = setUp(81, { status: "APPROVED", stockDeducted: true });
    const res = await modify(81, items);
    assert.equal(res.code, 200);
    assert.equal(db.products[1].stock, 9, "un parlante más");
    assert.equal(db.products[2].stock, 11, "vuelve el pendrive");
    assert.equal(db.orders[81].isModified, true);
  });

  test("un producto nuevo sin stock corta ANTES de tocar el pedido", async () => {
    const items = setUp(82, { status: "APPROVED", stockDeducted: true });
    // Antes: el producto 3, que tiene variantes. Ahora ese corta antes por no traer variante.
    const res = await modify(82, [...items, { productId: 5, quantity: 1, price: 500 }]);
    assert.equal(res.code, 400);
    assert.match(res.body.error, /Stock insuficiente/);
    assert.equal(db.orders[82].items.length, 2, "el pendrive sigue en el pedido");
    assert.equal(db.products[2].stock, 10, "y su stock no se devolvió");
    assert.equal(db.products[1].stock, 10);
  });

  test("sacar una línea y agregar el mismo producto en otra: cuenta las dos", async () => {
    addOrder(83, { status: "APPROVED", stockDeducted: true }, [{ productId: 1, quantity: 2 }]);
    const res = await modify(83, [{ productId: 1, quantity: 3, price: 900 }]);
    assert.equal(res.code, 200);
    assert.equal(db.products[1].stock, 9, "10 + 2 devueltos - 3 nuevos");
  });

  test("una variante que no es del producto se rechaza", async () => {
    addOrder(84, { status: "APPROVED", stockDeducted: true }, [{ productId: 1, quantity: 1 }]);
    db.products[3].stock = 10; // que no corte por falta de stock del producto
    const [linea] = db.orders[84].items;
    const res = await modify(84, [{ itemId: linea.id, productId: 1, quantity: 1, price: 1000 }, { productId: 3, variantId: 41, quantity: 1, price: 500 }]);
    assert.equal(res.code, 400);
    assert.equal(db.variants[41].stock, 30);
  });

  // 12/11/2026: agregar un cable con 5 variantes (350 unidades entre todas) decía
  // "Stock insuficiente… Disponible: 0", porque miraba el stock del producto padre.
  test("un producto con variantes agregado sin variante pide elegirla, sin tocar el pedido", async () => {
    const items = setUp(85, { status: "APPROVED", stockDeducted: true });
    const res = await modify(85, [...items, { productId: 3, quantity: 6, price: 699 }]);
    assert.equal(res.code, 400);
    assert.equal(res.body.error, 'Elegí la variante de "Funda"');
    assert.equal(db.orders[85].items.length, 2, "el pendrive sigue en el pedido");
    assert.equal(db.products[1].stock, 10);
    assert.equal(db.variants[31].stock, 30);
  });

  test("con la variante elegida descuenta de esa variante y guarda su etiqueta y SKU", async () => {
    const items = setUp(86, { status: "APPROVED", stockDeducted: true });
    const res = await modify(86, [...items, { productId: 3, variantId: 32, variantLabel: "texto del navegador", quantity: 6, price: 699 }]);
    assert.equal(res.code, 200);
    assert.equal(db.variants[32].stock, 24);
    assert.equal(db.variants[31].stock, 30);
    assert.equal(db.products[3].stock, 0, "el padre no se toca");
    const nueva = db.orders[86].items.find((i) => i.productId === 3);
    assert.equal(nueva.variantId, 32);
    assert.equal(nueva.variantLabel, "Color: Rojo", "la etiqueta la arma el servidor");
    assert.equal(nueva.variantSku, "FUN-R");
  });
});

describe("Modificar pedido: la respuesta reemplaza el pedido en pantalla", () => {
  beforeEach(resetDb);

  test("trae el SKU del producto: sin eso desaparecía del detalle al guardar, hasta recargar", async () => {
    addOrder(95, { status: "QUOTE_APPROVED", paymentMethod: "TRANSFERENCIA" }, [{ productId: 1, quantity: 1 }]);
    const [linea] = db.orders[95].items;
    const res = await modify(95, [{ itemId: linea.id, productId: 1, quantity: 2, price: 1000 }]);
    assert.equal(res.code, 200);
    assert.equal(db.lastOrderInclude.items.include.product.select.sku, true);
  });
});

describe("devolver stock no republica lo que el admin ocultó a mano (B12)", () => {
  beforeEach(() => {
    resetDb();
    db.products[1] = { ...db.products[1], active: false, hiddenByAdmin: true };            // oculto a mano, con stock
    db.products[2] = { ...db.products[2], stock: 0, active: false, hiddenByAdmin: false }; // oculto por falta de stock
  });

  test("cancelar una venta abonada", async () => {
    addOrder(90, { status: "APPROVED", stockDeducted: true }, [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }]);
    assert.equal((await setStatus(90, "CANCELLED")).code, 200);
    assert.equal(db.products[1].stock, 12);
    assert.equal(db.products[1].active, false, "el oculto a mano sigue oculto");
    assert.equal(db.products[2].active, true, "el que se había quedado sin stock vuelve a la tienda");
  });

  test("sacar la línea en Modificar pedido", async () => {
    addOrder(91, { status: "APPROVED", stockDeducted: true }, [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }]);
    const [, pendrive] = db.orders[91].items;
    assert.equal((await modify(91, [{ itemId: pendrive.id, productId: 2, quantity: 1, price: 1000 }])).code, 200);
    assert.equal(db.products[1].stock, 12);
    assert.equal(db.products[1].active, false);
  });
});

// ── Revisión del 12/11/2026: caminos hermanos que se habían quedado atrás ─────────────────────────

describe("el cliente cancela su cotización solo mientras está abierta", () => {
  beforeEach(resetDb);

  test("una cotización ya pagada no se cancela ni devuelve stock", async () => {
    addOrder(200, { status: "APPROVED", paymentMethod: "COTIZACION", customerId: 7, stockDeducted: true }, [{ productId: 1, quantity: 2 }]);
    const res = await call(cancelByCustomer, { params: { id: "200" }, user: { id: 7 }, body: { reason: "x" } });
    assert.equal(res.code, 400);
    assert.equal(db.orders[200].status, "APPROVED");
    assert.equal(db.products[1].stock, 10);
  });

  test("una pendiente sí", async () => {
    addOrder(201, { status: "PENDING", paymentMethod: "COTIZACION", customerId: 7 }, [{ productId: 1, quantity: 2 }]);
    const res = await call(cancelByCustomer, { params: { id: "201" }, user: { id: 7 }, body: { reason: "x" } });
    assert.equal(res.code, 200);
    assert.equal(db.orders[201].status, "CANCELLED");
  });

  test("devolver stock no republica lo que el admin ocultó a mano", async () => {
    db.products[2].active = false;
    db.products[2].hiddenByAdmin = true;
    addOrder(202, { status: "QUOTE_APPROVED", paymentMethod: "COTIZACION", customerId: 7, stockDeducted: true }, [{ productId: 2, quantity: 1 }]);
    assert.equal((await call(cancelByCustomer, { params: { id: "202" }, user: { id: 7 }, body: {} })).code, 200);
    assert.equal(db.products[2].stock, 11);
    assert.equal(db.products[2].active, false);
  });
});

describe("agregar un producto a un pedido (botón de las cotizaciones)", () => {
  beforeEach(resetDb);
  const add = (id, body) => call(addItemToOrder, { params: { id: String(id) }, body });

  test("una cotización acepta un producto con variantes sin elegir cuál (se asigna al aprobarla)", async () => {
    addOrder(210, { status: "PENDING", paymentMethod: "COTIZACION" }, [{ productId: 1, quantity: 1 }]);
    const res = await add(210, { productId: 3, quantity: 6 });
    assert.equal(res.code, 200, "antes: Stock insuficiente. Disponible: 0");
    const linea = db.orders[210].items.find((i) => i.productId === 3);
    assert.equal(linea.variantId, null);
    assert.equal(db.variants[31].stock, 30, "una cotización no descuenta");
  });

  test("pero no más que la suma de sus variantes", async () => {
    addOrder(211, { status: "PENDING", paymentMethod: "COTIZACION" }, [{ productId: 1, quantity: 1 }]);
    const res = await add(211, { productId: 3, quantity: 61 });
    assert.equal(res.code, 400);
    assert.match(res.body.error, /variantes: 60/);
  });

  test("un pedido que ya descontó stock pide la variante", async () => {
    addOrder(212, { status: "APPROVED", stockDeducted: true }, [{ productId: 1, quantity: 1 }]);
    const res = await add(212, { productId: 3, quantity: 1 });
    assert.equal(res.code, 400);
    assert.equal(res.body.error, 'Elegí la variante de "Funda"');
  });

  test("con variante: descuenta de ella y guarda etiqueta y SKU", async () => {
    addOrder(213, { status: "APPROVED", stockDeducted: true }, [{ productId: 1, quantity: 1 }]);
    const res = await add(213, { productId: 3, variantId: 32, quantity: 2 });
    assert.equal(res.code, 200);
    assert.equal(db.variants[32].stock, 28);
    const linea = db.orders[213].items.find((i) => i.productId === 3);
    assert.equal(linea.variantLabel, "Color: Rojo");
    assert.equal(linea.variantSku, "FUN-R");
  });

  test("la variante de otro producto se rechaza", async () => {
    addOrder(214, { status: "APPROVED", stockDeducted: true }, [{ productId: 1, quantity: 1 }]);
    const res = await add(214, { productId: 3, variantId: 41, quantity: 1 });
    assert.equal(res.code, 400);
    assert.equal(db.variants[41].stock, 30);
  });
});

describe("una línea sin variante de un producto con variantes no mueve el stock del padre", () => {
  beforeEach(resetDb);

  test("borrarla de un pedido cobrado no le inventa stock al padre", async () => {
    addOrder(220, { status: "APPROVED", stockDeducted: true }, [{ productId: 1, quantity: 1 }, { productId: 3, quantity: 5 }]);
    const linea = db.orders[220].items.find((i) => i.productId === 3);
    const res = await call(deleteOrderItem, { params: { orderId: "220", itemId: String(linea.id) } });
    assert.equal(res.code, 200);
    assert.equal(db.products[3].stock, 0, "antes quedaba en 5");
  });

  test("ni sacarla en Modificar pedido", async () => {
    addOrder(221, { status: "APPROVED", stockDeducted: true }, [{ productId: 1, quantity: 1 }, { productId: 3, quantity: 5 }]);
    const [parlante] = db.orders[221].items;
    const res = await modify(221, [{ itemId: parlante.id, productId: 1, quantity: 1, price: 1000 }]);
    assert.equal(res.code, 200);
    assert.equal(db.products[3].stock, 0);
  });
});

// 17/11/2026: la venta a mano suma el IVA como el checkout (solo mayorista con "Agregar IVA").
describe("venta a mano con IVA", () => {
  beforeEach(() => { resetDb(); db.products[1].ivaRate = 10.5; db.products[2].ivaRate = 21; });
  const venta = (body) => call(createManualOrder, { body: {
    customerName: "Cliente", paymentMethod: "EFECTIVO", status: "APPROVED", salesChannel: "MOSTRADOR",
    items: [{ productId: 1, quantity: 2, price: 1000 }, { productId: 2, quantity: 1, price: 500 }], ...body,
  } });
  const creado = () => Object.values(db.orders).find((o) => o.id >= 500);

  test("mayorista con IVA: cada producto con su alícuota, sobre el precio ya descontado", async () => {
    const res = await venta({ customerType: "MAYORISTA", wantsInvoice: true, manualDiscountType: "PERCENTAGE", manualDiscountValue: 10 });
    assert.equal(res.code, 201, JSON.stringify(res.body));
    const o = creado();
    assert.equal(o.wantsInvoice, true);
    // base: 2000 y 500, menos 10% → 1800 y 450; IVA 10,5% y 21% → 189 + 94,5
    assert.equal(o.ivaAmount, 283.5);
    assert.equal(o.total, 2250 + 283.5);
  });

  test("minorista: no se suma aunque venga marcado (sus precios ya tienen IVA)", async () => {
    const res = await venta({ customerType: "MINORISTA", wantsInvoice: true });
    assert.equal(res.code, 201, JSON.stringify(res.body));
    const o = creado();
    assert.equal(o.wantsInvoice, false);
    assert.equal(o.ivaAmount, 0);
    assert.equal(o.total, 2500);
  });

  test("mayorista sin la casilla: sin IVA", async () => {
    await venta({ customerType: "MAYORISTA" });
    assert.equal(creado().ivaAmount, 0);
    assert.equal(creado().total, 2500);
  });
});

// 17/11/2026: "Modificar pedido" también puede prender o apagar el IVA (solo pedidos mayoristas).
describe("Modificar pedido con IVA", () => {
  beforeEach(() => { resetDb(); db.products[1].ivaRate = 10.5; db.products[2].ivaRate = 21; });
  const lineas = (id) => db.orders[id].items.map((i) => ({ itemId: i.id, productId: i.productId, quantity: i.quantity, price: i.price }));

  test("prenderlo en un pedido mayorista suma el IVA de cada producto", async () => {
    addOrder(300, { status: "PENDING", customerType: "MAYORISTA" }, [{ productId: 1, quantity: 2, price: 1000 }, { productId: 2, quantity: 1, price: 500 }]);
    const res = await call(modifyOrder, { params: { id: "300" }, body: { items: lineas(300), wantsInvoice: true } });
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal(db.orders[300].wantsInvoice, true);
    assert.equal(db.orders[300].ivaAmount, 210 + 105); // 2000 × 10,5% + 500 × 21%
    assert.equal(db.orders[300].total, 2500 + 315);
  });

  test("apagarlo lo saca del total y deja el IVA en 0", async () => {
    addOrder(301, { status: "PENDING", customerType: "MAYORISTA", wantsInvoice: true, ivaAmount: 315, total: 2815 }, [{ productId: 1, quantity: 2, price: 1000 }, { productId: 2, quantity: 1, price: 500 }]);
    const res = await call(modifyOrder, { params: { id: "301" }, body: { items: lineas(301), wantsInvoice: false } });
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal(db.orders[301].wantsInvoice, false);
    assert.equal(db.orders[301].ivaAmount, 0);
    assert.equal(db.orders[301].total, 2500);
  });

  test("en un pedido minorista no se prende aunque llegue marcado", async () => {
    addOrder(302, { status: "PENDING", customerType: "MINORISTA" }, [{ productId: 1, quantity: 1, price: 1000 }]);
    await call(modifyOrder, { params: { id: "302" }, body: { items: lineas(302), wantsInvoice: true } });
    assert.equal(db.orders[302].wantsInvoice, false);
    assert.equal(db.orders[302].total, 1000);
  });

  test("un ítem libre en un pedido con IVA no rompe el cálculo (va al 21%)", async () => {
    addOrder(303, { status: "PENDING", customerType: "MAYORISTA" }, [{ productId: 1, quantity: 1, price: 1000 }, { productId: null, productName: "Libre", quantity: 1, price: 100 }]);
    const res = await call(modifyOrder, { params: { id: "303" }, body: { items: lineas(303), wantsInvoice: true } });
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal(db.orders[303].ivaAmount, 105 + 21);
  });
});

// 23/11/2026: descuento por monto (Black Friday). Los clientes de WhatsApp no pasan por el checkout:
// el vendedor se lo aplica con la casilla "Aplicar promo" de la venta a mano y de "Modificar pedido".
describe("descuento por monto en la venta a mano y en Modificar pedido", () => {
  const ahora = Date.now();
  const promo = (fields) => ({
    id: 1, name: "Black Friday", active: true, appliesTo: "AMBOS",
    startsAt: new Date(ahora - 86400000), endsAt: new Date(ahora + 86400000),
    tiers: [{ minAmount: 2000, percent: 5 }, { minAmount: 5000, percent: 10 }], ...fields,
  });
  beforeEach(() => { resetDb(); db.cartPromos = [promo()]; });
  const venta = (body) => call(createManualOrder, { body: {
    customerName: "Cliente WhatsApp", paymentMethod: "TRANSFERENCIA", status: "APPROVED", salesChannel: "WHATSAPP",
    customerType: "MINORISTA", items: [{ productId: 1, quantity: 2, price: 1000 }, { productId: 2, quantity: 1, price: 500 }], ...body,
  } });
  const creado = () => Object.values(db.orders).find((o) => o.id >= 500);
  const lineas = (id) => db.orders[id].items.map((i) => ({ itemId: i.id, productId: i.productId, quantity: i.quantity, price: i.price }));

  test("con la casilla: se aplica el escalón que alcanza y queda guardada la promo", async () => {
    const res = await venta({ applyPromo: true });
    assert.equal(res.code, 201, JSON.stringify(res.body));
    const o = creado();
    assert.equal(o.promoId, 1);
    assert.equal(o.promoPercent, 5);       // 2.500 llega al escalón de $2.000
    assert.equal(o.promoDiscount, 125);
    assert.equal(o.total, 2375);
    assert.equal(o.promoRule.name, "Black Friday");
  });

  test("sin la casilla: no se aplica aunque haya una promo vigente", async () => {
    await venta({});
    assert.equal(creado().promoId, undefined);
    assert.equal(creado().total, 2500);
  });

  test("con la casilla pero sin llegar al mínimo: avisa y no registra nada", async () => {
    const res = await venta({ applyPromo: true, items: [{ productId: 1, quantity: 1, price: 1000 }] });
    assert.equal(res.code, 400);
    assert.equal(creado(), undefined);
  });

  test("una promo solo para mayoristas no se le aplica a una venta minorista", async () => {
    db.cartPromos = [promo({ appliesTo: "MAYORISTA" })];
    const res = await venta({ applyPromo: true });
    assert.equal(res.code, 400);
    const res2 = await venta({ applyPromo: true, customerType: "MAYORISTA" });
    assert.equal(res2.code, 201, JSON.stringify(res2.body));
    assert.equal(creado().promoPercent, 5);
  });

  test("una promo pausada o terminada no se aplica", async () => {
    db.cartPromos = [promo({ active: false }), promo({ id: 2, endsAt: new Date(ahora - 1000) })];
    assert.equal((await venta({ applyPromo: true })).code, 400);
  });

  test("con descuento del vendedor: la promo va primero y el descuento sobre lo que quedó", async () => {
    await venta({ applyPromo: true, manualDiscountType: "FIXED", manualDiscountValue: 375 });
    assert.equal(creado().total, 2500 - 125 - 375);
  });

  test("Modificar pedido: si sube el total, el % sube al escalón siguiente con los escalones del pedido", async () => {
    // El pedido guardó sus escalones al comprar; la promo de hoy ya ni existe.
    db.cartPromos = [];
    addOrder(400, { status: "PENDING", customerType: "MINORISTA", promoId: 1, promoPercent: 5, promoDiscount: 125, total: 2375,
      promoRule: { name: "Black Friday", tiers: [{ minAmount: 2000, percent: 5 }, { minAmount: 5000, percent: 10 }] } },
      [{ productId: 1, quantity: 2, price: 1000 }, { productId: 2, quantity: 1, price: 500 }]);
    const items = lineas(400);
    items[0].quantity = 5; // 5.000 + 500
    const res = await call(modifyOrder, { params: { id: "400" }, body: { items } });
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal(db.orders[400].promoPercent, 10);
    assert.equal(db.orders[400].promoDiscount, 550);
    assert.equal(db.orders[400].total, 4950);
  });

  test("Modificar pedido: si baja del mínimo, el descuento queda en 0 (y vuelve si se agrega algo)", async () => {
    addOrder(401, { status: "PENDING", customerType: "MINORISTA", promoId: 1, promoPercent: 5, promoDiscount: 125, total: 2375,
      promoRule: { name: "Black Friday", tiers: [{ minAmount: 2000, percent: 5 }] } },
      [{ productId: 1, quantity: 2, price: 1000 }, { productId: 2, quantity: 1, price: 500 }]);
    const [parlante] = lineas(401);
    await call(modifyOrder, { params: { id: "401" }, body: { items: [{ ...parlante, quantity: 1 }] } });
    assert.equal(db.orders[401].promoDiscount, 0);
    assert.equal(db.orders[401].total, 1000);
  });

  test("Modificar pedido: destildar la promo la saca del total", async () => {
    addOrder(402, { status: "PENDING", customerType: "MINORISTA", promoId: 1, promoPercent: 5, promoDiscount: 125, total: 2375,
      promoRule: { name: "Black Friday", tiers: [{ minAmount: 2000, percent: 5 }] } },
      [{ productId: 1, quantity: 2, price: 1000 }, { productId: 2, quantity: 1, price: 500 }]);
    const res = await call(modifyOrder, { params: { id: "402" }, body: { items: lineas(402), applyPromo: false } });
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal(db.orders[402].promoId, null);
    assert.equal(db.orders[402].promoDiscount, null);
    assert.equal(db.orders[402].total, 2500);
  });

  test("Modificar pedido: tildarla en un pedido que no la tenía aplica la vigente", async () => {
    addOrder(403, { status: "PENDING", customerType: "MINORISTA", total: 2500 },
      [{ productId: 1, quantity: 2, price: 1000 }, { productId: 2, quantity: 1, price: 500 }]);
    const res = await call(modifyOrder, { params: { id: "403" }, body: { items: lineas(403), applyPromo: true } });
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal(db.orders[403].promoId, 1);
    assert.equal(db.orders[403].total, 2375);
  });

  test("Modificar pedido: tildarla sin llegar al mínimo avisa ANTES de tocar el pedido", async () => {
    addOrder(404, { status: "APPROVED", stockDeducted: true, customerType: "MINORISTA", total: 2500 },
      [{ productId: 1, quantity: 2, price: 1000 }, { productId: 2, quantity: 1, price: 500 }]);
    const [parlante] = lineas(404);
    const res = await call(modifyOrder, { params: { id: "404" }, body: { items: [{ ...parlante, quantity: 1 }], applyPromo: true } });
    assert.equal(res.code, 400);
    assert.equal(db.orders[404].items.length, 2, "no se sacó la línea del pendrive");
    assert.equal(db.products[2].stock, 10, "no se devolvió stock");
  });
});

// Tests del carrito de una cuenta (routes/cart.routes.js):
//  - "sin stock" en una línea SIN variante de un producto CON variantes (enrichCarts): antes miraba el stock
//    del producto padre (0 con variantes) y Checkout.jsx rebotaba al mayorista con "Tenés productos sin
//    stock" aunque el checkout aceptaba la cotización; ahora usa la misma regla que createOrder;
//  - POST /my/items: la variante tiene que ser visible para el tipo de cliente y la etiqueta la arma el
//    servidor (antes se guardaba la que mandaba el navegador), igual que el carrito sin cuenta.
// Base simulada. Correr con: npm test

process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-prueba";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const PRICES = { price: 1000, salePrice: null, wholesalePrice: 700, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null };
const NO_PRICES = { price: null, salePrice: null, wholesalePrice: null, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null };
const variant = (id, productId, visibility, stock, value, extra = {}) =>
  ({ id, productId, active: true, visibility, stock, stockUnlimited: false, combination: [{ name: "Color", value }], ...NO_PRICES, ...extra });

let db;
function resetDb() {
  db = {
    customers: { 1: { id: 1, type: "MINORISTA" }, 2: { id: 2, type: "MAYORISTA" } },
    products: [
      { id: 1, name: "Cable", active: true, visibility: "AMBOS", stock: 10, stockUnlimited: false, ivaRate: 21, currency: "ARS", ...PRICES },
      { id: 2, name: "Funda", active: true, visibility: "AMBOS", stock: 0, stockUnlimited: false, ivaRate: 21, currency: "ARS", ...PRICES }, // con variantes
      { id: 3, name: "Mouse", active: true, visibility: "AMBOS", stock: 0, stockUnlimited: false, ivaRate: 21, currency: "ARS", ...PRICES }, // sin variantes, agotado
      { id: 4, name: "Cargador", active: true, visibility: "AMBOS", stock: 0, stockUnlimited: false, ivaRate: 21, currency: "ARS", ...PRICES }, // con variantes
      { id: 5, name: "Caja surtida", active: true, visibility: "AMBOS", stock: 0, stockUnlimited: false, ivaRate: 21, currency: "ARS", ...PRICES }, // variantes solo minoristas
    ],
    variants: [
      variant(21, 2, "AMBOS", 3, "Rojo"),
      variant(22, 2, "MAYORISTA", 0, "Negro"),
      variant(23, 2, "MINORISTA", 5, "Azul"),
      variant(24, 2, "AMBOS", 9, "Verde", { active: false }),
      variant(41, 4, "AMBOS", 2, "Blanco"),
      // El mayorista no ve ninguna: ProductCard la agrega sin variante y el admin la asigna al aprobar
      variant(51, 5, "MINORISTA", 0, "Rojo"),
      variant(52, 5, "MINORISTA", 4, "Azul"),
      variant(53, 5, "MINORISTA", 50, "Verde", { active: false }),
    ],
    carts: [],
    cartItems: [],
    nextId: 100,
  };
}

// Filtro de la base simulada: { campo: valor } o { campo: { in: [...] } }
const matches = (row, where) => Object.entries(where).every(([k, cond]) =>
  (cond && typeof cond === "object" && Array.isArray(cond.in) ? cond.in.includes(row[k]) : row[k] === cond));

class FakePrismaClient {
  constructor() {
    this.product = {
      findUnique: async ({ where }) => clone(db.products.find((p) => p.id === where.id)),
      findMany: async ({ where }) => clone(db.products.filter((p) => matches(p, where))),
    };
    this.productVariant = {
      findUnique: async ({ where }) => clone(db.variants.find((v) => v.id === where.id)),
      findMany: async ({ where }) => clone(db.variants.filter((v) => matches(v, where))),
    };
    this.customer = { findUnique: async ({ where }) => clone(db.customers[where.id]) };
    this.cart = {
      upsert: async ({ where, create }) => {
        let cart = db.carts.find((c) => c.customerId === where.customerId);
        if (!cart) db.carts.push(cart = { id: db.nextId++, ...create });
        return clone(cart);
      },
      findUnique: async ({ where }) => {
        const cart = db.carts.find((c) => c.customerId === where.customerId);
        if (!cart) return null;
        return {
          ...clone(cart),
          items: clone(db.cartItems.filter((i) => i.cartId === cart.id).sort((a, b) => a.id - b.id)),
          customer: { type: db.customers[cart.customerId].type },
        };
      },
    };
    this.cartItem = {
      findFirst: async ({ where }) => clone(db.cartItems.find((i) => matches(i, where)) || null),
      create: async ({ data }) => {
        const { cart, product, ...rest } = data;
        const row = { id: db.nextId++, cartId: cart.connect.id, productId: product.connect.id, ...rest };
        db.cartItems.push(row);
        return clone(row);
      },
      update: async ({ where, data }) => clone(Object.assign(db.cartItems.find((i) => i.id === where.id), data)),
    };
  }
}
const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient, Prisma: {} });
stub(path.join(root, "src/services/email.service.js"), new Proxy({}, { get: () => async () => {} }));

const router = require("../src/routes/cart.routes");
const { enrichCarts } = router;
const layer = router.stack.find((l) => l.route?.path === "/my/items" && l.route.methods.post);
const addHandler = layer.route.stack[layer.route.stack.length - 1].handle; // sin los middlewares de sesión

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function add(customerId, body) {
  const res = fakeRes();
  await addHandler({ user: { id: customerId }, body: { name: "x", price: 1, quantity: 1, ...body } }, res);
  return res;
}
// outOfStock de una línea del carrito de un cliente de ese tipo
async function outOfStock(type, line) {
  const [cart] = await enrichCarts([{ id: 1, customer: { type }, items: [{ id: 1, variantId: null, quantity: 1, price: 1000, ...line }] }]);
  return cart.items[0].outOfStock;
}

describe("carrito de una cuenta: línea sin variante de un producto con variantes", () => {
  beforeEach(resetDb);

  test("mayorista: alcanza con stock en la suma de las variantes activas (el padre está en 0)", async () => {
    assert.equal(await outOfStock("MAYORISTA", { productId: 5 }), false, "4 en la azul");
    db.variants.find((v) => v.id === 52).stock = 0;
    assert.equal(await outOfStock("MAYORISTA", { productId: 5 }), true, "la desactivada no cuenta");
    db.variants.find((v) => v.id === 51).stockUnlimited = true;
    assert.equal(await outOfStock("MAYORISTA", { productId: 5 }), false, "una ilimitada alcanza");
    // Aunque haya variantes que el mayorista ve (la cotización igual va sin variante y el admin la asigna)
    assert.equal(await outOfStock("MAYORISTA", { productId: 2 }), false);
  });

  test("minorista que puede elegir una variante: el checkout se la pide, así que no se puede comprar así", async () => {
    assert.equal(await outOfStock("MINORISTA", { productId: 2 }), true);
    assert.equal(await outOfStock("MINORISTA", { productId: 5 }), true);
  });

  test("sin variantes, como siempre: el stock del producto; con variante, el de la variante", async () => {
    assert.equal(await outOfStock("MAYORISTA", { productId: 1 }), false);
    assert.equal(await outOfStock("MAYORISTA", { productId: 3 }), true);
    assert.equal(await outOfStock("MINORISTA", { productId: 2, variantId: 21 }), false);
    assert.equal(await outOfStock("MAYORISTA", { productId: 2, variantId: 22 }), true);
  });
});

describe("POST /my/items: variante visible y etiqueta armada en el servidor", () => {
  beforeEach(resetDb);

  test("la etiqueta sale de la combinación de la variante, no del navegador", async () => {
    const res = await add(1, { productId: 2, variantId: 21, variantLabel: "Color: Dorado edición limitada" });
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.items.map((i) => [i.variantId, i.variantLabel]), [[21, "Color: Rojo"]]);
    assert.equal(db.cartItems[0].variantLabel, "Color: Rojo");
  });

  test("sin variante no queda etiqueta, y volver a agregarlo suma en la misma línea", async () => {
    await add(2, { productId: 5, variantLabel: "Color: Rojo", quantity: 2 });
    const res = await add(2, { productId: 5, variantLabel: "otra cosa", quantity: 3 });
    assert.deepEqual(res.body.items.map((i) => [i.variantId, i.variantLabel, i.quantity, i.outOfStock]), [[null, null, 5, false]]);
  });

  test("una variante que este tipo de cliente no ve: 400 y no se agrega", async () => {
    const minorista = await add(1, { productId: 2, variantId: 22 }); // solo mayoristas
    assert.equal(minorista.code, 400);
    const mayorista = await add(2, { productId: 2, variantId: 23 }); // solo minoristas
    assert.equal(mayorista.code, 400);
    assert.equal(db.cartItems.length, 0);
    assert.equal((await add(2, { productId: 2, variantId: 22 })).code, 200, "la de mayoristas, al mayorista sí");
    assert.equal((await add(2, { productId: 2, variantId: 21 })).code, 200, "la de todos, también");
  });

  test("variante de otro producto o desactivada: 400", async () => {
    assert.equal((await add(1, { productId: 2, variantId: 41 })).code, 400);
    assert.equal((await add(1, { productId: 2, variantId: 24 })).code, 400);
    assert.equal((await add(1, { productId: 2, variantId: 999 })).code, 400);
    assert.equal(db.cartItems.length, 0);
  });
});

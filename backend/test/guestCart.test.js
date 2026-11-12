// Tests del carrito sin cuenta (POST /api/carts/guest, routes/cart.routes.js): el navegador manda qué
// producto, qué variante y cuántos; el servidor responde nombre, foto, precio minorista de hoy y si se puede
// comprar. Base simulada. Correr con: npm test

process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-prueba";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const clone = (o) => JSON.parse(JSON.stringify(o));
let db;
function resetDb() {
  db = {
    products: [
      { id: 1, name: "Cable USB", images: ["cable.jpg", "cable2.jpg"], active: true, visibility: "AMBOS", stock: 10, stockUnlimited: false, ivaRate: 21, currency: "ARS", price: 1000, salePrice: 900, wholesalePrice: 600, wholesaleSalePrice: 500, priceTiers: null, wholesalePriceTiers: null },
      { id: 2, name: "Funda", images: [], active: true, visibility: "AMBOS", stock: 0, stockUnlimited: false, ivaRate: 10.5, currency: "ARS", price: 5000, salePrice: null, wholesalePrice: null, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null },
      { id: 3, name: "Pack mayorista", images: ["pack.jpg"], active: true, visibility: "MAYORISTA", stock: 50, stockUnlimited: false, ivaRate: 21, currency: "ARS", price: 30000, salePrice: null, wholesalePrice: 30000, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null },
      { id: 4, name: "Parlante pausado", images: ["p.jpg"], active: false, visibility: "AMBOS", stock: 5, stockUnlimited: false, ivaRate: 21, currency: "ARS", price: 40000, salePrice: null, wholesalePrice: null, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null },
      { id: 5, name: "Notebook", images: ["n.jpg"], active: true, visibility: "AMBOS", stock: 0, stockUnlimited: true, ivaRate: 21, currency: "USD", price: 890, salePrice: null, wholesalePrice: null, wholesaleSalePrice: null, priceTiers: [{ minQty: 3, price: 800 }], wholesalePriceTiers: null },
    ],
    variants: [
      { id: 21, productId: 2, active: true, visibility: "AMBOS", combination: [{ name: "Color", value: "Rojo" }, { name: "Modelo", value: "A15" }], stock: 3, stockUnlimited: false, price: 5500, salePrice: 5200, wholesalePrice: null, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null },
      { id: 22, productId: 2, active: true, visibility: "AMBOS", combination: [{ name: "Color", value: "Azul" }], stock: 0, stockUnlimited: false, price: null, salePrice: null, wholesalePrice: null, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null },
      { id: 23, productId: 2, active: true, visibility: "MAYORISTA", combination: [{ name: "Color", value: "Negro" }], stock: 9, stockUnlimited: false, price: null, salePrice: null, wholesalePrice: 4000, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null },
      { id: 24, productId: 2, active: false, visibility: "AMBOS", combination: [{ name: "Color", value: "Verde" }], stock: 9, stockUnlimited: false, price: null, salePrice: null, wholesalePrice: null, wholesaleSalePrice: null, priceTiers: null, wholesalePriceTiers: null },
    ],
  };
}
// Filtro de la base simulada: { campo: valor } o { campo: { in: [...] } }
const matches = (row, where) => Object.entries(where).every(([k, cond]) =>
  (cond && typeof cond === "object" && Array.isArray(cond.in) ? cond.in.includes(row[k]) : row[k] === cond));
class FakePrismaClient {
  constructor() {
    this.product = { findMany: async ({ where }) => clone(db.products.filter((p) => where.id.in.includes(p.id))) };
    // Antes solo entendía { id: { in } }: el carrito ahora también pide las variantes activas de un producto
    // (líneas sin variante de un producto con variantes)
    this.productVariant = { findMany: async ({ where }) => clone(db.variants.filter((v) => matches(v, where))) };
  }
}
const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient, Prisma: {} });
stub(path.join(root, "src/services/email.service.js"), new Proxy({}, { get: () => async () => {} }));

const router = require("../src/routes/cart.routes");
const layer = router.stack.find((l) => l.route?.path === "/guest");
const handler = layer.route.stack[layer.route.stack.length - 1].handle;

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function guest(items) {
  const res = fakeRes();
  await handler({ body: { items } }, res);
  return res;
}
const only = async (item) => (await guest([item])).body.items[0];

describe("carrito sin cuenta", () => {
  beforeEach(resetDb);

  test("devuelve nombre, foto y precio minorista de hoy, con la forma del carrito de una cuenta", async () => {
    const res = await guest([{ productId: 1, quantity: 2 }]);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.items, [{
      id: "g-1-0", productId: 1, variantId: null, variantLabel: null, name: "Cable USB", image: "cable.jpg", quantity: 2,
      price: 900, previousPrice: null, priceChanged: false, outOfStock: false, currency: "ARS",
      product: { stock: 10, stockUnlimited: false, active: true, ivaRate: 21, currency: "ARS" },
    }]);
  });

  test("nunca viaja un precio mayorista", async () => {
    const res = await guest([{ productId: 1, quantity: 1 }, { productId: 3, quantity: 1 }]);
    assert.doesNotMatch(JSON.stringify(res.body), /wholesale|600|500/);
  });

  test("avisa si el precio cambió desde que lo agregó", async () => {
    const subio = await only({ productId: 1, quantity: 1, price: 800 });
    assert.deepEqual([subio.price, subio.previousPrice, subio.priceChanged], [900, 800, true]);
    const igual = await only({ productId: 1, quantity: 1, price: 900 });
    assert.deepEqual([igual.price, igual.previousPrice, igual.priceChanged], [900, null, false]);
  });

  test("variante: su etiqueta y su precio; sin precio propio, el del producto", async () => {
    const roja = await only({ productId: 2, variantId: 21, quantity: 1 });
    assert.deepEqual([roja.id, roja.variantId, roja.variantLabel, roja.price, roja.outOfStock], ["g-2-21", 21, "Color: Rojo / Modelo: A15", 5200, false]);
    const azul = await only({ productId: 2, variantId: 22, quantity: 1 });
    assert.deepEqual([azul.price, azul.outOfStock], [5000, true]); // sin stock
  });

  test("lo que no se puede comprar queda marcado: sin stock, pausado, solo mayoristas, variante de otro producto o inactiva", async () => {
    const res = await guest([
      { productId: 2, quantity: 1 }, { productId: 4, quantity: 1 }, { productId: 3, quantity: 1 },
      { productId: 1, variantId: 21, quantity: 1 }, { productId: 2, variantId: 23, quantity: 1 }, { productId: 2, variantId: 24, quantity: 1 },
    ]);
    assert.deepEqual(res.body.items.map((i) => [i.id, i.outOfStock]), [
      ["g-2-0", true], ["g-4-0", true], ["g-3-0", true], ["g-1-21", true], ["g-2-23", true], ["g-2-24", true],
    ]);
  });

  test("sin variante, de un producto con variantes: misma regla que el checkout, no el stock del padre", async () => {
    // Producto con variantes que un minorista no puede elegir (todas de mayoristas): el checkout lo acepta
    // sin variante si la SUMA de las variantes activas tiene stock. El padre está en 0, como siempre.
    db.products.push({ ...db.products[1], id: 6, name: "Caja surtida", stock: 0 });
    db.variants.push(
      { ...db.variants[2], id: 61, productId: 6, stock: 0 },
      { ...db.variants[2], id: 62, productId: 6, stock: 4 },
      { ...db.variants[2], id: 63, productId: 6, stock: 50, active: false }, // desactivada: no cuenta
    );
    assert.equal((await only({ productId: 6, quantity: 1 })).outOfStock, false);
    db.variants.find((v) => v.id === 62).stock = 0;
    assert.equal((await only({ productId: 6, quantity: 1 })).outOfStock, true, "las activas suman 0");
    db.variants.find((v) => v.id === 61).stockUnlimited = true;
    assert.equal((await only({ productId: 6, quantity: 1 })).outOfStock, false, "una ilimitada alcanza");
    // Si el minorista SÍ puede elegir una variante (Funda: la roja es para todos), el checkout le pide que la
    // elija: sin variante no se puede comprar aunque haya stock en las variantes.
    assert.equal((await only({ productId: 2, quantity: 1 })).outOfStock, true);
  });

  test("stock ilimitado y dólares: se puede comprar y lleva su moneda; el tramo por cantidad baja el precio", async () => {
    const una = await only({ productId: 5, quantity: 1 });
    assert.deepEqual([una.price, una.currency, una.outOfStock], [890, "USD", false]);
    assert.equal((await only({ productId: 5, quantity: 3 })).price, 800);
  });

  test("un producto borrado sale del carrito", async () => {
    const res = await guest([{ productId: 999, quantity: 1 }, { productId: 1, quantity: 1 }]);
    assert.deepEqual(res.body.items.map((i) => i.productId), [1]);
  });

  test("líneas repetidas se suman; la basura se ignora; vacío responde vacío", async () => {
    const res = await guest([{ productId: 1, quantity: 2 }, { productId: "1", quantity: "3" }, null, "x", { productId: "abc" }, { productId: 1, variantId: "x" }, { productId: -4 }]);
    assert.deepEqual(res.body.items.map((i) => [i.id, i.quantity]), [["g-1-0", 5]]);
    assert.deepEqual((await guest([])).body.items, []);
    assert.deepEqual((await guest(undefined)).body.items, []);
    assert.deepEqual((await guest("x")).body.items, []);
  });

  test("tope de líneas y de cantidad", async () => {
    for (let i = 100; i < 200; i++) db.products.push({ ...db.products[0], id: i });
    const muchas = Array.from({ length: 100 }, (_, i) => ({ productId: 100 + i, quantity: 1 }));
    assert.equal((await guest(muchas)).body.items.length, 60);
    assert.equal((await only({ productId: 1, quantity: 99999999 })).quantity, 9999);
  });
});

// Tests de privacidad de precios en la API pública de productos.
// Correr con: npm test  (usa el runner que trae Node, sin dependencias extra)
//
// Qué protege: que el costo y los precios mayoristas NUNCA salgan en una respuesta sin sesión o a
// un cliente minorista. Se detectó que /api/products/<slug> los devolvía a cualquiera.

const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const SECRET = process.env.JWT_SECRET;

// ── Base simulada ────────────────────────────────────────────────────────────
// Los controllers crean su propio PrismaClient al cargarse, así que se reemplaza @prisma/client en
// el cache de require ANTES de cargarlos. Cada test define qué devuelve cada consulta.
// lastFindMany / lastFindUnique: los argumentos de la última consulta, para revisar qué filtro armó
// el handler (la base simulada no filtra nada por su cuenta).
const db = { product: null, products: [], customers: {}, lastFindMany: null, lastFindUnique: null };

class FakePrismaClient {
  constructor() {
    this.product = {
      findUnique: async (args) => { db.lastFindUnique = args; return db.product; },
      findMany:   async (args) => { db.lastFindMany = args; return db.products; },
      count:      async () => db.products.length,
    };
    this.customer = {
      findUnique: async ({ where }) => db.customers[where.id] || null,
    };
    this.category = { findMany: async () => [] };
    this.$queryRaw = async () => [];
    this.$queryRawUnsafe = async () => [];
  }
}
const prismaPath = require.resolve("@prisma/client", { paths: [path.join(__dirname, "..")] });
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: { PrismaClient: FakePrismaClient, Prisma: { sql: () => ({}), join: () => ({}) } },
};

const { resolvePriceViewer, sanitizeProductForViewer, effectiveVisibleFor } = require("../src/utils/productPrivacy");
let getProduct, getProducts;
before(() => {
  ({ getProduct, getProducts } = require("../src/controllers/product.controller"));
});

// ── Datos de ejemplo ─────────────────────────────────────────────────────────
const SECRET_FIELDS    = ["cost", "module", "shelf", "supplierId", "supplier", "stockBreak", "hotSellerThreshold"];
const WHOLESALE_FIELDS = ["wholesalePrice", "wholesaleSalePrice", "wholesalePriceTiers"];
const RETAIL_FIELDS    = ["price", "salePrice", "priceTiers"];

// Producto que se vende SOLO a mayoristas: el panel copia el precio mayorista en `price`.
function wholesaleOnlyFixture() {
  return { ...productFixture(), id: 3, slug: "cargador-solo-mayorista", visibility: "MAYORISTA", price: 16299 };
}

function productFixture() {
  return {
    id: 1, name: "Pendrive 128GB", slug: "pendrive", active: true, visibility: "AMBOS",
    price: 20999, salePrice: null, currency: "ARS",
    cost: 9660, wholesalePrice: 16299, wholesaleSalePrice: 15999,
    wholesalePriceTiers: [{ minQty: 10, price: 15999 }, { minQty: 20, price: 15750 }],
    priceTiers: [{ minQty: 5, price: 19999 }],
    module: "A", shelf: "3", supplierId: 7, supplier: { id: 7, name: "Proveedor" },
    stockBreak: 2, hotSellerThreshold: 50,
    stock: 10, stockUnlimited: false, images: [], categories: [], attributes: [],
    variants: [{
      id: 11, combination: [], price: 21999, salePrice: null,
      wholesalePrice: 17000, wholesaleSalePrice: null, wholesalePriceTiers: null, priceTiers: null,
      cost: 9000, module: "B", shelf: "1", supplierId: 7, stock: 3, stockUnlimited: false,
    }],
    _count: { variants: 1 },
  };
}

const tokenFor = (payload) => `Bearer ${jwt.sign(payload, SECRET)}`;
const reqWith = (authorization, query = {}, params = {}) => ({
  headers: authorization ? { authorization } : {}, query, params,
});
function fakeRes() {
  return {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function assertNoFields(obj, fields, where) {
  for (const f of fields) assert.ok(!(f in obj), `${where}: no debería tener "${f}"`);
}
// Chequeo de punta a punta: el JSON serializado no contiene ninguna de las claves prohibidas.
function assertJsonHasNo(body, fields) {
  const json = JSON.stringify(body);
  for (const f of fields) assert.ok(!json.includes(`"${f}"`), `la respuesta no debería contener "${f}"`);
}

// ── sanitizeProductForViewer ─────────────────────────────────────────────────
describe("sanitizeProductForViewer", () => {
  test("visitante: sin costo, sin mayoristas, sin datos de depósito (producto y variantes)", () => {
    const out = sanitizeProductForViewer(productFixture(), { isAdmin: false, isMayorista: false });
    assertNoFields(out, [...SECRET_FIELDS, ...WHOLESALE_FIELDS], "producto");
    assertNoFields(out.variants[0], [...SECRET_FIELDS, ...WHOLESALE_FIELDS], "variante");
    assert.equal(out.price, 20999);
    assert.deepEqual(out.priceTiers, [{ minQty: 5, price: 19999 }]);
  });

  test("mayorista aprobado: ve precios mayoristas, pero no el costo", () => {
    const out = sanitizeProductForViewer(productFixture(), { isAdmin: false, isMayorista: true });
    assertNoFields(out, SECRET_FIELDS, "producto");
    assertNoFields(out.variants[0], SECRET_FIELDS, "variante");
    assert.equal(out.wholesalePrice, 16299);
    assert.equal(out.variants[0].wholesalePrice, 17000);
  });

  test("admin: recibe el producto completo", () => {
    const p = productFixture();
    assert.deepEqual(sanitizeProductForViewer(p, { isAdmin: true, isMayorista: true }), p);
  });

  test("no modifica el objeto original", () => {
    const p = productFixture();
    sanitizeProductForViewer(p, { isAdmin: false, isMayorista: false });
    assert.equal(p.cost, 9660);
    assert.equal(p.variants[0].cost, 9000);
  });
});

// ── resolvePriceViewer ───────────────────────────────────────────────────────
describe("resolvePriceViewer", () => {
  const prisma = new FakePrismaClient();

  test("sin token → visitante", async () => {
    assert.deepEqual(await resolvePriceViewer(reqWith(null), prisma), { isAdmin: false, isMayorista: false });
  });

  test("token inválido → visitante (no error)", async () => {
    assert.deepEqual(await resolvePriceViewer(reqWith("Bearer basura"), prisma), { isAdmin: false, isMayorista: false });
  });

  test("admin → ve todo", async () => {
    const v = await resolvePriceViewer(reqWith(tokenFor({ id: 1, role: "ADMIN" })), prisma);
    assert.deepEqual(v, { isAdmin: true, isMayorista: true });
  });

  test("mayorista aprobado en la base → mayorista", async () => {
    db.customers = { 5: { type: "MAYORISTA", status: "APPROVED" } };
    const v = await resolvePriceViewer(reqWith(tokenFor({ id: 5, role: "CUSTOMER", type: "MAYORISTA" })), prisma);
    assert.equal(v.isMayorista, true);
  });

  test("el token dice MAYORISTA pero en la base ya es minorista → no ve mayoristas", async () => {
    db.customers = { 5: { type: "MINORISTA", status: "APPROVED" } };
    const v = await resolvePriceViewer(reqWith(tokenFor({ id: 5, role: "CUSTOMER", type: "MAYORISTA" })), prisma);
    assert.equal(v.isMayorista, false);
  });

  test("mayorista no aprobado → no ve mayoristas", async () => {
    db.customers = { 5: { type: "MAYORISTA", status: "PENDING" } };
    const v = await resolvePriceViewer(reqWith(tokenFor({ id: 5, role: "CUSTOMER" })), prisma);
    assert.equal(v.isMayorista, false);
  });
});

// ── Handlers reales ──────────────────────────────────────────────────────────
describe("GET /api/products/:id (getProduct)", () => {
  test("sin sesión: la respuesta no trae costo ni precios mayoristas", async () => {
    db.product = productFixture();
    const res = fakeRes();
    await getProduct(reqWith(null, {}, { id: "pendrive" }), res);
    assert.equal(res.statusCode, 200);
    assertJsonHasNo(res.body, [...SECRET_FIELDS, ...WHOLESALE_FIELDS]);
    assert.equal(res.body.price, 20999);
  });

  test("sin sesión con ?visibleFor=MAYORISTA escrito a mano: igual no trae mayoristas", async () => {
    db.product = productFixture();
    const res = fakeRes();
    await getProduct(reqWith(null, { visibleFor: "MAYORISTA" }, { id: "pendrive" }), res);
    assertJsonHasNo(res.body, [...SECRET_FIELDS, ...WHOLESALE_FIELDS]);
  });

  test("cliente minorista: no trae costo ni mayoristas", async () => {
    db.product = productFixture();
    db.customers = { 9: { type: "MINORISTA", status: "APPROVED" } };
    const res = fakeRes();
    await getProduct(reqWith(tokenFor({ id: 9, role: "CUSTOMER" }), {}, { id: "pendrive" }), res);
    assertJsonHasNo(res.body, [...SECRET_FIELDS, ...WHOLESALE_FIELDS]);
  });

  test("mayorista aprobado: trae mayoristas, no el costo", async () => {
    db.product = productFixture();
    db.customers = { 5: { type: "MAYORISTA", status: "APPROVED" } };
    const res = fakeRes();
    await getProduct(reqWith(tokenFor({ id: 5, role: "CUSTOMER" }), { visibleFor: "MAYORISTA" }, { id: "pendrive" }), res);
    assertJsonHasNo(res.body, SECRET_FIELDS);
    assert.equal(res.body.wholesalePrice, 16299);
    assert.deepEqual(res.body.wholesalePriceTiers, [{ minQty: 10, price: 15999 }, { minQty: 20, price: 15750 }]);
  });

  test("admin: trae todo (el panel lo necesita)", async () => {
    db.product = productFixture();
    const res = fakeRes();
    await getProduct(reqWith(tokenFor({ id: 1, role: "SUPERADMIN" }), {}, { id: "pendrive" }), res);
    assert.equal(res.body.cost, 9660);
    assert.equal(res.body.wholesalePrice, 16299);
  });

  test("producto inactivo: 404 para visitantes", async () => {
    db.product = { ...productFixture(), active: false };
    const res = fakeRes();
    await getProduct(reqWith(null, {}, { id: "pendrive" }), res);
    assert.equal(res.statusCode, 404);
  });
});

describe("GET /api/products (getProducts)", () => {
  test("sin sesión: ninguna card trae costo ni precios mayoristas", async () => {
    db.products = [productFixture(), { ...productFixture(), id: 2, slug: "otro" }];
    const res = fakeRes();
    await getProducts(reqWith(null, { visibleFor: "MAYORISTA" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.products.length, 2);
    assertJsonHasNo(res.body, [...SECRET_FIELDS, ...WHOLESALE_FIELDS]);
  });

  test("mayorista aprobado: las cards traen precio mayorista, no el costo", async () => {
    db.products = [productFixture()];
    db.customers = { 5: { type: "MAYORISTA", status: "APPROVED" } };
    const res = fakeRes();
    await getProducts(reqWith(tokenFor({ id: 5, role: "CUSTOMER" }), { visibleFor: "MAYORISTA" }), res);
    assertJsonHasNo(res.body, SECRET_FIELDS);
    assert.equal(res.body.products[0].wholesalePrice, 17000); // el de la primera variante disponible
  });
});

// ── Productos que se venden SOLO a mayoristas ────────────────────────────────
// En esos productos el panel copia el precio mayorista en `price`, así que para quien no es
// mayorista no puede viajar ningún precio.
describe("productos solo mayoristas", () => {
  test("visitante: sin ningún precio (ni en las variantes) y con priceHidden", () => {
    const out = sanitizeProductForViewer(wholesaleOnlyFixture(), { isAdmin: false, isMayorista: false });
    assertNoFields(out, [...SECRET_FIELDS, ...WHOLESALE_FIELDS, ...RETAIL_FIELDS], "producto");
    assertNoFields(out.variants[0], [...SECRET_FIELDS, ...WHOLESALE_FIELDS, ...RETAIL_FIELDS], "variante");
    assert.equal(out.priceHidden, true);
    assert.equal(out.name, "Pendrive 128GB"); // el resto de la ficha viaja igual
  });

  test("mayorista aprobado: ve los precios y no lleva priceHidden", () => {
    const out = sanitizeProductForViewer(wholesaleOnlyFixture(), { isAdmin: false, isMayorista: true });
    assert.equal(out.price, 16299);
    assert.equal(out.wholesalePrice, 16299);
    assert.ok(!("priceHidden" in out));
  });

  test("producto para todos, visitante: conserva el precio minorista", () => {
    const out = sanitizeProductForViewer(productFixture(), { isAdmin: false, isMayorista: false });
    assert.equal(out.price, 20999);
    assert.ok(!("priceHidden" in out));
  });

  test("GET /api/products/:slug sin sesión: 200, sin precios, con priceHidden", async () => {
    db.product = wholesaleOnlyFixture();
    const res = fakeRes();
    await getProduct(reqWith(null, {}, { id: "cargador-solo-mayorista" }), res);
    assert.equal(res.statusCode, 200);
    assertJsonHasNo(res.body, [...SECRET_FIELDS, ...WHOLESALE_FIELDS, "salePrice", "priceTiers"]);
    assert.ok(!("price" in res.body), "el producto no debería traer price");
    assert.ok(res.body.variants.every((v) => !("price" in v)), "las variantes no deberían traer price");
    assert.equal(res.body.priceHidden, true);
  });

  test("GET /api/products/:slug como mayorista aprobado: con precios", async () => {
    db.product = wholesaleOnlyFixture();
    db.customers = { 5: { type: "MAYORISTA", status: "APPROVED" } };
    const res = fakeRes();
    await getProduct(reqWith(tokenFor({ id: 5, role: "CUSTOMER" }), { visibleFor: "MAYORISTA" }, { id: "cargador-solo-mayorista" }), res);
    assert.equal(res.body.price, 16299);
    assert.equal(res.body.wholesalePrice, 16299);
    assert.ok(!("priceHidden" in res.body));
  });
});

// ── Filtro por tipo de cliente (?visibleFor) ─────────────────────────────────
describe("effectiveVisibleFor", () => {
  const anon = { isAdmin: false, isMayorista: false };
  const may  = { isAdmin: false, isMayorista: true };
  const adm  = { isAdmin: true,  isMayorista: true };

  test("visitante: siempre MINORISTA (sin query, con MAYORISTA escrito a mano o con basura)", () => {
    assert.equal(effectiveVisibleFor(undefined, anon), "MINORISTA");
    assert.equal(effectiveVisibleFor("MAYORISTA", anon), "MINORISTA");
    assert.equal(effectiveVisibleFor("CUALQUIERA", anon), "MINORISTA");
  });

  test("mayorista: su tipo por defecto, y puede pedir ver el catálogo minorista", () => {
    assert.equal(effectiveVisibleFor(undefined, may), "MAYORISTA");
    assert.equal(effectiveVisibleFor("MAYORISTA", may), "MAYORISTA");
    assert.equal(effectiveVisibleFor("MINORISTA", may), "MINORISTA");
  });

  test("admin: lo que pida, incluido sin filtro", () => {
    assert.equal(effectiveVisibleFor(undefined, adm), undefined);
    assert.equal(effectiveVisibleFor("MINORISTA", adm), "MINORISTA");
  });
});

describe("filtros que arma GET /api/products", () => {
  test("visitante sin ?visibleFor: no se listan los productos solo mayoristas", async () => {
    db.products = [productFixture()];
    await getProducts(reqWith(null, {}), fakeRes());
    assert.deepEqual(db.lastFindMany.where.visibility, { in: ["AMBOS", "MINORISTA"] });
  });

  test("visitante con ?active=false: igual solo productos activos", async () => {
    db.products = [productFixture()];
    await getProducts(reqWith(null, { active: "false" }), fakeRes());
    assert.equal(db.lastFindMany.where.active, true);
  });

  test("admin sin ?visibleFor: sin filtro de visibilidad (ve todo)", async () => {
    db.products = [productFixture()];
    await getProducts(reqWith(tokenFor({ id: 1, role: "ADMIN" }), {}), fakeRes());
    assert.equal(db.lastFindMany.where.visibility, undefined);
  });

  test("GET /api/products/:slug de un visitante sin ?visibleFor: solo variantes visibles para minoristas", async () => {
    db.product = productFixture();
    await getProduct(reqWith(null, {}, { id: "pendrive" }), fakeRes());
    assert.deepEqual(db.lastFindUnique.include.variants.where.visibility, { in: ["AMBOS", "MINORISTA"] });
  });
});

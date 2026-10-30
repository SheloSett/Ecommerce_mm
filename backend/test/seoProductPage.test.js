// Tests de la página de producto que leen Google y las vistas previas de links (getProductOgPage, M7 de
// la auditoría): canonical, datos estructurados con precio y stock, y 404 para lo que no existe.
// Base y fetch simulados. Correr con: npm test

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

let product;
let dbDown;
class FakePrismaClient {
  constructor() {
    this.product = { findFirst: async () => { if (dbDown) throw new Error("base caída"); return product; } };
  }
}
const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient });
global.fetch = async () => ({ ok: true, text: async () => "<!doctype html><html><head><title>IGWT Store</title></head><body><div id=\"root\"></div></body></html>" });

const { getProductOgPage } = require("../src/controllers/seo.controller");

async function page(slug) {
  const res = {
    code: 200, body: "", headers: {},
    status(c) { this.code = c; return this; }, set(k, v) { this.headers[k] = v; return this; },
    removeHeader() {}, send(b) { this.body = b; return this; },
  };
  await getProductOgPage({ params: { slug } }, res);
  return res;
}
const jsonLd = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);

describe("ficha de producto para Google", () => {
  beforeEach(() => {
    dbDown = false;
    product = {
      id: 7, name: "Auriculares </script> X", slug: "auriculares-x", sku: "AUR-1", description: "<p>Bluetooth</p>",
      images: ["https://res.cloudinary.com/demo/image/upload/a.jpg"], price: 20000, salePrice: 15000,
      currency: "ARS", visibility: "AMBOS", stock: 3, stockUnlimited: false, active: true, hiddenByAdmin: false, variants: [],
    };
  });

  test("canonical al slug, y datos estructurados con precio, moneda y stock", async () => {
    const r = await page("7");
    assert.equal(r.code, 200);
    assert.match(r.body, /<link rel="canonical" href="https:\/\/igwtstore\.com\.ar\/producto\/auriculares-x" \/>/);
    const ld = jsonLd(r.body);
    assert.equal(ld["@type"], "Product");
    assert.equal(ld.sku, "AUR-1");
    assert.deepEqual([ld.offers.price, ld.offers.priceCurrency, ld.offers.availability], ["15000.00", "ARS", "https://schema.org/InStock"]);
  });

  test("un nombre con </script> no corta la etiqueta", async () => {
    const r = await page("auriculares-x");
    assert.equal(jsonLd(r.body).name, "Auriculares </script> X");
  });

  test("con variantes, el stock es el de las variantes", async () => {
    product.stock = 0;
    product.variants = [{ stock: 0, stockUnlimited: false }];
    assert.equal(jsonLd((await page("7")).body).offers.availability, "https://schema.org/OutOfStock");
  });

  test("solo para mayoristas: sin precio", async () => {
    product.visibility = "MAYORISTA";
    assert.equal(jsonLd((await page("7")).body).offers, undefined);
  });

  test("producto que no existe: 404 con noindex", async () => {
    product = null;
    const r = await page("no-existe");
    assert.equal(r.code, 404);
    assert.match(r.body, /<meta name="robots" content="noindex" \/>/);
  });

  test("si la base falla no se marca como inexistente (es pasajero)", async () => {
    dbDown = true;
    const r = await page("7");
    assert.equal(r.code, 200);
    assert.doesNotMatch(r.body, /noindex/);
  });
});

describe("producto agotado (M8)", () => {
  beforeEach(() => {
    dbDown = false;
    product = {
      id: 8, name: "Parlante", slug: "parlante", sku: null, description: "", images: [], price: 30000, salePrice: null,
      currency: "ARS", visibility: "AMBOS", stock: 0, stockUnlimited: false, active: false, hiddenByAdmin: false, variants: [],
    };
  });

  test("se despublicó solo por falta de stock: la ficha sigue (200) y sale como OutOfStock", async () => {
    const r = await page("parlante");
    assert.equal(r.code, 200);
    assert.equal(jsonLd(r.body).offers.availability, "https://schema.org/OutOfStock");
  });

  test("lo ocultó el admin: 404", async () => {
    product.hiddenByAdmin = true;
    assert.equal((await page("parlante")).code, 404);
  });
});

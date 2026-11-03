// Tests del buscador de productos del panel (getProductsAdmin): con excludePaused=true no ofrece lo que el
// admin despublicó a mano (hiddenByAdmin), que es lo que usan la venta a mano, la cotización, "Modificar
// pedido", las campañas y los emails. Base simulada. Correr con: npm test

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

let captured;
class FakePrismaClient {
  constructor() {
    this.product = {
      findMany: async (args) => { captured.push(args.where); return []; },
      count: async () => 0,
    };
  }
}
const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient, Prisma: {} });

const { getProductsAdmin } = require("../src/controllers/product.controller");

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function list(query) {
  const res = fakeRes();
  await getProductsAdmin({ query }, res);
  return res;
}

describe("buscador de productos del panel", () => {
  beforeEach(() => { captured = []; });

  test("excludePaused=true deja afuera lo despublicado a mano", async () => {
    const res = await list({ excludePaused: "true", all: "true" });
    assert.equal(res.code, 200);
    assert.equal(captured[0].hiddenByAdmin, false);
    assert.equal(captured[0].active, undefined); // lo agotado sigue: se puede vender algo que se compra después
  });

  test("sin el parámetro trae todo, como el listado de productos del panel", async () => {
    await list({ all: "true" });
    assert.equal("hiddenByAdmin" in captured[0], false);
    await list({ excludePaused: "false" });
    assert.equal("hiddenByAdmin" in captured[1], false);
  });

  test("se combina con el filtro de stock de las campañas", async () => {
    await list({ excludePaused: "true", inStock: "true", all: "true" });
    assert.equal(captured[0].hiddenByAdmin, false);
    assert.ok(Array.isArray(captured[0].AND) && captured[0].AND.length === 1);
  });
});

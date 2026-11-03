// Tests de que el detalle del pedido en el panel recibe el SKU de cada línea al abrirlo (getOrder). El de la
// respuesta de "Modificar pedido" está en orderStatus.test.js. Base y servicios simulados. Correr con: npm test

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

let db;
class FakePrismaClient {
  constructor() {
    this.order = {
      findUnique: async (args) => { db.lastOrderArgs = args; return JSON.parse(JSON.stringify(db.order)); },
    };
    this.productVariant = {
      findMany: async ({ select }) => {
        db.lastVariantSelect = select;
        return [{ id: 31, sku: "VAR-31", module: null, shelf: null, cost: null, images: [], supplier: null }];
      },
    };
  }
}

function stub(modulePath, exportsObj) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}
const root = path.join(__dirname, "..");
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient, Prisma: {} });
stub(path.join(root, "src/services/email.service.js"), new Proxy({}, { get: () => async () => {} }));
stub(path.join(root, "src/services/meta.service.js"), { browserDataFromRequest: () => null, sendPurchaseEvent: async () => {} });
stub(path.join(root, "src/controllers/product.controller.js"), { syncProductVisibility: async () => {} });
stub(path.join(root, "src/config/cloudinary.js"), { uploadBuffer: async () => ({}) });
stub(path.join(root, "src/sse/notificationSSE.js"), { pushToClient: () => {} });

const { getOrder } = require("../src/controllers/order.controller");

async function fetchOrder() {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await getOrder({ params: { id: "1" } }, res);
  return res;
}

beforeEach(() => {
  db = {
    lastOrderArgs: null,
    lastVariantSelect: null,
    order: {
      id: 1,
      items: [
        { id: 1, productId: 3, variantId: 31, variantSku: null, product: { id: 3, name: "Funda", sku: "PROD-3" } },
        { id: 2, productId: 4, variantId: null, variantSku: null, product: { id: 4, name: "Pendrive", sku: "PROD-4" } },
      ],
    },
  };
});

describe("SKU en el detalle del pedido", () => {
  test("getOrder pide el SKU del producto", async () => {
    await fetchOrder();
    assert.equal(db.lastOrderArgs.include.items.include.product.select.sku, true);
  });

  test("getOrder pide el SKU de la variante y lo adjunta a su línea", async () => {
    const res = await fetchOrder();
    assert.equal(db.lastVariantSelect.sku, true);
    assert.equal(res.body.items[0].variant.sku, "VAR-31");
    assert.equal(res.body.items[1].variant, undefined);
    assert.equal(res.body.items[1].product.sku, "PROD-4");
  });
});

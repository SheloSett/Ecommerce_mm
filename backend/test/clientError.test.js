// Tests del aviso de errores del navegador (routes/events.routes.js): un archivo que no bajó por la conexión
// del visitante no manda email; uno que no está en el servidor, sí. Correr con: npm test

const { test, describe, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
const reported = [];
stub(path.join(root, "src/services/errorAlerts.service.js"), { reportError: (...args) => reported.push(args) });
stub(path.join(root, "src/controllers/events.controller.js"), { track: () => {}, ping: () => {}, contact: () => {} });

const router = require("../src/routes/events.routes");
const layer = router.stack.find((l) => l.route?.path === "/client-error");
const handler = layer.route.stack[layer.route.stack.length - 1].handle;

const realFetch = global.fetch;
let fetched;
const serve = (status, contentType) => {
  global.fetch = async (url, opts) => { fetched.push([String(url), opts.method]); return { status, headers: { get: () => contentType } }; };
};
const fakeRes = () => ({ code: null, sendStatus(c) { this.code = c; return this; } });
const post = async (message) => {
  const res = fakeRes();
  await handler({ body: { message, url: "https://igwtstore.com.ar/login", stack: "at Lazy" } }, res);
  return res;
};
// Un archivo distinto por test: lo consultado se recuerda 10 minutos
const chunk = (name) => `Failed to fetch dynamically imported module: https://igwtstore.com.ar/assets/${name}.js`;
const CHUNK = chunk("CustomerLogin-BSzbYG2i");

describe("aviso de errores del navegador", () => {
  beforeEach(() => { reported.length = 0; fetched = []; process.env.FRONTEND_URL = "https://igwtstore.com.ar"; });
  after(() => { global.fetch = realFetch; delete process.env.FRONTEND_URL; });

  test("un error común se avisa, sin consultar nada", async () => {
    serve(200, "application/javascript");
    const res = await post("n.some is not a function");
    assert.equal(res.code, 204);
    assert.equal(reported.length, 1);
    assert.equal(reported[0][1], "n.some is not a function");
    assert.match(reported[0][2], /igwtstore\.com\.ar\/login/);
    assert.equal(fetched.length, 0);
  });

  test("un archivo que no bajó pero está en el servidor: conexión del visitante, sin email", async () => {
    serve(200, "application/javascript");
    const res = await post(CHUNK);
    assert.equal(res.code, 204);
    assert.deepEqual(fetched, [["https://igwtstore.com.ar/assets/CustomerLogin-BSzbYG2i.js", "HEAD"]]);
    assert.equal(reported.length, 0);
  });

  test("un archivo que no está en el servidor se avisa (nginx devuelve index.html, o 404)", async () => {
    serve(200, "text/html");
    await post(chunk("Checkout-aaaaaaaa"));
    assert.equal(reported.length, 1);
    serve(404, "text/html");
    await post(chunk("Checkout-bbbbbbbb"));
    assert.equal(reported.length, 2);
  });

  test("si no se puede comprobar, se avisa igual", async () => {
    global.fetch = async () => { throw new Error("sin red"); };
    await post(chunk("Cart-cccccccc"));
    assert.equal(reported.length, 1);
    delete process.env.FRONTEND_URL;
    serve(200, "application/javascript");
    await post(chunk("Cart-dddddddd"));
    assert.equal(reported.length, 2);
    assert.equal(fetched.length, 0);
  });

  test("el mismo archivo se consulta una sola vez cada 10 minutos", async () => {
    serve(200, "application/javascript");
    await post(chunk("Home-eeeeeeee"));
    await post(chunk("Home-eeeeeeee"));
    assert.equal(fetched.length, 1);
    assert.equal(reported.length, 0);
  });

  test("solo se consulta la propia tienda", async () => {
    serve(200, "application/javascript");
    await post("Failed to fetch dynamically imported module: https://otro-sitio.com/x.js");
    assert.equal(fetched.length, 0);
    assert.equal(reported.length, 1);
  });

  test("sin mensaje, 400", async () => {
    const res = fakeRes();
    await handler({ body: {} }, res);
    assert.equal(res.code, 400);
    assert.equal(reported.length, 0);
  });
});

// Tests de la cuenta de Mercado Libre: conexión (OAuth con state y PKCE), token (renovación de a una,
// revocado), avisos públicos (clave, tópicos, usuario), publicaciones y el cliente de la API.
// Mercado Libre y la base son simulados. Correr con: npm test
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const crypto = require("crypto");

process.env.SECRETS_KEY = crypto.randomBytes(32).toString("base64");

const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
const { makeFakePrisma } = require("./helpers/fakeMlDb");
const { FakeMl, response } = require("./helpers/fakeMl");

let db;
let clock;
const fake = makeFakePrisma(() => db, () => clock.now());
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: function FakePrismaClient() { return fake; } });
const alerts = [];
stub(require.resolve("../src/services/errorAlerts.service"), { reportError: (kind, message) => alerts.push({ kind, message }) });

const { seal, open } = require("../src/utils/secretBox");
const mlAuth = require("../src/services/ml/mlAuth");
const api = require("../src/services/ml/mlApi");
const { refreshListings, rowsOf } = require("../src/services/ml/mlListings");
const controller = require("../src/controllers/ml.controller");
const mlWorker = require("../src/services/ml/mlWorker");

const T0 = Date.parse("2026-11-20T15:00:00Z");
const cfg = {
  enabled: true, appId: "1234567890", clientSecret: "secreto-app", redirectUri: "https://tienda.example/admin/mercadolibre/conectar",
  webhookToken: "w".repeat(32), expectedUserId: "123456789", pkce: true,
};
const admin = { id: 7, role: "SUPERADMIN", email: "duenio@example.com" };
let ml;

function reset() {
  clock = { t: T0, now() { return new Date(this.t); }, advance(secs) { this.t += secs * 1000; } };
  db = { mlAccount: [], mlPool: [], mlListing: [], mlCycle: [], product: [], productVariant: [], movements: [] };
  alerts.length = 0;
  ml = new FakeMl();
  mlWorker.configure({ cfg: { ...cfg, enabled: false } }); // los avisos no arrancan pasadas solas
}

async function connected({ expiresInSecs = 5 * 3600 } = {}) {
  const { access, refresh } = ml.issueTokens();
  await fake.mlAccount.create({
    data: {
      id: 1, mlUserId: cfg.expectedUserId, status: "CONECTADA", mode: "ACTIVO",
      accessToken: seal("ml.access_token", access), refreshToken: seal("ml.refresh_token", refresh),
      tokenExpiresAt: new Date(T0 + expiresInSecs * 1000),
    },
  });
  return { access, refresh };
}

// Lo que haría Mercado Libre al autorizar: registra el código con el challenge de la dirección.
function authorize(url, { code = "TG-codigo-12345", userId } = {}) {
  const u = new URL(url);
  ml.codes.set(code, { challenge: u.searchParams.get("code_challenge"), userId });
  return { code, state: u.searchParams.get("state") };
}

describe("conectar la cuenta", () => {
  beforeEach(reset);

  test("ida y vuelta: state de un solo uso, PKCE y tokens guardados cifrados", async () => {
    const start = await mlAuth.startOAuth({ user: admin, now: clock.now(), cfg });
    assert.equal(start.ok, true);
    const u = new URL(start.url);
    assert.equal(u.origin + u.pathname, "https://auth.mercadolibre.com.ar/authorization");
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.equal(u.searchParams.get("redirect_uri"), cfg.redirectUri);
    const account = db.mlAccount[0];
    assert.notEqual(account.oauthState, u.searchParams.get("state"), "se guarda el hash, no el state");

    const { code, state } = authorize(start.url);
    const r = await mlAuth.exchangeOAuth({ user: admin, code, state, actor: "Dueño", now: clock.now(), cfg, fetchImpl: ml.fetch });
    assert.equal(r.ok, true, r.error);
    const saved = db.mlAccount[0];
    assert.equal(saved.status, "CONECTADA");
    assert.equal(saved.oauthState, null);
    assert.ok(!saved.accessToken.includes("APP_USR"), "el token no queda en claro");
    assert.match(open("ml.access_token", saved.accessToken), /^APP_USR-/);

    const again = await mlAuth.exchangeOAuth({ user: admin, code, state, now: clock.now(), cfg, fetchImpl: ml.fetch });
    assert.equal(again.ok, false, "el state no se puede usar dos veces");
  });

  test("otro admin, state vencido o state inventado: no", async () => {
    const start = await mlAuth.startOAuth({ user: admin, now: clock.now(), cfg });
    const { code, state } = authorize(start.url);
    assert.equal((await mlAuth.exchangeOAuth({ user: { id: 99 }, code, state, now: clock.now(), cfg, fetchImpl: ml.fetch })).ok, false);
    assert.equal((await mlAuth.exchangeOAuth({ user: admin, code, state: "x".repeat(43), now: clock.now(), cfg, fetchImpl: ml.fetch })).ok, false);
    const later = new Date(T0 + 11 * 60 * 1000);
    const start2 = await mlAuth.startOAuth({ user: admin, now: clock.now(), cfg });
    const second = authorize(start2.url, { code: "TG-codigo-99999" });
    assert.equal((await mlAuth.exchangeOAuth({ user: admin, ...second, now: later, cfg, fetchImpl: ml.fetch })).ok, false);
    assert.notEqual(db.mlAccount[0].status, "CONECTADA");
  });

  test("conectar otra cuenta de Mercado Libre se rechaza y no guarda nada", async () => {
    const start = await mlAuth.startOAuth({ user: admin, now: clock.now(), cfg });
    const { code, state } = authorize(start.url, { userId: "555555555" });
    const r = await mlAuth.exchangeOAuth({ user: admin, code, state, now: clock.now(), cfg, fetchImpl: ml.fetch });
    assert.equal(r.ok, false);
    assert.match(r.error, /no es la de la tienda/);
    assert.equal(db.mlAccount[0].accessToken, null);
  });

  test("sin la configuración del servidor no arranca", async () => {
    const r = await mlAuth.startOAuth({ user: admin, now: clock.now(), cfg: { ...cfg, enabled: false, appId: "" } });
    assert.equal(r.ok, false);
    assert.match(r.error, /ML_SYNC_ENABLED/);
    assert.match(r.error, /ML_APP_ID/);
  });
});

describe("token", () => {
  beforeEach(reset);

  test("vigente: se usa sin renovar", async () => {
    const { access } = await connected();
    const r = await mlAuth.getAccessToken({ now: () => clock.now(), cfg, fetchImpl: ml.fetch });
    assert.deepEqual(r, { ok: true, token: access });
    assert.equal(ml.calls.length, 0);
  });

  test("por vencer: se renueva una sola vez aunque lo pidan varios a la vez, y se guarda el par nuevo", async () => {
    await connected({ expiresInSecs: 60 });
    const results = await Promise.all([1, 2, 3].map(() => mlAuth.getAccessToken({ now: () => clock.now(), cfg, fetchImpl: ml.fetch })));
    assert.equal(ml.calls.filter((c) => c.path === "/oauth/token").length, 1);
    assert.ok(results.every((r) => r.ok && r.token === results[0].token));
    const saved = db.mlAccount[0];
    assert.equal(open("ml.refresh_token", saved.refreshToken), ml.validRefresh, "quedó guardado el refresh token nuevo");
    assert.ok(saved.tokenExpiresAt > new Date(T0 + 3600 * 1000));
  });

  test("revocado: la cuenta queda para reconectar y llega un aviso", async () => {
    await connected({ expiresInSecs: 60 });
    ml.revoked = true;
    const r = await mlAuth.getAccessToken({ now: () => clock.now(), cfg, fetchImpl: ml.fetch });
    assert.equal(r.ok, false);
    assert.equal(db.mlAccount[0].status, "RECONECTAR");
    assert.ok(alerts.some((a) => /volver a conectar/.test(a.message)));
  });

  test("con otra SECRETS_KEY no se puede leer: reconectar (no se usa nada en claro)", async () => {
    await connected();
    db.mlAccount[0].accessToken = seal("ml.access_token", "APP_USR-x", { key: crypto.randomBytes(32) });
    const r = await mlAuth.getAccessToken({ now: () => clock.now(), cfg, fetchImpl: ml.fetch });
    assert.equal(r.ok, false);
    assert.equal(db.mlAccount[0].status, "RECONECTAR");
  });

  test("sin ML_SYNC_ENABLED no se usa ni se renueva el token", async () => {
    await connected({ expiresInSecs: 60 });
    const r = await mlAuth.getAccessToken({ now: () => clock.now(), cfg: { ...cfg, enabled: false }, fetchImpl: ml.fetch });
    assert.equal(r.kind, "disabled");
    assert.equal(ml.calls.length, 0);
  });
});

describe("avisos de Mercado Libre", () => {
  beforeEach(async () => {
    reset();
    await connected();
    await fake.mlPool.create({ data: { id: 1, key: "UP:MLAU100", userProductId: "MLAU100", productId: 1, active: true } });
    await fake.mlPool.create({ data: { id: 2, key: "UP:MLAU200", userProductId: "MLAU200" } }); // sin vincular
    await fake.mlListing.create({ data: { itemId: "MLA1000001", poolId: 1, title: "Parlante", status: "active" } });
    await fake.mlListing.create({ data: { itemId: "MLA2000001", poolId: 2, title: "Otro", status: "active" } });
  });

  function res() {
    return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  }

  test("clave incorrecta: 404 sin leer el cuerpo ni tocar la base", () => {
    const original = process.env.ML_WEBHOOK_TOKEN;
    process.env.ML_SYNC_ENABLED = "1";
    process.env.ML_WEBHOOK_TOKEN = cfg.webhookToken;
    try {
      const r = res();
      let nextCalled = false;
      controller.webhookGate({ params: { token: "w".repeat(31) + "x" } }, r, () => { nextCalled = true; });
      assert.equal(r.code, 404);
      assert.equal(nextCalled, false);
      const ok = res();
      controller.webhookGate({ params: { token: cfg.webhookToken } }, ok, () => { nextCalled = true; });
      assert.equal(nextCalled, true);
    } finally {
      process.env.ML_WEBHOOK_TOKEN = original;
      delete process.env.ML_SYNC_ENABLED;
    }
  });

  test("una clave corta en la configuración no sirve nunca", () => {
    assert.equal(controller.tokenMatches("abc", "abc"), false);
    assert.equal(controller.tokenMatches("w".repeat(32), "w".repeat(32)), true);
  });

  test("aviso de una publicación vinculada: marca su pozo", async () => {
    const r = await controller.handleNotification({ topic: "items", resource: "/items/MLA1000001", user_id: 123456789 }, { cfg, now: clock.now() });
    assert.equal(r.marked, 1);
    assert.equal(db.mlPool[0].dirty, true);
    assert.equal(db.mlPool[1].dirty, false, "el pozo sin vincular no se marca");
  });

  test("aviso de stock de un user product", async () => {
    const r = await controller.handleNotification({ topic: "stock-location", resource: "/user-products/MLAU100/stock", user_id: "123456789" }, { cfg, now: clock.now() });
    assert.equal(r.marked, 1);
  });

  test("otro usuario, tópico desconocido o dirección rara: no se marca nada", async () => {
    const cases = [
      { topic: "items", resource: "/items/MLA1000001", user_id: 999 },
      { topic: "questions", resource: "/questions/1", user_id: 123456789 },
      { topic: "items", resource: "/items/MLA1000001/../../users/me", user_id: 123456789 },
      { topic: "items", resource: "https://evil.example/items/MLA1000001", user_id: 123456789 },
      "texto",
      null,
    ];
    for (const body of cases) await controller.handleNotification(body, { cfg, now: clock.now() });
    assert.ok(db.mlPool.every((p) => !p.dirty));
  });
});

describe("publicaciones", () => {
  beforeEach(async () => {
    reset();
    await connected();
  });

  test("trae las activas y pausadas, arma los pozos y no vincula nada", async () => {
    ml.addUp("MLAU100", 4).addItem("MLA1000001", { up: "MLAU100", sku: "PARL-1" }).addItem("MLA1000002", { up: "MLAU100", status: "paused" });
    ml.addUp("MLAU200", 9).addItem("MLA2000001", { up: "MLAU200" });
    ml.addItem("MLA3000001", { up: "MLAU300", seller: "555555555" }); // de otra cuenta: no aparece en la búsqueda
    const r = await refreshListings({ now: () => clock.now(), cfg, fetchImpl: ml.fetch });
    assert.equal(r.ok, true, r.error);
    assert.equal(db.mlListing.length, 3);
    assert.equal(db.mlPool.length, 2);
    assert.ok(db.mlPool.every((p) => p.productId === null));
    const l = db.mlListing.find((x) => x.itemId === "MLA1000001");
    assert.equal(l.sku, "PARL-1");
    assert.equal(l.thumbnail, "https://http2.mlstatic.com/D_MLA1000001.jpg");
  });

  test("una publicación que cambió de pozo frena el pozo vinculado", async () => {
    ml.addUp("MLAU100", 4).addItem("MLA1000001", { up: "MLAU100" });
    await refreshListings({ now: () => clock.now(), cfg, fetchImpl: ml.fetch });
    db.mlPool[0].productId = 1;
    ml.addUp("MLAU999", 4);
    ml.items.get("MLA1000001").user_product_id = "MLAU999";
    await refreshListings({ now: () => clock.now(), cfg, fetchImpl: ml.fetch });
    assert.equal(db.mlPool[0].status, "REVISAR");
  });

  test("variaciones del modelo viejo: una fila por variación, con su pozo", () => {
    const rows = rowsOf({
      id: "MLA5000001", title: "Funda", status: "active", seller_id: 1, available_quantity: 7, sold_quantity: 3,
      variations: [
        { id: 111, user_product_id: "MLAU501", available_quantity: 3, sold_quantity: 1, attribute_combinations: [{ name: "Color", value_name: "Negro" }] },
        { id: 222, available_quantity: 4, sold_quantity: 2, attribute_combinations: [{ name: "Color", value_name: "Rojo" }] },
      ],
    });
    assert.deepEqual(rows.map((r) => [r.variationId, r.poolKey, r.title, r.quantity]), [
      ["111", "UP:MLAU501", "Funda — Color: Negro", 3],
      ["222", "IV:MLA5000001:222", "Funda — Color: Rojo", 4],
    ]);
  });

  test("links e imágenes de otros dominios no se guardan", () => {
    const [row] = rowsOf({ id: "MLA5000002", title: "X", status: "active", permalink: "javascript:alert(1)", secure_thumbnail: "https://evil.example/a.jpg" });
    assert.equal(row.permalink, null);
    assert.equal(row.thumbnail, null);
  });
});

describe("cliente de la API", () => {
  test("solo arma direcciones con identificadores válidos", async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return response(200, {}); };
    for (const bad of ["MLA1/../users/me", "https://x", "MLA", "123"]) {
      const r = await api.getItem("t", bad, { fetchImpl });
      assert.equal(r.ok, false);
    }
    assert.equal((await api.putItemQuantity("t", "MLA1000001", null, -1, { fetchImpl })).ok, false);
    assert.equal((await api.putItemQuantity("t", "MLA1000001", null, 1.5, { fetchImpl })).ok, false);
    assert.equal(called, false);
  });

  test("clasifica los errores y nunca incluye el token en el mensaje", async () => {
    const cases = [[429, "rate_limit"], [401, "auth"], [403, "forbidden"], [404, "not_found"], [400, "rejected"], [503, "transient"]];
    for (const [status, kind] of cases) {
      const r = await api.getItem("APP_USR-secreto", "MLA1000001", { fetchImpl: async () => response(status, { message: "algo" }) });
      assert.equal(r.kind, kind);
      assert.ok(!JSON.stringify(r).includes("APP_USR-secreto"));
    }
    const timeout = await api.getItem("t", "MLA1000001", { fetchImpl: async () => { const e = new Error("x"); e.name = "TimeoutError"; throw e; } });
    assert.equal(timeout.kind, "transient");
    const html = await api.getItem("t", "MLA1000001", { fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "<html>mantenimiento</html>" }) });
    assert.equal(html.kind, "bad_response");
    const huge = await api.getItem("t", "MLA1000001", { fetchImpl: async () => ({ ok: true, status: 200, headers: { get: (k) => (k === "content-length" ? "99999999" : null) }, text: async () => "{}" }) });
    assert.equal(huge.kind, "bad_response");
  });

  test("las llamadas van solo a api.mercadolibre.com y no siguen redirecciones", async () => {
    let seen;
    await api.getMe("t", { fetchImpl: async (url, init) => { seen = { url, redirect: init.redirect }; return response(200, { id: 1 }); } });
    assert.equal(new URL(seen.url).origin, "https://api.mercadolibre.com");
    assert.equal(seen.redirect, "error");
  });
});

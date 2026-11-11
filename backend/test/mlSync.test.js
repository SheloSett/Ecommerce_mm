// Tests del motor de sincronización de stock con Mercado Libre (services/ml/mlSync.js y mlWorker.js),
// contra un Mercado Libre simulado (helpers/fakeMl.js) y una base simulada (helpers/fakeMlDb.js).
// Correr con: npm test
//
// Cada caso termina comparando tres números: el stock de la página, el de Mercado Libre y lo que
// "de verdad" queda (lo que había menos todas las ventas de los dos lados).
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const crypto = require("crypto");

process.env.SECRETS_KEY = crypto.randomBytes(32).toString("base64");

const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
const { makeFakePrisma } = require("./helpers/fakeMlDb");
const { FakeMl } = require("./helpers/fakeMl");

let db;
let clock;
const fake = makeFakePrisma(() => db, () => clock.now());
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: function FakePrismaClient() { return fake; } });
const alerts = [];
stub(require.resolve("../src/services/errorAlerts.service"), { reportError: (kind, message) => alerts.push({ kind, message }) });

const { seal } = require("../src/utils/secretBox");
const stock = require("../src/services/stock.service");
const mlSync = require("../src/services/ml/mlSync");
const mlWorker = require("../src/services/ml/mlWorker");
const mlPools = require("../src/services/ml/mlPools");
const { DEFAULTS } = require("../src/services/ml/mlRules");

const T0 = Date.parse("2026-11-20T15:00:00Z");
const ITEM = "MLA1000001";
const UP = "MLAU100";
const UNIT = { productId: 1, variantId: null };
const cfg = {
  enabled: true, appId: "1234567890", clientSecret: "secreto-app", redirectUri: "https://tienda.example/admin/mercadolibre/conectar",
  webhookToken: "w".repeat(32), expectedUserId: "123456789", pkce: true,
};

let ml;
function ctx() {
  return { now: () => clock.now(), fetchImpl: ml.fetch, cfg, sleep: null, opts: DEFAULTS };
}

async function setup({ web = 10, mlQty = 10, sold = 5, mode = "ACTIVO", items = [ITEM], active = true, unlimited = false } = {}) {
  clock = { t: T0, now() { return new Date(this.t); }, advance(secs) { this.t += secs * 1000; } };
  db = { mlAccount: [], mlPool: [], mlListing: [], mlCycle: [], product: [], productVariant: [], movements: [] };
  alerts.length = 0;
  ml = new FakeMl();
  ml.addUp(UP, mlQty);
  for (const id of items) ml.addItem(id, { up: UP, sold });
  const { access, refresh } = ml.issueTokens();
  await fake.mlAccount.create({
    data: {
      id: 1, mlUserId: cfg.expectedUserId, nickname: "TIENDA", status: "CONECTADA", mode,
      accessToken: seal("ml.access_token", access), refreshToken: seal("ml.refresh_token", refresh),
      tokenExpiresAt: new Date(T0 + 5 * 3600 * 1000),
    },
  });
  await fake.product.create({ data: { id: 1, name: "Parlante", stock: web, stockUnlimited: unlimited } });
  const soldMap = Object.fromEntries(items.map((i) => [i, sold]));
  const long = new Date(T0 - 10 * 60 * 1000);
  await fake.mlPool.create({
    data: {
      id: 1, key: `UP:${UP}`, userProductId: UP, productId: 1, variantId: null, active, status: "OK",
      agreed: mlQty, agreedSold: soldMap, lastRead: { qty: mlQty, sold: soldMap }, lastReadAt: long, lastChangeAt: long,
    },
  });
  for (const id of items) {
    await fake.mlListing.create({ data: { itemId: id, variationId: "", poolId: 1, userProductId: UP, title: `Parlante ${id}`, status: "active" } });
  }
}

const webQty = () => db.product[0].stock;
const pool = (id = 1) => db.mlPool.find((p) => p.id === id);
const reasons = () => db.movements.map((m) => `${m.reason}:${m.delta}`);
const sync = () => mlSync.syncUnit(UNIT, ctx());
const webSale = (n = 1) => stock.adjustStock({ productId: 1, delta: -n, reason: stock.REASONS.VENTA });

// Pasadas espaciadas (como el tick del trabajador) hasta que no quede nada pendiente.
async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    clock.advance(25);
    await sync();
  }
}

describe("los cuatro casos del plan", () => {
  beforeEach(() => setup());

  test("venta en Mercado Libre: la página baja y no se escribe nada", async () => {
    ml.sell(ITEM, 1);
    await sync();
    assert.equal(webQty(), 9);
    assert.equal(ml.qty(UP), 9);
    assert.deepEqual(reasons(), ["VENTA_ML:-1"]);
    assert.equal(ml.puts.length, 0);
  });

  test("venta en la página: se escribe en Mercado Libre y se cierran las cuentas", async () => {
    await webSale(1);
    await sync();
    assert.equal(ml.qty(UP), 9);
    assert.equal(pool().writeTarget, 9);
    await settle();
    assert.equal(webQty(), 9);
    assert.equal(ml.qty(UP), 9);
    assert.equal(pool().writeTarget, null, "la escritura quedó cerrada");
    assert.equal(ml.puts.length, 1);
  });

  test("carga a mano en Mercado Libre: la página copia el número", async () => {
    ml.setQty(UP, 15);
    await sync();
    assert.equal(webQty(), 15);
    assert.deepEqual(reasons(), ["CAMBIO_ML:5"]);
    assert.equal(ml.puts.length, 0);
  });

  test("una venta en cada lado a la vez: los dos en 8", async () => {
    ml.sell(ITEM, 1);
    await webSale(1);
    await sync();
    assert.equal(webQty(), 8);
    assert.equal(ml.puts.length, 0, "Mercado Libre acaba de cambiar: espera a que se quede quieto");
    await settle();
    assert.equal(webQty(), 8);
    assert.equal(ml.qty(UP), 8);
  });
});

describe("escribir pisa: ventas en el momento justo", () => {
  beforeEach(() => setup());

  test("una venta que entra justo antes de la escritura (queda pisada) se recupera", async () => {
    await webSale(1);                     // página 9
    ml.onPut(() => ml.sell(ITEM, 1));     // Mercado Libre vende 1 (10 → 9) y la escritura de 9 lo pisa
    await sync();
    assert.equal(ml.qty(UP), 9, "Mercado Libre perdió su venta");
    await settle();
    assert.equal(webQty(), 8, "la página descontó la venta pisada");
    assert.equal(ml.qty(UP), 8, "y se la volvió a escribir a Mercado Libre");
    assert.deepEqual(reasons(), ["VENTA:-1", "VENTA_ML:-1"]);
  });

  test("una venta que entra justo después de la escritura no se cuenta dos veces", async () => {
    await webSale(1);
    ml.afterPut(() => ml.sell(ITEM, 1));
    await sync();
    await settle();
    assert.equal(webQty(), 8);
    assert.equal(ml.qty(UP), 8);
    assert.equal(ml.puts.length, 1, "no hizo falta volver a escribir");
  });

  test("escritura sin respuesta que entró", async () => {
    await webSale(1);
    ml.failNextPut("timeout-after");
    await sync();
    assert.equal(pool().writeOutcome, "DESCONOCIDA");
    await settle();
    assert.equal(webQty(), 9);
    assert.equal(ml.qty(UP), 9);
    assert.equal(ml.puts.length, 1);
    assert.equal(pool().writeTarget, null);
  });

  test("escritura sin respuesta que no entró: se vuelve a escribir", async () => {
    await webSale(1);
    ml.failNextPut("timeout-before");
    await sync();
    await settle();
    assert.equal(webQty(), 9);
    assert.equal(ml.qty(UP), 9);
    assert.equal(ml.puts.length, 1, "la que entró es la segunda");
  });

  test("escritura sin respuesta, que no entró, y una venta en el medio", async () => {
    await webSale(1);
    ml.failNextPut("timeout-before");
    await sync();
    ml.sell(ITEM, 1);
    await settle();
    assert.equal(webQty(), 8);
    assert.equal(ml.qty(UP), 8);
  });

  test("lectura vieja apenas después de escribir: se espera, no se escribe dos veces", async () => {
    await webSale(1);
    ml.onPut(() => ml.staleReads(ITEM, 2));
    await sync();
    await settle(8);
    assert.equal(webQty(), 9);
    assert.equal(ml.qty(UP), 9);
    assert.equal(ml.puts.length, 1);
    assert.equal(pool().status, "OK");
  });

  test("un 500 al escribir no frena: queda desconocida y se cierra después", async () => {
    await webSale(2);
    ml.failNextPut(500);
    await sync();
    await settle();
    assert.equal(webQty(), 8);
    assert.equal(ml.qty(UP), 8);
  });
});

describe("protecciones", () => {
  test("sobreventa: los dos vendieron la última unidad", async () => {
    await setup({ web: 1, mlQty: 1 });
    ml.sell(ITEM, 1);
    await webSale(1);
    await sync();
    assert.equal(webQty(), 0);
    assert.equal(ml.qty(UP), 0);
    assert.ok(alerts.some((a) => /Sobreventa/.test(a.message)));
  });

  test("429 al leer: se frena toda la cuenta y la próxima pasada no hace nada", async () => {
    await setup();
    ml.failReads(429);
    const r = await sync();
    assert.equal(r.stopped, "rate_limit");
    const account = db.mlAccount[0];
    assert.ok(account.pausedUntil > clock.now());
    assert.equal(account.pauseLevel, 1);
    ml.sell(ITEM, 1);
    assert.equal((await mlWorker.runPass(ctx())).skipped, "frenada");
    assert.equal(webQty(), 10);
  });

  test("429 al escribir: no se escribió nada y se frena la cuenta", async () => {
    await setup();
    await webSale(1);
    ml.failNextPut(429);
    await sync();
    assert.equal(ml.qty(UP), 10);
    assert.equal(pool().writeTarget, null, "un 429 es un no: no queda escritura pendiente");
    assert.ok(db.mlAccount[0].pausedUntil > clock.now());
  });

  test("corte al leer: reintento con espera, sin tocar nada", async () => {
    await setup();
    ml.failReads("timeout");
    await sync();
    assert.equal(pool().attempts, 1);
    assert.ok(pool().nextAttemptAt > clock.now());
    assert.equal(webQty(), 10);
  });

  test("vínculo roto: el producto ya no existe y nunca se manda un 0", async () => {
    await setup();
    db.product = [];
    ml.sell(ITEM, 1);
    await sync();
    assert.equal(pool().status, "ROTO");
    assert.equal(ml.puts.length, 0);
    assert.ok(alerts.some((a) => /Vínculo roto/.test(a.message)));
  });

  test("producto con stock ilimitado: no se sincroniza", async () => {
    await setup({ unlimited: true });
    ml.sell(ITEM, 1);
    await sync();
    assert.equal(webQty(), 10);
    assert.equal(ml.puts.length, 0);
    assert.match(pool().lastError, /ilimitado/);
  });

  test("una publicación que pasa a otro producto de Mercado Libre frena el pozo", async () => {
    await setup();
    ml.items.get(ITEM).user_product_id = "MLAU999";
    ml.addUp("MLAU999", 3);
    await sync();
    assert.equal(pool().status, "REVISAR");
    assert.equal(webQty(), 10);
    assert.equal(ml.puts.length, 0);
  });

  test("Mercado Libre guarda otro número que el enviado: se confirma leyendo y queda para revisar", async () => {
    await setup();
    await webSale(1);
    ml.storeOnPut(5);
    await sync();
    assert.equal(pool().writeTarget, 9, "queda como escritura sin confirmar");
    await settle();
    assert.equal(pool().status, "REVISAR");
    assert.equal(webQty(), 5, "la página toma el número más bajo mientras se revisa");
    assert.equal(ml.puts.length, 1, "no vuelve a escribir");
  });

  test("una respuesta vieja al escribir (dice el número de antes pero guardó bien) no frena nada", async () => {
    await setup();
    await webSale(1);
    ml.onPut(() => ml.staleReads(ITEM, 0));
    const original = ml.put.bind(ml);
    ml.put = async (itemId, payload) => {
      const r = await original(itemId, payload);
      const body = JSON.parse(await r.text());
      body.available_quantity = 10; // la respuesta todavía muestra el número viejo
      return { ...r, text: async () => JSON.stringify(body) };
    };
    await sync();
    ml.put = original;
    await settle();
    assert.equal(pool().status, "OK");
    assert.equal(webQty(), 9);
    assert.equal(ml.qty(UP), 9);
  });

  test("un cambio grande sin ventas espera una segunda lectura", async () => {
    await setup();
    ml.setQty(UP, 40);
    await sync();
    assert.equal(webQty(), 10, "todavía no");
    clock.advance(31);
    await sync();
    assert.equal(webQty(), 40);
  });

  test("dos publicaciones del mismo pozo cuentan una sola vez", async () => {
    await setup({ items: [ITEM, "MLA1000002"] });
    ml.sell("MLA1000002", 1);
    await sync();
    assert.equal(webQty(), 9);
  });

  test("publicaciones del pozo con números distintos: se reintenta", async () => {
    await setup({ items: [ITEM, "MLA1000002"] });
    ml.staleReads("MLA1000002", 1);
    ml.sell(ITEM, 1);
    await sync();
    assert.equal(webQty(), 10);
    assert.match(pool().lastError, /números distintos/);
    clock.advance(31);
    await sync();
    assert.equal(webQty(), 9);
  });
});

describe("modos y pozos", () => {
  test("OBSERVAR: un pozo activo queda congelado y al volver a ACTIVO aplica lo que pasó", async () => {
    await setup({ mode: "OBSERVAR" });
    ml.sell(ITEM, 2);
    await sync();
    assert.equal(webQty(), 10);
    db.mlAccount[0].mode = "ACTIVO";
    await sync();
    assert.equal(webQty(), 8);
  });

  test("un pozo vinculado sin activar solo se anota en la bitácora", async () => {
    await setup({ active: false });
    ml.sell(ITEM, 1);
    await sync();
    assert.equal(webQty(), 10);
    assert.equal(ml.puts.length, 0);
    const cycle = db.mlCycle.find((c) => c.kind === "OBSERVA");
    assert.ok(cycle, "quedó anotado lo que habría pasado");
    assert.equal(cycle.webAfter, 9);
  });

  test("dos pozos de la misma unidad: una venta en uno se escribe en el otro", async () => {
    await setup();
    ml.addUp("MLAU200", 10).addItem("MLA2000001", { up: "MLAU200", sold: 0 });
    const long = new Date(T0 - 10 * 60 * 1000);
    await fake.mlPool.create({ data: { id: 2, key: "UP:MLAU200", userProductId: "MLAU200", productId: 1, active: true, agreed: 10, agreedSold: { MLA2000001: 0 }, lastRead: { qty: 10, sold: { MLA2000001: 0 } }, lastReadAt: long, lastChangeAt: long } });
    await fake.mlListing.create({ data: { itemId: "MLA2000001", poolId: 2, userProductId: "MLAU200", title: "Parlante premium", status: "active" } });
    ml.sell(ITEM, 1);
    await sync();
    assert.equal(webQty(), 9);
    assert.equal(ml.qty("MLAU200"), 9, "el otro pozo recibió el número");
    await settle();
    assert.equal(ml.qty(UP), 9);
    assert.equal(ml.qty("MLAU200"), 9);
  });

  test("APAGADO: nada corre", async () => {
    await setup({ mode: "APAGADO" });
    ml.sell(ITEM, 1);
    assert.equal((await sync()).skipped, "apagado");
    assert.equal((await mlWorker.runPass(ctx())).skipped, "apagado");
    assert.equal(webQty(), 10);
  });

  test("sin ML_SYNC_ENABLED el trabajador no hace nada", async () => {
    await setup();
    assert.equal((await mlWorker.runPass({ ...ctx(), cfg: { ...cfg, enabled: false } })).skipped, "deshabilitado");
  });
});

describe("el trabajador", () => {
  test("toma lo marcado, lo vencido y un barrido, y baja la marca", async () => {
    await setup();
    db.mlPool[0].dirty = true;
    ml.sell(ITEM, 1);
    const r = await mlWorker.runPass(ctx());
    assert.equal(r.units, 1);
    assert.equal(webQty(), 9);
    assert.equal(pool().dirty, false);
  });

  test("un cambio de stock de la página marca los pozos activos; uno de Mercado Libre no", async () => {
    await setup();
    mlWorker.configure({ ...ctx(), cfg: { ...cfg, enabled: false } }); // que no arranque una pasada sola
    await mlWorker.onStockCommitted([{ productId: 1, variantId: null, reasons: ["VENTA_ML"] }], cfg);
    assert.equal(pool().dirty, false);
    await mlWorker.onStockCommitted([{ productId: 1, variantId: null, reasons: ["VENTA"] }], { ...cfg, enabled: true });
    assert.equal(pool().dirty, true);
    mlWorker.configure({});
  });
});

describe("activar un vínculo", () => {
  beforeEach(() => setup({ web: 7, mlQty: 10, active: false }));

  test("queda el número de Mercado Libre", async () => {
    const r = await mlPools.activatePool(1, { choice: "ml" }, "Dueño", ctx());
    assert.equal(r.ok, true);
    assert.equal(webQty(), 10);
    assert.deepEqual(reasons(), ["VINCULO_ML:3"]);
    assert.equal(pool().active, true);
  });

  test("queda el número de la página: el motor lo escribe en Mercado Libre", async () => {
    await mlPools.activatePool(1, { choice: "web" }, "Dueño", ctx());
    assert.equal(webQty(), 7);
    await settle();
    assert.equal(ml.qty(UP), 7);
  });

  test("queda un número escrito a mano", async () => {
    await mlPools.activatePool(1, { choice: "number", number: "5" }, "Dueño", ctx());
    await settle();
    assert.equal(webQty(), 5);
    assert.equal(ml.qty(UP), 5);
  });

  test("números inválidos y productos ilimitados se rechazan", async () => {
    assert.equal((await mlPools.activatePool(1, { choice: "number", number: "-1" }, "Dueño", ctx())).ok, false);
    assert.equal((await mlPools.activatePool(1, { choice: "number", number: "3.5" }, "Dueño", ctx())).ok, false);
    assert.equal((await mlPools.activatePool(1, { choice: "otro" }, "Dueño", ctx())).ok, false);
    db.product[0].stockUnlimited = true;
    const r = await mlPools.activatePool(1, { choice: "ml" }, "Dueño", ctx());
    assert.equal(r.ok, false);
    assert.match(r.error, /ilimitado/);
  });

  test("un pozo en REVISAR se resuelve eligiendo el número", async () => {
    db.mlPool[0].status = "REVISAR";
    db.mlPool[0].active = true;
    const r = await mlPools.resolvePool(1, { choice: "ml" }, "Dueño", ctx());
    assert.equal(r.ok, true);
    assert.equal(pool().status, "OK");
    assert.equal(webQty(), 10);
  });

  test("vincular un producto con variantes pide la variante", async () => {
    db.mlPool[0].productId = null;
    await fake.product.create({ data: { id: 2, name: "Funda" } });
    await fake.productVariant.create({ data: { id: 21, productId: 2, stock: 3, combination: [{ name: "Color", value: "Negro" }] } });
    assert.equal((await mlPools.linkPool(1, { productId: 2 }, "Dueño")).ok, false);
    const r = await mlPools.linkPool(1, { productId: 2, variantId: 21 }, "Dueño");
    assert.equal(r.ok, true);
    assert.equal(pool().variantId, 21);
    assert.equal(pool().active, false, "vincular no activa: hay que elegir el número");
  });
});

// ── Casos que encontró la revisión del 11/11/2026 ────────────────────────────
describe("revisión: escrituras sin respuesta y lecturas viejas", () => {
  beforeEach(() => setup());

  test("escritura sin respuesta que entró, con una lectura vieja al cerrar: no se descuenta dos veces", async () => {
    await webSale(1);                                   // página 9
    ml.failNextPut("timeout-after");                    // entra, pero sin respuesta
    ml.onPut(() => ml.staleReads(ITEM, 1));              // la próxima lectura todavía muestra 10
    await sync();
    await settle(8);
    assert.equal(webQty(), 9);
    assert.equal(ml.qty(UP), 9);
  });

  test("lo mismo con una carga en la página (10 → 15): no aparece un +5 fantasma", async () => {
    await stock.adjustStock({ productId: 1, setTo: 15, reason: stock.REASONS.AJUSTE });
    ml.failNextPut("timeout-after");
    ml.onPut(() => ml.staleReads(ITEM, 1));
    await sync();
    await settle(8);
    assert.equal(webQty(), 15);
    assert.equal(ml.qty(UP), 15);
  });

  test("una lectura vieja después de cerrar la escritura no mueve la página", async () => {
    const before = ml.itemJson(ITEM);
    await webSale(1);
    await sync();                                       // escribe 9
    clock.advance(25); await sync();                    // lee 9: espera
    clock.advance(25); await sync();                    // quieto: cierra
    assert.equal(pool().writeTarget, null);
    ml.stale.set(ITEM, { left: 1, snapshot: before });  // Mercado Libre sirve una vez el número viejo
    clock.advance(25); await sync();
    assert.equal(webQty(), 9, "no se copia la lectura vieja");
    clock.advance(25); await sync();
    assert.equal(webQty(), 9);
    assert.deepEqual(reasons(), ["VENTA:-1"]);
  });
});

describe("revisión: una pasada cortada no deja el pozo olvidado", () => {
  beforeEach(() => setup());
  // Sin barrido: solo lo que pide la cola (dirty / nextAttemptAt).
  const queued = async () => { db.mlAccount[0].lastSweepAt = clock.now(); return (await mlWorker.runPass(ctx())).units; };

  test("falla al renovar el token", async () => {
    db.mlAccount[0].tokenExpiresAt = new Date(clock.t + 30 * 1000);
    const original = ml.oauth.bind(ml);
    ml.oauth = () => ({ ok: false, status: 503, headers: { get: () => null }, text: async () => "{}" });
    await webSale(1);
    pool().dirty = true;
    await queued();
    ml.oauth = original;
    clock.advance(130);
    assert.equal(await queued(), 1, "sigue en la cola");
    await settle();
    assert.equal(ml.qty(UP), 9);
  });

  test("429 al releer justo antes de escribir", async () => {
    await webSale(1);
    pool().dirty = true;
    ml.readFailures.push(null, 429);                    // la primera lectura anda, la relectura no
    await queued();
    clock.advance(130);
    assert.equal(await queued(), 1);
  });

  test("429 en la primera lectura", async () => {
    await webSale(1);
    pool().dirty = true;
    ml.failReads(429);
    await queued();
    clock.advance(130);
    assert.equal(await queued(), 1);
  });

  test("dos 429 seguidos al escribir: el freno crece", async () => {
    await webSale(1);
    pool().dirty = true;
    ml.failNextPut(429);
    await mlWorker.runPass(ctx());
    assert.equal(db.mlAccount[0].pauseLevel, 1);
    clock.advance(61);
    ml.failNextPut(429);
    await mlWorker.runPass(ctx());
    assert.equal(db.mlAccount[0].pauseLevel, 2);
    assert.ok(db.mlAccount[0].pausedUntil - clock.now() >= 2 * 60 * 1000, "la segunda vez frena 2 minutos");
  });
});

describe("revisión: resolver y desactivar no pierden ventas", () => {
  test("ventas en Mercado Libre mientras el pozo estaba frenado: se descuentan al resolver con el número de la página", async () => {
    await setup();
    Object.assign(pool(), { status: "REVISAR", review: { reason: "x", ml: 10, web: 10 } });
    ml.sell(ITEM, 2);                                   // la publicación sigue vendiendo: 8
    await sync();                                       // frenado: no pasa nada
    const peek = await mlPools.peekPool(1, ctx());
    assert.deepEqual([peek.ml, peek.missedSales, peek.webAfterSales], [8, 2, 8], "la ventana muestra los números de ahora");
    const r = await mlPools.resolvePool(1, { choice: "web" }, "Dueño", ctx());
    assert.equal(r.ok, true);
    assert.equal(r.number, 8);
    await settle(4);
    assert.equal(webQty(), 8);
    assert.equal(ml.qty(UP), 8);
    assert.deepEqual(reasons(), ["VENTA_ML:-2"]);
  });

  test("desactivar con una escritura sin cerrar espera, y después no se pierde la venta pisada", async () => {
    await setup();
    await webSale(1);                                   // página 9
    ml.onPut(() => ml.sell(ITEM, 1));                   // una venta en Mercado Libre queda pisada
    await sync();
    const r = await mlPools.deactivatePool(1);
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    await settle();
    assert.equal((await mlPools.deactivatePool(1)).ok, true, "ya cerrada, se puede desactivar");
    assert.equal(webQty(), 8);
    assert.equal(ml.qty(UP), 8);
  });
});

describe("revisión: otros", () => {
  test("una publicación con variaciones del modelo viejo no se puede activar ni se le escribe", async () => {
    await setup({ active: false });
    db.mlListing[0].variationId = "111";
    const r = await mlPools.activatePool(1, { choice: "web" }, "Dueño", ctx());
    assert.equal(r.ok, false);
    assert.match(r.error, /variaciones del modelo viejo/);
    const api = require("../src/services/ml/mlApi");
    const put = await api.putItemQuantity("t", ITEM, "111", 5, { fetchImpl: ml.fetch });
    assert.equal(put.ok, false);
    assert.equal(ml.puts.length, 0);
  });

  test("producto que se vende muy seguido: igual se escribe pasado el tiempo máximo", async () => {
    await setup({ web: 100, mlQty: 100, sold: 0 });
    await webSale(1);                                   // página 99: hay que escribir
    let mlSales = 0;
    for (let i = 0; i < 40 && ml.puts.length === 0; i++) {
      ml.sell(ITEM, 1); mlSales++;                      // una venta en Mercado Libre cada 10 segundos
      clock.advance(10);
      await sync();
    }
    assert.ok(ml.puts.length >= 1, "escribió aunque nunca estuvo quieto 20 segundos");
    await settle(16);                                   // después se calma
    assert.equal(webQty(), 100 - 1 - mlSales);
    assert.equal(ml.qty(UP), 100 - 1 - mlSales);
  });
});

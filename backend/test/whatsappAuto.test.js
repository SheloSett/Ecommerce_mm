// Aviso automático por WhatsApp de las campañas y promos (26/11/2026): con la casilla "avisar al empezar"
// tildada, el cron las encola por WhatsApp igual que el email, una sola vez. Base simulada, datos inventados.
// Correr con: npm test

process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-prueba";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const NOW = new Date("2026-11-26T15:00:00Z");
const AYER = new Date("2026-11-25T15:00:00Z");
const MANANA = new Date("2026-11-27T15:00:00Z");

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
let db;
let nextId;
function resetDb() {
  nextId = 1;
  db = {
    offers: {},
    promos: {},
    broadcasts: [],
    recipients: [],
    customers: [
      { id: 1, name: "Ana Prueba", email: "ana@prueba.test", phone: "11 2222-3333", type: "MINORISTA", status: "APPROVED", unsubscribeMarketing: false },
      { id: 2, name: "Beto Prueba", email: "beto@prueba.test", phone: "11 4444-5555", type: "MAYORISTA", status: "APPROVED", unsubscribeMarketing: false },
      { id: 3, name: "Caro Prueba", email: "caro@prueba.test", phone: null, type: "MINORISTA", status: "APPROVED", unsubscribeMarketing: false },
      { id: 4, name: "Dani Prueba", email: "dani@prueba.test", phone: "11 6666-7777", type: "MINORISTA", status: "APPROVED", unsubscribeMarketing: true },
    ],
  };
}

// Filtro mínimo de los where que usa el cron (true/valor exacto, lte/gt de fechas)
function matches(row, where = {}) {
  return Object.entries(where).every(([k, cond]) => {
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("lte" in cond) return new Date(row[k]) <= cond.lte;
      if ("gt" in cond) return new Date(row[k]) > cond.gt;
      if ("in" in cond) return cond.in.includes(row[k]);
      return true;
    }
    return row[k] === cond;
  });
}

class FakePrismaClient {
  constructor() {
    this.offer = {
      findMany: async ({ where }) => Object.values(db.offers).filter((o) => matches(o, where)).map(clone),
      findUnique: async ({ where }) => clone(db.offers[where.id]) || null,
    };
    this.cartPromo = {
      findMany: async ({ where }) => Object.values(db.promos).filter((p) => matches(p, where)).map(clone),
      findUnique: async ({ where }) => clone(db.promos[where.id]) || null,
    };
    this.emailBroadcast = {
      findFirst: async ({ where }) => clone(db.broadcasts.find((b) => matches(b, where))) || null,
    };
    this.customer = { findMany: async () => db.customers.map(clone) };
    this.siteConfig = { findUnique: async () => null, findMany: async () => [] };
    this.$transaction = async (fn) => fn({
      emailBroadcast: { create: async ({ data }) => { const b = { id: nextId++, status: "SENDING", ...data }; db.broadcasts.push(b); return clone(b); } },
      emailRecipient: { createMany: async ({ data }) => { db.recipients.push(...data); return { count: data.length }; } },
    });
  }
}
const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient });

const { announceStartedWhatsapp } = require("../src/services/broadcast.service");

const offer = (id, fields = {}) => {
  db.offers[id] = { id, name: `Campaña ${id}`, appliesTo: "AMBOS", active: true, applied: true, emailAnnounce: true, startsAt: AYER, endsAt: MANANA, ...fields };
};
const promo = (id, fields = {}) => {
  db.promos[id] = { id, name: `Promo ${id}`, appliesTo: "MINORISTA", active: true, emailAnnounce: true, startsAt: AYER, endsAt: MANANA, ...fields };
};

const ENV = { EVOLUTION_URL: "http://evolution.test", EVOLUTION_API_KEY: "llave-de-prueba", EVOLUTION_INSTANCIA: "avisos" };
let envBefore;

describe("aviso automático por WhatsApp", () => {
  beforeEach(() => {
    resetDb();
    envBefore = { ...process.env };
    Object.assign(process.env, ENV);
  });
  const restoreEnv = () => { for (const k of Object.keys(ENV)) if (!(k in envBefore)) delete process.env[k]; };

  test("una campaña con la casilla tildada que ya empezó: se encola por WhatsApp a los que tienen celular", async () => {
    offer(10);
    await announceStartedWhatsapp(NOW);
    assert.equal(db.broadcasts.length, 1);
    const b = db.broadcasts[0];
    assert.equal(b.channel, "WHATSAPP");
    assert.equal(b.kind, "WA_OFFER");
    assert.equal(b.offerId, 10);
    // Ana y Beto. Caro no tiene celular y Dani se dio de baja de las promociones.
    assert.deepEqual(db.recipients.map((r) => r.customerId).sort(), [1, 2]);
    restoreEnv();
  });

  test("una sola vez: la segunda pasada del cron no la repite", async () => {
    offer(10);
    await announceStartedWhatsapp(NOW);
    await announceStartedWhatsapp(NOW);
    assert.equal(db.broadcasts.length, 1);
    restoreEnv();
  });

  test("si ya se mandó a mano (o se canceló) no sale de nuevo sola", async () => {
    offer(10);
    db.broadcasts.push({ id: 99, channel: "WHATSAPP", offerId: 10, status: "CANCELLED" });
    await announceStartedWhatsapp(NOW);
    assert.equal(db.broadcasts.length, 1);
    restoreEnv();
  });

  test("sin la casilla, pausada, que todavía no empezó o sin los precios escritos: no sale", async () => {
    offer(1, { emailAnnounce: false });
    offer(2, { active: false });
    offer(3, { startsAt: MANANA, endsAt: new Date("2026-11-30T15:00:00Z") });
    offer(4, { applied: false });
    offer(5, { endsAt: AYER, startsAt: new Date("2026-11-20T15:00:00Z") });
    await announceStartedWhatsapp(NOW);
    assert.equal(db.broadcasts.length, 0);
    restoreEnv();
  });

  test("un descuento por monto para mayoristas: solo a los mayoristas aprobados", async () => {
    promo(7, { appliesTo: "MAYORISTA" });
    await announceStartedWhatsapp(NOW);
    assert.equal(db.broadcasts.length, 1);
    assert.equal(db.broadcasts[0].kind, "WA_PROMO");
    assert.equal(db.broadcasts[0].cartPromoId, 7);
    assert.deepEqual(db.recipients.map((r) => r.customerId), [2]);
    restoreEnv();
  });

  test("si nadie al que le aplica tiene celular, no rompe y no lo reintenta cada minuto", async () => {
    db.customers = db.customers.filter((c) => c.id !== 2); // ningún mayorista con celular
    promo(8, { appliesTo: "MAYORISTA" });
    const errores = [];
    const orig = console.error;
    console.error = (...a) => errores.push(a.join(" "));
    try {
      await announceStartedWhatsapp(NOW);
      await announceStartedWhatsapp(NOW);
    } finally {
      console.error = orig;
    }
    assert.equal(db.broadcasts.length, 0);
    assert.equal(errores.length, 1, "un solo aviso en el log, no uno por minuto");
    restoreEnv();
  });

  test("sin Evolution configurado no hace nada", async () => {
    for (const k of Object.keys(ENV)) delete process.env[k];
    offer(10);
    await announceStartedWhatsapp(NOW);
    assert.equal(db.broadcasts.length, 0);
    Object.assign(process.env, envBefore);
  });
});

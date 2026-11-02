// Tests de visibilidad de los slides del carrusel por tipo de cliente.
// Correr con: npm test  (usa el runner que trae Node, sin dependencias extra)
//
// Qué protege: que un slide "solo mayoristas" no le llegue a un visitante, a un minorista ni a una
// cuenta mayorista sin aprobar, aunque pidan ?all=true o ?visibleFor=MAYORISTA a mano.

const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const SECRET = process.env.JWT_SECRET;

// ── Base simulada ────────────────────────────────────────────────────────────
// Mismo truco que productPrivacy.test.js: se reemplaza @prisma/client antes de cargar el controller.
// A diferencia de aquel, esta aplica el filtro, así los tests miran qué slides llegan de verdad.
const SLIDES = [
  { id: 1, active: true,  visibility: "AMBOS" },
  { id: 2, active: true,  visibility: "MINORISTA" },
  { id: 3, active: true,  visibility: "MAYORISTA" },
  { id: 4, active: false, visibility: "MAYORISTA" },
];
const CUSTOMERS = {
  5: { type: "MINORISTA", status: "APPROVED", tokenVersion: 0 },
  6: { type: "MAYORISTA", status: "APPROVED", tokenVersion: 0 },
  7: { type: "MAYORISTA", status: "PENDING",  tokenVersion: 0 },
};
const db = { lastUpdate: null };

class FakePrismaClient {
  constructor() {
    this.slide = {
      findMany: async ({ where = {} }) => SLIDES.filter((s) =>
        (where.active === undefined || s.active === where.active) &&
        (!where.visibility || where.visibility.in.includes(s.visibility))),
      findUnique: async ({ where }) => SLIDES.find((s) => s.id === where.id) || null,
      update: async (args) => { db.lastUpdate = args; return { id: args.where.id, ...args.data }; },
    };
    this.customer = { findUnique: async ({ where }) => CUSTOMERS[where.id] || null };
    this.user = { findUnique: async ({ where }) => (where.id === 1 ? { tokenVersion: 0 } : null) };
  }
}
const prismaPath = require.resolve("@prisma/client", { paths: [path.join(__dirname, "..")] });
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: { PrismaClient: FakePrismaClient },
};

let getSlides, createSlide, updateSlide;
before(() => {
  ({ getSlides, createSlide, updateSlide } = require("../src/controllers/slide.controller"));
});

const tokenFor = (payload) => `Bearer ${jwt.sign(payload, SECRET)}`;
const ADMIN     = () => tokenFor({ id: 1, role: "ADMIN" });
const MINORISTA = () => tokenFor({ id: 5, role: "CUSTOMER" });
const MAYORISTA = () => tokenFor({ id: 6, role: "CUSTOMER" });
const PENDIENTE = () => tokenFor({ id: 7, role: "CUSTOMER" });

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

async function idsFor(authorization, query = {}) {
  const res = fakeRes();
  await getSlides({ headers: authorization ? { authorization } : {}, query }, res);
  assert.equal(res.statusCode, 200);
  return res.body.map((s) => s.id);
}

describe("GET /api/slides — qué slides recibe cada uno", () => {
  test("visitante: los de todos y los minoristas", async () => {
    assert.deepEqual(await idsFor(null), [1, 2]);
  });

  test("minorista: los de todos y los minoristas", async () => {
    assert.deepEqual(await idsFor(MINORISTA(), { visibleFor: "MINORISTA" }), [1, 2]);
  });

  test("mayorista aprobado: los de todos y los mayoristas activos, no los minoristas", async () => {
    assert.deepEqual(await idsFor(MAYORISTA(), { visibleFor: "MAYORISTA" }), [1, 3]);
  });

  test("mayorista pendiente de aprobación: se lo trata como minorista", async () => {
    assert.deepEqual(await idsFor(PENDIENTE(), { visibleFor: "MAYORISTA" }), [1, 2]);
  });

  test("visitante con ?visibleFor=MAYORISTA escrito a mano: igual no trae los mayoristas", async () => {
    assert.deepEqual(await idsFor(null, { visibleFor: "MAYORISTA" }), [1, 2]);
  });

  test("token inválido: se lo trata como visitante", async () => {
    assert.deepEqual(await idsFor("Bearer no-es-un-token", { visibleFor: "MAYORISTA" }), [1, 2]);
  });

  test("?all=true sin ser admin: no da acceso a mayoristas ni a ocultos", async () => {
    assert.deepEqual(await idsFor(null, { all: "true" }), [1, 2]);
    assert.deepEqual(await idsFor(MINORISTA(), { all: "true" }), [1, 2]);
    assert.deepEqual(await idsFor(MAYORISTA(), { all: "true" }), [1, 3]);
  });

  test("admin con ?all=true (panel): todos, también los ocultos", async () => {
    assert.deepEqual(await idsFor(ADMIN(), { all: "true" }), [1, 2, 3, 4]);
  });

  test("admin en el inicio: ve lo que corresponde al tipo con el que navega", async () => {
    assert.deepEqual(await idsFor(ADMIN(), { visibleFor: "MINORISTA" }), [1, 2]);
    assert.deepEqual(await idsFor(ADMIN(), { visibleFor: "MAYORISTA" }), [1, 3]);
  });
});

describe("Guardar la visibilidad de un slide", () => {
  test("crear con un valor inválido: 400 antes de subir la imagen", async () => {
    const res = fakeRes();
    await createSlide({ body: { visibility: "TODOS" }, files: { image: [{ buffer: Buffer.from("x") }] } }, res);
    assert.equal(res.statusCode, 400);
  });

  test("editar con un valor inválido: 400 y no toca la base", async () => {
    db.lastUpdate = null;
    const res = fakeRes();
    await updateSlide({ params: { id: "1" }, body: { visibility: "TODOS" } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(db.lastUpdate, null);
  });

  test("editar con un valor válido: se guarda", async () => {
    const res = fakeRes();
    await updateSlide({ params: { id: "1" }, body: { visibility: "MAYORISTA" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(db.lastUpdate.data.visibility, "MAYORISTA");
  });

  test("editar otra cosa (mover, ocultar): no cambia la visibilidad", async () => {
    const res = fakeRes();
    await updateSlide({ params: { id: "1" }, body: { order: "2" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal("visibility" in db.lastUpdate.data, false);
  });
});

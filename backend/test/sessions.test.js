// Tests del contador de sesión (A5 de la auditoría): cortar sesiones al cambiar la contraseña, borrar o
// rechazar una cuenta. Base simulada. Correr con: npm test

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const SECRET = process.env.JWT_SECRET;

let db;
let failDb = false;
const PASS_HASH = bcrypt.hashSync("vieja123", 4);
function resetDb() {
  failDb = false;
  db = {
    users: { 1: { id: 1, email: "duenio@example.com", name: "Dueño", role: "SUPERADMIN", permissions: [], tokenVersion: 0, password: PASS_HASH },
             2: { id: 2, email: "emple@example.com", name: "Emple", role: "ADMIN", permissions: ["productos", "ordenes"], tokenVersion: 0, password: PASS_HASH } },
    customers: { 7: { id: 7, email: "ana@example.com", name: "Ana", type: "MINORISTA", status: "APPROVED", tokenVersion: 0, password: PASS_HASH },
                 8: { id: 8, email: "rech@example.com", name: "Rech", type: "MINORISTA", status: "REJECTED", tokenVersion: 0, password: PASS_HASH } },
  };
}
const pick = (row, select) => (row && select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row);
function applyData(row, data) {
  for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === "object" && "increment" in v ? (row[k] || 0) + v.increment : v;
  return { ...row };
}
class FakePrismaClient {
  constructor() {
    const model = (name) => ({
      findUnique: async ({ where, select }) => { if (failDb) throw new Error("base caída"); return pick(db[name][where.id], select) || null; },
      update: async ({ where, data }) => applyData(db[name][where.id], data),
    });
    this.user = model("users");
    this.customer = model("customers");
  }
}
const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient });
stub(require.resolve(path.join(root, "src/services/email.service.js")), new Proxy({}, { get: () => async () => {} }));

const { authMiddleware } = require("../src/middleware/auth.middleware");
const { changePassword: customerChangePassword } = require("../src/controllers/customer.controller");
const { changePassword: adminChangePassword } = require("../src/controllers/auth.controller");

const tokenFor = (payload) => jwt.sign(payload, SECRET);
const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function runAuth(token) {
  const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
  const res = fakeRes();
  let passed = false;
  await authMiddleware(req, res, () => { passed = true; });
  return { passed, code: passed ? 200 : res.code, user: req.user };
}

describe("authMiddleware: la sesión tiene que seguir vigente", () => {
  beforeEach(resetDb);

  test("un token al día entra, y el rol y los permisos salen de la base", async () => {
    // El token dice solo "productos"; en la base el empleado también tiene "ordenes"
    const r = await runAuth(tokenFor({ id: 2, role: "ADMIN", permissions: ["productos"], tv: 0 }));
    assert.equal(r.passed, true);
    assert.deepEqual(r.user.permissions, ["productos", "ordenes"]);
  });

  test("los tokens de antes de este cambio (sin tv) siguen andando", async () => {
    assert.equal((await runAuth(tokenFor({ id: 7, role: "CUSTOMER" }))).passed, true);
  });

  test("si el contador subió (contraseña cambiada), el token viejo ya no entra", async () => {
    db.customers[7].tokenVersion = 1;
    assert.equal((await runAuth(tokenFor({ id: 7, role: "CUSTOMER", tv: 0 }))).code, 401);
  });

  test("un admin borrado queda afuera al instante", async () => {
    delete db.users[2];
    assert.equal((await runAuth(tokenFor({ id: 2, role: "ADMIN", tv: 0 }))).code, 401);
  });

  test("una cuenta de cliente rechazada queda afuera", async () => {
    assert.equal((await runAuth(tokenFor({ id: 8, role: "CUSTOMER", tv: 0 }))).code, 401);
  });

  test("si la base no responde, 503 (y no se deja pasar)", async () => {
    failDb = true;
    assert.equal((await runAuth(tokenFor({ id: 7, role: "CUSTOMER", tv: 0 }))).code, 503);
  });
});

describe("cambiar la propia contraseña corta las otras sesiones y deja viva esta", () => {
  beforeEach(resetDb);

  test("cliente", async () => {
    const viejo = tokenFor({ id: 7, role: "CUSTOMER", tv: 0 });
    const res = fakeRes();
    await customerChangePassword({ user: { id: 7 }, body: { currentPassword: "vieja123", newPassword: "nueva456" } }, res);
    assert.equal(res.code, 200);
    assert.equal(db.customers[7].tokenVersion, 1);
    assert.equal((await runAuth(viejo)).code, 401, "la sesión vieja (otro navegador) queda afuera");
    assert.equal((await runAuth(res.body.token)).passed, true, "la sesión actual sigue con el token nuevo");
  });

  test("cliente que se equivoca de contraseña actual: 400, no 401 (el 401 lo deslogueaba)", async () => {
    const res = fakeRes();
    await customerChangePassword({ user: { id: 7 }, body: { currentPassword: "otra", newPassword: "nueva456" } }, res);
    assert.equal(res.code, 400);
    assert.equal(db.customers[7].tokenVersion, 0);
  });

  test("admin", async () => {
    const viejo = tokenFor({ id: 1, role: "SUPERADMIN", tv: 0 });
    const res = fakeRes();
    await adminChangePassword({ user: { id: 1 }, body: { currentPassword: "vieja123", newPassword: "nueva456" } }, res);
    assert.equal(res.code, 200);
    assert.equal((await runAuth(viejo)).code, 401);
    assert.equal((await runAuth(res.body.token)).passed, true);
  });
});

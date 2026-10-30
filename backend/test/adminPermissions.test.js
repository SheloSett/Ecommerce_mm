// Tests de los permisos del panel en el backend (A2 de la auditoría): cada ruta del panel pide los
// permisos de las pantallas que la usan. Base simulada. Correr con: npm test

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
class FakePrismaClient {}
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient });

const { requireAnyPermission } = require("../src/middleware/auth.middleware");

const superadmin = { id: 1, email: "duenio@example.com", role: "SUPERADMIN", permissions: [] };
const empleado = (...permissions) => ({ id: 2, email: "emple@example.com", role: "ADMIN", permissions });
const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
function run(guard, user, body = {}, extra = {}) {
  const req = { user, body, method: "PUT", baseUrl: "/api/test", route: { path: "/" }, path: "/", ...extra };
  const res = fakeRes();
  let passed = false;
  guard(req, res, () => { passed = true; });
  return { passed, code: passed ? 200 : res.code };
}

let warnings;
let originalWarn;
beforeEach(() => {
  delete process.env.ENFORCE_ADMIN_PERMISSIONS;
  warnings = [];
  originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
});
afterEach(() => {
  console.warn = originalWarn;
  delete process.env.ENFORCE_ADMIN_PERMISSIONS;
});

describe("requireAnyPermission", () => {
  test("el SUPERADMIN pasa siempre, aunque no tenga permisos cargados", () => {
    process.env.ENFORCE_ADMIN_PERMISSIONS = "true";
    assert.equal(run(requireAnyPermission("caja"), superadmin).passed, true);
  });

  test("alcanza con uno de los permisos", () => {
    process.env.ENFORCE_ADMIN_PERMISSIONS = "true";
    assert.equal(run(requireAnyPermission("clientes", "cupones"), empleado("cupones")).passed, true);
  });

  test("activado: sin ninguno de los permisos, 403", () => {
    process.env.ENFORCE_ADMIN_PERMISSIONS = "true";
    const r = run(requireAnyPermission("caja"), empleado("productos"));
    assert.equal(r.passed, false);
    assert.equal(r.code, 403);
  });

  test("por defecto bloquea", () => {
    assert.equal(run(requireAnyPermission("caja"), empleado("productos")).code, 403);
  });

  test("modo aviso (ENFORCE_ADMIN_PERMISSIONS=false): deja pasar y lo anota una sola vez por admin y ruta", () => {
    process.env.ENFORCE_ADMIN_PERMISSIONS = "false";
    const guard = requireAnyPermission("compras");
    const extra = { method: "GET", baseUrl: "/api/purchases", route: { path: "/" } };
    assert.equal(run(guard, empleado("productos"), {}, extra).passed, true);
    assert.equal(run(guard, empleado("productos"), {}, extra).passed, true);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /emple@example\.com usó GET \/api\/purchases\/ sin permiso 'compras'/);
  });
});

describe("todas las rutas del panel piden permiso", () => {
  // Rutas que cualquier admin usa: su propio perfil y los contadores del menú.
  const ANY_ADMIN = new Set([
    'auth.routes.js router.get("/me"',
    'auth.routes.js router.put("/change-password"',
    'auth.routes.js router.put("/profile"',
    'order.routes.js router.get("/badge-counts"',
  ]);
  const GUARDS = /requireAnyPermission\(|requirePermission\(|superAdminMiddleware|settingsWriteAccess|offerPatchAccess/;

  test("cada línea con adminMiddleware lleva también un control de permisos", () => {
    const dir = path.join(root, "src/routes");
    const missing = [];
    for (const file of fs.readdirSync(dir)) {
      for (const line of fs.readFileSync(path.join(dir, file), "utf8").split(/\r?\n/)) {
        if (!/adminMiddleware[,)]/.test(line) || /require\(|^\s*\/\//.test(line)) continue;
        const where = `${file} ${(line.match(/router\.\w+\("[^"]*"/) || [line.trim()])[0]}`;
        if (!GUARDS.test(line) && !ANY_ADMIN.has(where)) missing.push(where);
      }
    }
    assert.deepEqual(missing, []);
  });
});

// Busca el control de permisos de una ruta en el router de Express (route.stack, por nombre de función).
function guardOf(router, method, routePath, name) {
  const layer = router.stack.find((l) => l.route?.path === routePath && l.route.methods[method]);
  return layer.route.stack.find((l) => l.handle.name === name).handle;
}

describe("Configuración: con 'emails' solo se guarda la campaña automática de emails", () => {
  let guard;
  beforeEach(() => {
    process.env.ENFORCE_ADMIN_PERMISSIONS = "true";
    guard ||= guardOf(require("../src/routes/settings.routes"), "put", "/", "settingsWriteAccess");
  });

  test("'configuracion' guarda cualquier clave", () => {
    assert.equal(run(guard, empleado("configuracion"), { maintenance: "true" }).passed, true);
  });

  test("'emails' guarda la campaña (claves emailMinorista*)", () => {
    const body = { emailMinoristaFrequencyDays: "7", emailMinoristaHour: "10", emailMinoristaProductCount: "6" };
    assert.equal(run(guard, empleado("emails"), body).passed, true);
  });

  test("'emails' prende el recordatorio de carrito abandonado", () => {
    assert.equal(run(guard, empleado("emails"), { emailAbandonedCart: "true" }).passed, true);
  });

  test("'emails' no puede activar el mantenimiento ni tocar Meta", () => {
    assert.equal(run(guard, empleado("emails"), { maintenance: "true" }).code, 403);
    assert.equal(run(guard, empleado("emails"), { emailMinoristaHour: "10", metaPixelId: "1" }).code, 403);
  });

  test("sin permisos, 403", () => {
    assert.equal(run(guard, empleado("productos"), { emailMinoristaHour: "10" }).code, 403);
  });
});

describe("Campañas: con 'emails' solo se prende o apaga el aviso por email", () => {
  let guard;
  beforeEach(() => {
    process.env.ENFORCE_ADMIN_PERMISSIONS = "true";
    guard ||= guardOf(require("../src/routes/offer.routes"), "patch", "/:id", "offerPatchAccess");
  });

  test("'productos' edita la campaña", () => {
    assert.equal(run(guard, empleado("productos"), { name: "Black Friday", active: true }).passed, true);
  });

  test("'emails' cambia emailAnnounce", () => {
    assert.equal(run(guard, empleado("emails"), { emailAnnounce: true }).passed, true);
  });

  test("'emails' no cambia precios ni la activa", () => {
    assert.equal(run(guard, empleado("emails"), { emailAnnounce: true, active: true }).code, 403);
    assert.equal(run(guard, empleado("emails"), { items: [] }).code, 403);
  });
});

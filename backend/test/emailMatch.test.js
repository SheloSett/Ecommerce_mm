// Tests de la búsqueda de emails sin mayúsculas (utils/email.js).
// Correr con: npm test
//
// Prisma compara `equals` + `mode: "insensitive"` con ILIKE y le pasa el texto tal cual: sin escapar,
// "%" coincidía con cualquier email. Así, GET /api/returns/lookup?email=% (pública) devolvía los
// pedidos de todos los clientes de los últimos 10 días, y el login o "olvidé mi contraseña" con "%"
// encontraban al primer cliente de la tabla.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { whereEmail, escapeLike } = require("../src/utils/email");

describe("escapeLike / whereEmail", () => {
  test("los comodines de ILIKE quedan como texto", () => {
    assert.equal(escapeLike("%"), "\\%");
    assert.equal(escapeLike("a%@%.%"), "a\\%@\\%.\\%");
    assert.equal(escapeLike("juan_p@x.com"), "juan\\_p@x.com");
    assert.equal(escapeLike("a\\b@x.com"), "a\\\\b@x.com");
  });

  test("un email normal no cambia (solo se le sacan los espacios)", () => {
    assert.deepEqual(whereEmail("  Ana@Gmail.com "), { email: { equals: "Ana@Gmail.com", mode: "insensitive" } });
  });

  test("whereEmail escapa lo que recibe", () => {
    assert.equal(whereEmail("%").email.equals, "\\%");
    assert.equal(whereEmail(undefined).email.equals, "");
  });
});

describe("búsqueda pública de pedidos por email", () => {
  test("la ruta /api/returns/lookup ya no existe", () => {
    // Cargar el router sin base ni emails reales
    const root = path.join(__dirname, "..");
    const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
    stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: class {} });
    stub(require.resolve(path.join(root, "src/services/email.service.js")), new Proxy({}, { get: () => async () => {} }));

    const router = require("../src/routes/return.routes");
    const paths = router.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
    assert.ok(!paths.includes("GET /lookup"), `rutas: ${paths.join(", ")}`);
    assert.ok(paths.includes("POST /"), "el formulario de arrepentimiento sigue andando");
  });
});

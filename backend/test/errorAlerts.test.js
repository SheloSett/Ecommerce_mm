// Tests de los avisos de errores de producción (services/errorAlerts.service.js).
// Correr con: npm test
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

// email.service falso: anota los avisos en vez de mandarlos
const sent = [];
const emailPath = require.resolve(path.join(__dirname, "../src/services/email.service.js"));
require.cache[emailPath] = { id: emailPath, filename: emailPath, loaded: true,
  exports: { sendErrorAlert: async (subject) => { sent.push(subject); } } };
const { reportError } = require("../src/services/errorAlerts.service");
console.error = () => {}; // el servicio también loguea; acá no hace falta verlo

test("el mismo error se avisa una sola vez cada 15 minutos", () => {
  for (let i = 0; i < 5; i++) reportError("servidor", "GET /api/products: boom");
  assert.equal(sent.filter((s) => s.includes("boom")).length, 1);
});

test("muchos errores distintos no pasan de 20 emails por hora", () => {
  for (let i = 0; i < 50; i++) reportError("navegador", `error distinto ${i}`);
  assert.ok(sent.length <= 20, `salieron ${sent.length}`);
});

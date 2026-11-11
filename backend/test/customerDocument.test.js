// Tests del documento del cliente que viaja con el pedido (utils/customerDocument.js).
// Correr con: npm test
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeDocument } = require("../src/utils/customerDocument");

test("sin número no se guarda nada", () => {
  assert.deepEqual(normalizeDocument("DNI", ""), { ok: true, empty: true });
  assert.deepEqual(normalizeDocument(undefined, undefined), { ok: true, empty: true });
  assert.deepEqual(normalizeDocument("DNI", "   "), { ok: true, empty: true });
});

test("DNI: con puntos o espacios queda solo con números", () => {
  assert.deepEqual(normalizeDocument("dni", "30.123.456"), { ok: true, type: "DNI", number: "30123456" });
  assert.deepEqual(normalizeDocument("DNI", " 7 654 321 "), { ok: true, type: "DNI", number: "7654321" });
  assert.equal(normalizeDocument("DNI", "12345").ok, false);
  assert.equal(normalizeDocument("DNI", "1234567890").ok, false);
  assert.equal(normalizeDocument("DNI", "12a45678").ok, false);
});

test("CUIT y CUIL: 11 números con el dígito verificador correcto", () => {
  // 20-11111111-2: CUIT de ejemplo con dígito verificador válido
  assert.deepEqual(normalizeDocument("CUIT", "20-11111111-2"), { ok: true, type: "CUIT", number: "20111111112" });
  assert.equal(normalizeDocument("CUIT", "20-11111111-3").ok, false, "dígito verificador mal");
  assert.match(normalizeDocument("CUIT", "20-11111111-3").error, /Revisá el CUIT/);
  assert.equal(normalizeDocument("CUIL", "20111111112").ok, true);
  assert.equal(normalizeDocument("CUIL", "30000000007").ok, false, "un CUIL es de persona, no de empresa");
});

test("tipo desconocido o número raro", () => {
  assert.equal(normalizeDocument("PASAPORTE", "123").ok, false);
  assert.equal(normalizeDocument("DNI", { n: 1 }).ok, false);
  assert.equal(normalizeDocument("DNI", "<script>").ok, false);
});

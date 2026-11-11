// Tests del texto del QR de la factura (services/arca/qr.js). Funciones puras. Correr con: npm test
//
// El caso principal es el ejemplo oficial de ARCA ("Especificaciones del QR incluido en las facturas
// electrónicas", https://www.arca.gob.ar/fe/qr/documentos/QRespecificaciones.pdf): el JSON y el Base64
// tienen que salir idénticos, byte por byte.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { buildQr, QR_BASE_URL, amountJson } = require("../src/services/arca/qr");

// Datos del ejemplo oficial.
const EJEMPLO = {
  cbteFch: "20201013", cuit: "30000000007", ptoVta: 10, cbteTipo: 1, cbteNro: 94, importeCents: 1210000,
  monId: "DOL", monCotiz: 65, docTipo: 80, docNro: "20000000001", tipoCodAut: "E", codAut: "70417054367476",
};
// Copiados del documento.
const JSON_OFICIAL = '{"ver":1,"fecha":"2020-10-13","cuit":30000000007,"ptoVta":10,"tipoCmp":1,"nroCmp":94,"importe":12100,"moneda":"DOL","ctz":65,"tipoDocRec":80,"nroDocRec":20000000001,"tipoCodAut":"E","codAut":70417054367476}';
const P_OFICIAL = "eyJ2ZXIiOjEsImZlY2hhIjoiMjAyMC0xMC0xMyIsImN1aXQiOjMwMDAwMDAwMDA3LCJwdG9WdGEiOjEwLCJ0aXBvQ21wIjoxLCJucm9DbXAiOjk0LCJpbXBvcnRlIjoxMjEwMCwibW9uZWRhIjoiRE9MIiwiY3R6Ijo2NSwidGlwb0RvY1JlYyI6ODAsIm5yb0RvY1JlYyI6MjAwMDAwMDAwMDEsInRpcG9Db2RBdXQiOiJFIiwiY29kQXV0Ijo3MDQxNzA1NDM2NzQ3Nn0=";

describe("ejemplo oficial de ARCA", () => {
  test("el JSON y el Base64 salen idénticos", () => {
    const r = buildQr(EJEMPLO);
    assert.equal(r.ok, true);
    assert.equal(r.json, JSON_OFICIAL);
    assert.equal(r.payload, P_OFICIAL);
  });

  test("la dirección es la de la especificación (arca.gob.ar), con el mismo dato", () => {
    const r = buildQr(EJEMPLO);
    assert.equal(QR_BASE_URL, "https://www.arca.gob.ar/fe/qr/");
    assert.equal(r.url, `https://www.arca.gob.ar/fe/qr/?p=${P_OFICIAL}`);
  });

  test("también con la fecha en formato AAAA-MM-DD y la cotización como texto", () => {
    assert.equal(buildQr({ ...EJEMPLO, cbteFch: "2020-10-13", monCotiz: "65.000000" }).payload, P_OFICIAL);
  });
});

describe("factura en pesos de la tienda", () => {
  test("pesos con cotización 1 por defecto, importe con centavos sin ceros de más", () => {
    const r = buildQr({ cbteFch: "20261111", cuit: "30-00000000-7", ptoVta: 3, cbteTipo: 6, cbteNro: 1234, importeCents: 123450, docTipo: 99, docNro: "0", codAut: "86123456789012" });
    assert.equal(r.ok, true);
    assert.equal(r.json, '{"ver":1,"fecha":"2026-11-11","cuit":30000000007,"ptoVta":3,"tipoCmp":6,"nroCmp":1234,"importe":1234.5,"moneda":"PES","ctz":1,"tipoDocRec":99,"nroDocRec":0,"tipoCodAut":"E","codAut":86123456789012}');
    assert.equal(Buffer.from(r.payload, "base64").toString("utf8"), r.json);
    assert.doesNotThrow(() => JSON.parse(r.json));
  });

  test("sin documento del receptor el JSON no lleva esos campos (son 'de corresponder')", () => {
    const r = buildQr({ cbteFch: "20261111", cuit: "30000000007", ptoVta: 3, cbteTipo: 6, cbteNro: 1, importeCents: 100, codAut: "86123456789012" });
    assert.equal(r.ok, true);
    assert.ok(!r.json.includes("tipoDocRec") && !r.json.includes("nroDocRec"));
  });

  test("importes: entero, con decimales y con un solo decimal", () => {
    assert.equal(amountJson(1210000), "12100");
    assert.equal(amountJson(123405), "1234.05");
    assert.equal(amountJson(123450), "1234.5");
    assert.equal(amountJson(0), "0");
  });
});

describe("datos inválidos", () => {
  test("devuelve qué campos están mal, sin tirar error", () => {
    const r = buildQr({
      cbteFch: "20261131", cuit: "30000000008", ptoVta: 0, cbteTipo: 1000, cbteNro: 0, importeCents: -1,
      monId: "pesos", monCotiz: "1,5", docTipo: 100, docNro: "abc", tipoCodAut: "X", codAut: "123",
    });
    assert.deepEqual(r, {
      ok: false,
      errors: ["cbteFch", "cuit", "ptoVta", "cbteTipo", "cbteNro", "importeCents", "monId", "monCotiz", "docTipo", "docNro", "tipoCodAut", "codAut"],
    });
    assert.deepEqual(buildQr(), { ok: false, errors: ["cbteFch", "cuit", "ptoVta", "cbteTipo", "cbteNro", "importeCents", "codAut"] });
  });

  test("un CAE con algo que no sean 14 dígitos no entra al JSON", () => {
    assert.deepEqual(buildQr({ ...EJEMPLO, codAut: '1234567890123"' }).errors, ["codAut"]);
    assert.deepEqual(buildQr({ ...EJEMPLO, monId: 'DO"' }).errors, ["monId"]);
  });
});

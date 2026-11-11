// Tests del receptor de la factura (services/arca/receiver.js). Funciones puras. Correr con: npm test
//
// CUIT de ejemplo (con DNI 0 o los del manual de ARCA): el repo es público y no lleva datos reales.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { validateReceiver, suggestClass, cleanText } = require("../src/services/arca/receiver");

const EMISOR = "30000000007";
const CLIENTE_CUIT = "20000000001";
const ctx = (extra = {}) => ({ issuerCuit: EMISOR, totalCents: 100000, ...extra });
const codes = (r) => (r.errors || []).map((e) => e.code).sort();

const facturaA = (extra = {}) => ({
  cbteClass: "A", ivaConditionId: 1, docType: "CUIT", docNumber: CLIENTE_CUIT,
  name: "Cliente de Prueba SA", address: "Calle Falsa 123, CABA", constanciaVerificada: true, ...extra,
});

describe("factura A", () => {
  test("responsable inscripto con CUIT, razón social, domicilio y constancia", () => {
    const r = validateReceiver(facturaA(), ctx());
    assert.deepEqual(r, {
      ok: true,
      receiver: {
        cbteClass: "A", docTipo: 80, docNro: CLIENTE_CUIT, ivaConditionId: 1, ivaConditionDesc: "IVA Responsable Inscripto",
        name: "Cliente de Prueba SA", address: "Calle Falsa 123, CABA",
      },
    });
  });

  test("monotributista: A (RG 5003), con el CUIT con guiones", () => {
    const r = validateReceiver(facturaA({ ivaConditionId: 6, docNumber: "20-00000000-1" }), ctx());
    assert.equal(r.ok, true);
    assert.equal(r.receiver.docNro, CLIENTE_CUIT);
  });

  test("consumidor final no recibe A", () => {
    assert.deepEqual(codes(validateReceiver(facturaA({ ivaConditionId: 5 }), ctx())), ["CONDICION_NO_VALIDA_PARA_CLASE"]);
  });

  test("sin CUIT, con DNI o sin documento: no", () => {
    assert.deepEqual(codes(validateReceiver(facturaA({ docType: "DNI", docNumber: "12345678" }), ctx())), ["DOCUMENTO_DEBE_SER_CUIT"]);
    assert.deepEqual(codes(validateReceiver(facturaA({ docType: null, docNumber: null }), ctx())), ["DOCUMENTO_DEBE_SER_CUIT"]);
  });

  test("CUIT mal tipeado, sin razón social, sin domicilio, sin constancia: los cuatro juntos", () => {
    const r = validateReceiver(facturaA({ docNumber: "20000000002", name: "  ", address: "", constanciaVerificada: false }), ctx());
    assert.deepEqual(codes(r), ["CUIT_INVALIDO", "FALTA_CONSTANCIA", "FALTA_DOMICILIO", "FALTA_RAZON_SOCIAL"]);
    assert.equal(r.errors.find((e) => e.code === "CUIT_INVALIDO").field, "docNumber");
  });

  test("la constancia tiene que venir tildada de verdad (true), no un texto", () => {
    assert.deepEqual(codes(validateReceiver(facturaA({ constanciaVerificada: "true" }), ctx())), ["FALTA_CONSTANCIA"]);
  });
});

describe("factura B", () => {
  test("consumidor final sin documento, por debajo del tope: DocTipo 99 y DocNro 0", () => {
    const r = validateReceiver({ cbteClass: "B", ivaConditionId: 5 }, ctx());
    assert.equal(r.ok, true);
    assert.deepEqual([r.receiver.docTipo, r.receiver.docNro, r.receiver.name], [99, "0", null]);
  });

  test("consumidor final sin documento desde el tope: hay que identificarlo", () => {
    assert.deepEqual(codes(validateReceiver({ cbteClass: "B", ivaConditionId: 5 }, ctx({ totalCents: 10000000 * 100 }))), ["DOCUMENTO_OBLIGATORIO"]);
    assert.equal(validateReceiver({ cbteClass: "B", ivaConditionId: 5 }, ctx({ totalCents: 10000000 * 100 - 1 })).ok, true);
    // El tope se puede cambiar desde la configuración fiscal.
    assert.deepEqual(codes(validateReceiver({ cbteClass: "B", ivaConditionId: 5 }, ctx({ totalCents: 5000, cfCapCents: 5000 }))), ["DOCUMENTO_OBLIGATORIO"]);
  });

  test("sin total no se puede saber si hace falta documento", () => {
    assert.deepEqual(codes(validateReceiver({ cbteClass: "B", ivaConditionId: 5 }, { issuerCuit: EMISOR })), ["TOTAL_INVALIDO"]);
  });

  test("consumidor final con DNI (con puntos), con CUIT o con CUIL", () => {
    assert.deepEqual(validateReceiver({ cbteClass: "B", ivaConditionId: 5, docType: "DNI", docNumber: "12.345.678" }, ctx()).receiver.docNro, "12345678");
    assert.equal(validateReceiver({ cbteClass: "B", ivaConditionId: 5, docType: 96, docNumber: 1234567 }, ctx()).receiver.docTipo, 96);
    assert.equal(validateReceiver({ cbteClass: "B", ivaConditionId: 5, docType: "CUIT", docNumber: CLIENTE_CUIT }, ctx()).receiver.docTipo, 80);
    assert.equal(validateReceiver({ cbteClass: "B", ivaConditionId: 5, docType: "cuil", docNumber: CLIENTE_CUIT }, ctx()).receiver.docTipo, 86);
  });

  test("DNI con pocos o demasiados números, CUIL de empresa", () => {
    assert.deepEqual(codes(validateReceiver({ cbteClass: "B", ivaConditionId: 5, docType: "DNI", docNumber: "12345" }, ctx())), ["DNI_INVALIDO"]);
    assert.deepEqual(codes(validateReceiver({ cbteClass: "B", ivaConditionId: 5, docType: "DNI", docNumber: "123456789" }, ctx())), ["DNI_INVALIDO"]);
    assert.deepEqual(codes(validateReceiver({ cbteClass: "B", ivaConditionId: 5, docType: "CUIL", docNumber: EMISOR }, ctx())), ["CUIL_INVALIDO"]);
  });

  test("exento: con CUIT y razón social", () => {
    assert.equal(validateReceiver({ cbteClass: "B", ivaConditionId: 4, docType: "CUIT", docNumber: CLIENTE_CUIT, name: "Fundación de Prueba" }, ctx()).ok, true);
    assert.deepEqual(codes(validateReceiver({ cbteClass: "B", ivaConditionId: 4, docType: "DNI", docNumber: "12345678" }, ctx())), ["DOCUMENTO_DEBE_SER_CUIT", "FALTA_RAZON_SOCIAL"]);
  });

  test("responsable inscripto no recibe B", () => {
    assert.deepEqual(codes(validateReceiver({ cbteClass: "B", ivaConditionId: 1, docType: "CUIT", docNumber: CLIENTE_CUIT }, ctx())), ["CONDICION_NO_VALIDA_PARA_CLASE"]);
  });
});

describe("casos que el sistema no factura", () => {
  test("sujeto no categorizado, por condición o por el CUIT genérico", () => {
    assert.deepEqual(codes(validateReceiver({ cbteClass: "B", ivaConditionId: 7 }, ctx())), ["NO_CATEGORIZADO_NO_SOPORTADO"]);
    assert.deepEqual(codes(validateReceiver({ cbteClass: "B", ivaConditionId: 5, docType: "CUIT", docNumber: "23000000000" }, ctx())), ["NO_CATEGORIZADO_NO_SOPORTADO"]);
  });

  test("condiciones fuera de lo que emite la tienda o que no existen", () => {
    assert.deepEqual(codes(validateReceiver({ cbteClass: "B", ivaConditionId: 9 }, ctx())), ["CONDICION_NO_SOPORTADA"]);
    assert.deepEqual(codes(validateReceiver({ cbteClass: "B", ivaConditionId: 99 }, ctx())), ["CONDICION_INVALIDA"]);
    assert.deepEqual(codes(validateReceiver({ cbteClass: "B" }, ctx())), ["CONDICION_INVALIDA"]);
  });

  test("letra que no es A ni B, tipo de documento que no existe", () => {
    assert.deepEqual(codes(validateReceiver({ cbteClass: "C", ivaConditionId: 5 }, ctx())), ["CLASE_INVALIDA"]);
    assert.deepEqual(codes(validateReceiver({ cbteClass: "B", ivaConditionId: 5, docType: "PASAPORTE", docNumber: "X1" }, ctx())), ["TIPO_DOCUMENTO_INVALIDO"]);
  });

  test("el receptor no puede ser la misma empresa que factura", () => {
    assert.deepEqual(codes(validateReceiver(facturaA({ docNumber: "30-00000000-7" }), ctx())), ["RECEPTOR_IGUAL_EMISOR"]);
  });
});

const ch = (code) => String.fromCharCode(code);

describe("textos que van al PDF", () => {
  test("saca caracteres de control y de dirección del texto, y junta los espacios", () => {
    assert.deepEqual(cleanText(`  Juan\t\nPérez${ch(0)}  `, 50), { ok: true, text: "Juan Pérez" });
    assert.deepEqual(cleanText(`abc${ch(0x202e)}def${ch(0x200b)}${ch(0x2028)}g`, 50), { ok: true, text: "abcdef g" });
    assert.deepEqual(cleanText(null, 5), { ok: true, text: "" });
  });

  test("demasiado largo o que no es texto: no", () => {
    assert.deepEqual(cleanText("x".repeat(6), 5), { ok: false });
    assert.deepEqual(cleanText({ a: 1 }, 5), { ok: false });
    assert.deepEqual(codes(validateReceiver(facturaA({ name: "x".repeat(201) }), ctx())), ["TEXTO_INVALIDO"]);
  });
});

test("letra sugerida según la condición frente al IVA", () => {
  assert.equal(suggestClass(1), "A");
  assert.equal(suggestClass(6), "A");
  assert.equal(suggestClass("16"), "A");
  assert.equal(suggestClass(5), "B");
  assert.equal(suggestClass(4), "B");
  assert.equal(suggestClass(15), "B");
  assert.equal(suggestClass(7), null);
  assert.equal(suggestClass(undefined), null);
});

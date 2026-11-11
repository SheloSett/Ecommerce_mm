// Tests de los códigos de ARCA (services/arca/constants.js) y de la validación de CUIT
// (services/arca/cuit.js). Funciones puras. Correr con: npm test
//
// Los CUIT de estos tests son de ejemplo (los del manual de ARCA o armados con DNI 0): el repo es
// público y no lleva datos de contribuyentes reales.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateCuit, validateCuil, isValidCuit, cuitCheckDigit, formatCuit, digitsOnly,
} = require("../src/services/arca/cuit");
const C = require("../src/services/arca/constants");

describe("CUIT", () => {
  test("los CUIT de ejemplo del manual de ARCA son válidos", () => {
    for (const cuit of ["20111111112", "30000000007", "23000000000", "20000000001"]) {
      assert.deepEqual(validateCuit(cuit), { ok: true, cuit }, cuit);
    }
  });

  test("acepta guiones, puntos y espacios, y devuelve solo los dígitos", () => {
    assert.deepEqual(validateCuit(" 30-00000000-7 "), { ok: true, cuit: "30000000007" });
    assert.deepEqual(validateCuit("20.00000000.1"), { ok: true, cuit: "20000000001" });
    assert.deepEqual(validateCuit(30000000007), { ok: true, cuit: "30000000007" });
  });

  test("dígito verificador equivocado", () => {
    assert.deepEqual(validateCuit("30000000008"), { ok: false, error: "DIGITO_VERIFICADOR" });
  });

  test("largo, letras o nada: FORMATO", () => {
    for (const v of ["3000000000", "300000000071", "30-0000000A-7", "", null, undefined, {}, -1, 1.5]) {
      assert.deepEqual(validateCuit(v), { ok: false, error: "FORMATO" }, String(v));
    }
  });

  test("prefijo que no existe", () => {
    // 12-00000000-? con el verificador que corresponda igual se rechaza por el prefijo.
    const dv = cuitCheckDigit("1200000000");
    assert.deepEqual(validateCuit(`1200000000${dv}`), { ok: false, error: "PREFIJO" });
  });

  test("si el verificador daría 10 el número no existe, con cualquier último dígito", () => {
    // 2,0,0,0,0,0,0,0,0,1 × 5,4,3,2,7,6,5,4,3,2 = 12 → resto 1 → 11 - 1 = 10.
    assert.equal(cuitCheckDigit("2000000001"), null);
    for (let d = 0; d <= 9; d++) assert.equal(isValidCuit(`2000000001${d}`), false, String(d));
  });

  test("CUIL: solo prefijos de persona", () => {
    assert.equal(validateCuil("20000000001").ok, true);
    assert.deepEqual(validateCuil("30000000007"), { ok: false, error: "PREFIJO" });
  });

  test("formatCuit y digitsOnly", () => {
    assert.equal(formatCuit("30000000007"), "30-00000000-7");
    assert.equal(formatCuit("123"), "123");
    assert.equal(digitsOnly("20-00000000-1"), "20000000001");
    assert.equal(digitsOnly("20/00000000/1"), null);
  });
});

describe("códigos de ARCA", () => {
  test("cada condición que emite la tienda está permitida por ARCA para esa clase", () => {
    for (const [clase, condiciones] of Object.entries(C.SUPPORTED_CONDITIONS_BY_CLASS)) {
      for (const id of condiciones) {
        assert.ok(C.CLASSES_BY_CONDITION[id].includes(clase), `condición ${id} en clase ${clase}`);
        assert.ok(C.IVA_CONDITION_DESC[id], `descripción de ${id}`);
      }
    }
  });

  test("ninguna condición va en las dos clases (la clase sale de la condición)", () => {
    const a = new Set(C.SUPPORTED_CONDITIONS_BY_CLASS.A);
    assert.ok(C.SUPPORTED_CONDITIONS_BY_CLASS.B.every((id) => !a.has(id)));
  });

  test("factura → nota de crédito de la misma clase", () => {
    for (const [factura, nota] of Object.entries(C.CREDIT_NOTE_FOR)) {
      assert.equal(C.CLASS_OF_TYPE[factura], C.CLASS_OF_TYPE[nota]);
      assert.ok(C.isInvoiceType(Number(factura)));
      assert.ok(C.isCreditNoteType(nota));
    }
    assert.equal(C.INVOICE_TYPE_FOR_CLASS.A, C.CBTE_TIPO.FACTURA_A);
    assert.equal(C.INVOICE_TYPE_FOR_CLASS.B, C.CBTE_TIPO.FACTURA_B);
  });

  test("alícuotas: 21 y 10,5 con sus Id de ARCA; cualquier otra no", () => {
    assert.equal(C.rateFromPct(21).id, 5);
    assert.equal(C.rateFromPct(10.5).id, 4);
    assert.equal(C.rateFromPct("10,5").id, 4);
    for (const v of [27, 0, 5, 10, "", null, undefined, NaN, "21%"]) assert.equal(C.rateFromPct(v), null, String(v));
  });

  test("el CUIT genérico de no categorizado es un CUIT bien formado (por eso hay que rechazarlo aparte)", () => {
    assert.equal(isValidCuit(C.CUIT_NOT_CATEGORIZED), true);
  });
});

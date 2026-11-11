// Validación de CUIT y CUIL (11 dígitos con dígito verificador "módulo 11").
//
// Un CUIT bien formado no quiere decir que exista ni que esté activo: eso lo dice el padrón de ARCA.
// Esto solo evita mandarle a ARCA un número mal tipeado.
//
// Algoritmo: los primeros 10 dígitos se multiplican por 5, 4, 3, 2, 7, 6, 5, 4, 3, 2 y se suman; el
// verificador es 11 menos el resto de dividir esa suma por 11 (si da 11, es 0). Si da 10 ese número no
// existe: ARCA le asigna otro prefijo (23 o 33) en vez de usar un verificador de dos cifras. ARCA no lo
// trae en el manual del web service (es el algoritmo conocido), pero los CUIT de ejemplo del manual
// (20111111112, 30000000007, 23000000000) lo cumplen y los tests lo comprueban.

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

// Prefijos en uso: 20, 23, 24, 25, 26, 27 para personas; 30, 33, 34 para empresas y otras entidades.
const PERSON_PREFIXES = Object.freeze(["20", "23", "24", "25", "26", "27"]);
const COMPANY_PREFIXES = Object.freeze(["30", "33", "34"]);
const PREFIXES = Object.freeze([...PERSON_PREFIXES, ...COMPANY_PREFIXES]);

// Deja solo los dígitos de lo que tipeó el admin ("20-12345678-6", "20 12345678 6", un número). null si
// trae algo que no sea dígitos, guiones, puntos o espacios.
function digitsOnly(value) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return String(value);
  }
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!/^[\d\s.\-]+$/.test(clean)) return null;
  return clean.replace(/[\s.\-]/g, "");
}

// Dígito verificador de los 10 primeros dígitos, o null si ese número no puede existir (daría 10).
function cuitCheckDigit(firstTen) {
  if (typeof firstTen !== "string" || !/^\d{10}$/.test(firstTen)) return null;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(firstTen[i]) * WEIGHTS[i];
  const dv = 11 - (sum % 11);
  if (dv === 11) return 0;
  if (dv === 10) return null;
  return dv;
}

/**
 * Valida un CUIT.
 * @returns {{ ok: true, cuit: string } | { ok: false, error: "FORMATO" | "PREFIJO" | "DIGITO_VERIFICADOR" }}
 *          cuit: los 11 dígitos sin guiones.
 */
function validateCuit(value) {
  const d = digitsOnly(value);
  if (!d || d.length !== 11) return { ok: false, error: "FORMATO" };
  if (!PREFIXES.includes(d.slice(0, 2))) return { ok: false, error: "PREFIJO" };
  const dv = cuitCheckDigit(d.slice(0, 10));
  if (dv === null || dv !== Number(d[10])) return { ok: false, error: "DIGITO_VERIFICADOR" };
  return { ok: true, cuit: d };
}

const isValidCuit = (value) => validateCuit(value).ok;

// Un CUIL es de una persona: mismo algoritmo, solo prefijos de persona.
function validateCuil(value) {
  const r = validateCuit(value);
  if (!r.ok) return r;
  if (!PERSON_PREFIXES.includes(r.cuit.slice(0, 2))) return { ok: false, error: "PREFIJO" };
  return r;
}

// "20123456786" → "20-12345678-6". Si no son 11 dígitos lo devuelve como vino.
function formatCuit(value) {
  const d = digitsOnly(value);
  if (!d || d.length !== 11) return typeof value === "string" ? value : String(value ?? "");
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

module.exports = {
  validateCuit,
  validateCuil,
  isValidCuit,
  cuitCheckDigit,
  formatCuit,
  digitsOnly,
  PREFIXES,
  PERSON_PREFIXES,
  COMPANY_PREFIXES,
};

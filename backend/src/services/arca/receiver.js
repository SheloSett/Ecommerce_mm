// Receptor de la factura: a quién se le factura y qué letra le corresponde.
//
// REGLAS (plan de facturación; las de ARCA salen del manual WSFEv1 v4.7):
// - Factura A: a responsable inscripto o monotributista (CondicionIVAReceptorId 1, 6, 13 o 16), siempre
//   con CUIT (validación 10013), razón social, domicilio, y el admin tiene que tildar "verifiqué la
//   constancia": ARCA no rechaza una A a quien no corresponde, solo la observa (observación 10017), así
//   que el control queda de este lado.
// - Factura B: a consumidor final, exento o IVA no alcanzado (5, 4 o 15). Al consumidor final se le puede
//   facturar sin documento (DocTipo 99, DocNro 0) solo por debajo del tope vigente (validación 10015); al
//   exento y al no alcanzado, con CUIT.
// - El receptor no puede ser el mismo CUIT que factura (validación 10069).
// - El CUIT genérico de no categorizado (23000000000) exige una percepción de IVA que el sistema no
//   calcula (validaciones 10067 y 10283): no se acepta.
// - La condición frente al IVA se manda siempre (RG 5616). La letra la decide el admin; acá solo se
//   sugiere y se valida.
//
// Nombre y domicilio no viajan a ARCA (el web service no los pide): van al PDF. Igual se limpian acá.

const {
  DOC_TIPO, IVA_CONDITION, IVA_CONDITION_DESC, CLASSES_BY_CONDITION, SUPPORTED_CONDITIONS_BY_CLASS,
  CUIT_NOT_CATEGORIZED, CF_UNIDENTIFIED_CAP_CENTS,
} = require("./constants");
const { validateCuit, validateCuil, digitsOnly } = require("./cuit");

const MAX_NAME = 200;
const MAX_ADDRESS = 300;

const MESSAGES = Object.freeze({
  CLASE_INVALIDA: "La letra de la factura tiene que ser A o B.",
  CONDICION_INVALIDA: "Falta la condición frente al IVA del cliente.",
  CONDICION_NO_VALIDA_PARA_CLASE: "Esa condición frente al IVA no va con esta letra de factura.",
  CONDICION_NO_SOPORTADA: "El sistema no factura a esa condición frente al IVA.",
  NO_CATEGORIZADO_NO_SOPORTADO: "No se puede facturar a un sujeto no categorizado: lleva una percepción de IVA que el sistema no calcula.",
  TIPO_DOCUMENTO_INVALIDO: "El tipo de documento tiene que ser CUIT, CUIL, DNI o sin identificar.",
  DOCUMENTO_DEBE_SER_CUIT: "Para esta factura el cliente tiene que tener CUIT.",
  CUIT_INVALIDO: "El CUIT no es válido: revisá los números.",
  CUIL_INVALIDO: "El CUIL no es válido: revisá los números.",
  DNI_INVALIDO: "El DNI no es válido: tienen que ser entre 6 y 8 números.",
  DOCUMENTO_OBLIGATORIO: "Por el importe, hay que identificar al cliente con su documento.",
  TOTAL_INVALIDO: "No se pudo leer el total de la factura.",
  RECEPTOR_IGUAL_EMISOR: "El cliente no puede tener el mismo CUIT que la empresa que factura.",
  FALTA_RAZON_SOCIAL: "Falta el nombre o la razón social del cliente.",
  FALTA_DOMICILIO: "Falta el domicilio del cliente.",
  TEXTO_INVALIDO: "El nombre o el domicilio tienen caracteres no permitidos o son demasiado largos.",
  FALTA_CONSTANCIA: "Para una factura A hay que confirmar que se verificó la constancia de inscripción del cliente.",
});

const error = (code, field) => ({ code, field, message: MESSAGES[code] });

// Texto que va al PDF: sin caracteres de control ni de dirección del texto (los que dan vuelta lo que se
// ve impreso), espacios colapsados, con tope de largo.
// { ok: true, text } ("" si no vino) | { ok: false }
function cleanText(value, max) {
  if (value === undefined || value === null) return { ok: true, text: "" };
  if (typeof value !== "string") return { ok: false };
  const text = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u{0}-\u{1F}\u{7F}-\u{9F}\u{2028}\u{2029}]/gu, " ")
    .replace(/[\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2069}\u{FEFF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > max) return { ok: false };
  return { ok: true, text };
}

// Tipo de documento: acepta el nombre ("CUIT", "DNI"...) o el código de ARCA (80, 96...).
function normalizeDocType(value) {
  if (value === undefined || value === null || value === "") return "SIN_IDENTIFICAR";
  if (typeof value === "string" && DOC_TIPO[value.trim().toUpperCase()] !== undefined) return value.trim().toUpperCase();
  const n = Number(value);
  const key = Object.keys(DOC_TIPO).find((k) => DOC_TIPO[k] === n);
  return key || null;
}

// DNI: entre 6 y 8 dígitos (puede venir con puntos). null si no.
function cleanDni(value) {
  const d = digitsOnly(typeof value === "number" ? String(value) : value);
  if (!d) return null;
  const sinCeros = d.replace(/^0+/, "");
  if (sinCeros.length < 6 || sinCeros.length > 8) return null;
  return sinCeros;
}

/**
 * Valida el receptor para la letra elegida.
 *
 * @param {Object} input - { cbteClass: "A" | "B", ivaConditionId, docType, docNumber, name, address,
 *                           constanciaVerificada }
 * @param {Object} ctx   - { issuerCuit, totalCents, cfCapCents } — cfCapCents: tope para facturarle sin
 *                         documento al consumidor final (por defecto el de constants.js).
 * @returns {{ ok: true, receiver: { cbteClass, docTipo, docNro, ivaConditionId, ivaConditionDesc, name, address } }
 *         | { ok: false, errors: [{ code, field, message }] }}
 *   docNro: los dígitos, como texto ("0" sin identificar).
 */
function validateReceiver(input = {}, ctx = {}) {
  const errors = [];
  const cbteClass = input.cbteClass;
  if (cbteClass !== "A" && cbteClass !== "B") return { ok: false, errors: [error("CLASE_INVALIDA", "cbteClass")] };

  // Condición frente al IVA.
  const cond = Number(input.ivaConditionId);
  if (!Number.isInteger(cond) || !IVA_CONDITION_DESC[cond]) {
    errors.push(error("CONDICION_INVALIDA", "ivaConditionId"));
  } else if (cond === IVA_CONDITION.NO_CATEGORIZADO) {
    errors.push(error("NO_CATEGORIZADO_NO_SOPORTADO", "ivaConditionId"));
  } else if (!SUPPORTED_CONDITIONS_BY_CLASS[cbteClass].includes(cond)) {
    const otra = cbteClass === "A" ? "B" : "A";
    const vaConLaOtra = SUPPORTED_CONDITIONS_BY_CLASS[otra].includes(cond) && !CLASSES_BY_CONDITION[cond].includes(cbteClass);
    errors.push(error(vaConLaOtra ? "CONDICION_NO_VALIDA_PARA_CLASE" : "CONDICION_NO_SOPORTADA", "ivaConditionId"));
  }

  // Nombre y domicilio.
  const name = cleanText(input.name, MAX_NAME);
  const address = cleanText(input.address, MAX_ADDRESS);
  if (!name.ok) errors.push(error("TEXTO_INVALIDO", "name"));
  if (!address.ok) errors.push(error("TEXTO_INVALIDO", "address"));

  // Documento.
  const docType = normalizeDocType(input.docType);
  let docTipo = null;
  let docNro = null;
  if (!docType) {
    errors.push(error("TIPO_DOCUMENTO_INVALIDO", "docType"));
  } else if (docType === "CUIT") {
    const r = validateCuit(input.docNumber);
    if (r.ok) { docTipo = DOC_TIPO.CUIT; docNro = r.cuit; } else errors.push(error("CUIT_INVALIDO", "docNumber"));
  } else if (docType === "CUIL") {
    const r = validateCuil(input.docNumber);
    if (r.ok) { docTipo = DOC_TIPO.CUIL; docNro = r.cuit; } else errors.push(error("CUIL_INVALIDO", "docNumber"));
  } else if (docType === "DNI") {
    const dni = cleanDni(input.docNumber);
    if (dni) { docTipo = DOC_TIPO.DNI; docNro = dni; } else errors.push(error("DNI_INVALIDO", "docNumber"));
  } else {
    docTipo = DOC_TIPO.SIN_IDENTIFICAR;
    docNro = "0";
  }

  if (docNro === CUIT_NOT_CATEGORIZED) errors.push(error("NO_CATEGORIZADO_NO_SOPORTADO", "docNumber"));
  const issuer = digitsOnly(ctx.issuerCuit == null ? "" : String(ctx.issuerCuit));
  if (docNro && docNro !== "0" && issuer && docNro === issuer) errors.push(error("RECEPTOR_IGUAL_EMISOR", "docNumber"));

  // Reglas de cada letra.
  if (cbteClass === "A") {
    if (docType && docType !== "CUIT") errors.push(error("DOCUMENTO_DEBE_SER_CUIT", "docType"));
    if (name.ok && !name.text) errors.push(error("FALTA_RAZON_SOCIAL", "name"));
    if (address.ok && !address.text) errors.push(error("FALTA_DOMICILIO", "address"));
    if (input.constanciaVerificada !== true) errors.push(error("FALTA_CONSTANCIA", "constanciaVerificada"));
  } else if (cond === IVA_CONDITION.CONSUMIDOR_FINAL) {
    if (docTipo === DOC_TIPO.SIN_IDENTIFICAR) {
      const cap = Number.isFinite(ctx.cfCapCents) ? ctx.cfCapCents : CF_UNIDENTIFIED_CAP_CENTS;
      if (!Number.isFinite(ctx.totalCents) || ctx.totalCents < 0) errors.push(error("TOTAL_INVALIDO", "totalCents"));
      else if (ctx.totalCents >= cap) errors.push(error("DOCUMENTO_OBLIGATORIO", "docNumber"));
    }
  } else if (cond === IVA_CONDITION.EXENTO || cond === IVA_CONDITION.IVA_NO_ALCANZADO) {
    if (docType && docType !== "CUIT") errors.push(error("DOCUMENTO_DEBE_SER_CUIT", "docType"));
    if (name.ok && !name.text) errors.push(error("FALTA_RAZON_SOCIAL", "name"));
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    receiver: {
      cbteClass,
      docTipo,
      docNro,
      ivaConditionId: cond,
      ivaConditionDesc: IVA_CONDITION_DESC[cond],
      name: name.text || null,
      address: address.text || null,
    },
  };
}

// Letra sugerida según la condición frente al IVA del cliente: "A", "B" o null si el sistema no le
// factura a esa condición. Es una sugerencia: decide el admin.
function suggestClass(ivaConditionId) {
  const cond = Number(ivaConditionId);
  if (SUPPORTED_CONDITIONS_BY_CLASS.A.includes(cond)) return "A";
  if (SUPPORTED_CONDITIONS_BY_CLASS.B.includes(cond)) return "B";
  return null;
}

module.exports = { validateReceiver, suggestClass, cleanText, MESSAGES };

// Texto del código QR que lleva impreso cada factura electrónica.
//
// FUENTE: "Especificaciones del QR incluido en las facturas electrónicas", ARCA, versión 1 del formato:
//   https://www.arca.gob.ar/fe/qr/documentos/QRespecificaciones.pdf (enlazado desde
//   https://www.arca.gob.ar/fe/qr/, bajado el 11/11/2026).
//
// El QR codifica el texto {URL}?p={DATOS}, donde {URL} es https://www.arca.gob.ar/fe/qr/ y {DATOS} es un
// JSON con los datos del comprobante, en Base64. El ejemplo de ese mismo documento todavía usa la
// dirección vieja (www.afip.gob.ar); se usa la de la especificación. El JSON del ejemplo se reproduce
// byte por byte en test/arca-qr.test.js.
//
// El JSON se arma a mano, campo por campo y en el orden del documento, para que los números salgan
// exactamente como en el ejemplo ("importe":12100, "ctz":65): sin comillas, sin ceros de más y sin pasar
// por números de punto flotante.

const { validateCuit } = require("./cuit");

const QR_BASE_URL = "https://www.arca.gob.ar/fe/qr/";
const QR_VERSION = 1;

// Importe: hasta 13 enteros y 2 decimales.
const MAX_CENTS = 10n ** 15n - 1n;

// Centavos → número JSON sin ceros de más: 1210000 → "12100", 123450 → "1234.5", 123405 → "1234.05".
function amountJson(cents) {
  const c = BigInt(cents);
  const int = c / 100n;
  const dec = (c % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return dec ? `${int}.${dec}` : `${int}`;
}

// Dígitos → número JSON (sin ceros a la izquierda, que JSON no admite).
const digitsJson = (s) => s.replace(/^0+(?=\d)/, "");

// Cotización: hasta 13 enteros y 6 decimales; sin ceros de más ("1.000000" → "1").
function rateJson(value) {
  const s = typeof value === "number" ? String(value) : value;
  if (typeof s !== "string" || !/^\d{1,13}(\.\d{1,6})?$/.test(s)) return null;
  const [int, dec = ""] = s.split(".");
  const d = dec.replace(/0+$/, "");
  return d ? `${digitsJson(int)}.${d}` : digitsJson(int);
}

// "20201013" o "2020-10-13" → "2020-10-13", si es una fecha que existe.
function isoDate(value) {
  const m = typeof value === "string" && (/^(\d{4})(\d{2})(\d{2})$/.exec(value) || /^(\d{4})-(\d{2})-(\d{2})$/.exec(value));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const intIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/**
 * Arma el texto del QR de un comprobante autorizado.
 *
 * @param {Object} c
 *   cbteFch     "AAAAMMDD" (como lo devuelve ARCA) o "AAAA-MM-DD"
 *   cuit        CUIT del emisor
 *   ptoVta, cbteTipo, cbteNro  enteros
 *   importeCents  total del comprobante en centavos
 *   monId       "PES" por defecto; monCotiz "1" por defecto
 *   docTipo, docNro  documento del receptor tal como se mandó a ARCA ("de corresponder": si no viene
 *               docTipo, el JSON no lleva esos dos campos)
 *   codAut      CAE (14 dígitos); tipoCodAut "E" (CAE, por defecto) o "A" (CAEA)
 * @returns {{ ok: true, json, payload, url } | { ok: false, errors: string[] }}  errors: campos inválidos.
 */
function buildQr(c = {}) {
  const errors = [];
  const fecha = isoDate(c.cbteFch);
  if (!fecha) errors.push("cbteFch");
  const cuit = validateCuit(c.cuit);
  if (!cuit.ok) errors.push("cuit");
  if (!intIn(c.ptoVta, 1, 99999)) errors.push("ptoVta");
  if (!intIn(c.cbteTipo, 1, 999)) errors.push("cbteTipo");
  if (!intIn(c.cbteNro, 1, 99999999)) errors.push("cbteNro");
  if (!Number.isSafeInteger(c.importeCents) || c.importeCents < 0 || BigInt(c.importeCents) > MAX_CENTS) errors.push("importeCents");
  const monId = c.monId ?? "PES";
  if (typeof monId !== "string" || !/^[A-Z0-9]{3}$/.test(monId)) errors.push("monId");
  const ctz = rateJson(c.monCotiz ?? "1");
  if (!ctz) errors.push("monCotiz");
  const conDoc = c.docTipo !== undefined && c.docTipo !== null;
  const docNro = conDoc ? (typeof c.docNro === "number" ? String(c.docNro) : c.docNro) : null;
  if (conDoc) {
    if (!intIn(c.docTipo, 1, 99)) errors.push("docTipo");
    if (typeof docNro !== "string" || !/^\d{1,20}$/.test(docNro)) errors.push("docNro");
  }
  const tipoCodAut = c.tipoCodAut ?? "E";
  if (tipoCodAut !== "E" && tipoCodAut !== "A") errors.push("tipoCodAut");
  if (typeof c.codAut !== "string" || !/^\d{14}$/.test(c.codAut)) errors.push("codAut");
  if (errors.length) return { ok: false, errors };

  const fields = [
    `"ver":${QR_VERSION}`,
    `"fecha":"${fecha}"`,
    `"cuit":${digitsJson(cuit.cuit)}`,
    `"ptoVta":${c.ptoVta}`,
    `"tipoCmp":${c.cbteTipo}`,
    `"nroCmp":${c.cbteNro}`,
    `"importe":${amountJson(c.importeCents)}`,
    `"moneda":"${monId}"`,
    `"ctz":${ctz}`,
    ...(conDoc ? [`"tipoDocRec":${c.docTipo}`, `"nroDocRec":${digitsJson(docNro)}`] : []),
    `"tipoCodAut":"${tipoCodAut}"`,
    `"codAut":${digitsJson(c.codAut)}`,
  ];
  const json = `{${fields.join(",")}}`;
  const payload = Buffer.from(json, "utf8").toString("base64");
  return { ok: true, json, payload, url: `${QR_BASE_URL}?p=${payload}` };
}

module.exports = { buildQr, QR_BASE_URL, QR_VERSION, amountJson };

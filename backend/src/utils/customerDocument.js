// Documento del cliente que se carga en el checkout (DNI, CUIT o CUIL). Hasta ahora el checkout lo
// pedía como obligatorio pero no lo mandaba al servidor: se perdía, y para facturar había que
// pedírselo de nuevo al cliente. Ahora viaja con el pedido y se guarda normalizado (solo números).
//
// Reglas: DNI de 6 a 9 números (hay DNI viejos de 6 o 7 y de extranjeros de 8 o 9); CUIT y CUIL de 11
// con el dígito verificador correcto (services/arca/cuit.js). Sin número: no se guarda nada (los
// pedidos de antes y las ventas cargadas a mano no lo traen).
const { validateCuit, validateCuil, digitsOnly } = require("../services/arca/cuit");

const TYPES = new Set(["DNI", "CUIT", "CUIL"]);

/**
 * @returns {{ok:true, empty:true} | {ok:true, type:string, number:string} | {ok:false, error:string}}
 */
function normalizeDocument(type, number) {
  if (number == null || (typeof number === "string" && !number.trim())) return { ok: true, empty: true };
  const t = String(type ?? "").trim().toUpperCase();
  if (!TYPES.has(t)) return { ok: false, error: "Elegí el tipo de documento (DNI, CUIT o CUIL)" };
  if (typeof number !== "string" && typeof number !== "number") return { ok: false, error: "Número de documento inválido" };
  const digits = digitsOnly(String(number));
  if (!digits) return { ok: false, error: "El documento lleva solo números" };
  if (t === "DNI") {
    if (!/^\d{6,9}$/.test(digits)) return { ok: false, error: "El DNI tiene que tener entre 7 y 8 números" };
    return { ok: true, type: t, number: String(parseInt(digits, 10)) };
  }
  const r = t === "CUIT" ? validateCuit(digits) : validateCuil(digits);
  if (!r.ok) return { ok: false, error: `Revisá el ${t}: tiene que tener 11 números y el último tiene que coincidir` };
  return { ok: true, type: t, number: r.cuit };
}

module.exports = { normalizeDocument };

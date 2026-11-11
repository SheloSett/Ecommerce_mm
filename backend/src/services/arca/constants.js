// Códigos de ARCA que usa el sistema para facturar (web service WSFEv1, factura electrónica con CAE).
//
// FUENTE de todos los códigos de este archivo, salvo donde se indica otra:
//   "Manuales para el desarrollador – Facturación – RG 4291 – Proyecto FE v4.7", ARCA-SDG SIT,
//   revisión del 1 de septiembre de 2026.
//   https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf
//
// Van escritos acá y no se toman de las tablas de ARCA (FEParamGet*) porque ARCA entrega código y
// descripción pero no el significado, y sus tablas traen mucho más de lo que este sistema sabe emitir.
// El diagnóstico (paso posterior) baja esas tablas y avisa si alguno de estos códigos falta o venció.
//
// La tienda es UN solo CUIT responsable inscripto: emite facturas A y B y sus notas de crédito.
// La clase C es de monotributistas y no aplica.

// ── Tipos de comprobante (CbteTipo) ───────────────────────────────────────────
// Manual, validación 700 (FECAEARegInformativo): "1: Factura A, 2: Nota de Débito A, 3: Nota de Crédito
// A, ... 6: Factura B, 7: Nota de Débito B, 8: Nota de Crédito B". La validación 10007 los agrupa por
// clase (01..03 clase A, 06..08 clase B).
const CBTE_TIPO = Object.freeze({
  FACTURA_A: 1,
  NOTA_CREDITO_A: 3,
  FACTURA_B: 6,
  NOTA_CREDITO_B: 8,
});

// Clase (letra) de cada tipo que se emite.
const CLASS_OF_TYPE = Object.freeze({ 1: "A", 3: "A", 6: "B", 8: "B" });

// Factura → su nota de crédito. Manual, validación 10040: a una 03 se le asocian comprobantes 01..; a una
// 08, comprobantes 06...
const CREDIT_NOTE_FOR = Object.freeze({ 1: 3, 6: 8 });

// Tipo de factura según la clase elegida.
const INVOICE_TYPE_FOR_CLASS = Object.freeze({ A: 1, B: 6 });

const isInvoiceType = (tipo) => tipo === CBTE_TIPO.FACTURA_A || tipo === CBTE_TIPO.FACTURA_B;
const isCreditNoteType = (tipo) => tipo === CBTE_TIPO.NOTA_CREDITO_A || tipo === CBTE_TIPO.NOTA_CREDITO_B;

// ── Tipos de documento del receptor (DocTipo) ─────────────────────────────────
// Manual, validación 10115: "80, 86, 87, 96 (CUIT, CUIL, CDI, DNI respectivamente)".
// 99 = receptor sin identificar, con DocNro 0 (validación 10015: factura B a consumidor final por debajo
// del monto que obliga a identificarlo). La clase A exige 80 (validación 10013).
const DOC_TIPO = Object.freeze({
  CUIT: 80,
  CUIL: 86,
  DNI: 96,
  SIN_IDENTIFICAR: 99,
});

// CUIT genérico de "No Categorizado" (validaciones 10015, 10067 y 10283): ARCA lo acepta solo con la
// percepción de IVA de la RG 2126/2006, que este sistema no calcula. receiver.js lo rechaza.
const CUIT_NOT_CATEGORIZED = "23000000000";

// ── Alícuotas de IVA (Id de AlicIva) ──────────────────────────────────────────
// Manual, ejemplo 1 de FECAESolicitar: "<Id>5</Id> 21%" y "<Id>4</Id> 10.5%". Validación 10018: Id 3 es
// "iva 0". perMille = la alícuota en milésimos, para hacer las cuentas con enteros (21 % = 210/1000).
const IVA_RATES = Object.freeze([
  Object.freeze({ id: 5, pct: 21, perMille: 210 }),
  Object.freeze({ id: 4, pct: 10.5, perMille: 105 }),
]);
const IVA_ID_ZERO = 3;

// Alícuota a partir del porcentaje guardado en el producto (Product.ivaRate: 21 o 10.5) o elegido en el
// panel ("10,5" también vale). null si no es una de las que emite el sistema.
function rateFromPct(pct) {
  const n = typeof pct === "string" && pct.trim() !== "" ? Number(pct.trim().replace(",", ".")) : pct;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return IVA_RATES.find((r) => r.pct === n) || null;
}

// ── Concepto, moneda ──────────────────────────────────────────────────────────
// Concepto: campo <Concepto>, "1 Productos, 2 Servicios, 3 Productos y Servicios". Con 1 no hacen falta
// las fechas de servicio (validación 10049). La tienda vende productos; el envío va como un renglón más.
const CONCEPT = Object.freeze({ PRODUCTOS: 1 });

// Moneda: "PES" con cotización 1 (validación 10039: MonCotiz igual a 1 cuando MonId = PES). Con PES el
// campo CanMisMonExt no se informa (validación 10241).
const CURRENCY_PESOS = "PES";
const PESOS_EXCHANGE_RATE = 1;

// ── Condición frente al IVA del receptor (CondicionIVAReceptorId) ─────────────
// Manual, tabla "Condición Frente al IVA del receptor" (última página) y método
// FEParamGetCondicionIvaReceptor. Obligatoria según la RG 5616 (validaciones 10242, 10243, 10246): se
// manda siempre.
const IVA_CONDITION = Object.freeze({
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTO: 6,
  NO_CATEGORIZADO: 7,
  PROVEEDOR_EXTERIOR: 8,
  CLIENTE_EXTERIOR: 9,
  IVA_LIBERADO: 10,
  MONOTRIBUTISTA_SOCIAL: 13,
  IVA_NO_ALCANZADO: 15,
  MONOTRIBUTO_TRABAJADOR_PROMOVIDO: 16,
});

// Descripciones de la misma tabla, por si ARCA no está disponible para traerlas.
const IVA_CONDITION_DESC = Object.freeze({
  1: "IVA Responsable Inscripto",
  4: "IVA Sujeto Exento",
  5: "Consumidor Final",
  6: "Responsable Monotributo",
  7: "Sujeto No Categorizado",
  8: "Proveedor del Exterior",
  9: "Cliente del Exterior",
  10: "IVA Liberado – Ley N° 19.640",
  13: "Monotributista Social",
  15: "IVA No Alcanzado",
  16: "Monotributo Trabajador Independiente Promovido",
});

// Qué clases admite ARCA para cada condición (misma tabla; "49" es bienes usados).
const CLASSES_BY_CONDITION = Object.freeze({
  1: Object.freeze(["A", "C"]),
  4: Object.freeze(["B", "C"]),
  5: Object.freeze(["B", "C", "49"]),
  6: Object.freeze(["A", "C"]),
  7: Object.freeze(["B", "C"]),
  8: Object.freeze(["B", "C"]),
  9: Object.freeze(["B", "C"]),
  10: Object.freeze(["B", "C"]),
  13: Object.freeze(["A", "C"]),
  15: Object.freeze(["B", "C"]),
  16: Object.freeze(["A", "C"]),
});

// Lo que emite ESTA tienda, un subconjunto de la tabla de arriba:
// - A: responsable inscripto y las tres variantes de monotributo (desde la RG 5003 un responsable
//   inscripto le factura A al monotributista).
// - B: consumidor final, exento e IVA no alcanzado.
// Quedan afuera a propósito: no categorizado (exige percepción de IVA), exterior (va con factura E, otro
// web service) e IVA liberado de Tierra del Fuego. Para sumar una, que lo confirme el contador.
const SUPPORTED_CONDITIONS_BY_CLASS = Object.freeze({
  A: Object.freeze([1, 6, 13, 16]),
  B: Object.freeze([5, 4, 15]),
});

// ── Monto que obliga a identificar al consumidor final ────────────────────────
// Por debajo, una factura B a consumidor final puede ir sin documento (DocTipo 99, DocNro 0; validación
// 10015). El manual remite al monto vigente sin decir cuál es. $10.000.000 es el de la RG 5700/2025
// según lo publicado (no lo verifiqué en el Boletín Oficial): es el valor por defecto y la configuración
// fiscal lo puede cambiar. Que lo confirme el contador.
const CF_UNIDENTIFIED_CAP_CENTS = 10000000 * 100;

// ── Direcciones y espacio de nombres del web service ──────────────────────────
// Manual, "Dirección URL".
const WSFE_URL = Object.freeze({
  HOMOLOGACION: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  PRODUCCION: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
});
const WSFE_NAMESPACE = "http://ar.gov.afip.dif.FEV1/";

// ── Códigos de error que el sistema mira ──────────────────────────────────────
// Manual, "Tratamiento de errores en el WS": 602 = "No existen datos en nuestros registros". Es lo que se
// espera de FECompConsultar con un comprobante que no existe; se confirma en homologación.
const ERROR_NO_DATA = 602;

module.exports = {
  CBTE_TIPO,
  CLASS_OF_TYPE,
  CREDIT_NOTE_FOR,
  INVOICE_TYPE_FOR_CLASS,
  isInvoiceType,
  isCreditNoteType,
  DOC_TIPO,
  CUIT_NOT_CATEGORIZED,
  IVA_RATES,
  IVA_ID_ZERO,
  rateFromPct,
  CONCEPT,
  CURRENCY_PESOS,
  PESOS_EXCHANGE_RATE,
  IVA_CONDITION,
  IVA_CONDITION_DESC,
  CLASSES_BY_CONDITION,
  SUPPORTED_CONDITIONS_BY_CLASS,
  CF_UNIDENTIFIED_CAP_CENTS,
  WSFE_URL,
  WSFE_NAMESPACE,
  ERROR_NO_DATA,
};

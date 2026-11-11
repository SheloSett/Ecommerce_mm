// XML de los web services de ARCA: escapado de lo que va dentro de un sobre SOAP y un lector chico de
// las respuestas. Sin librerías de XML: lo que se necesita es poco y así se controla todo.
//
// SEGURIDAD (el pedido del dueño):
// - Todo texto que entra a un sobre pasa por escapeXml: no puede abrir ni cerrar etiquetas.
// - El lector rechaza DOCTYPE y ENTITY (no hay entidades externas ni expansiones del tipo "billion
//   laughs"), tiene tope de tamaño, de profundidad y de cantidad de nodos, y es estricto: una etiqueta
//   mal cerrada es un error, no se adivina.
// - Si en vez de XML llega una página HTML (ARCA en mantenimiento), lo dice con su propio código.
//
// Las respuestas pueden venir en SOAP 1.1 o 1.2 y con cualquier prefijo de espacio de nombres
// ("soap:", "s:", ninguno): se compara siempre por el nombre local.
//
// Formato de las respuestas: manual del desarrollador WSFEv1 v4.7 (revisión del 1/9/2026). Donde el
// manual se contradice (FEDetResponse en la tabla y FECAEDetResponse en los ejemplos; <Obs> dentro de
// <Observaciones> o al revés) se aceptan las dos formas.

const { divRoundHalfEven } = require("./amounts");
const { ERROR_NO_DATA } = require("./constants");

const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 100000;

const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

// ── Escapado ──────────────────────────────────────────────────────────────────

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
// Caracteres que XML 1.0 no admite: controles (salvo tabulación, salto de línea y retorno), mitades
// sueltas de pares sustitutos, FFFE y FFFF. Se sacan en vez de mandarlos.
const INVALID_XML_CHARS = /[\u{0}-\u{8}\u{B}\u{C}\u{E}-\u{1F}\u{D800}-\u{DFFF}\u{FFFE}\u{FFFF}]/gu;

// Texto listo para ir entre etiquetas o en un atributo. null/undefined → "".
function escapeXml(value) {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  return s.replace(INVALID_XML_CHARS, "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

// <ar:Nombre>valor escapado</ar:Nombre>. null si el nombre no es un nombre de etiqueta válido (nunca se
// arma una etiqueta con un nombre que venga de afuera).
function xmlElement(name, value, prefix = "ar") {
  if (typeof name !== "string" || !NAME_RE.test(name)) return null;
  if (prefix !== null && (typeof prefix !== "string" || !NAME_RE.test(prefix))) return null;
  const q = prefix ? `${prefix}:${name}` : name;
  return `<${q}>${escapeXml(value)}</${q}>`;
}

// ── Lector ────────────────────────────────────────────────────────────────────

// Un carácter que XML admite, a partir de su código (para &#...;). null si no.
function xmlChar(cp) {
  const okCp = cp === 0x9 || cp === 0xA || cp === 0xD || (cp >= 0x20 && cp <= 0xD7FF)
    || (cp >= 0xE000 && cp <= 0xFFFD) || (cp >= 0x10000 && cp <= 0x10FFFF);
  return okCp ? String.fromCodePoint(cp) : null;
}

// &lt; &gt; &amp; &quot; &apos; &#N; &#xH;. Cualquier otra referencia es un error (sin DOCTYPE no puede
// haber entidades propias). null si algo está mal.
function decodeEntities(s) {
  let out = "";
  let i = 0;
  for (;;) {
    const amp = s.indexOf("&", i);
    if (amp < 0) return out + s.slice(i);
    out += s.slice(i, amp);
    const semi = s.indexOf(";", amp + 1);
    if (semi < 0 || semi - amp > 12) return null;
    const body = s.slice(amp + 1, semi);
    let ch = null;
    if (body === "lt") ch = "<";
    else if (body === "gt") ch = ">";
    else if (body === "amp") ch = "&";
    else if (body === "quot") ch = '"';
    else if (body === "apos") ch = "'";
    else if (/^#[0-9]{1,7}$/.test(body)) ch = xmlChar(Number(body.slice(1)));
    else if (/^#x[0-9A-Fa-f]{1,6}$/.test(body)) ch = xmlChar(parseInt(body.slice(2), 16));
    if (ch === null) return null;
    out += ch;
    i = semi + 1;
  }
}

const QNAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;
const CONTROL_RE = /[\u{0}-\u{8}\u{B}\u{C}\u{E}-\u{1F}]/u;

function makeNode(qname, attrs) {
  const colon = qname.indexOf(":");
  return {
    name: qname,
    prefix: colon >= 0 ? qname.slice(0, colon) : null,
    local: colon >= 0 ? qname.slice(colon + 1) : qname,
    attrs,
    children: [],
    text: "",
  };
}

// Lee una etiqueta de apertura que empieza en `lt`. { qname, attrs, selfClose, end } o null.
function readOpenTag(text, lt) {
  let i = lt + 1;
  const nameMatch = /^[^\s/>]+/.exec(text.slice(i, i + 256));
  if (!nameMatch || !QNAME_RE.test(nameMatch[0])) return null;
  const qname = nameMatch[0];
  i += qname.length;
  const attrs = {};
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) return null;
    if (text[i] === ">") return { qname, attrs, selfClose: false, end: i };
    if (text.startsWith("/>", i)) return { qname, attrs, selfClose: true, end: i + 1 };
    const attrMatch = /^[^\s=/>]+/.exec(text.slice(i, i + 256));
    if (!attrMatch || !QNAME_RE.test(attrMatch[0])) return null;
    const attrName = attrMatch[0];
    i += attrName.length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== "=") return null;
    i++;
    while (i < text.length && /\s/.test(text[i])) i++;
    const quote = text[i];
    if (quote !== '"' && quote !== "'") return null;
    const close = text.indexOf(quote, i + 1);
    if (close < 0) return null;
    const raw = text.slice(i + 1, close);
    if (raw.includes("<")) return null;
    const value = decodeEntities(raw);
    if (value === null || Object.prototype.hasOwnProperty.call(attrs, attrName)) return null;
    attrs[attrName] = value;
    i = close + 1;
  }
}

// Lo que tiene pinta de página HTML (el aviso de mantenimiento de ARCA) en vez de una respuesta SOAP:
// después de la declaración y los comentarios del principio, empieza con <!doctype html o <html.
// Se recorre a mano y no con una sola expresión regular, que con muchos comentarios seguidos puede
// tardar muchísimo en decir que no.
function looksLikeHtml(text) {
  let i = 0;
  const skipSpace = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  skipSpace();
  if (text.startsWith("<?xml", i)) {
    const end = text.indexOf("?>", i);
    if (end < 0) return false;
    i = end + 2;
    skipSpace();
  }
  while (text.startsWith("<!--", i)) {
    const end = text.indexOf("-->", i + 4);
    if (end < 0) return false;
    i = end + 3;
    skipSpace();
  }
  return /^(?:<!doctype\s+html|<html[\s>])/i.test(text.slice(i, i + 20));
}

/**
 * Lee un documento XML. Estricto y con topes.
 * @returns {{ ok: true, root } | { ok: false, error }}
 *   root: { name, prefix, local, attrs, children: [...], text }
 *   error: VACIO | DEMASIADO_GRANDE | HTML_EN_VEZ_DE_XML | DOCTYPE_NO_PERMITIDO | ENTIDAD_NO_PERMITIDA |
 *          DEMASIADO_PROFUNDO | XML_MAL_FORMADO
 */
function parseXml(input, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  let text;
  if (Buffer.isBuffer(input)) {
    if (input.length > maxBytes) return fail("DEMASIADO_GRANDE");
    text = input.toString("utf8");
  } else if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > maxBytes) return fail("DEMASIADO_GRANDE");
    text = input;
  } else {
    return fail("VACIO");
  }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (!text.trim()) return fail("VACIO");
  if (looksLikeHtml(text)) return fail("HTML_EN_VEZ_DE_XML");
  if (/<!DOCTYPE/i.test(text)) return fail("DOCTYPE_NO_PERMITIDO");
  if (/<!ENTITY/i.test(text)) return fail("ENTIDAD_NO_PERMITIDA");

  const doc = makeNode("#document", {});
  const stack = [doc];
  let nodes = 0;
  let i = 0;
  const bad = () => fail("XML_MAL_FORMADO");

  while (i < text.length) {
    const lt = text.indexOf("<", i);
    const segment = text.slice(i, lt < 0 ? text.length : lt);
    if (segment) {
      const top = stack[stack.length - 1];
      if (top === doc) {
        if (segment.trim()) return bad(); // texto fuera del elemento raíz
      } else {
        if (CONTROL_RE.test(segment)) return bad();
        const decoded = decodeEntities(segment);
        if (decoded === null) return bad();
        top.text += decoded;
      }
    }
    if (lt < 0) break;

    if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt + 2);
      if (end < 0) return bad();
      i = end + 2;
    } else if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end < 0) return bad();
      i = end + 3;
    } else if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      if (end < 0 || stack.length === 1) return bad();
      stack[stack.length - 1].text += text.slice(lt + 9, end);
      i = end + 3;
    } else if (text.startsWith("<!", lt)) {
      return bad();
    } else if (text.startsWith("</", lt)) {
      const end = text.indexOf(">", lt + 2);
      if (end < 0) return bad();
      const qname = text.slice(lt + 2, end).trim();
      const top = stack[stack.length - 1];
      if (top === doc || top.name !== qname) return bad();
      stack.pop();
      i = end + 1;
    } else {
      const tag = readOpenTag(text, lt);
      if (!tag) return bad();
      if (stack.length === 1 && doc.children.length) return bad(); // dos elementos raíz
      if (stack.length > MAX_DEPTH) return fail("DEMASIADO_PROFUNDO");
      if (++nodes > MAX_NODES) return fail("DEMASIADO_GRANDE");
      const node = makeNode(tag.qname, tag.attrs);
      stack[stack.length - 1].children.push(node);
      if (!tag.selfClose) stack.push(node);
      i = tag.end + 1;
    }
  }
  if (stack.length !== 1 || doc.children.length !== 1) return bad();
  return { ok: true, root: doc.children[0] };
}

// ── Recorrer el árbol ─────────────────────────────────────────────────────────

const child = (node, local) => (node ? node.children.find((c) => c.local === local) || null : null);
const childrenNamed = (node, local) => (node ? node.children.filter((c) => c.local === local) : []);
const textOf = (node, local) => { const c = child(node, local); return c ? c.text.trim() : null; };

function toInt(s) {
  if (s === null || s === undefined) return null;
  return /^-?\d+$/.test(s) ? Number(s) : null;
}

// Importe de una respuesta ("184.05", "150", "7.8") → centavos. null si no se puede leer.
function decimalToCents(s) {
  if (s === null || s === undefined) return null;
  const m = /^(-?)(\d{1,15})(?:\.(\d{1,10}))?$/.exec(String(s).trim());
  if (!m) return null;
  const frac = m[3] || "";
  const scaled = BigInt(m[2] + frac) * 100n;
  const cents = divRoundHalfEven(scaled, 10n ** BigInt(frac.length));
  return Number(m[1] === "-" ? -cents : cents) || 0;
}

// Un elemento con hojas → { hoja: "texto" }.
function toRecord(node) {
  const out = {};
  for (const c of node.children) out[c.local] = c.children.length ? toRecord(c) : c.text.trim();
  return out;
}

const codeMsgList = (container, itemLocal) =>
  childrenNamed(container, itemLocal).map((n) => ({ code: toInt(textOf(n, "Code")), msg: textOf(n, "Msg") ?? "" }));

function readObservations(node) {
  return [
    ...codeMsgList(child(node, "Observaciones"), "Obs"),
    ...codeMsgList(child(node, "Obs"), "Observaciones"),
  ];
}

// Sobre → resultado del método. { ok: true, result } o un error (incluido el SOAP Fault).
function readEnvelope(input, method, opts) {
  const parsed = parseXml(input, opts);
  if (!parsed.ok) return parsed;
  const root = parsed.root;
  if (root.local.toLowerCase() === "html") return fail("HTML_EN_VEZ_DE_XML");
  const body = root.local === "Envelope" ? child(root, "Body") : null;
  if (!body) return fail("RESPUESTA_INESPERADA");
  const fault = child(body, "Fault");
  if (fault) {
    // SOAP 1.1: faultcode / faultstring. SOAP 1.2: Code/Value / Reason/Text.
    const code = textOf(fault, "faultcode") ?? textOf(child(fault, "Code"), "Value");
    const message = textOf(fault, "faultstring") ?? textOf(child(fault, "Reason"), "Text");
    return fail("SOAP_FAULT", { fault: { code: code ?? null, message: message ?? null } });
  }
  const result = child(child(body, `${method}Response`), `${method}Result`);
  if (!result) return fail("RESPUESTA_INESPERADA");
  return { ok: true, result };
}

const common = (result) => ({
  errors: codeMsgList(child(result, "Errors"), "Err"),
  events: codeMsgList(child(result, "Events"), "Evt"),
});

// ── Lectores por método ───────────────────────────────────────────────────────

// FECAESolicitar: cabecera, un detalle por comprobante (con CAE u observaciones), errores y eventos.
// ok: true quiere decir "llegó una respuesta de ARCA bien formada"; si aprobó o no lo dice `resultado`.
function readFECAESolicitar(input, opts) {
  const env = readEnvelope(input, "FECAESolicitar", opts);
  if (!env.ok) return env;
  const r = env.result;
  const cab = child(r, "FeCabResp");
  const detResp = child(r, "FeDetResp");
  const dets = [...childrenNamed(detResp, "FECAEDetResponse"), ...childrenNamed(detResp, "FEDetResponse")];
  return {
    ok: true,
    cab: cab ? {
      cuit: textOf(cab, "Cuit"),
      ptoVta: toInt(textOf(cab, "PtoVta")),
      cbteTipo: toInt(textOf(cab, "CbteTipo")),
      fchProceso: textOf(cab, "FchProceso"),
      cantReg: toInt(textOf(cab, "CantReg")),
      resultado: textOf(cab, "Resultado"),
      reproceso: textOf(cab, "Reproceso"),
    } : null,
    det: dets.map((d) => ({
      concepto: toInt(textOf(d, "Concepto")),
      docTipo: toInt(textOf(d, "DocTipo")),
      docNro: textOf(d, "DocNro"),
      cbteDesde: toInt(textOf(d, "CbteDesde")),
      cbteHasta: toInt(textOf(d, "CbteHasta")),
      cbteFch: textOf(d, "CbteFch"),
      resultado: textOf(d, "Resultado"),
      cae: textOf(d, "CAE") || null,
      caeFchVto: textOf(d, "CAEFchVto") || null,
      observaciones: readObservations(d),
    })),
    ...common(r),
  };
}

// FECompUltimoAutorizado: el último número autorizado para un punto de venta y tipo.
function readFECompUltimoAutorizado(input, opts) {
  const env = readEnvelope(input, "FECompUltimoAutorizado", opts);
  if (!env.ok) return env;
  const r = env.result;
  return {
    ok: true,
    ptoVta: toInt(textOf(r, "PtoVta")),
    cbteTipo: toInt(textOf(r, "CbteTipo")),
    cbteNro: toInt(textOf(r, "CbteNro")),
    ...common(r),
  };
}

// FECompConsultar: los datos de un comprobante ya emitido, para reconciliar una emisión que quedó
// "a confirmar". notFound: ARCA dice que no existe (código 602, a confirmar en homologación).
function readFECompConsultar(input, opts) {
  const env = readEnvelope(input, "FECompConsultar", opts);
  if (!env.ok) return env;
  const r = env.result;
  const rg = child(r, "ResultGet");
  const base = common(r);
  if (!rg) {
    return { ok: true, found: false, notFound: base.errors.some((e) => e.code === ERROR_NO_DATA), comprobante: null, ...base };
  }
  const cents = (local) => decimalToCents(textOf(rg, local));
  return {
    ok: true,
    found: true,
    notFound: false,
    comprobante: {
      concepto: toInt(textOf(rg, "Concepto")),
      docTipo: toInt(textOf(rg, "DocTipo")),
      docNro: textOf(rg, "DocNro"),
      cbteDesde: toInt(textOf(rg, "CbteDesde")),
      cbteHasta: toInt(textOf(rg, "CbteHasta")),
      cbteFch: textOf(rg, "CbteFch"),
      impTotalCents: cents("ImpTotal"),
      impTotConcCents: cents("ImpTotConc"),
      impNetoCents: cents("ImpNeto"),
      impOpExCents: cents("ImpOpEx"),
      impTribCents: cents("ImpTrib"),
      impIvaCents: cents("ImpIVA"),
      monId: textOf(rg, "MonId"),
      monCotiz: textOf(rg, "MonCotiz"),
      condicionIvaReceptorId: toInt(textOf(rg, "CondicionIVAReceptorId")),
      iva: childrenNamed(child(rg, "Iva"), "AlicIva").map((a) => ({
        id: toInt(textOf(a, "Id")),
        baseImpCents: decimalToCents(textOf(a, "BaseImp")),
        importeCents: decimalToCents(textOf(a, "Importe")),
      })),
      cbtesAsoc: childrenNamed(child(rg, "CbtesAsoc"), "CbteAsoc").map((a) => ({
        tipo: toInt(textOf(a, "Tipo")),
        ptoVta: toInt(textOf(a, "PtoVta")),
        nro: toInt(textOf(a, "Nro")),
      })),
      resultado: textOf(rg, "Resultado"),
      codAutorizacion: textOf(rg, "CodAutorizacion"),
      emisionTipo: textOf(rg, "EmisionTipo"),
      fchVto: textOf(rg, "FchVto"),
      fchProceso: textOf(rg, "FchProceso"),
      ptoVta: toInt(textOf(rg, "PtoVta")),
      cbteTipo: toInt(textOf(rg, "CbteTipo")),
      observaciones: readObservations(rg),
    },
    ...base,
  };
}

// FEParamGet*: tablas de referencia. items: una fila por elemento de ResultGet (CbteTipo, DocTipo,
// IvaTipo, PtoVenta, CondicionIvaReceptor...), con sus campos como texto. record: cuando ResultGet trae
// los campos sueltos (FEParamGetCotizacion).
function readFEParamGet(input, method, opts) {
  if (typeof method !== "string" || !/^FEParamGet[A-Za-z]+$/.test(method)) return fail("METODO_DESCONOCIDO");
  const env = readEnvelope(input, method, opts);
  if (!env.ok) return env;
  const r = env.result;
  const rg = child(r, "ResultGet");
  const rows = rg ? rg.children : [];
  const isList = rows.length > 0 && rows.every((c) => c.children.length > 0);
  return {
    ok: true,
    items: isList ? rows.map(toRecord) : [],
    record: rg && !isList ? toRecord(rg) : null,
    ...common(r),
  };
}

// FEDummy: estado de los servidores de ARCA ("OK" cada uno).
function readFEDummy(input, opts) {
  const env = readEnvelope(input, "FEDummy", opts);
  if (!env.ok) return env;
  const r = env.result;
  return { ok: true, appServer: textOf(r, "AppServer"), dbServer: textOf(r, "DbServer"), authServer: textOf(r, "AuthServer") };
}

// Lector según el método.
function readResponse(input, method, opts) {
  switch (method) {
    case "FECAESolicitar": return readFECAESolicitar(input, opts);
    case "FECompUltimoAutorizado": return readFECompUltimoAutorizado(input, opts);
    case "FECompConsultar": return readFECompConsultar(input, opts);
    case "FEDummy": return readFEDummy(input, opts);
    default: return readFEParamGet(input, method, opts);
  }
}

module.exports = {
  escapeXml,
  xmlElement,
  parseXml,
  readResponse,
  readFECAESolicitar,
  readFECompUltimoAutorizado,
  readFECompConsultar,
  readFEParamGet,
  readFEDummy,
  decimalToCents,
  DEFAULT_MAX_BYTES,
};

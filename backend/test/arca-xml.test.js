// Tests del XML de ARCA (services/arca/xml.js): escapado de lo que entra a un sobre SOAP y lector de las
// respuestas. Funciones puras. Correr con: npm test
//
// Las respuestas de test/fixtures/arca/ siguen los ejemplos del manual WSFEv1 v4.7, con los datos
// reemplazados por los de ejemplo de ARCA (CUIT 30000000007 y 20000000001): el repo es público.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  escapeXml, xmlElement, parseXml, readResponse, readFECAESolicitar, readFECompUltimoAutorizado,
  readFECompConsultar, readFEParamGet, readFEDummy, decimalToCents,
} = require("../src/services/arca/xml");

const FIXTURES = path.join(__dirname, "fixtures", "arca");
// Con saltos de línea \n aunque git los haya pasado a \r\n en Windows.
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8").replace(/\r\n/g, "\n");
const ch = (code) => String.fromCodePoint(code);

describe("escapado", () => {
  test("los cinco caracteres especiales de XML", () => {
    assert.equal(escapeXml(`a<b>&"c'`), "a&lt;b&gt;&amp;&quot;c&apos;");
  });

  test("saca los caracteres que XML no admite y deja el resto (acentos, emojis)", () => {
    assert.equal(escapeXml(`a${ch(0)}b${ch(0x1b)}c${ch(0xfffe)}d`), "abcd");
    assert.equal(escapeXml(`x${String.fromCharCode(0xd800)}y`), "xy"); // mitad suelta de un par
    assert.equal(escapeXml(`Peña ${ch(0x1f600)}\ttab\nlinea`), `Peña ${ch(0x1f600)}\ttab\nlinea`);
  });

  test("null y undefined son vacío; los números se escriben", () => {
    assert.equal(escapeXml(null), "");
    assert.equal(escapeXml(undefined), "");
    assert.equal(escapeXml(184.05), "184.05");
  });

  test("xmlElement escapa el valor y no arma etiquetas con nombres raros", () => {
    assert.equal(xmlElement("DocNro", "20000000001"), "<ar:DocNro>20000000001</ar:DocNro>");
    assert.equal(xmlElement("Desc", "A & B", null), "<Desc>A &amp; B</Desc>");
    for (const bad of ["", "a b", "x><y", "1abc", "a:b", null]) assert.equal(xmlElement(bad, "v"), null, String(bad));
    assert.equal(xmlElement("Desc", "v", "a b"), null);
  });

  test("un valor que intenta cerrar la etiqueta y meter otra queda como texto", () => {
    const ataque = "</ar:DocNro><ar:ImpTotal>0</ar:ImpTotal><ar:DocNro>";
    const sobre = `<ar:FECAEDetRequest xmlns:ar="x">${xmlElement("DocNro", ataque)}</ar:FECAEDetRequest>`;
    const r = parseXml(sobre);
    assert.equal(r.ok, true);
    assert.equal(r.root.children.length, 1);
    assert.equal(r.root.children[0].local, "DocNro");
    assert.equal(r.root.children[0].text, ataque);
  });
});

describe("lector de XML", () => {
  test("elementos, atributos, prefijos, entidades, CDATA, comentarios y BOM", () => {
    const r = parseXml(`${ch(0xfeff)}<?xml version="1.0"?><!-- hola --><s:A xmlns:s="ns" b='1 &amp; 2'><B>x &lt; y &#65;&#x42;</B><C/><D><![CDATA[<no es etiqueta> & listo]]></D></s:A>`);
    assert.equal(r.ok, true);
    assert.deepEqual([r.root.name, r.root.prefix, r.root.local], ["s:A", "s", "A"]);
    assert.equal(r.root.attrs.b, "1 & 2");
    assert.deepEqual(r.root.children.map((c) => [c.local, c.text]), [["B", "x < y AB"], ["C", ""], ["D", "<no es etiqueta> & listo"]]);
  });

  test("también lee un Buffer", () => {
    assert.equal(parseXml(Buffer.from("<a>ñ</a>", "utf8")).root.text, "ñ");
  });

  test("rechaza DOCTYPE: billion laughs y entidad externa", () => {
    const laughs = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><lolz>&lol2;</lolz>';
    const xxe = '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>';
    assert.deepEqual(parseXml(laughs), { ok: false, error: "DOCTYPE_NO_PERMITIDO" });
    assert.deepEqual(parseXml(xxe), { ok: false, error: "DOCTYPE_NO_PERMITIDO" });
    assert.deepEqual(parseXml('<a><!ENTITY x "y"></a>'), { ok: false, error: "ENTIDAD_NO_PERMITIDA" });
  });

  test("una entidad que no es de las cinco de XML es un error, no se deja pasar", () => {
    assert.deepEqual(parseXml("<a>&lol;</a>"), { ok: false, error: "XML_MAL_FORMADO" });
    assert.deepEqual(parseXml("<a>& suelto</a>"), { ok: false, error: "XML_MAL_FORMADO" });
    assert.deepEqual(parseXml("<a>&#0;</a>"), { ok: false, error: "XML_MAL_FORMADO" });
  });

  test("topes: tamaño, profundidad", () => {
    assert.deepEqual(parseXml(`<a>${"x".repeat(2000)}</a>`, { maxBytes: 1000 }), { ok: false, error: "DEMASIADO_GRANDE" });
    assert.deepEqual(parseXml(Buffer.alloc(2000, 0x20), { maxBytes: 1000 }), { ok: false, error: "DEMASIADO_GRANDE" });
    const profundo = `${"<a>".repeat(100)}${"</a>".repeat(100)}`;
    assert.deepEqual(parseXml(profundo), { ok: false, error: "DEMASIADO_PROFUNDO" });
  });

  test("estricto: etiquetas cruzadas, sin cerrar, dos raíces, texto afuera, atributos repetidos", () => {
    for (const malo of [
      "<a><b></a></b>", "<a><b></b>", "<a></a><b></b>", "texto<a></a>", "<a></a>texto",
      '<a x="1" x="2"></a>', "<a x=1></a>", '<a x="<"></a>', "<a>", "</a>", "<1a></1a>", "<a><!--sin cerrar</a>",
      `<a>con control ${ch(1)}</a>`,
    ]) {
      assert.deepEqual(parseXml(malo), { ok: false, error: "XML_MAL_FORMADO" }, malo);
    }
  });

  test("vacío o cualquier cosa que no sea texto", () => {
    assert.deepEqual(parseXml(""), { ok: false, error: "VACIO" });
    assert.deepEqual(parseXml("   "), { ok: false, error: "VACIO" });
    assert.deepEqual(parseXml(null), { ok: false, error: "VACIO" });
    assert.deepEqual(parseXml({ a: 1 }), { ok: false, error: "VACIO" });
  });

  test("una página HTML (ARCA en mantenimiento) tiene su propio error", () => {
    assert.deepEqual(parseXml(fixture("mantenimiento.html")), { ok: false, error: "HTML_EN_VEZ_DE_XML" });
    assert.deepEqual(parseXml("<html><body>Mantenimiento</body></html>"), { ok: false, error: "HTML_EN_VEZ_DE_XML" });
    assert.deepEqual(readFECAESolicitar(fixture("mantenimiento.html")), { ok: false, error: "HTML_EN_VEZ_DE_XML" });
    assert.deepEqual(parseXml('<?xml version="1.0"?>\n<!-- a --><!-- b -->\n<!DOCTYPE html><html></html>'), { ok: false, error: "HTML_EN_VEZ_DE_XML" });
  });

  // Saltear los comentarios del principio con una sola expresión regular puede tardar muchísimo cuando
  // hay muchos seguidos (cada uno puede "tragarse" al siguiente y las combinaciones se multiplican): el
  // lector los recorre una sola vez.
  test("muchos comentarios seguidos no traban el lector", () => {
    assert.equal(parseXml(`${"<!--x-->".repeat(20000)}<a/>`).ok, true);
    assert.equal(parseXml(`${"<!--x-->".repeat(20000)}texto`).ok, false);
  });
});

describe("FECAESolicitar", () => {
  test("aprobada: CAE y vencimiento", () => {
    const r = readFECAESolicitar(fixture("fecaesolicitar-aprobada.xml"));
    assert.deepEqual(r, {
      ok: true,
      cab: { cuit: "30000000007", ptoVta: 12, cbteTipo: 1, fchProceso: "20261111103015", cantReg: 1, resultado: "A", reproceso: "N" },
      det: [{
        concepto: 1, docTipo: 80, docNro: "20000000001", cbteDesde: 1, cbteHasta: 1, cbteFch: "20261111",
        resultado: "A", cae: "41124578989845", caeFchVto: "20261121", observaciones: [],
      }],
      errors: [],
      events: [],
    });
  });

  test("aprobada con observaciones, y eventos con entidades", () => {
    const r = readFECAESolicitar(fixture("fecaesolicitar-observada.xml"));
    assert.equal(r.det[0].resultado, "A");
    assert.equal(r.det[0].cae, "41124599989845");
    assert.deepEqual(r.det[0].observaciones.map((o) => o.code), [10017]);
    assert.deepEqual(r.events, [{ code: 35, msg: "Mensaje de prueba & aviso <importante>" }]);
  });

  test("rechazada (SOAP 1.2, otro prefijo): sin CAE y con el motivo", () => {
    const r = readFECAESolicitar(fixture("fecaesolicitar-rechazada.xml"));
    assert.equal(r.ok, true);
    assert.equal(r.cab.resultado, "R");
    assert.deepEqual([r.det[0].resultado, r.det[0].cae, r.det[0].caeFchVto], ["R", null, null]);
    assert.deepEqual(r.det[0].observaciones, [{ code: 10016, msg: "El numero o fecha del comprobante no se corresponde con el proximo a autorizar." }]);
  });

  test("errores generales (token): sin cabecera ni detalle", () => {
    const r = readFECAESolicitar(fixture("fecaesolicitar-errores.xml"));
    assert.deepEqual([r.ok, r.cab, r.det, r.errors.map((e) => e.code)], [true, null, [], [600]]);
  });

  test("las observaciones también se leen con <Obs> por fuera, como en la tabla del manual", () => {
    const xml = fixture("fecaesolicitar-observada.xml")
      .replace("<Observaciones>", "<Obs>").replace("</Observaciones>", "</Obs>")
      .replace("<Obs>\n                <Code>", "<Observaciones>\n                <Code>").replace("</Msg>\n              </Obs>", "</Msg>\n              </Observaciones>");
    assert.ok(xml.includes("<Obs>\n              <Observaciones>"), "el XML del test quedó con <Obs> por fuera");
    assert.deepEqual(readFECAESolicitar(xml).det[0].observaciones.map((o) => o.code), [10017]);
  });
});

describe("SOAP Fault y respuestas inesperadas", () => {
  test("SOAP 1.1", () => {
    assert.deepEqual(readFECAESolicitar(fixture("soap11-fault.xml")), {
      ok: false, error: "SOAP_FAULT", fault: { code: "soap:Server", message: "Server was unable to process request. ---> Error de prueba." },
    });
  });

  test("SOAP 1.2", () => {
    assert.deepEqual(readFECompUltimoAutorizado(fixture("soap12-fault.xml")), {
      ok: false, error: "SOAP_FAULT", fault: { code: "soap12:Receiver", message: "Error de prueba del servidor." },
    });
  });

  test("XML que no es un sobre SOAP, o la respuesta de otro método", () => {
    assert.deepEqual(readFEDummy("<a><b/></a>"), { ok: false, error: "RESPUESTA_INESPERADA" });
    assert.deepEqual(readFECAESolicitar(fixture("fedummy.xml")), { ok: false, error: "RESPUESTA_INESPERADA" });
  });
});

describe("otros métodos", () => {
  test("FECompUltimoAutorizado", () => {
    assert.deepEqual(readFECompUltimoAutorizado(fixture("fecompultimoautorizado.xml")), {
      ok: true, ptoVta: 3, cbteTipo: 6, cbteNro: 1234, errors: [], events: [],
    });
  });

  test("FECompConsultar: comprobante encontrado, con importes en centavos", () => {
    const r = readFECompConsultar(fixture("fecompconsultar-encontrado.xml"));
    assert.deepEqual([r.ok, r.found, r.notFound], [true, true, false]);
    const c = r.comprobante;
    assert.deepEqual(
      [c.impTotalCents, c.impNetoCents, c.impIvaCents, c.impTribCents, c.impTotConcCents, c.impOpExCents],
      [18405, 15000, 2625, 780, 0, 0],
    );
    assert.deepEqual(c.iva, [{ id: 5, baseImpCents: 10000, importeCents: 2100 }, { id: 4, baseImpCents: 5000, importeCents: 525 }]);
    assert.deepEqual([c.codAutorizacion, c.emisionTipo, c.cbteFch, c.docNro, c.condicionIvaReceptorId], ["41124578989845", "CAE", "20261111", "20000000001", 1]);
    assert.deepEqual([c.ptoVta, c.cbteTipo, c.cbteDesde], [12, 1, 1]);
  });

  test("FECompConsultar: comprobante que no existe (602)", () => {
    const r = readFECompConsultar(fixture("fecompconsultar-inexistente.xml"));
    assert.deepEqual([r.ok, r.found, r.notFound, r.comprobante, r.errors[0].code], [true, false, true, null, 602]);
  });

  test("FEParamGet: tablas de ARCA como filas", () => {
    const tipos = readFEParamGet(fixture("feparamgettiposcbte.xml"), "FEParamGetTiposCbte");
    assert.deepEqual(tipos.items.map((t) => [t.Id, t.Desc]), [["1", "Factura A"], ["3", "Nota de Crédito A"], ["6", "Factura B"], ["8", "Nota de Crédito B"]]);
    assert.equal(tipos.items[0].FchHasta, "NULL");
    assert.equal(tipos.record, null);
    const cond = readResponse(fixture("feparamgetcondicionivareceptor.xml"), "FEParamGetCondicionIvaReceptor");
    assert.deepEqual(cond.items.map((c) => [c.Id, c.Cmp_Clase]), [["1", "A"], ["6", "A"], ["5", "B"]]);
  });

  test("FEParamGet con un nombre de método inventado", () => {
    assert.deepEqual(readFEParamGet(fixture("feparamgettiposcbte.xml"), "Cualquiera"), { ok: false, error: "METODO_DESCONOCIDO" });
    assert.deepEqual(readResponse(fixture("feparamgettiposcbte.xml"), "FEParamGet<x>"), { ok: false, error: "METODO_DESCONOCIDO" });
  });

  test("FEDummy y readResponse según el método", () => {
    assert.deepEqual(readFEDummy(fixture("fedummy.xml")), { ok: true, appServer: "OK", dbServer: "OK", authServer: "OK" });
    assert.equal(readResponse(fixture("fecompultimoautorizado.xml"), "FECompUltimoAutorizado").cbteNro, 1234);
    assert.equal(readResponse(fixture("fecaesolicitar-aprobada.xml"), "FECAESolicitar").det[0].cae, "41124578989845");
    assert.equal(readResponse(fixture("fecompconsultar-encontrado.xml"), "FECompConsultar").found, true);
  });
});

test("importes de las respuestas a centavos", () => {
  assert.equal(decimalToCents("184.05"), 18405);
  assert.equal(decimalToCents("150"), 15000);
  assert.equal(decimalToCents("7.8"), 780);
  assert.equal(decimalToCents(" 0.015 "), 2); // mitad al par
  assert.equal(decimalToCents("0.005"), 0);
  assert.equal(decimalToCents("-1.5"), -150);
  for (const v of ["1E+3", "", "abc", "1.2.3", null, undefined]) assert.equal(decimalToCents(v), null, String(v));
});

test("los fixtures solo traen CUIT de ejemplo (el repo es público)", () => {
  const permitidos = new Set(["30000000007", "20000000001"]);
  for (const name of fs.readdirSync(FIXTURES)) {
    const encontrados = fixture(name).match(/\b\d{11}\b/g) || [];
    for (const n of encontrados) assert.ok(permitidos.has(n), `${name}: ${n}`);
  }
});

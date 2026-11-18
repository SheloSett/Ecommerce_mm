// Tests de las etiquetas de envío importadas de BarTender: lectura del .btw y cliente sugerido.
// Los archivos se arman acá con datos inventados (el repo es público: nada de etiquetas reales).
// Correr con: npm test
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const { parseBtwLabel } = require("../src/utils/btwLabel");
const { suggestCustomers, personKey, DEFAULT_SENDER } = require("../src/services/shippingLabels.service");

const MASK = "(???) ???-????";
// Cadena serializada al estilo MFC: FF FE FF + largo + UTF-16LE
function mfc(s) {
  const body = Buffer.from(s, "utf16le");
  const len = s.length < 255 ? Buffer.from([s.length]) : Buffer.concat([Buffer.from([0xff]), Buffer.from([s.length & 0xff, s.length >> 8])]);
  return Buffer.concat([Buffer.from([0xff, 0xfe, 0xff]), len, body]);
}
// Un .btw mínimo: encabezado, "vista previa" y el bloque zlib con los textos (cada valor tras la máscara)
function fakeBtw(values, { size = "150 x 100 mm", title = "Etiqueta" } = {}) {
  const header = Buffer.from(`\r\nBar Tender Format File\r\n(c) 1992 - 2026 Seagull Scientific, Inc.\r\n<Metadata><TemplateSize>${size}</TemplateSize><Title>${title}</Title></Metadata>\r\n`, "latin1");
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40), Buffer.from("IEND"), Buffer.alloc(4)]);
  const parts = [mfc("BarTender"), mfc("DataSource")];
  for (const v of values) parts.push(mfc("Texto"), mfc(MASK), mfc(v), mfc("Box Options"), mfc("Recuadro 1"));
  return Buffer.concat([header, png, Buffer.alloc(16), zlib.deflateSync(Buffer.concat(parts))]);
}

describe("leer una etiqueta .btw", () => {
  test("molde 10×15: destinatario, datos, transporte, seguro, bultos y remitente", () => {
    const buf = fakeBtw([
      "Texto de muestra", "JUAN PRUEBA",
      "DNI: 30.111.222\rDireccion: Calle Falsa 123\rCP 1000\rTelefono: 11-4444-5555",
      "CANT. BULTOS", "TRANSPORTE:", "Remitente:\rEMPRESA DE PRUEBA\rCalle 1", "VIA CARGO", "SEGURO:", "$ MINIMO", "2", "3",
      "Texto de muestra", "1", "1",
    ]);
    const r = parseBtwLabel(buf, "ENVIO JUAN PRUEBA 10X15.btw");
    assert.equal(r.recipientName, "JUAN PRUEBA");
    assert.equal(r.recipientDetails, "DNI: 30.111.222\nDireccion: Calle Falsa 123\nCP 1000\nTelefono: 11-4444-5555");
    assert.equal(r.transport, "VIA CARGO");
    assert.equal(r.insurance, "$ MINIMO");
    assert.equal(r.sender, "EMPRESA DE PRUEBA\nCalle 1");
    assert.deepEqual(r.packages, { current: 2, total: 3 });
    assert.equal(r.size, "10x15");
  });

  test("molde de moto: los datos van arriba y el nombre al final", () => {
    const buf = fakeBtw([
      "Texto de muestra", "AV SIEMPREVIVA 742\rBARRIO\rCEL: 11-2222-3333",
      "CANT. BULTOS", "TRANSPORTE", "Remitente:\rEMPRESA DE PRUEBA", "MOTO", "SEGURO:", "$ 1000", "1", "1", "ANA O LUIS",
    ], { size: "101 x 101 mm" });
    const r = parseBtwLabel(buf, "Etiqueta envio MOTO molde10x10.btw");
    assert.equal(r.recipientName, "ANA O LUIS");
    assert.equal(r.recipientDetails, "AV SIEMPREVIVA 742\nBARRIO\nCEL: 11-2222-3333");
    assert.equal(r.transport, "MOTO");
    assert.equal(r.size, "10x10");
  });

  test("sin tamaño en el archivo, lo saca del nombre", () => {
    const buf = fakeBtw(["PEPE", "Calle 1\rCiudad", "Remitente:\rX", "OCA"], { size: "" });
    assert.equal(parseBtwLabel(buf, "Envio Pepe 10x10.btw").size, "10x10");
  });

  test("una etiqueta que no es de envío no tiene remitente", () => {
    const r = parseBtwLabel(fakeBtw(["MUY FRAGIL", "MANIPULAR CON CUIDADO\rESTE LADO ARRIBA"]), "fragil.btw");
    assert.equal(r.sender, null);
  });

  test("un archivo que no es de BarTender da null", () => {
    assert.equal(parseBtwLabel(Buffer.from("hola, no soy una etiqueta"), "x.btw"), null);
  });
});

describe("sugerir el cliente de una etiqueta", () => {
  const customers = [
    { id: 1, name: "Juan Prueba", phone: null, cuit: "20-30111222-3", email: "a@x.com" },
    { id: 2, name: "Otra Persona", phone: "+54 9 11 4444-5555", cuit: null, email: "b@x.com" },
    { id: 3, name: "Juana Prueba Gomez", phone: null, cuit: null, email: "c@x.com" },
    { id: 4, name: "Nadie Relacionado", phone: "1199998888", cuit: "99999999", email: "d@x.com" },
  ];
  const label = { recipientName: "JUAN PRUEBA", recipientDetails: "DNI: 30.111.222\nTelefono: 11-4444-5555" };

  test("el DNI dentro del CUIT gana; después el teléfono", () => {
    const s = suggestCustomers(label, customers);
    assert.equal(s[0].customerId, 1);
    assert.equal(s[0].reason, "mismo DNI");
    assert.equal(s[1].customerId, 2);
    assert.equal(s[1].reason, "mismo teléfono");
    assert.ok(!s.some((x) => x.customerId === 4));
  });

  test("sin DNI ni teléfono, por nombre (sin tildes ni mayúsculas)", () => {
    const s = suggestCustomers({ recipientName: "JUAN PRUEBA", recipientDetails: "Calle 1" }, [{ id: 9, name: "Juán Prueba", phone: null, cuit: null }]);
    assert.equal(s[0].customerId, 9);
    assert.equal(s[0].reason, "mismo nombre");
  });

  test("la misma persona en dos archivos tiene la misma clave", () => {
    assert.equal(personKey({ recipientName: "Agustín Aloy" }), personKey({ recipientName: "AGUSTIN ALOY" }));
  });

  test("el remitente por defecto es LS MARKET SRL", () => {
    assert.match(DEFAULT_SENDER, /^LS MARKET SRL/);
  });
});

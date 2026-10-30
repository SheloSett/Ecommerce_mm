// Tests de los formularios públicos que hacen que la tienda mande emails.
// Correr con: npm test
//
// Caso que los motivó (auditoría 28/10/2026): una sola solicitud de arrepentimiento, sin cuenta,
// generaba un email "de IGWT Store" a 40 direcciones con el HTML que escribía quien llenaba el
// formulario (links y títulos a gusto), y un email armado con "a:" repetido trababa el servidor.
// Acá se usa el servicio de emails REAL con nodemailer en jsonTransport: arma el mensaje y no
// manda nada. La red queda bloqueada por las dudas.

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const net = require("net");

net.Socket.prototype.connect = function () { throw new Error("red bloqueada en los tests"); };
process.env.SMTP_USER = "tienda@example.com"; // valores falsos: solo para que haya transporte
process.env.SMTP_PASS = "x";

const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };

// nodemailer real, pero cada transporte es jsonTransport y guarda lo que "manda"
const sent = [];
const nmPath = require.resolve("nodemailer", { paths: [root] });
const realNodemailer = require(nmPath);
stub(nmPath, {
  ...realNodemailer,
  createTransport: () => {
    const t = realNodemailer.createTransport({ jsonTransport: true });
    const orig = t.sendMail.bind(t);
    t.sendMail = async (msg) => { const info = await orig(msg); sent.push(info); return info; };
    return t;
  },
});
stub(require.resolve("@prisma/client", { paths: [root] }), {
  PrismaClient: class { constructor() { this.returnRequest = { create: async ({ data }) => ({ id: 1, ...data }) }; } },
});

const { validateReturnRequest, validateOrder, isSingleEmail } = require("../src/middleware/validate.middleware");
const { createReturnRequest } = require("../src/controllers/return.controller");

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
// Corre el validador y, si pasa, el controller. Devuelve la respuesta.
async function submitReturn(body) {
  const res = fakeRes();
  let passed = false;
  validateReturnRequest({ body }, res, () => { passed = true; });
  if (passed) await createReturnRequest({ body, headers: {} }, res);
  await new Promise((r) => setTimeout(r, 50)); // el email sale sin esperar la respuesta
  return res;
}
const valid = { customerName: "Ana Test", customerEmail: "ana@example.com", customerPhone: "11 1234-5678", reason: "Me arrepentí de la compra del pedido #120" };

describe("isSingleEmail", () => {
  test("acepta direcciones normales", () => {
    for (const e of ["ana@example.com", "juan.perez+tienda@gmail.com", "o'brien@x.com.ar", "  Ana@X.com "]) assert.ok(isSingleEmail(e), e);
  });
  test("rechaza listas y la sintaxis de grupos y nombres", () => {
    for (const e of ["a@x.com,b@y.com", "a,b@x.com", "a@x.com;b@y.com", "a:b@x.com", "Ana <ana@x.com>", "\"a\"@x.com", "sin-arroba", 42]) {
      assert.equal(isSingleEmail(e), false, String(e));
    }
  });
  test("una cadena larga de 'a:' se rechaza al toque (antes trababa a nodemailer)", () => {
    const t0 = Date.now();
    assert.equal(isSingleEmail("a:".repeat(45000) + "x@y.zz"), false);
    assert.ok(Date.now() - t0 < 200);
  });
});

describe("formulario de arrepentimiento", () => {
  beforeEach(() => { sent.length = 0; });

  test("una lista de emails se rechaza y no sale nada", async () => {
    const lista = Array.from({ length: 40 }, (_, i) => `victima${i}@dominio.com`).join(",");
    const res = await submitReturn({ ...valid, customerEmail: lista });
    assert.equal(res.code, 400);
    assert.equal(sent.length, 0);
  });

  test("motivo demasiado largo o teléfono gigante se rechazan", async () => {
    assert.equal((await submitReturn({ ...valid, reason: "x".repeat(2001) })).code, 400);
    assert.equal((await submitReturn({ ...valid, customerPhone: "1".repeat(41) })).code, 400);
    assert.equal(sent.length, 0);
  });

  test("una solicitud válida manda UN email a UNA dirección, con el texto del cliente escapado", async () => {
    const res = await submitReturn({
      ...valid,
      customerName: `<a href="https://phishing.example/login">Reclamá tu reintegro</a>`,
      reason: `<h1 style="color:red">Tu cuenta fue suspendida</h1><a href="https://phishing.example">Verificar</a>`,
    });
    assert.equal(res.code, 201);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].envelope.to, ["ana@example.com"]);
    const html = JSON.parse(sent[0].message).html;
    assert.ok(!html.includes('<a href="https://phishing.example'), "el link del nombre no tiene que quedar como HTML");
    assert.ok(!html.includes("<h1 style=\"color:red\">"), "el título del motivo no tiene que quedar como HTML");
    assert.ok(html.includes("&lt;h1"), "el motivo se ve como texto");
  });
});

describe("checkout: datos del cliente", () => {
  const run = (body) => {
    const res = fakeRes();
    let passed = false;
    validateOrder({ body: { customerName: "Ana Test", customerEmail: "ana@example.com", items: [{ productId: 1, quantity: 1 }], ...body } }, res, () => { passed = true; });
    return passed ? 200 : res.code;
  };

  test("el email tiene que ser uno solo", () => {
    assert.equal(run({ customerEmail: "a,b@x.com" }), 400);
    assert.equal(run({ customerEmail: "ana@example.com" }), 200);
  });

  test("teléfono y nota: largo máximo, sin exigir formato", () => {
    assert.equal(run({ customerPhone: "11 1234-5678 / 11 9876-5432" }), 200);
    assert.equal(run({ customerPhone: "1".repeat(41) }), 400);
    assert.equal(run({ customerNote: "x".repeat(1001) }), 400);
  });
});

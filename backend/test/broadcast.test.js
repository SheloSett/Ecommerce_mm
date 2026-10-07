// Tests de los emails masivos (services/broadcast.service.js y broadcast.templates.js): a quién le
// llega cada envío, el link de baja, qué errores pausan la cola y qué muestra cada plantilla.
// Solo funciones puras: no toca la base ni manda emails. Correr con: npm test

process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-prueba";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  pickRecipients,
  recipientsForOffer,
  renderFor,
  isRetryableSendError,
  validateCustomPayload,
  marketingUnsubscribeToken,
  verifyMarketingUnsubscribeToken,
} = require("../src/services/broadcast.service");
const { formatBodyHtml, personalize, buildOfferEmail, buildPlainOfferEmail, buildCustomEmail } = require("../src/services/broadcast.templates");

const c = (id, extra = {}) => ({ id, name: `Cliente ${id}`, email: `c${id}@mail.com`, type: "MINORISTA", status: "APPROVED", unsubscribeMarketing: false, ...extra });
const customers = [
  c(1),
  c(2, { type: "MAYORISTA" }),
  c(3, { type: "MAYORISTA", status: "PENDING" }),   // mayorista sin aprobar → recibe como minorista
  c(4, { unsubscribeMarketing: true }),             // se dio de baja
  c(5, { status: "REJECTED" }),
  c(6, { email: "C1@MAIL.COM" }),                   // mismo email que el 1, en mayúsculas
  c(7, { email: "sin-arroba" }),
];
const ids = (list) => list.map((r) => r.customerId);

describe("a quién le llega", () => {
  test("todos: sin dados de baja, rechazados, repetidos ni emails inválidos", () => {
    assert.deepEqual(ids(pickRecipients(customers, "ALL")), [1, 2, 3]);
  });
  test("mayoristas: solo los aprobados", () => {
    const r = pickRecipients(customers, "MAYORISTA");
    assert.deepEqual(ids(r), [2]);
    assert.equal(r[0].type, "MAYORISTA");
  });
  test("minoristas: incluye al mayorista pendiente, que no ve precios mayoristas", () => {
    const r = pickRecipients(customers, "MINORISTA");
    assert.deepEqual(ids(r), [1, 3]);
    assert.ok(r.every((x) => x.type === "MINORISTA"));
  });
  test("elegidos a mano: les llega aunque se hayan dado de baja (es un mensaje directo)", () => {
    assert.deepEqual(ids(pickRecipients([c(4, { unsubscribeMarketing: true }), c(2, { type: "MAYORISTA" })], "SELECTED")), [4, 2]);
  });
  test("el email se guarda en minúscula", () => {
    assert.equal(pickRecipients([c(9, { email: " Ana@Mail.COM " })], "ALL")[0].email, "ana@mail.com");
  });
});

describe("aviso de una campaña a clientes elegidos", () => {
  const elegidos = pickRecipients(customers.slice(0, 3), "SELECTED"); // minorista, mayorista, mayorista pendiente
  test("campaña para todos: les llega a todos los elegidos", () => {
    assert.deepEqual(ids(recipientsForOffer(elegidos, "AMBOS")), [1, 2, 3]);
  });
  test("solo mayoristas: solo al mayorista aprobado", () => {
    assert.deepEqual(ids(recipientsForOffer(elegidos, "MAYORISTA")), [2]);
  });
  test("solo minoristas: el mayorista pendiente cuenta como minorista", () => {
    assert.deepEqual(ids(recipientsForOffer(elegidos, "MINORISTA")), [1, 3]);
  });
});

describe("formato simple (para que llegue a Principal)", () => {
  const draft = { subject: "Hola {nombre}", title: "", body: "Tu pedido está listo", buttonText: null, buttonUrl: null };
  test("a clientes elegidos es un mensaje directo: sin link de baja", async () => {
    const r = await renderFor({ kind: "PLAIN", audience: "SELECTED", ...draft }, { customerId: 5, name: "Ana", type: "MINORISTA" });
    assert.equal(r.subject, "Hola Ana");
    assert.ok(!r.html.includes("desuscribirse"));
    assert.ok(r.text.includes("Tu pedido está listo"));
  });
  test("a todos lleva el link de baja", async () => {
    const r = await renderFor({ kind: "PLAIN", audience: "ALL", ...draft }, { customerId: 5, name: "Ana", type: "MINORISTA" });
    assert.ok(r.html.includes("desuscribirse?id=5"));
    assert.ok(r.text.includes("desuscribirse?id=5"));
  });
  test("el email con diseño también va en texto plano", async () => {
    const r = await renderFor({ kind: "CUSTOM", audience: "ALL", ...draft }, { customerId: 5, name: "Ana", type: "MINORISTA" });
    assert.ok(r.text.includes("Tu pedido está listo") && r.text.includes("desuscribirse?id=5"));
    assert.ok(!r.text.includes("<"));
  });
});

describe("link de baja", () => {
  test("el token es del cliente: no sirve para dar de baja a otro", () => {
    const t = marketingUnsubscribeToken(10);
    assert.equal(verifyMarketingUnsubscribeToken(10, t), true);
    assert.equal(verifyMarketingUnsubscribeToken(11, t), false);
    assert.equal(verifyMarketingUnsubscribeToken(10, "cualquiera"), false);
    assert.equal(verifyMarketingUnsubscribeToken(10, undefined), false);
  });
});

describe("errores de envío", () => {
  test("límite de Gmail, SMTP caído o sin configurar → se pausa y se reintenta", () => {
    assert.equal(isRetryableSendError({ responseCode: 550, response: "550 5.4.5 Daily user sending limit exceeded" }), true);
    assert.equal(isRetryableSendError({ responseCode: 421, response: "421 4.7.0 Try again later" }), true);
    assert.equal(isRetryableSendError({ code: "ECONNECTION" }), true);
    assert.equal(isRetryableSendError({ code: "EAUTH" }), true);
    assert.equal(isRetryableSendError({ code: "NO_SMTP" }), true);
  });
  test("casilla inexistente → falla solo ese destinatario", () => {
    assert.equal(isRetryableSendError({ responseCode: 550, response: "550 5.1.1 The email account does not exist" }), false);
  });
});

describe("formulario de Enviar email", () => {
  test("asunto y mensaje obligatorios", () => {
    assert.ok(validateCustomPayload({ subject: "", body: "hola" }).error);
    assert.ok(validateCustomPayload({ subject: "Hola", body: "  " }).error);
  });
  test("el botón necesita un link http(s)", () => {
    assert.ok(validateCustomPayload({ subject: "a", body: "b", buttonText: "Ver", buttonUrl: "javascript:alert(1)" }).error);
    const ok = validateCustomPayload({ subject: "a", body: "b", buttonText: "Ver", buttonUrl: "https://igwtstore.com.ar/catalogo" });
    assert.equal(ok.data.buttonUrl, "https://igwtstore.com.ar/catalogo");
  });
  test("sin texto de botón no se guarda el link", () => {
    assert.equal(validateCustomPayload({ subject: "a", body: "b", buttonUrl: "https://x.com" }).data.buttonUrl, null);
  });
});

describe("plantillas", () => {
  test("el texto del admin se escapa (no se puede meter HTML) y respeta párrafos y negrita", () => {
    const html = formatBodyHtml("Hola <b>todos</b>\n\nOferta **especial**\nhasta el lunes");
    assert.ok(html.includes("&lt;b&gt;todos&lt;/b&gt;"));
    assert.equal((html.match(/<p /g) || []).length, 2);
    assert.ok(html.includes("<strong") && html.includes("especial</strong>"));
    assert.ok(html.includes("<br>"));
  });
  test("{nombre} → primer nombre", () => {
    assert.equal(personalize("Hola {nombre}!", "Juan Pérez"), "Hola Juan!");
    assert.equal(personalize("Hola {Nombre}", ""), "Hola ");
  });
  test("email escrito: asunto personalizado y link de baja", () => {
    const { subject, html } = buildCustomEmail(
      { subject: "{nombre}, novedades", title: "Llegó stock", body: "Hola", buttonText: "Ver", buttonUrl: "https://x.com" },
      { name: "Ana López" },
      { storeName: "IGWT Store", unsubscribeUrl: "https://x.com/desuscribirse?id=1&token=t" }
    );
    assert.equal(subject, "Ana, novedades");
    assert.ok(html.includes("No quiero recibir más ofertas"));
    assert.ok(html.includes("desuscribirse?id=1&amp;token=t"));
  });

  const offer = {
    id: 7, name: "Día de la Madre", description: null, discountType: "PERCENTAGE",
    discountValue: 10, wholesaleDiscountValue: 15, appliesTo: "AMBOS", endsAt: "2026-10-18T03:00:00.000Z",
    items: [{ discountValue: null, wholesaleDiscountValue: null }],
  };
  const product = { id: 1, name: "Cable", images: [], currency: "ARS", price: 1000, salePrice: 900, wholesalePrice: 800, wholesaleSalePrice: 680 };
  const ctx = { storeName: "IGWT Store", frontendUrl: "https://tienda", backendUrl: "https://tienda", unsubscribeUrl: "u" };

  test("aviso a un minorista: su descuento y precio, sin precios mayoristas", () => {
    const { subject, html } = buildOfferEmail(offer, [product], "retail", { name: "Ana" }, ctx);
    assert.equal(subject, "Día de la Madre: 10% OFF en IGWT Store");
    assert.ok(html.includes("¡Hola Ana!"));
    assert.ok(/900,00/.test(html));
    assert.ok(!/680,00/.test(html) && !/800,00/.test(html));
    assert.ok(html.includes("https://tienda/catalogo?offerId=7"));
  });
  test("aviso simple: como un mensaje personal, sin precios ni OFF, con el link y el link de baja", () => {
    const { subject, html, text } = buildPlainOfferEmail(offer, "retail", { name: "Ana López" }, ctx);
    assert.equal(subject, "Ana, arrancó Día de la Madre en IGWT Store");
    assert.ok(text.includes("10% de descuento en productos seleccionados"));
    assert.ok(text.includes("https://tienda/catalogo?offerId=7"));
    assert.ok(!/OFF|\$\s?\d/.test(text) && !/<img/.test(html));
    assert.ok(html.includes("tocá acá"));
    // el mayorista ve el suyo
    assert.ok(buildPlainOfferEmail(offer, "wholesale", { name: "Ana" }, ctx).text.includes("15% de descuento"));
  });
  test("aviso a un mayorista: su descuento y su precio mayorista", () => {
    const { subject, html } = buildOfferEmail(offer, [product], "wholesale", { name: "Ana" }, ctx);
    assert.equal(subject, "Día de la Madre: 15% OFF en IGWT Store");
    assert.ok(/680,00/.test(html));
  });
});

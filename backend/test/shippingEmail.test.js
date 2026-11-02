// Tests de los mails y el PDF con envío: como el costo ya está sumado en Order.total, tiene que verse como
// renglón para que la cuenta cierre, y el repartidor necesita la dirección. SMTP simulado. Correr con: npm test

process.env.SMTP_USER = "tienda@example.com";
process.env.SMTP_PASS = "x";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

let sent;
const root = path.join(__dirname, "..");
require.cache[require.resolve("nodemailer", { paths: [root] })] = {
  id: "nodemailer", filename: "nodemailer", loaded: true,
  exports: { createTransport: () => ({ sendMail: async (mail) => { sent.push(mail); return {}; } }) },
};

const { sendOrderConfirmationToCustomer, sendOrderFulfillmentEmail } = require("../src/services/email.service");

const order = (fields) => ({
  id: 7, customerName: "Ana", customerEmail: "ana@example.com", customerPhone: "11", paymentMethod: "EFECTIVO",
  createdAt: new Date("2026-11-02T13:00:00Z"), status: "QUOTE_APPROVED", total: 31200, wantsInvoice: false, ivaAmount: 0, couponDiscount: 0,
  items: [{ id: 1, quantity: 1, price: 25000, currency: "ARS", product: { name: "Parlante", images: [] } }],
  shippingMethod: "MOTO", shippingCost: 6200,
  shippingAddress: {
    streetName: "Rivadavia", streetNumber: "100", floor: "2", apartment: "B", city: "Morón", provinceCode: "B", postalCode: "1708",
    references: "<b>Timbre</b> 3", zoneName: "Zona 1", deliveryDate: "2026-11-03",
  },
  ...fields,
});

describe("mail de confirmación", () => {
  beforeEach(() => { sent = []; });

  test("un pedido que pasó a retiro no muestra la dirección ni el día de la moto", async () => {
    await sendOrderConfirmationToCustomer(order({ shippingMethod: "RETIRO", shippingCost: 0 }));
    const { html } = sent[0];
    assert.doesNotMatch(html, /Rivadavia/);
    assert.doesNotMatch(html, /Entrega estimada/);
  });

  test("moto: renglón de envío, dirección y día de entrega", async () => {
    await sendOrderConfirmationToCustomer(order());
    const { html, attachments } = sent[0];
    assert.match(html, /Envío en moto \(Zona 1\)/);
    assert.match(html, /\+ \$\s?6\.200/);
    assert.match(html, /Rivadavia 100, Piso 2 Dpto B/);
    assert.match(html, /Morón, Buenos Aires · CP 1708/);
    assert.match(html, /Entrega estimada: martes 3\/11/);
    const pdf = attachments.find((a) => a.contentType === "application/pdf");
    assert.equal(pdf.content.subarray(0, 4).toString(), "%PDF", "el PDF se arma con el envío");
  });

  test("lo que escribe el cliente va escapado", async () => {
    await sendOrderConfirmationToCustomer(order());
    assert.match(sent[0].html, /&lt;b&gt;Timbre&lt;\/b&gt; 3/);
    assert.doesNotMatch(sent[0].html, /<b>Timbre/);
  });

  test("correo sin costo: avisa que se confirma por WhatsApp y no pone renglón", async () => {
    await sendOrderConfirmationToCustomer(order({ shippingMethod: "CORREO_ARGENTINO", shippingCost: 0, total: 25000 }));
    assert.match(sent[0].html, /Envío por correo/);
    assert.match(sent[0].html, /te lo confirmamos por WhatsApp/);
    assert.doesNotMatch(sent[0].html, /🚚/);
  });

  test("retiro: sin dirección ni renglón de envío", async () => {
    await sendOrderConfirmationToCustomer(order({ shippingMethod: "RETIRO", shippingCost: 0, shippingAddress: null, total: 25000 }));
    assert.match(sent[0].html, /Retiro en el local/);
    assert.doesNotMatch(sent[0].html, /Entrega estimada/);
  });
});

describe("aviso de que salió", () => {
  beforeEach(() => { sent = []; });

  test("moto y correo dicen que va en camino, no que está listo para retirar", async () => {
    await sendOrderFulfillmentEmail(order(), "ENVIADO");
    await sendOrderFulfillmentEmail(order({ shippingMethod: "CORREO_ARGENTINO", trackingNumber: "TN123" }), "ENVIADO");
    assert.match(sent[0].subject, /en camino/);
    assert.match(sent[0].html, /salió en moto/);
    assert.match(sent[1].subject, /en camino/);
    assert.match(sent[1].html, /TN123/);
  });

  test("retiro sigue diciendo listo para retirar", async () => {
    await sendOrderFulfillmentEmail(order({ shippingMethod: "RETIRO" }), "ENVIADO");
    assert.match(sent[0].subject, /listo para retirar/);
  });
});

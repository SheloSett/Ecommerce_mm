// Tests de la hoja de la etiqueta de envío (utils/shippingLabel.js). Correr con: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { labelDocumentHtml, labelFromOrder, DEFAULT_SENDER } from "./shippingLabel.js";

const label = { recipientName: "Juan <b>Prueba</b>", recipientDetails: "Calle 1\nCiudad", transport: "VIA CARGO", insurance: "$ MINIMO", sender: DEFAULT_SENDER };

test("los datos van escapados: un nombre con < > no se vuelve HTML", () => {
  const html = labelDocumentHtml(label);
  assert.ok(html.includes("Juan &lt;b&gt;Prueba&lt;/b&gt;"));
  assert.ok(!html.includes("<b>Prueba</b>"));
});

test("hoja de 150 × 100 apaisada; girada, de 100 × 150", () => {
  assert.match(labelDocumentHtml(label), /@page \{ size: 150mm 100mm;/);
  const rot = labelDocumentHtml(label, { rotate: true });
  assert.match(rot, /@page \{ size: 100mm 150mm;/);
  assert.match(rot, /rotate\(90deg\)/);
});

test("bultos: nunca menos de 1 ni el total menor que el actual", () => {
  assert.match(labelDocumentHtml(label, { packages: { current: 2, total: 3 } }), />2<span class="sep">\/<\/span>3</);
  assert.match(labelDocumentHtml(label, { packages: { current: 0, total: "" } }), />1<span class="sep">\/<\/span>1</);
  assert.match(labelDocumentHtml(label, { packages: { current: 4, total: 2 } }), />4<span class="sep">\/<\/span>4</);
});

test("solo la impresión se manda a imprimir sola", () => {
  assert.ok(!labelDocumentHtml(label).includes("window.print(); }, 150)"));
  assert.ok(labelDocumentHtml(label, { forPrint: true }).includes("window.print(); }, 150)"));
});

test("etiqueta nueva desde un pedido: nombre, dirección, teléfono y remitente por defecto", () => {
  const l = labelFromOrder({ customerId: 7, customerName: "Ana Gómez", customerPhone: "11-2222-3333", shippingMethod: "MOTO" }, ["Calle 1", "CABA · CP 1000"]);
  assert.equal(l.customerId, 7);
  assert.equal(l.recipientName, "Ana Gómez");
  assert.equal(l.recipientDetails, "Calle 1\nCABA · CP 1000\nTel: 11-2222-3333");
  assert.equal(l.transport, "MOTO");
  assert.equal(l.sender, DEFAULT_SENDER);
});

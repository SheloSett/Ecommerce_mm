// Tests de los textos de entrega. Correr con: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryAddressOf, formatDeliveryDate, shippingAddressLines, motoDeliveryText } from "./shipping.js";

test("el día de entrega no se corre con el huso horario", () => {
  assert.equal(formatDeliveryDate("2026-11-02"), "lunes 2/11");
  assert.equal(formatDeliveryDate("2026-12-25"), "viernes 25/12");
  assert.equal(formatDeliveryDate(null), "");
});

test("la dirección en renglones, sin los campos vacíos", () => {
  assert.deepEqual(
    shippingAddressLines({ streetName: "Rivadavia", streetNumber: "100", floor: "2", apartment: "B", city: "Morón", provinceCode: "B", postalCode: "1708", references: "Timbre 3", recipientName: "Beto" }),
    ["Rivadavia 100, Piso 2 Dpto B", "Morón, Buenos Aires · CP 1708", "Indicaciones: Timbre 3", "Recibe: Beto"]
  );
  assert.deepEqual(shippingAddressLines({ streetName: "Rivadavia", streetNumber: "100", city: "Almagro", provinceCode: "C", postalCode: "1235" }), ["Rivadavia 100", "Almagro, CABA · CP 1235"]);
  assert.deepEqual(shippingAddressLines(null), []);
});

test("la dirección que se muestra depende de cómo se entrega hoy el pedido", () => {
  const shippingAddress = { streetName: "Rivadavia", zoneName: "Zona 1", deliveryDate: "2026-11-03", reviewCity: true };
  assert.equal(deliveryAddressOf({ shippingMethod: "MOTO", shippingAddress }), shippingAddress);
  assert.deepEqual(deliveryAddressOf({ shippingMethod: "CORREO_ARGENTINO", shippingAddress }), { streetName: "Rivadavia" });
  assert.equal(deliveryAddressOf({ shippingMethod: "RETIRO", shippingAddress }), null);
  assert.equal(deliveryAddressOf({ shippingMethod: "MOTO" }), null);
  assert.equal(deliveryAddressOf(null), null);
});

test("la promesa de la moto según la cotización", () => {
  assert.equal(motoDeliveryText({ sameDay: true, label: "hoy", cutoffTime: "13:30" }), "Llega hoy si comprás antes de las 13:30 hs");
  assert.equal(motoDeliveryText({ sameDay: false, label: "mañana", cutoffTime: "13:30" }), "Llega mañana");
  assert.equal(motoDeliveryText({ sameDay: false, label: "el lunes 9/11", cutoffTime: "13:30" }), "Llega el lunes 9/11");
  assert.equal(motoDeliveryText(null), "");
});

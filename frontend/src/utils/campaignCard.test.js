// Tests de los textos de la tarjeta de campaña del Home (campaignCard.js). Correr con: npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { badgeParts, badgeFor, endsLabel, textColorFor } from "./campaignCard.js";

describe("descuento de la tarjeta", () => {
  test("porcentaje y monto fijo", () => {
    assert.deepEqual(badgeParts({ value: 10, upTo: false }, "PERCENTAGE"), { prefix: null, amount: "10%", suffix: "OFF" });
    assert.deepEqual(badgeParts({ value: 20, upTo: true }, "PERCENTAGE"), { prefix: "Hasta", amount: "20%", suffix: "OFF" });
    assert.equal(badgeParts({ value: 5000, upTo: false }, "FIXED").amount, "$ 5.000");
  });

  test("sin descuento para quien mira → nada", () => {
    assert.equal(badgeParts(null, "PERCENTAGE"), null);
  });

  test("el mayorista ve el suyo; el minorista, el minorista", () => {
    const offer = { badges: { retail: { value: 10 }, wholesale: { value: 15 } } };
    assert.equal(badgeFor(offer, "MAYORISTA").value, 15);
    assert.equal(badgeFor(offer, "MINORISTA").value, 10);
    // sin el de mayoristas en la respuesta (cuenta no aprobada) cae al minorista
    assert.equal(badgeFor({ badges: { retail: { value: 10 } } }, "MAYORISTA").value, 10);
    // campaña solo mayorista vista por un mayorista
    assert.equal(badgeFor({ badges: { retail: null, wholesale: { value: 12 } } }, "MAYORISTA").value, 12);
  });
});

describe("cuánto falta", () => {
  const now = new Date(2026, 9, 6, 10, 0); // 6/10 10:00
  test("por días de calendario", () => {
    assert.equal(endsLabel(new Date(2026, 9, 6, 23, 59), now), "¡Termina hoy!");
    assert.equal(endsLabel(new Date(2026, 9, 7, 1, 0), now), "Termina mañana");
    assert.equal(endsLabel(new Date(2026, 9, 10, 9, 0), now), "Quedan 4 días");
    assert.equal(endsLabel(new Date(2026, 9, 19, 9, 0), now), "Hasta el 19/10");
  });
  test("ya terminó o sin fecha → nada", () => {
    assert.equal(endsLabel(new Date(2026, 9, 5), now), null);
    assert.equal(endsLabel(null, now), null);
  });
});

describe("color del texto", () => {
  test("fondo claro → texto oscuro; fondo oscuro → blanco", () => {
    assert.equal(textColorFor("#ffd6e8"), "#0b1c30");
    assert.equal(textColorFor("#ffffff"), "#0b1c30");
    assert.equal(textColorFor("#c2185b"), "#ffffff");
    assert.equal(textColorFor("#0b1c30"), "#ffffff");
    assert.equal(textColorFor("cualquier cosa"), "#ffffff");
  });
});

// Tests del descuento por monto del lado del navegador (cartPromo.js). Correr con: npm test
// Las cuentas tienen que dar lo mismo que backend/test/cartPromo.test.js: el carrito muestra lo que
// después cobra el servidor.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizePromoTiers, promoTierFor, cartPromoSummary } from "./cartPromo.js";

const BF = { id: 1, name: "Black Friday", appliesTo: "AMBOS", tiers: [{ minAmount: 200000, percent: 10 }, { minAmount: 100000, percent: 5 }] };

describe("escalones", () => {
  test("ordenados y sin lo inválido", () => {
    assert.deepEqual(normalizePromoTiers([...BF.tiers, { minAmount: 5, percent: 0 }]).map((t) => t.minAmount), [100000, 200000]);
  });

  test("el más alto alcanzado; justo en el monto cuenta", () => {
    assert.equal(promoTierFor(BF.tiers, 99999), null);
    assert.equal(promoTierFor(BF.tiers, 100000).percent, 5);
    assert.equal(promoTierFor(BF.tiers, 200000).percent, 10);
  });
});

describe("resumen para el carrito", () => {
  test("antes del primer escalón: sin descuento y cuánto falta", () => {
    const s = cartPromoSummary([BF], 60000, "MINORISTA");
    assert.deepEqual([s.percent, s.discount, s.available], [0, 0, true]);
    assert.deepEqual([s.next.percent, s.next.missing], [5, 40000]);
  });

  test("en el primer escalón: el descuento y lo que falta para el siguiente", () => {
    const s = cartPromoSummary([BF], 150000, "MINORISTA");
    assert.deepEqual([s.promo.id, s.percent, s.discount], [1, 5, 7500]);
    assert.deepEqual([s.next.percent, s.next.missing], [10, 50000]);
  });

  test("en el último escalón: no hay siguiente", () => {
    const s = cartPromoSummary([BF], 250000, "MINORISTA");
    assert.deepEqual([s.percent, s.discount, s.next], [10, 25000, null]);
  });

  test("una promo de mayoristas no aparece para un minorista", () => {
    const s = cartPromoSummary([{ ...BF, appliesTo: "MAYORISTA" }], 250000, "MINORISTA");
    assert.deepEqual([s.percent, s.available, s.next], [0, false, null]);
    assert.equal(cartPromoSummary([{ ...BF, appliesTo: "MAYORISTA" }], 250000, "MAYORISTA").percent, 10);
  });

  test("una promo que ya terminó (pestaña abierta de antes) no se muestra", () => {
    const s = cartPromoSummary([{ ...BF, endsAt: "2026-11-30T03:00:00Z" }], 250000, "MINORISTA", new Date("2026-11-30T03:00:01Z"));
    assert.equal(s.available, false);
  });

  test("con dos promos gana la que más da con ese monto", () => {
    const cyber = { id: 2, name: "Cyber", appliesTo: "AMBOS", tiers: [{ minAmount: 150000, percent: 8 }] };
    assert.equal(cartPromoSummary([BF, cyber], 160000, "MINORISTA").promo.id, 2);
    assert.equal(cartPromoSummary([BF, cyber], 210000, "MINORISTA").promo.id, 1);
  });
});

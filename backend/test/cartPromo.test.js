// Tests del descuento por monto de compra (Black Friday, 23/11/2026): las reglas puras de
// utils/cartPromo.js, cómo entra en computeOrderTotals y la validación del panel. Correr con: npm test

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { normalizePromoTiers, promoTierFor, nextPromoTier, promoAppliesTo, isPromoLive, bestPromoFor } = require("../src/utils/cartPromo");
const { computeOrderTotals } = require("../src/utils/orderTotals");
const { parsePromoBody, withState } = require("../src/controllers/cartPromo.controller");

const TIERS = [{ minAmount: 200000, percent: 10 }, { minAmount: 100000, percent: 5 }]; // desordenados a propósito
const ars = (price, quantity = 1, productId = 1) => ({ price, quantity, currency: "ARS", productId });
const usd = (price, quantity = 1, productId = 2) => ({ price, quantity, currency: "USD", productId });

describe("escalones", () => {
  test("se ordenan y se descarta lo inválido", () => {
    assert.deepEqual(normalizePromoTiers([...TIERS, { minAmount: "x", percent: 5 }, { minAmount: 10, percent: 0 }, { minAmount: 10, percent: 120 }]),
      [{ minAmount: 100000, percent: 5 }, { minAmount: 200000, percent: 10 }]);
    assert.deepEqual(normalizePromoTiers(null), []);
  });

  test("aplica el escalón más alto alcanzado; justo en el monto cuenta", () => {
    assert.equal(promoTierFor(TIERS, 99999), null);
    assert.equal(promoTierFor(TIERS, 100000).percent, 5);
    assert.equal(promoTierFor(TIERS, 199999).percent, 5);
    assert.equal(promoTierFor(TIERS, 250000).percent, 10);
  });

  test("el próximo escalón, para el aviso de cuánto falta", () => {
    assert.equal(nextPromoTier(TIERS, 50000).minAmount, 100000);
    assert.equal(nextPromoTier(TIERS, 150000).minAmount, 200000);
    assert.equal(nextPromoTier(TIERS, 300000), null);
  });

  test("para quién y cuándo", () => {
    assert.equal(promoAppliesTo({ appliesTo: "AMBOS" }, "MAYORISTA"), true);
    assert.equal(promoAppliesTo({ appliesTo: "MINORISTA" }, "MAYORISTA"), false);
    assert.equal(promoAppliesTo({ appliesTo: "MINORISTA" }, undefined), true); // sin tipo = minorista
    const now = new Date("2026-11-27T12:00:00Z");
    const p = { active: true, startsAt: "2026-11-23T03:00:00Z", endsAt: "2026-11-30T03:00:00Z" };
    assert.equal(isPromoLive(p, now), true);
    assert.equal(isPromoLive({ ...p, active: false }, now), false);
    assert.equal(isPromoLive(p, new Date("2026-11-30T03:00:00Z")), false); // el fin no entra
  });

  test("entre dos promos gana la que más da con ESE monto", () => {
    const a = { id: 1, tiers: [{ minAmount: 100000, percent: 5 }] };
    const b = { id: 2, tiers: [{ minAmount: 300000, percent: 20 }] };
    assert.equal(bestPromoFor([a, b], 150000).promo.id, 1);
    assert.equal(bestPromoFor([a, b], 300000).promo.id, 2);
    assert.equal(bestPromoFor([a, b], 1000), null);
  });
});

describe("computeOrderTotals con promo", () => {
  test("descuenta el % del escalón sobre los pesos", () => {
    const t = computeOrderTotals({ items: [ars(150000)], promo: { tiers: TIERS } });
    assert.deepEqual([t.promoPercent, t.promoDiscountArs, t.totalArs], [5, 7500, 142500]);
  });

  test("las líneas en dólares no suman para el escalón ni se descuentan", () => {
    const t = computeOrderTotals({ items: [ars(90000), usd(5000)], promo: { tiers: TIERS } });
    assert.deepEqual([t.promoPercent, t.totalArs, t.totalUsd], [0, 90000, 5000]);
    const t2 = computeOrderTotals({ items: [ars(100000), usd(50)], promo: { tiers: TIERS } });
    assert.deepEqual([t2.promoDiscountArs, t2.totalUsd], [5000, 50]);
  });

  test("el envío no cuenta ni se descuenta", () => {
    const t = computeOrderTotals({ items: [ars(95000)], shippingCost: 10000, promo: { tiers: TIERS } });
    assert.deepEqual([t.promoPercent, t.totalArs], [0, 105000]);
  });

  test("con cupón: el cupón va sobre lo que dejó la promo", () => {
    const t = computeOrderTotals({ items: [ars(200000)], promo: { tiers: TIERS }, coupon: { discountType: "PERCENTAGE", discountValue: 10 } });
    assert.deepEqual([t.promoDiscountArs, t.couponDiscountArs, t.totalArs], [20000, 18000, 162000]);
    const fijo = computeOrderTotals({ items: [ars(100000)], promo: { tiers: TIERS }, coupon: { discountType: "FIXED", discountValue: 999999 } });
    assert.equal(fijo.totalArs, 0, "un cupón fijo enorme deja en 0, nunca negativo");
  });

  test("con IVA (mayorista con factura): el IVA va sobre la base ya descontada", () => {
    const t = computeOrderTotals({ items: [ars(100000, 1, 1), ars(100000, 1, 2)], ivaRates: { 1: 21, 2: 10.5 }, promo: { tiers: TIERS } });
    // 200.000 − 10% = 180.000 → 90.000 × 21% + 90.000 × 10,5%
    assert.equal(t.ivaAmountArs, 28350);
    assert.equal(t.totalArs, 208350);
  });

  test("sin promo da exactamente lo mismo que antes", () => {
    const sin = computeOrderTotals({ items: [ars(10000), usd(100)], coupon: { discountType: "PERCENTAGE", discountValue: 10 }, manualDiscount: { type: "FIXED", value: 500 } });
    assert.deepEqual([sin.totalArs, sin.totalUsd, sin.promoDiscountArs], [8500, 90, 0]);
  });
});

describe("validación del panel", () => {
  const ok = { name: "Black Friday", appliesTo: "MINORISTA", startsAt: "2026-11-23T03:00:00Z", endsAt: "2026-11-30T03:00:00Z", tiers: TIERS };

  test("una promo bien cargada pasa, con los escalones ordenados", () => {
    const { data, error } = parsePromoBody(ok);
    assert.equal(error, undefined);
    assert.deepEqual(data.tiers.map((t) => t.minAmount), [100000, 200000]);
    assert.equal(data.active, true);
  });

  test("lo que se rechaza", () => {
    assert.ok(parsePromoBody({ ...ok, name: "  " }).error);
    assert.ok(parsePromoBody({ ...ok, tiers: [] }).error);
    assert.ok(parsePromoBody({ ...ok, tiers: [{ minAmount: 1000, percent: "abc" }] }).error);
    assert.ok(parsePromoBody({ ...ok, tiers: [{ minAmount: 1000, percent: 5 }, { minAmount: 1000, percent: 8 }] }).error, "mismo monto dos veces");
    assert.ok(parsePromoBody({ ...ok, tiers: [{ minAmount: 1000, percent: 10 }, { minAmount: 5000, percent: 5 }] }).error, "más plata, menos %");
    assert.ok(parsePromoBody({ ...ok, appliesTo: "TODOS" }).error);
    assert.ok(parsePromoBody({ ...ok, endsAt: ok.startsAt }).error);
  });

  test("editar solo el interruptor mantiene el resto", () => {
    const { data, error } = parsePromoBody({ active: false }, { ...ok, active: true });
    assert.equal(error, undefined);
    assert.equal(data.active, false);
    assert.equal(data.name, "Black Friday");
  });

  test("estado para el listado", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    const base = { active: true, startsAt: "2026-11-23T03:00:00Z", endsAt: "2026-11-30T03:00:00Z" };
    assert.equal(withState(base, now).state, "VIGENTE");
    assert.equal(withState({ ...base, active: false }, now).state, "PAUSADA");
    assert.equal(withState({ ...base, startsAt: "2026-11-26T03:00:00Z" }, now).state, "PROGRAMADA");
    assert.equal(withState({ ...base, endsAt: "2026-11-24T03:00:00Z" }, now).state, "TERMINADA");
  });
});

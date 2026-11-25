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

// 23/11/2026: cómo se ve la promo (tarjeta del inicio y aviso del carrito), como las campañas
describe("estilo de la promo", () => {
  const ok = { name: "Black Friday", appliesTo: "AMBOS", startsAt: "2026-11-23T03:00:00Z", endsAt: "2026-11-30T03:00:00Z", tiers: TIERS };

  test("sin elegir nada: Black Friday, con tarjeta y cuenta regresiva", () => {
    const { data } = parsePromoBody(ok);
    assert.deepEqual([data.cardStyle, data.cardColor, data.showCard, data.showCountdown, data.description], ["blackfriday", null, true, true, null]);
  });

  test("color propio: se guarda en minúscula y es obligatorio con ese estilo", () => {
    assert.equal(parsePromoBody({ ...ok, cardStyle: "color", cardColor: "#D81B60" }).data.cardColor, "#d81b60");
    assert.ok(parsePromoBody({ ...ok, cardStyle: "color" }).error);
    assert.ok(parsePromoBody({ ...ok, cardColor: "rojo" }).error);
  });

  test("un estilo que no existe se rechaza", () => {
    assert.ok(parsePromoBody({ ...ok, cardStyle: "<script>" }).error);
  });

  test("apagar la tarjeta o la cuenta regresiva, y el subtítulo", () => {
    const { data } = parsePromoBody({ ...ok, showCard: false, showCountdown: false, description: "  Envíos a todo el país  " });
    assert.deepEqual([data.showCard, data.showCountdown, data.description], [false, false, "Envíos a todo el país"]);
    assert.ok(parsePromoBody({ ...ok, description: "x".repeat(141) }).error);
  });

  test("editar solo el interruptor conserva el estilo guardado", () => {
    const { data } = parsePromoBody({ active: false }, { ...ok, cardStyle: "cybermonday", showCard: false, description: "Hasta el lunes" });
    assert.deepEqual([data.cardStyle, data.showCard, data.description, data.active], ["cybermonday", false, "Hasta el lunes", false]);
  });
});

// 24/11/2026: la promo puede ser para algunas categorías o productos. El monto se mide y el % se descuenta
// solo sobre esos productos; el resto del carrito se cobra normal.
describe("promo para algunos productos", () => {
  const { promoBaseAmount, bestPromoForItems, promoSnapshot } = require("../src/utils/cartPromo");
  const T = [{ minAmount: 100000, percent: 10 }];

  test("lo que cuenta: solo las líneas en pesos de los productos que entran", () => {
    const items = [ars(80000, 1, 1), ars(50000, 1, 2), usd(500, 1, 1), { price: 30000, quantity: 1, currency: "ARS", productId: null }];
    assert.equal(promoBaseAmount(items, null), 160000, "sin elegir: todos los pesos, incluido el ítem libre");
    assert.equal(promoBaseAmount(items, [1]), 80000, "solo el producto 1, sin los dólares");
    assert.equal(promoBaseAmount(items, []), 0, "lista vacía resuelta: ninguno entra");
  });

  test("computeOrderTotals mide y descuenta solo lo que entra", () => {
    const items = [ars(80000, 1, 1), ars(50000, 1, 2)];
    // El 1 solo no llega a $100.000: sin descuento aunque el pedido sume $130.000
    let t = computeOrderTotals({ items, promo: { tiers: T, productIds: [1] } });
    assert.equal(t.promoPercent, 0);
    assert.equal(t.totalArs, 130000);
    // Con 2 del producto 1 llega: 10% de $160.000, el producto 2 se cobra entero
    t = computeOrderTotals({ items: [ars(80000, 2, 1), ars(50000, 1, 2)], promo: { tiers: T, productIds: [1] } });
    assert.equal(t.promoPercent, 10);
    assert.equal(t.promoDiscountArs, 16000);
    assert.equal(t.totalArs, 210000 - 16000);
    // Sin productIds, como antes: todo el pedido
    assert.equal(computeOrderTotals({ items, promo: { tiers: T } }).promoDiscountArs, 13000);
  });

  test("entre dos promos gana la que más da con lo que el pedido tiene de cada una", () => {
    const items = [ars(120000, 1, 1), ars(30000, 1, 2)];
    const general = { id: 1, tiers: [{ minAmount: 100000, percent: 5 }], eligibleProductIds: null };
    const audio = { id: 2, tiers: [{ minAmount: 100000, percent: 15 }], eligibleProductIds: [2] };
    assert.equal(bestPromoForItems([general, audio], items).promo.id, 1, "la de audio no llega con $30.000");
    const best = bestPromoForItems([general, { ...audio, eligibleProductIds: [1] }], items);
    assert.equal(best.promo.id, 2);
    assert.equal(best.base, 120000);
  });

  test("el pedido guarda qué productos entraban (solo si la promo es para algunos)", () => {
    assert.deepEqual(promoSnapshot({ name: "Audio", tiers: T, eligibleProductIds: [3, 4] }).productIds, [3, 4]);
    assert.equal(promoSnapshot({ name: "Todo", tiers: T, eligibleProductIds: null }).productIds, undefined);
  });

  test("el panel guarda categorías y productos sin repetidos ni basura; vacías = todos", () => {
    const ok = { name: "Audio", appliesTo: "AMBOS", startsAt: "2026-11-23T03:00:00Z", endsAt: "2026-11-30T03:00:00Z", tiers: T };
    const { data } = parsePromoBody({ ...ok, categoryIds: [5, "5", "x", -1, 7], productIds: ["12", 12, 0] });
    assert.deepEqual(data.categoryIds, [5, 7]);
    assert.deepEqual(data.productIds, [12]);
    const todos = parsePromoBody(ok).data;
    assert.deepEqual([todos.categoryIds, todos.productIds], [[], []]);
    assert.ok(parsePromoBody({ ...ok, productIds: Array.from({ length: 20001 }, (_, i) => i + 1) }).error);
    // Editar otra cosa conserva lo elegido
    assert.deepEqual(parsePromoBody({ active: false }, { ...ok, categoryIds: [9], productIds: [] }).data.categoryIds, [9]);
  });
});

// Escalones propios para mayoristas (25/11/2026): una promo para los dos con otros escalones y otro % para
// los mayoristas (wholesaleTiers).
describe("escalones para mayoristas", () => {
  const { promoForCustomer } = require("../src/utils/cartPromo");
  const { Prisma } = require("@prisma/client");
  const MIN = [{ minAmount: 100000, percent: 5 }];
  const MAY = [{ minAmount: 150000, percent: 5 }, { minAmount: 500000, percent: 8 }];
  const promo = { id: 1, name: "Black Friday", appliesTo: "AMBOS", tiers: MIN, wholesaleTiers: MAY };

  test("el mayorista recibe sus escalones y la promo marcada como exclusiva; el minorista, los de siempre", () => {
    const may = promoForCustomer(promo, "MAYORISTA");
    assert.deepEqual([may.tiers, may.appliesTo, may.wholesaleTiers], [MAY, "MAYORISTA", undefined]);
    const min = promoForCustomer(promo, "MINORISTA");
    assert.deepEqual([min.tiers, min.appliesTo, min.wholesaleTiers], [MIN, "AMBOS", undefined]);
  });

  test("sin escalones de mayoristas, o en una promo solo para un tipo, no cambia nada", () => {
    assert.deepEqual(promoForCustomer({ ...promo, wholesaleTiers: null }, "MAYORISTA").tiers, MIN);
    assert.deepEqual(promoForCustomer({ ...promo, wholesaleTiers: [] }, "MAYORISTA").appliesTo, "AMBOS");
    assert.deepEqual(promoForCustomer({ ...promo, appliesTo: "MAYORISTA" }, "MAYORISTA").tiers, MIN);
  });

  test("aplicarla dos veces da lo mismo (el carrito la recibe ya resuelta del servidor)", () => {
    const una = promoForCustomer(promo, "MAYORISTA");
    assert.deepEqual(promoForCustomer(una, "MAYORISTA"), una);
  });

  test("el panel guarda los escalones de mayoristas solo en una promo para los dos", () => {
    const ok = { name: "Black Friday", appliesTo: "AMBOS", startsAt: "2026-11-23T03:00:00Z", endsAt: "2026-11-30T03:00:00Z", tiers: MIN };
    assert.deepEqual(parsePromoBody({ ...ok, wholesaleTiers: [MAY[1], MAY[0]] }).data.wholesaleTiers, MAY, "ordenados");
    assert.equal(parsePromoBody(ok).data.wholesaleTiers, Prisma.DbNull, "sin mandar = los mismos que minoristas");
    assert.equal(parsePromoBody({ ...ok, wholesaleTiers: [] }).data.wholesaleTiers, Prisma.DbNull);
    assert.equal(parsePromoBody({ ...ok, appliesTo: "MAYORISTA", wholesaleTiers: MAY }).data.wholesaleTiers, Prisma.DbNull, "solo mayoristas: usa tiers");
    const mal = parsePromoBody({ ...ok, wholesaleTiers: [{ minAmount: 1000, percent: 10 }, { minAmount: 5000, percent: 5 }] }).error;
    assert.match(mal, /de mayoristas/);
    // Editar otra cosa conserva los de mayoristas
    assert.deepEqual(parsePromoBody({ active: false }, { ...ok, wholesaleTiers: MAY }).data.wholesaleTiers, MAY);
  });
});

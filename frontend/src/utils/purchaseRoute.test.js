// Tests del orden por recorrido de la orden de compra (purchaseRoute.js).
// Correr con: npm test (en frontend). No es parte de la tienda: Vite no lo incluye en el build.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { planRoute, routeLegs, walkMeters, googleMapsUrl, formatMeters } from "./purchaseRoute.js";

// Generador pseudoaleatorio con semilla, para que los casos al azar sean siempre los mismos.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
// Puntos al azar dentro de unas 10 × 10 cuadras de Once.
function randomStops(n, rand, withTiers) {
  return Array.from({ length: n }, (_, i) => ({
    key: `s${i}`,
    point: { lat: -34.61 + rand() * 0.009, lng: -58.405 + rand() * 0.011 },
    tier: withTiers ? Math.floor(rand() * 3) : 0,
  }));
}
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}
// El mejor costo posible probando TODOS los órdenes que respetan los niveles.
function bruteForceBest(stops, start, useTiers) {
  let best = Infinity;
  for (const perm of permutations(stops)) {
    const tiers = perm.map((s) => (useTiers ? s.tier : 0));
    if (tiers.some((t, i) => i > 0 && t < tiers[i - 1])) continue;
    best = Math.min(best, routeLegs(start, perm).total);
  }
  return best;
}
const tiersInOrder = (order, stops) => order.map((k) => stops.find((s) => s.key === k).tier);
const HOME = { lat: -34.624302, lng: -58.427245 }; // Av La Plata 744

describe("planRoute", () => {
  test("camino más corto: igual al mejor posible (contra fuerza bruta, 40 casos al azar)", () => {
    const rand = rng(7);
    for (let c = 0; c < 40; c++) {
      const stops = randomStops(2 + (c % 6), rand, false);
      const start = c % 2 ? HOME : null;
      const plan = planRoute({ start, stops });
      assert.ok(Math.abs(plan.total - bruteForceBest(stops, start, false)) < 1e-6, `caso ${c}`);
    }
  });

  test("bultosos al final: respeta los niveles y es el mejor posible con esa regla", () => {
    const rand = rng(11);
    for (let c = 0; c < 40; c++) {
      const stops = randomStops(3 + (c % 5), rand, true);
      const plan = planRoute({ start: HOME, stops, useTiers: true });
      const tiers = tiersInOrder(plan.order, stops);
      assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b), `caso ${c}: niveles fuera de orden`);
      assert.ok(Math.abs(plan.total - bruteForceBest(stops, HOME, true)) < 1e-6, `caso ${c}`);
    }
  });

  test("sin marcar niveles, 'bultosos al final' da lo mismo que el camino más corto", () => {
    const stops = randomStops(6, rng(3), false);
    assert.deepEqual(planRoute({ start: HOME, stops, useTiers: true }).order, planRoute({ start: HOME, stops }).order);
  });

  test("desde casa arranca por el proveedor más cercano a casa si está en el camino", () => {
    // Tres proveedores sobre la misma calle, alejándose de casa: el orden natural es de cerca a lejos.
    const stops = [
      { key: "lejos", point: { lat: -34.6063, lng: -58.3994 } },
      { key: "cerca", point: { lat: -34.6100, lng: -58.4050 } },
      { key: "medio", point: { lat: -34.6080, lng: -58.4020 } },
    ];
    assert.deepEqual(planRoute({ start: HOME, stops }).order, ["cerca", "medio", "lejos"]);
  });

  test("los que no se pudieron ubicar van al final, en el orden en que llegaron", () => {
    const stops = [
      { key: "b", point: null },
      { key: "x", point: { lat: -34.6063, lng: -58.3994 } },
      { key: "a", point: null },
      { key: "y", point: { lat: -34.6070, lng: -58.3990 } },
    ];
    const plan = planRoute({ start: HOME, stops });
    assert.deepEqual(plan.order.slice(2), ["b", "a"]);
    assert.ok(!("a" in plan.legs) && !("b" in plan.legs));
  });

  test("muchos proveedores (más que el cálculo exacto): orden válido y respeta los niveles", () => {
    const stops = randomStops(19, rng(5), true);
    const plan = planRoute({ start: HOME, stops, useTiers: true });
    assert.equal(new Set(plan.order).size, 19);
    const tiers = tiersInOrder(plan.order, stops);
    assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b));
    // No puede ser peor que recorrerlos en el orden en que vinieron (con los niveles ordenados).
    const naive = [...stops].sort((a, b) => a.tier - b.tier);
    assert.ok(plan.total <= routeLegs(HOME, naive).total + 1e-6);
  });

  test("sin salida cargada, el primer tramo no suma", () => {
    const stops = randomStops(4, rng(9), false);
    const plan = planRoute({ start: null, stops });
    assert.equal(plan.legs[plan.order[0]], null);
  });
});

describe("walkMeters / formatMeters", () => {
  test("una cuadra de Pasteur (288 → 348) da unos 100 m", () => {
    const m = walkMeters({ lat: -34.606315, lng: -58.399368 }, { lat: -34.605407, lng: -58.399454 });
    assert.ok(m > 90 && m < 120, `dio ${m}`);
  });
  test("routeLegs separa el viaje desde la salida de lo que se camina entre proveedores", () => {
    const a = { key: "a", point: { lat: -34.6063, lng: -58.3994 } };
    const b = { key: "b", point: { lat: -34.6054, lng: -58.3994 } };
    const r = routeLegs(HOME, [a, b]);
    assert.ok(r.fromStart > 3000, "casa → Once son varios km");
    assert.ok(Math.abs(r.between - walkMeters(a.point, b.point)) < 1e-6);
    assert.ok(Math.abs(r.total - (r.fromStart + r.between)) < 1e-6);
    const sinSalida = routeLegs(null, [a, b]);
    assert.equal(sinSalida.fromStart, 0);
    assert.ok(Math.abs(sinSalida.between - sinSalida.total) < 1e-6);
  });
  test("formato", () => {
    assert.equal(formatMeters(0), "0 m");
    assert.equal(formatMeters(12), "≈ 50 m");
    assert.equal(formatMeters(348), "≈ 350 m");
    assert.equal(formatMeters(1234), "≈ 1,2 km");
  });
});

describe("googleMapsUrl", () => {
  const P = (i) => ({ lat: -34.6 - i / 1000, lng: -58.4 });
  test("desde casa: origen casa, destino la última parada, el resto intermedias", () => {
    const { url, truncated } = googleMapsUrl(HOME, [P(1), P(2), P(3)]);
    const q = new URL(url).searchParams;
    assert.equal(q.get("origin"), "-34.624302,-58.427245");
    assert.equal(q.get("destination"), "-34.603000,-58.400000");
    assert.equal(q.get("waypoints"), "-34.601000,-58.400000|-34.602000,-58.400000");
    assert.equal(q.get("travelmode"), "walking");
    assert.equal(truncated, false);
  });
  test("más de 10 paradas: el link cubre las primeras 10 y avisa", () => {
    const { url, truncated } = googleMapsUrl(HOME, Array.from({ length: 12 }, (_, i) => P(i)));
    assert.equal(new URL(url).searchParams.get("waypoints").split("|").length, 9);
    assert.equal(truncated, true);
  });
  test("una sola parada sin salida: link a ese punto", () => {
    assert.match(googleMapsUrl(null, [P(1)]).url, /maps\/search\/\?api=1&query=-34\.601000,-58\.400000$/);
  });
  test("sin paradas ubicadas: null", () => {
    assert.equal(googleMapsUrl(HOME, [null, null]), null);
  });
});

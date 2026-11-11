// Tests de los textos del historial de stock. Correr con: npm test (desde frontend/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { reasonLabel, changeText, shortfallOf, refOf, unitLabel, movementDate } from "./stockMovements.js";

test("motivos en castellano, y el código tal cual si es uno nuevo", () => {
  assert.equal(reasonLabel("VENTA"), "Venta");
  assert.equal(reasonLabel("AJUSTE"), "Carga a mano");
  assert.equal(reasonLabel("VENTA_ML"), "Venta en Mercado Libre");
  assert.equal(reasonLabel("OTRO_NUEVO"), "OTRO_NUEVO");
  assert.equal(reasonLabel(undefined), "Otro");
});

test("el cambio lleva signo", () => {
  assert.equal(changeText(5), "+5");
  assert.equal(changeText(-3), "-3");
  assert.equal(changeText(0), "0");
});

test("faltante: lo que se pidió y no había", () => {
  assert.equal(shortfallOf({ requested: -5, delta: -2 }), 3);
  assert.equal(shortfallOf({ requested: -2, delta: -2 }), 0);
  assert.equal(shortfallOf({ requested: null, delta: -6 }), 0, "carga a mano: no hay faltante");
  assert.equal(shortfallOf({ requested: 4, delta: 4 }), 0);
});

test("a qué corresponde: el pedido lleva a su pantalla", () => {
  assert.deepEqual(refOf({ refType: "order", refId: "167" }), { text: "Pedido #167", to: "/admin/ordenes/167" });
  assert.deepEqual(refOf({ refType: "purchase", refId: "9" }), { text: "Compra #9", to: null });
  assert.equal(refOf({ refType: null, refId: null }), null);
});

test("variante: su nombre, o el número si ya no existe", () => {
  assert.equal(unitLabel({ variantId: 31 }, { 31: "Color: Negro" }), "Color: Negro");
  assert.equal(unitLabel({ variantId: 99 }, {}), "Variante #99 (ya no existe)");
  assert.equal(unitLabel({ variantId: null }, {}), null);
});

test("la fecha sale en hora argentina", () => {
  // 03:30 UTC del 12/11 son las 00:30 del 12/11 en Argentina
  assert.match(movementDate("2026-11-12T03:30:00Z"), /12\/11\/26.*00:30/);
  assert.equal(movementDate("no es una fecha"), "");
});

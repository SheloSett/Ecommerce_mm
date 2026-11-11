// Tests de los textos del panel de Mercado Libre. Correr con: npm test (desde frontend/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountStatus, poolStatus, numbersMatch, cycleKind, parseStockNumber, since } from "./mlTexts.js";

test("estado de la cuenta", () => {
  assert.equal(accountStatus("CONECTADA").tone, "ok");
  assert.equal(accountStatus("RECONECTAR").tone, "bad");
  assert.equal(accountStatus(undefined).text, "Sin conectar");
});

test("estado de un pozo", () => {
  assert.equal(poolStatus({ productId: null }).text, "Sin vincular");
  assert.equal(poolStatus({ productId: 1, status: "OK", active: false }).text, "Vinculado (sin activar)");
  assert.equal(poolStatus({ productId: 1, status: "OK", active: true }).text, "Compartiendo stock");
  assert.equal(poolStatus({ productId: 1, status: "REVISAR", active: true }).tone, "bad");
  assert.equal(poolStatus({ productId: 1, status: "CERRADO", active: true }).text, "Publicación cerrada");
});

test("los números coinciden o no", () => {
  assert.equal(numbersMatch({ unit: { qty: 5 }, mlQty: 5 }), true);
  assert.equal(numbersMatch({ unit: { qty: 5 }, mlQty: 4 }), false);
  assert.equal(numbersMatch({ unit: { qty: 5, stockUnlimited: true }, mlQty: 4 }), null);
  assert.equal(numbersMatch({ unit: null, mlQty: 4 }), null);
});

test("bitácora", () => {
  assert.equal(cycleKind("ESCRIBE"), "Escrito en Mercado Libre");
  assert.equal(cycleKind("NUEVO"), "NUEVO");
});

test("número de stock escrito a mano", () => {
  assert.equal(parseStockNumber("12"), 12);
  assert.equal(parseStockNumber(" 0 "), 0);
  for (const bad of ["", "-1", "3.5", "abc", "100000", null]) assert.equal(parseStockNumber(bad), null);
});

test("hace cuánto", () => {
  const now = new Date("2026-11-20T15:00:00Z");
  assert.equal(since(null, now), "nunca");
  assert.equal(since(new Date("2026-11-20T14:59:30Z"), now), "recién");
  assert.equal(since(new Date("2026-11-20T14:55:00Z"), now), "hace 5 min");
  assert.equal(since(new Date("2026-11-20T12:00:00Z"), now), "hace 3 h");
  assert.equal(since(new Date("2026-11-15T15:00:00Z"), now), "hace 5 días");
});

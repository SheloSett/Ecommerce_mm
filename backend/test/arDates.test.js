// Tests de los cortes de día de los reportes (utils/arDates.js). Correr con: npm test
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isDay, arDayStart, arDayEnd, dateOnlyStart, dateOnlyEnd } = require("../src/utils/arDates");

test("el día de los pedidos va de 00:00 a 23:59 hora argentina", () => {
  assert.equal(arDayStart("2026-10-01").toISOString(), "2026-10-01T03:00:00.000Z");
  assert.equal(arDayEnd("2026-10-31").toISOString(), "2026-11-01T02:59:59.999Z");
});

test("una venta del 31/10 a las 22:00 (hora argentina) entra en octubre", () => {
  const venta = new Date("2026-10-31T22:00:00-03:00");
  assert.ok(venta >= arDayStart("2026-10-01") && venta <= arDayEnd("2026-10-31"));
  assert.ok(!(venta >= arDayStart("2026-11-01")), "y no en noviembre");
});

test("un gasto (fecha sin hora, 00:00 UTC) entra en el día cargado", () => {
  const gasto = new Date("2026-10-01T00:00:00.000Z");
  assert.ok(gasto >= dateOnlyStart("2026-10-01") && gasto <= dateOnlyEnd("2026-10-31"));
  assert.ok(gasto > dateOnlyEnd("2026-09-30"), "y no en septiembre");
});

test("isDay acepta solo YYYY-MM-DD", () => {
  assert.ok(isDay("2026-10-30"));
  for (const v of ["30/10/2026", "2026-10-30T00:00", "", undefined, 20261030]) assert.equal(isDay(v), false);
});

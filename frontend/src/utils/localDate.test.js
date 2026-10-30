// Tests de las fechas del panel (utils/localDate.js). Correr con: npm test (en frontend)
import { test } from "node:test";
import assert from "node:assert/strict";
import { localDay, localTime, formatDateOnly } from "./localDate.js";

test("localDay usa el día de la computadora, también de noche", () => {
  assert.equal(localDay(new Date(2026, 9, 28, 22, 30)), "2026-10-28");
  assert.equal(localDay(new Date(2026, 0, 5, 0, 1)), "2026-01-05");
});

test("localTime en horas y minutos de la computadora", () => {
  assert.equal(localTime(new Date(2026, 9, 31, 23, 59)), "23:59");
});

test("una fecha sin hora (00:00 UTC) se muestra con el día cargado", () => {
  assert.equal(formatDateOnly("2026-10-28T00:00:00.000Z"), "28/10/2026");
});

test("ida y vuelta del vencimiento de un cupón: no se corre", () => {
  const guardado = new Date("2026-10-31T23:59:00").toISOString(); // lo que manda el form (hora local)
  const d = new Date(guardado);
  assert.equal(`${localDay(d)}T${localTime(d)}`, "2026-10-31T23:59");
});

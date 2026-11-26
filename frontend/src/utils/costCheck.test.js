import { test } from "node:test";
import assert from "node:assert/strict";
import { costoSobrePrecio, preciosBajoCosto } from "./costCheck.js";

test("costo mayor que el precio: avisa y sospecha de un cero de más", () => {
  // El caso real: cargador a $ 6.599 con el costo en 45.000 en vez de 4.500
  assert.deepEqual(costoSobrePrecio(45000, 6599), { cost: 45000, price: 6599, ceroDeMas: true });
});

test("costo mayor pero no por un cero: avisa sin la sospecha", () => {
  // Apenas por encima: no es un cero de más
  assert.deepEqual(costoSobrePrecio(8000, 6599), { cost: 8000, price: 6599, ceroDeMas: false });
  // Muy por encima, pero con un cero menos tampoco alcanza (dos ceros, otra cosa)
  assert.equal(costoSobrePrecio(80000, 6599).ceroDeMas, false);
});

test("costo menor o igual al precio: no avisa", () => {
  assert.equal(costoSobrePrecio(4500, 6599), null);
  assert.equal(costoSobrePrecio(6599, 6599), null);
});

test("valores vacíos, en 0 o que no son número: no avisa", () => {
  for (const [c, p] of [["", 100], [null, 100], [undefined, 100], [0, 100], [100, ""], [100, 0], ["abc", 10], [100, null]]) {
    assert.equal(costoSobrePrecio(c, p), null, `${c} / ${p}`);
  }
  // Lo que viene de un input es texto
  assert.ok(costoSobrePrecio("45000", "6599"));
});

test("ficha del producto: sin la sospecha si alguno de los precios no la tiene", () => {
  // contra el minorista (9.999) con un cero menos alcanza; contra el mayorista (4.000) no
  const r = preciosBajoCosto("45000", [{ label: "Precio minorista", value: "9999" }, { label: "Precio mayorista", value: "4000" }]);
  assert.equal(r.bajos.length, 2);
  assert.equal(r.ceroDeMas, false);
});

test("ficha del producto: qué precios quedan por debajo del costo", () => {
  const r = preciosBajoCosto("45000", [
    { label: "Precio minorista", value: "9999" },
    { label: "Oferta minorista", value: "" },
    { label: "Precio mayorista", value: "6599" },
  ]);
  assert.deepEqual(r.bajos, [{ label: "Precio minorista", price: 9999 }, { label: "Precio mayorista", price: 6599 }]);
  assert.equal(r.ceroDeMas, true);
});

test("ficha del producto: con un costo normal no hay nada", () => {
  const r = preciosBajoCosto("4500", [{ label: "Precio minorista", value: "9999" }, { label: "Precio mayorista", value: "6599" }]);
  assert.deepEqual(r, { bajos: [], ceroDeMas: false });
});

// Tests de "volver adonde estaba" después del login (utils/returnTo.js). Correr con: npm test (en frontend)
import { test } from "node:test";
import assert from "node:assert/strict";
import { withReturnTo, safeReturnTo } from "./returnTo.js";

test("el link al login recuerda la página (con su búsqueda)", () => {
  assert.equal(withReturnTo("/login", { pathname: "/producto/cable-usb", search: "?v=2" }), "/login?volver=%2Fproducto%2Fcable-usb%3Fv%3D2");
});

test("después de entrar vuelve a esa página", () => {
  assert.equal(safeReturnTo("?volver=%2Fproducto%2Fcable-usb%3Fv%3D2"), "/producto/cable-usb?v=2");
  assert.equal(safeReturnTo("?volver=/pagar-cotizacion/120"), "/pagar-cotizacion/120");
});

test("un destino afuera de la tienda se ignora", () => {
  for (const evil of ["https://otro-sitio.com", "//otro-sitio.com", "/\\otro-sitio.com", "javascript:alert(1)"]) {
    assert.equal(safeReturnTo(`?volver=${encodeURIComponent(evil)}`), "/", evil);
  }
});

test("sin destino, o si el destino es el login o el registro, va al de siempre", () => {
  assert.equal(safeReturnTo("", "/catalogo"), "/catalogo");
  assert.equal(safeReturnTo("?volver=/login", "/catalogo"), "/catalogo");
  assert.equal(safeReturnTo("?volver=/registro?x=1"), "/");
});

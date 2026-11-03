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

test("pasar del login al registro y volver conserva adónde iba, sin envolver la dirección", () => {
  const producto = { pathname: "/producto/cable-usb", search: "" };
  const registro = withReturnTo("/registro", producto);
  const [pathname, search] = registro.split("?");
  const login = withReturnTo("/login", { pathname, search: `?${search}` });
  assert.equal(login, "/login?volver=%2Fproducto%2Fcable-usb");
  assert.equal(withReturnTo("/registro", { pathname: "/login", search: login.slice(login.indexOf("?")) }), "/registro?volver=%2Fproducto%2Fcable-usb");
  assert.equal(withReturnTo("/login", { pathname: "/login", search: "" }), "/login");
  assert.equal(withReturnTo("/login", { pathname: "/registro", search: "?volver=https%3A%2F%2Fotro-sitio.com" }), "/login");
});

test("un link que ya quedó envuelto vuelve al destino real", () => {
  // La dirección real de un visitante, que pasó varias veces del login al registro
  const search = "?volver=%2Fregistro%3Fvolver%3D%252Flogin%253Fvolver%253D%25252Fregistro%25253Fvolver%25253D%2525252Fregistro%2525253Fvolver%2525253D%252525252Fproducto%252525252Fcable-usb-a-tipo-c-de-carga-lenta";
  assert.equal(safeReturnTo(search), "/producto/cable-usb-a-tipo-c-de-carga-lenta");
});

test("adentro de un link envuelto tampoco se acepta un destino afuera de la tienda", () => {
  const evil = encodeURIComponent(`/registro?volver=${encodeURIComponent("https://otro-sitio.com")}`);
  assert.equal(safeReturnTo(`?volver=${evil}`), "/");
});

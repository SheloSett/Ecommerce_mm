// Tests del carrito sin cuenta (utils/guestCart.js): lo que se guarda en el navegador. Correr con: npm test
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

function fakeLocalStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
globalThis.window = { localStorage: fakeLocalStorage() };
const { guestKey, cleanGuestCart, readGuestCart, writeGuestCart, addGuestLine, setGuestQuantity, removeGuestLine, setGuestPrice, restoreGuestLine, GUEST_CART_MAX_LINES } = await import("./guestCart.js");

const cable = { productId: 7, variantId: null, quantity: 2, price: 1000 };
const funda = { productId: 9, variantId: 31, quantity: 1, price: 5000 };

describe("carrito sin cuenta", () => {
  beforeEach(() => { globalThis.window = { localStorage: fakeLocalStorage() }; });

  test("la clave de una línea distingue la variante", () => {
    assert.equal(guestKey(7, null), "g-7-0");
    assert.equal(guestKey(9, 31), "g-9-31");
  });

  test("agregar: una línea nueva, y si ya estaba suma la cantidad", () => {
    let cart = addGuestLine([], { productId: 7, quantity: 2 });
    cart = addGuestLine(cart, { productId: 9, variantId: 31, quantity: 1 });
    assert.deepEqual(cart.map((l) => [l.productId, l.variantId, l.quantity]), [[7, null, 2], [9, 31, 1]]);
    cart = addGuestLine(cart, { productId: 7, quantity: 3 });
    assert.equal(cart[0].quantity, 5);
    // otra variante del mismo producto es otra línea
    assert.equal(addGuestLine(cart, { productId: 9, variantId: 32, quantity: 1 }).length, 3);
  });

  test("el precio al agregar lo pone el servidor: la línea tocada queda sin precio hasta que responde", () => {
    // aunque llegue un precio calculado por la tienda, no se guarda
    assert.equal(addGuestLine([], { productId: 7, quantity: 1, price: 890 })[0].price, null);
    const cart = setGuestPrice(addGuestLine([funda], { productId: 7, quantity: 1 }), "g-7-0", 800);
    assert.deepEqual(cart.map((l) => l.price), [5000, 800]);
    // sumar más o cambiar la cantidad vuelve a dejarla sin precio; las otras líneas no se tocan
    assert.deepEqual(addGuestLine(cart, { productId: 7, quantity: 2 }).map((l) => l.price), [5000, null]);
    assert.deepEqual(setGuestQuantity(cart, "g-7-0", 1).map((l) => l.price), [5000, null]);
    assert.equal(setGuestPrice(cart, "g-7-0", "abc")[1].price, null);
  });

  test("cambiar la cantidad; con 0 se saca", () => {
    const cart = [cable, funda];
    assert.equal(setGuestQuantity(cart, "g-7-0", 6)[0].quantity, 6);
    assert.deepEqual(setGuestQuantity(cart, "g-7-0", 0), [funda]);
    assert.deepEqual(setGuestQuantity(cart, "no-existe", 3), cart);
  });

  test("deshacer un cambio que no se pudo confirmar", () => {
    // la línea ya existía: vuelve a como estaba
    assert.deepEqual(restoreGuestLine([funda, { ...cable, quantity: 5, price: null }], "g-7-0", cable), [funda, cable]);
    // no existía: se saca
    assert.deepEqual(restoreGuestLine([funda, cable], "g-7-0", undefined), [funda]);
  });

  test("sacar una línea", () => {
    assert.deepEqual(removeGuestLine([cable, funda], "g-9-31"), [cable]);
  });

  test("se guarda y se lee; vacío borra lo guardado", () => {
    writeGuestCart([cable, funda]);
    assert.deepEqual(readGuestCart(), [cable, funda]);
    writeGuestCart([]);
    assert.deepEqual(readGuestCart(), []);
    assert.equal(globalThis.window.localStorage.getItem("igwt_cart_guest"), null);
  });

  test("lo guardado roto o con basura no rompe: se queda con las líneas que sirven", () => {
    globalThis.window.localStorage.setItem("igwt_cart_guest", "{no es json");
    assert.deepEqual(readGuestCart(), []);
    globalThis.window.localStorage.setItem("igwt_cart_guest", '{"a":1}');
    assert.deepEqual(readGuestCart(), []);
    const basura = [null, "x", { productId: "abc", quantity: 1 }, { productId: 5, quantity: 0 }, { productId: 5, quantity: -2 }, { productId: 5, variantId: "x", quantity: 1 }, { productId: "7", quantity: "2", price: "1000" }];
    assert.deepEqual(cleanGuestCart(basura), [cable]);
  });

  test("líneas repetidas se suman, la cantidad tiene tope y la lista también", () => {
    assert.deepEqual(cleanGuestCart([cable, cable]), [{ ...cable, quantity: 4 }]);
    assert.equal(cleanGuestCart([{ productId: 1, quantity: 99999999 }])[0].quantity, 9999);
    const muchas = Array.from({ length: GUEST_CART_MAX_LINES + 20 }, (_, i) => ({ productId: i + 1, quantity: 1 }));
    assert.equal(cleanGuestCart(muchas).length, GUEST_CART_MAX_LINES);
  });

  test("un precio que no sirve queda sin precio (lo pone el servidor)", () => {
    assert.equal(cleanGuestCart([{ productId: 1, quantity: 1, price: "abc" }])[0].price, null);
    assert.equal(cleanGuestCart([{ productId: 1, quantity: 1, price: -5 }])[0].price, null);
  });
});

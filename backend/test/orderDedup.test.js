// Pedidos repetidos por doble envío (26/11/2026). Datos inventados.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { fingerprint } = require("../src/utils/orderDedup");

describe("huella de un pedido (para no crear dos por un doble clic)", () => {
  const base = { email: "Ana@Ejemplo.invalid", paymentMethod: "COTIZACION", items: [{ productId: 7, quantity: 2 }, { productId: 9, variantId: 3, quantity: 1 }] };

  test("el mismo pedido da la misma huella, sin importar mayúsculas ni el orden de los productos", () => {
    const otra = { ...base, email: " ana@ejemplo.invalid ", items: [...base.items].reverse() };
    assert.equal(fingerprint(base), fingerprint(otra));
  });

  test("otra cantidad, otra variante, otro método o otro cliente es otro pedido", () => {
    assert.notEqual(fingerprint(base), fingerprint({ ...base, items: [{ productId: 7, quantity: 3 }, base.items[1]] }));
    assert.notEqual(fingerprint(base), fingerprint({ ...base, items: [base.items[0], { ...base.items[1], variantId: 4 }] }));
    assert.notEqual(fingerprint(base), fingerprint({ ...base, paymentMethod: "TRANSFERENCIA" }));
    assert.notEqual(fingerprint(base), fingerprint({ ...base, email: "beto@ejemplo.invalid" }));
  });

  test("sin email o sin productos no hay huella (no se controla)", () => {
    assert.equal(fingerprint({ ...base, email: "" }), null);
    assert.equal(fingerprint({ ...base, items: [] }), null);
  });
});

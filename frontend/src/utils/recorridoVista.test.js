// Cómo se muestra el recorrido de un cliente (26/11/2026). Datos inventados.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compressCamino, visitsOf, resumenOf } from "./recorridoVista.js";

const at = (min) => new Date(Date.UTC(2026, 10, 26, 14, min)).toISOString();

describe("recorrido de un cliente", () => {
  test("ida y vuelta repetida: 'Carrito ⇄ Checkout ×4' en vez de ocho renglones", () => {
    const c = compressCamino(["Inicio", "Catálogo", "Carrito", "Checkout", "Carrito", "Checkout", "Carrito", "Checkout", "Carrito", "Checkout", "Carrito"]);
    assert.deepEqual(c, [{ label: "Inicio" }, { label: "Catálogo" }, { a: "Carrito", b: "Checkout", veces: 4 }]);
  });

  test("un camino sin vueltas queda igual", () => {
    assert.deepEqual(compressCamino(["Inicio", "Catálogo", "Carrito"]), [{ label: "Inicio" }, { label: "Catálogo" }, { label: "Carrito" }]);
    // Una sola ida y vuelta se deja como camino (se entiende mejor)
    assert.deepEqual(compressCamino(["Inicio", "Catálogo", "Inicio"]), [{ label: "Inicio" }, { label: "Catálogo" }, { label: "Inicio" }]);
    assert.deepEqual(compressCamino(["A", "B", "A", "B"]), [{ a: "A", b: "B", veces: 2 }]);
  });

  test("visitas: se corta por otro navegador o por 30 minutos sin actividad; la más reciente primero", () => {
    const items = [ // del más reciente al más viejo, como los manda el servidor
      { at: at(50), sessionId: "s2", kind: "page", label: "Inicio" },
      { at: at(5), sessionId: "s1", kind: "product", productId: 7 },
      { at: at(4), sessionId: "s1", kind: "page", label: "Carrito" },
      { at: at(3), sessionId: "s1", kind: "page", label: "Catálogo" },
      { at: at(2), sessionId: "s1", kind: "search", term: "parlante" },
    ];
    const v = visitsOf(items);
    assert.equal(v.length, 2);
    assert.equal(v[0].sessionId, "s2");
    assert.deepEqual(v[1].steps.map((s) => s.kind), ["search", "camino", "product"]);
    assert.deepEqual(v[1].steps[1].camino, [{ label: "Catálogo" }, { label: "Carrito" }]);
    // Pasos con la misma hora: en el orden en que pasaron
    const mismaHora = visitsOf([
      { at: at(1), sessionId: "s1", kind: "page", label: "Checkout" },
      { at: at(1), sessionId: "s1", kind: "page", label: "Carrito" },
    ]);
    assert.deepEqual(mismaHora[0].steps[0].camino, [{ label: "Carrito" }, { label: "Checkout" }]);
    const mismoNavegador = visitsOf([{ at: at(59), sessionId: "s1", kind: "page", label: "X" }, { at: at(0), sessionId: "s1", kind: "page", label: "Y" }]);
    assert.equal(mismoNavegador.length, 2, "59 minutos después es otra visita");
  });

  test("resumen: qué buscó y qué miró, lo más repetido primero", () => {
    const r = resumenOf([
      { at: at(9), kind: "product", productId: 7, product: { name: "A" } },
      { at: at(8), kind: "search", term: "cable", results: 0 },
      { at: at(7), kind: "product", productId: 9, product: { name: "B" } },
      { at: at(6), kind: "product", productId: 9, product: { name: "B" } },
      { at: at(5), kind: "search", term: "cable", results: 3 },
      { at: at(4), kind: "order", orderId: 280 },
    ]);
    assert.deepEqual(r.prods.map((p) => [p.productId, p.veces]), [[9, 2], [7, 1]]);
    assert.deepEqual(r.terms.map((t) => [t.term, t.veces, t.sinResultados]), [["cable", 2, true]]);
    assert.equal(r.orders.length, 1);
  });
});

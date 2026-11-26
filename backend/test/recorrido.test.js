// Recorrido por cliente (Analíticas → 👣 Recorrido, 26/11/2026). Datos inventados.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { buildPeople, buildTimeline, anonymousSessions } = require("../src/utils/recorrido");

const t = (min) => new Date(Date.UTC(2026, 10, 25, 15, min)).toISOString();
const ev = (sessionId, min, type, extra = {}) => ({ sessionId, createdAt: t(min), type, customerId: null, device: "celular", ...extra });

// Ana (cliente 1): en el celular buscó sin sesión, inició sesión y miró un producto; después volvió desde la compu.
// Beto compró sin cuenta. Una sesión anónima de 3 acciones y otra de 1 (un robot que entra y se va).
const events = [
  ev("s-ana-cel", 0, "SEARCH", { term: "parlante", results: 12 }),
  ev("s-ana-cel", 1, "PAGE_VIEW", { path: "/login" }),
  ev("s-ana-cel", 2, "PRODUCT_VIEW", { productId: 7, customerId: 1 }),
  ev("s-ana-pc", 30, "PAGE_VIEW", { path: "/carrito", customerId: 1, device: "escritorio" }),
  ev("s-ana-pc", 31, "PAGE_VIEW", { path: "/carrito", customerId: 1, device: "escritorio" }),
  ev("s-beto", 10, "SEARCH", { term: "cable hdmi", results: 0 }),
  ev("s-beto", 11, "PRODUCT_VIEW", { productId: 9 }),
  ev("s-anon", 5, "PAGE_VIEW", { path: "/" }), ev("s-anon", 6, "PAGE_VIEW", { path: "/catalogo" }), ev("s-anon", 7, "SEARCH", { term: "x", results: 3 }),
  ev("s-robot", 8, "PAGE_VIEW", { path: "/" }),
];
const orders = [{ id: 50, sessionId: "s-beto", customerId: null, customerName: "Beto Gómez", customerEmail: "Beto@Ejemplo.invalid", total: 30000, status: "PENDING", createdAt: t(12) }];

describe("recorrido por cliente", () => {
  test("una fila por persona, juntando sus visitas, ordenadas por la última actividad", () => {
    const people = buildPeople(events, orders);
    assert.deepEqual(people.map((p) => p.key), ["c:1", "g:beto@ejemplo.invalid"]);
    const ana = people[0];
    assert.equal(ana.visitas, 2, "celular y compu");
    assert.equal(ana.busquedas, 1, "la búsqueda de antes de iniciar sesión también es de ella");
    assert.equal(ana.productos, 1);
    assert.equal(ana.device, "escritorio", "el último dispositivo");
    assert.deepEqual(ana.terminos, ["parlante"]);
    const beto = people[1];
    assert.equal(beto.guestName, "Beto Gómez");
    assert.equal(beto.pedidos, 1);
    assert.equal(beto.busquedas, 1);
  });

  test("las visitas que no son de nadie se cuentan aparte (solo las de 2 o más acciones)", () => {
    assert.equal(anonymousSessions(events, orders), 1);
  });

  test("el recorrido de una persona: del más reciente al más viejo, sin páginas repetidas seguidas", () => {
    const tl = buildTimeline(events, orders, "c:1");
    assert.deepEqual(tl.map((i) => i.kind), ["page", "product", "page", "search"]);
    assert.equal(tl[0].path, "/carrito", "el carrito recargado aparece una vez");
    assert.equal(tl[3].term, "parlante");
    const beto = buildTimeline(events, orders, "g:beto@ejemplo.invalid");
    assert.deepEqual(beto.map((i) => i.kind), ["order", "product", "search"]);
    assert.equal(beto[0].orderId, 50);
  });
});

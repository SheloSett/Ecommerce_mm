// Tests de las reglas de sincronización con Mercado Libre (services/ml/mlRules.js): funciones puras.
// Correr con: npm test
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { decide, observe, soldDelta, afterRead, isSettled, DEFAULTS } = require("../src/services/ml/mlRules");

const T0 = new Date("2026-11-20T15:00:00Z");
const at = (secs) => new Date(T0.getTime() + secs * 1000);

// Pozo con un número acordado y sin escrituras pendientes.
function pool(over = {}) {
  return {
    agreed: 10, agreedSold: { MLA1: 5 },
    writeTarget: null, writeBase: null, writeStartedAt: null, writeOutcome: null,
    heldQty: null, heldAt: null,
    lastRead: { qty: 10, sold: { MLA1: 5 } }, lastChangeAt: at(-600),
    ...over,
  };
}
const read = (qty, sold = 5) => ({ qty, sold: typeof sold === "object" ? sold : { MLA1: sold } });

describe("soldDelta", () => {
  test("suma solo las publicaciones que están en las dos lecturas", () => {
    assert.equal(soldDelta({ A: 5, B: 1 }, { A: 7, B: 1 }), 2);
    assert.equal(soldDelta({ A: 5 }, { A: 6, NUEVA: 40 }), 1, "una publicación nueva en el pozo no es una venta");
    assert.equal(soldDelta({ A: 5, VIEJA: 9 }, { A: 5 }), 0, "una que sale del pozo tampoco");
  });
  test("sin datos o sin publicaciones en común: null", () => {
    assert.equal(soldDelta(null, { A: 1 }), null);
    assert.equal(soldDelta({ A: 1 }, { B: 1 }), null);
    assert.equal(soldDelta({ A: 1 }, { A: "x" }), null);
  });
});

describe("quieto o no", () => {
  test("afterRead anota cuándo cambió por última vez", () => {
    const p = pool();
    assert.deepEqual(afterRead(p, read(10), at(0)).lastChangeAt, at(-600), "misma lectura: no cambia la fecha");
    assert.deepEqual(afterRead(p, read(9, 6), at(0)).lastChangeAt, at(0));
  });
  test("isSettled: igual a la anterior y sin cambios hace settleMs", () => {
    assert.equal(isSettled(pool(), read(10), at(0)), true);
    assert.equal(isSettled(pool(), read(9, 6), at(0)), false);
    assert.equal(isSettled(pool({ lastChangeAt: at(-5) }), read(10), at(0)), false);
  });
});

describe("decide: sin escritura pendiente", () => {
  test("sin número acordado, la primera lectura es el punto de partida", () => {
    assert.deepEqual(decide(pool({ agreed: null }), read(7), at(0)), { kind: "baseline" });
  });

  test("nada cambió", () => {
    assert.deepEqual(decide(pool(), read(10), at(0)), { kind: "same" });
  });

  test("venta en Mercado Libre: baja el stock y suben los vendidos", () => {
    assert.deepEqual(decide(pool(), read(9, 6), at(0)), { kind: "apply", sales: 1, other: 0, afterWrite: false });
  });

  test("carga a mano en Mercado Libre (sube sin ventas)", () => {
    assert.deepEqual(decide(pool(), read(15), at(0)), { kind: "apply", sales: 0, other: 5, afterWrite: false });
  });

  test("baja sin ventas (carga a mano o el publicador)", () => {
    assert.deepEqual(decide(pool(), read(8), at(0)), { kind: "apply", sales: 0, other: -2, afterWrite: false });
  });

  test("sin contador de vendidos, el cambio entero va como 'otro'", () => {
    assert.deepEqual(decide(pool({ agreedSold: null }), read(9, 6), at(0)), { kind: "apply", sales: 0, other: -1, afterWrite: false });
  });

  test("una baja grande explicada por ventas se aplica enseguida", () => {
    const p = pool({ agreed: 20, agreedSold: { MLA1: 0 } });
    assert.deepEqual(decide(p, read(5, 15), at(0)), { kind: "apply", sales: 15, other: 0, afterWrite: false });
  });

  test("un cambio grande sin explicar espera a que otra lectura lo confirme", () => {
    const first = decide(pool(), read(40), at(0));
    assert.deepEqual(first, { kind: "hold", heldQty: 40, heldAt: at(0) });
    const held = pool({ heldQty: 40, heldAt: at(0) });
    assert.equal(decide(held, read(40), at(5)).kind, "hold", "todavía no pasó confirmMs");
    assert.deepEqual(decide(held, read(40), at(5)).heldAt, at(0), "conserva desde cuándo espera");
    assert.deepEqual(decide(held, read(40), at(31)), { kind: "apply", sales: 0, other: 30, afterWrite: false });
    assert.deepEqual(decide(held, read(45), at(31)), { kind: "hold", heldQty: 45, heldAt: at(31) }, "otro número: vuelve a esperar");
  });

  test("una mezcla grande (pocas ventas y una baja enorme) también espera", () => {
    const p = pool({ agreed: 30, agreedSold: { MLA1: 0 } });
    assert.equal(decide(p, read(5, 3), at(0)).kind, "hold");
  });

  test("stock inválido: revisar", () => {
    assert.equal(decide(pool(), { qty: -1, sold: {} }, at(0)).kind, "review");
    assert.equal(decide(pool(), { qty: null, sold: {} }, at(0)).kind, "review");
  });
});

describe("decide: después de escribir", () => {
  // Se escribió 12 a las T0; antes de escribir Mercado Libre mostraba 10 con 5 vendidos.
  function written(over = {}) {
    return pool({
      agreed: 12, writeTarget: 12, writeBase: { qty: 10, sold: { MLA1: 5 } }, writeStartedAt: at(0),
      writeOutcome: "APLICADA", ...over,
    });
  }
  // Pozo que ya leyó lo mismo hace un rato (quieto).
  const quiet = (p, r) => ({ ...p, lastRead: r, lastChangeAt: at(1) });

  test("sin ventas en el medio, Mercado Libre muestra lo escrito: nada para la página", () => {
    const r = read(12);
    assert.deepEqual(decide(quiet(written(), r), r, at(30)), { kind: "apply", sales: 0, other: 0, afterWrite: true });
  });

  test("una venta después de escribir: se ve en Mercado Libre y la página la descuenta", () => {
    const r = read(11, 6);
    assert.deepEqual(decide(quiet(written(), r), r, at(30)), { kind: "apply", sales: 1, other: 0, afterWrite: true });
  });

  test("una venta pisada por la escritura: Mercado Libre muestra lo escrito, pero los vendidos subieron", () => {
    const r = read(12, 6);
    assert.deepEqual(decide(quiet(written(), r), r, at(30)), { kind: "apply", sales: 1, other: 0, afterWrite: true });
  });

  test("dos ventas, una pisada y otra después: la página descuenta las dos", () => {
    const r = read(11, 7);
    assert.deepEqual(decide(quiet(written(), r), r, at(30)), { kind: "apply", sales: 2, other: 0, afterWrite: true });
  });

  test("todavía no está quieto: esperar, con fecha para volver a mirar", () => {
    const d = decide(written({ lastRead: read(10), lastChangeAt: at(-600) }), read(12), at(3));
    assert.equal(d.kind, "wait");
    assert.deepEqual(d.retryAt, at(23));
  });

  test("lectura vieja apenas después de una escritura confirmada: se descarta", () => {
    const r = read(10);
    const d = decide(quiet(written(), r), r, at(30));
    assert.equal(d.kind, "wait");
  });

  test("si sigue mostrando el número de antes mucho después, revisar", () => {
    const r = read(10);
    assert.equal(decide(quiet(written(), r), r, at(DEFAULTS.staleMs / 1000 + 5)).kind, "review");
  });

  test("escritura sin respuesta que no entró: la página descuenta las ventas y se vuelve a escribir", () => {
    const r = read(9, 6);
    const d = decide(quiet(written({ writeOutcome: "DESCONOCIDA" }), r), r, at(30));
    assert.deepEqual(d, { kind: "apply", sales: 1, other: 0, afterWrite: true });
  });

  test("escritura sin respuesta que sí entró", () => {
    const r = read(12);
    assert.deepEqual(decide(quiet(written({ writeOutcome: "DESCONOCIDA" }), r), r, at(30)), { kind: "apply", sales: 0, other: 0, afterWrite: true });
  });

  test("número que no cierra (más alto que lo escrito): revisar, y la página toma el más bajo", () => {
    const r = read(15, 6);
    const d = decide(quiet(written(), r), r, at(30));
    assert.equal(d.kind, "review");
    assert.equal(d.conservative, -1, "lo más bajo entre no tocar, +3 y -1 ventas");
  });

  test("número que no cierra (más bajo que todas las ventas): revisar", () => {
    const r = read(7, 6);
    const d = decide(quiet(written(), r), r, at(30));
    assert.equal(d.kind, "review");
    assert.equal(d.conservative, -5);
  });

  test("vendidos que bajan después de escribir: revisar", () => {
    const r = read(12, 4);
    assert.equal(decide(quiet(written(), r), r, at(30)).kind, "review");
  });

  test("sin contador de vendidos: solo se confía en el número", () => {
    const base = { writeBase: { qty: 10, sold: null } };
    const ok = read(12, {});
    assert.deepEqual(decide(quiet(written(base), ok), ok, at(30)), { kind: "apply", sales: 0, other: 0, afterWrite: true });
    const otro = read(11, {});
    assert.equal(decide(quiet(written(base), otro), otro, at(30)).kind, "review");
  });
});

describe("observe", () => {
  test("cuenta lo que habría pasado", () => {
    assert.deepEqual(observe(pool(), read(9, 6)), { changed: true, dq: -1, ds: 1, sales: 1, other: 0 });
    assert.deepEqual(observe(pool(), read(10)), { changed: false, dq: 0, ds: 0, sales: 0, other: 0 });
    assert.equal(observe(pool({ agreed: null }), read(3)).changed, false);
  });
});

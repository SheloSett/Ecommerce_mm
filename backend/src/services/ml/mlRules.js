// Reglas de la sincronización de stock con Mercado Libre. Funciones puras: reciben el estado guardado
// de un pozo y una lectura, y devuelven qué hacer. Sin base ni red, para poder probar cada caso.
//
// LA IDEA
// Por cada pozo vinculado se guarda el último número en que los dos lados coincidieron ("agreed").
// Cuando se lee Mercado Libre, la diferencia con ese número es lo que cambió allá (una venta, una
// cancelación, una carga a mano, el publicador) y la página copia ese cambio. Si después la página
// queda con otro número, se le escribe ese número a Mercado Libre. Así no hace falta interpretar
// órdenes: la página copia lo que Mercado Libre hizo con su número.
//
// EL PUNTO DELICADO: ESCRIBIR PISA
// Sin Full, Mercado Libre solo deja cambiar el stock mandando el número entero (PUT /items con
// available_quantity), sin control de versión. Si una venta entra justo entre la lectura y la escritura,
// la escritura la pisa: Mercado Libre vuelve a mostrar la unidad vendida y la página nunca se entera.
// Para eso está el contador de vendidos de cada publicación (sold_quantity, que la escritura no toca):
//   - Antes de escribir se relee, y solo se escribe si el pozo está "quieto" (sin cambios en los
//     últimos segundos): así los dos contadores de Mercado Libre (stock y vendidos) ya están al día.
//   - Después de escribir, cuando el pozo vuelve a quedar quieto, se cuentan las ventas desde la
//     lectura de antes de escribir (n). Si Mercado Libre muestra un número entre W - n y W (W = lo
//     escrito), las n ventas son reales: unas entraron después de la escritura y se ven, otras quedaron
//     pisadas. En los dos casos la página descuenta n, y si Mercado Libre quedó con otro número, se le
//     vuelve a escribir. Si la escritura no tuvo respuesta (corte), vale lo mismo: o entró (número
//     entre W - n y W) o no entró (número = el de antes - n); en los dos casos la página descuenta n.
//   - Si las cuentas no cierran (por ejemplo, una venta y a la vez una carga a mano allá), el pozo se
//     frena en REVISAR, la página toma el número más bajo posible y el panel pide elegir el correcto.
//   - Lecturas viejas: justo después de escribir, Mercado Libre puede seguir mostrando un rato el número
//     de antes. Una lectura igual a la de antes de escribir (mismo stock y mismos vendidos) dentro de
//     staleMs se descarta, también después de cerrar las cuentas. Y una escritura sin respuesta no se
//     da por "no entró" hasta que pase staleMs: antes podría ser una lectura vieja.
//   - Un producto que se vende muy seguido podría no quedarse nunca quieto: pasado maxWaitMs se cierran
//     las cuentas igual, con las mismas comprobaciones.
//
// Las lecturas traen { qty, sold }: qty es el stock del pozo y sold, los vendidos de cada publicación
// del pozo ({ "MLA123": 15, "MLA456:789": 2 }). Los vendidos se comparan solo entre publicaciones que
// están en las dos lecturas, así que sumar o sacar una publicación del pozo no parece una venta.

const DEFAULTS = Object.freeze({
  settleMs:  20 * 1000,     // cuánto tiene que estar quieto un pozo para escribirle o para cerrar las cuentas
  staleMs:   2 * 60 * 1000, // después de una escritura confirmada, una lectura vieja se descarta hasta acá
  confirmMs: 30 * 1000,     // un cambio grande sin explicar se aplica si otra lectura lo repite después de esto
  bigChange: 10,            // desde cuántas unidades un cambio sin ventas que lo expliquen es "grande"
  maxWaitMs: 5 * 60 * 1000, // espera máxima a que se quede quieto, para escribir o cerrar las cuentas
});

function isCount(n) {
  return Number.isInteger(n) && n >= 0;
}

// Vendidos desde a hasta b, sumando solo las publicaciones que están en las dos lecturas.
// null si no hay ninguna en común o si falta el dato.
function soldDelta(a, b) {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return null;
  let total = 0;
  let common = 0;
  for (const key of Object.keys(b)) {
    if (!Object.prototype.hasOwnProperty.call(a, key)) continue;
    if (!isCount(a[key]) || !isCount(b[key])) return null;
    total += b[key] - a[key];
    common++;
  }
  return common ? total : null;
}

function sameSold(a, b) {
  const ka = Object.keys(a || {}).sort();
  const kb = Object.keys(b || {}).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

// ¿La lectura es igual a la anterior?
function sameRead(a, b) {
  return !!a && !!b && a.qty === b.qty && sameSold(a.sold, b.sold);
}

// Lo que hay que guardar después de leer: la lectura, y desde cuándo el pozo no cambia.
function afterRead(pool, snap, now) {
  const changed = !sameRead(pool.lastRead, snap);
  return {
    lastRead:     { qty: snap.qty, sold: snap.sold || {} },
    lastReadAt:   now,
    lastChangeAt: changed ? now : (pool.lastChangeAt || now),
  };
}

// ¿Está quieto? (sin cambios hace al menos settleMs, mirando también la lectura recién hecha)
function isSettled(pool, snap, now, opts = DEFAULTS) {
  if (!sameRead(pool.lastRead, snap)) return false;
  const since = pool.lastChangeAt ? now - new Date(pool.lastChangeAt) : Infinity;
  return since >= opts.settleMs;
}

/**
 * Qué cambió en Mercado Libre para un pozo que comparte stock (activo), según la lectura snap.
 * now: Date. Devuelve uno de:
 *   { kind: "baseline" }                          sin número acordado: la lectura es el punto de partida
 *   { kind: "same" }                              no cambió nada
 *   { kind: "apply", sales, other, afterWrite }   la página tiene que aplicar -sales (ventas) y other
 *                                                 (cualquier otro cambio, + o -)
 *   { kind: "hold", heldQty, heldAt }             cambio grande sin explicar: esperar a que se confirme
 *   { kind: "wait", reason, retryAt }             hay una escritura sin cerrar y el pozo no está quieto
 *   { kind: "review", reason, conservative }      las cuentas no cierran: frenar y preguntar
 */
function decide(pool, snap, now, opts = DEFAULTS) {
  if (!isCount(snap.qty)) return { kind: "review", reason: "Mercado Libre devolvió un stock inválido", conservative: 0 };
  if (pool.writeTarget !== null && pool.writeTarget !== undefined) return afterWrite(pool, snap, now, opts);
  if (!isCount(pool.agreed)) return { kind: "baseline" };
  if (isStaleAfterWrite(pool, snap, now, opts)) {
    return { kind: "wait", reason: "Lectura vieja: Mercado Libre todavía muestra el número de antes de escribir", retryAt: new Date(now.getTime() + opts.settleMs) };
  }

  const dq = snap.qty - pool.agreed;
  if (dq === 0) return { kind: "same" };

  // Ventas que explican la baja (los vendidos que subieron, hasta lo que bajó el stock).
  const ds = soldDelta(pool.agreedSold, snap.sold);
  const sales = dq < 0 && ds !== null && ds > 0 ? Math.min(ds, -dq) : 0;
  const other = dq + sales;

  if (Math.abs(other) >= opts.bigChange) {
    const confirmed = pool.heldQty === snap.qty && pool.heldAt && now - new Date(pool.heldAt) >= opts.confirmMs;
    if (!confirmed) {
      return { kind: "hold", heldQty: snap.qty, heldAt: pool.heldQty === snap.qty && pool.heldAt ? new Date(pool.heldAt) : now };
    }
  }
  return { kind: "apply", sales, other, afterWrite: false };
}

// ¿Es la misma lectura de antes de la última escritura, poco después de escribir? (lectura vieja)
function isStaleAfterWrite(pool, snap, now, opts) {
  if (!pool.writeBase || !pool.writeStartedAt) return false;
  if (now - new Date(pool.writeStartedAt) >= opts.staleMs) return false;
  return snap.qty !== pool.agreed && sameRead(pool.writeBase, snap);
}

// Cierre de cuentas de una escritura (ver arriba "ESCRIBIR PISA").
function afterWrite(pool, snap, now, opts) {
  const W = pool.writeTarget;
  const base = pool.writeBase || {};
  const startedAt = pool.writeStartedAt ? new Date(pool.writeStartedAt) : now;
  const sinceWrite = now - startedAt;
  const waitedTooLong = sinceWrite >= opts.maxWaitMs;

  // Esperar a que el pozo esté quieto y haya pasado un rato desde la escritura (salvo que ya se haya
  // esperado demasiado: un producto que se vende muy seguido no se queda quieto nunca).
  if (!waitedTooLong && (sinceWrite < opts.settleMs || !isSettled(pool, snap, now, opts))) {
    const lastChange = pool.lastChangeAt && sameRead(pool.lastRead, snap) ? new Date(pool.lastChangeAt) : now;
    const retryAt = new Date(Math.max(startedAt.getTime(), lastChange.getTime()) + opts.settleMs);
    return { kind: "wait", reason: "Esperando a que Mercado Libre termine de aplicar el cambio", retryAt };
  }

  const M = snap.qty;
  const M0 = isCount(base.qty) ? base.qty : null;
  const n = soldDelta(base.sold, snap.sold);
  const applied = pool.writeOutcome === "APLICADA";

  const stillOld = () => ({ kind: "wait", reason: "Mercado Libre todavía muestra el número de antes", retryAt: new Date(now.getTime() + opts.settleMs) });

  // Sin contador de vendidos: solo se puede confiar en el número.
  if (n === null) {
    if (M === W) return { kind: "apply", sales: 0, other: 0, afterWrite: true };
    if (M0 !== null && M === M0) {
      if (sinceWrite < opts.staleMs) return stillOld(); // puede ser una lectura vieja
      if (!applied) return { kind: "apply", sales: 0, other: 0, afterWrite: true }; // no entró
    }
    return review("Mercado Libre muestra un número que no coincide con lo escrito y no hay contador de ventas para explicarlo", W, M, null);
  }
  if (n < 0) return review("Los vendidos de Mercado Libre bajaron (¿una venta cancelada?) justo después de escribir", W, M, n);

  const fitsApplied = M <= W && M >= W - n;
  const fitsNotApplied = M0 !== null && M === M0 - n;

  // Entró: las n ventas son reales (unas se ven, otras quedaron pisadas).
  if (fitsApplied) return { kind: "apply", sales: n, other: 0, afterWrite: true };
  if (fitsNotApplied) {
    // Muestra el número de antes (menos las ventas): puede ser una lectura vieja de una escritura que
    // sí entró. Se espera staleMs antes de creerlo.
    if (sinceWrite < opts.staleMs) return stillOld();
    // Sin respuesta y sigue así: no entró. La página descuenta las ventas y se vuelve a escribir.
    if (!applied) return { kind: "apply", sales: n, other: 0, afterWrite: true };
    return review("Mercado Libre confirmó el cambio pero sigue mostrando el número de antes", W, M, n);
  }
  return review(applied
    ? "Después de escribir, el número de Mercado Libre no cierra con las ventas"
    : "No se sabe si entró la última escritura y el número de Mercado Libre no cierra con las ventas", W, M, n);
}

// Para REVISAR: el cambio más bajo posible para la página (que nunca venda de más mientras alguien mira).
function review(reason, W, M, n) {
  const candidates = [0, M - W];
  if (Number.isInteger(n) && n > 0) candidates.push(-n);
  return { kind: "review", reason, conservative: Math.min(...candidates) };
}

/**
 * Para un pozo vinculado que solo se observa (no comparte stock todavía): qué habría pasado.
 * Devuelve { changed, dq, ds, sales, other } (sin decidir nada: solo para la bitácora).
 */
function observe(pool, snap) {
  if (!isCount(pool.agreed) || !isCount(snap.qty)) return { changed: false, dq: 0, ds: null, sales: 0, other: 0 };
  const dq = snap.qty - pool.agreed;
  const ds = soldDelta(pool.agreedSold, snap.sold);
  const sales = dq < 0 && ds !== null && ds > 0 ? Math.min(ds, -dq) : 0;
  return { changed: dq !== 0 || (ds !== null && ds !== 0), dq, ds, sales, other: dq + sales };
}

module.exports = { DEFAULTS, soldDelta, sameRead, afterRead, isSettled, decide, observe };

// Stock: la única puerta para cambiar cuántas unidades hay de un producto o de una variante.
//
// POR QUÉ EXISTE:
// Antes el stock se tocaba desde unos 20 lugares (pago de Mercado Pago, pedido marcado abonado, venta
// manual, compras, edición de pedidos, panel de productos, RMA...) y casi todos hacían lo mismo: leer el
// número, sumarle o restarle en JavaScript y escribir el resultado. Si dos de esas cosas pasaban a la vez
// (un pago que llega mientras el admin carga una compra), la segunda escritura pisaba a la primera y una
// venta o una compra se perdía sin dejar rastro. Además no quedaba ningún historial: cuando un número no
// cerraba, no había forma de saber por qué.
//
// Acá cada cambio:
//   1. corre dentro de una transacción y toma el candado de la fila antes de leer el número, así dos
//      cambios simultáneos sobre la misma unidad se hacen uno después del otro y ninguno pisa al otro;
//   2. mantiene las reglas que ya tenía cada lugar (piso en 0, los ilimitados no se tocan, publicar o
//      despublicar el producto según le quede stock);
//   3. deja una fila en stock_movements con el antes, el después, el motivo y el pedido/compra/gasto.
//
// Se hace con operaciones de Prisma y no con SQL a mano a propósito: los tests usan una base simulada
// (cada archivo de test arma la suya) que no ejecuta SQL. Ver test/helpers/fakeStock.js.

const prisma = require("../lib/prisma"); // cliente único (ver lib/prisma.js)

// Motivos de un movimiento. El panel los muestra con un texto en castellano (StockHistoryModal.jsx).
const REASONS = Object.freeze({
  VENTA:          "VENTA",          // pedido aprobado: pago de Mercado Pago o marcado "Abonado" en el panel
  VENTA_MANUAL:   "VENTA_MANUAL",   // venta cargada a mano en el panel
  CANCELACION:    "CANCELACION",    // pedido cancelado o rechazado: vuelve el stock
  EDICION_PEDIDO: "EDICION_PEDIDO", // se cambiaron las líneas de un pedido que ya había descontado
  AJUSTE:         "AJUSTE",         // número cargado a mano en el panel de productos
  ALTA:           "ALTA",           // stock inicial al crear un producto
  COMPRA:         "COMPRA",         // compra a un proveedor (cargada, editada o borrada)
  RMA:            "RMA",            // unidad dada de baja por falla desde la Caja
  VARIANTES:      "VARIANTES",      // stock que se fue al regenerar o borrar las variantes de un producto
  VENTA_ML:       "VENTA_ML",       // venta en Mercado Libre (services/ml/mlSync.js)
  CAMBIO_ML:      "CAMBIO_ML",      // otro cambio hecho en Mercado Libre: carga a mano, cancelación, el publicador
  VINCULO_ML:     "VINCULO_ML",     // número elegido al activar el vínculo de un producto con Mercado Libre
});
const VALID_REASONS = new Set(Object.values(REASONS));

// Cada ajuste es una transacción cortita (una fila), pero puede tener que esperar a otra más larga que
// tenga tomada la misma fila (una compra con muchas líneas usa hasta 20 s): margen para no cortar antes.
const TX_OPTS = { maxWait: 10000, timeout: 20000 };

// ─── Avisos después de cada cambio ──────────────────────────────────────────
// Quien necesite enterarse de que cambió el stock de una unidad (la sincronización con Mercado Libre) se
// anota con onCommitted. El aviso sale recién cuando la transacción se confirmó: avisar antes podría
// hacer que alguien lea un número que después se deshace. Un oyente que falla no frena a nadie.
const listeners = new Set();
function onCommitted(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notifyCommitted(units) {
  if (!units.length) return;
  for (const fn of listeners) {
    try {
      const r = fn(units);
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch { /* un oyente no frena el cambio de stock */ }
  }
}
// Unidades tocadas dentro de una transacción armada con transaction(): se avisan al confirmarse.
const touchedByTx = new WeakMap();

function unitKey(u) {
  return `${u.productId}:${u.variantId ?? ""}`;
}
// Cada unidad una sola vez, con los motivos de lo que la cambió (el oyente de Mercado Libre ignora lo
// que vino de Mercado Libre, para no despertarse con sus propios cambios).
function uniqueUnits(units) {
  const seen = new Map();
  for (const u of units) {
    const key = unitKey(u);
    const entry = seen.get(key) || { productId: u.productId, variantId: u.variantId ?? null, reasons: [] };
    if (u.reason && !entry.reasons.includes(u.reason)) entry.reasons.push(u.reason);
    seen.set(key, entry);
  }
  return [...seen.values()];
}

// ─── Orden de los candados ──────────────────────────────────────────────────
// Una transacción que mueve varias unidades las tiene que bloquear SIEMPRE en el mismo orden (por
// producto y después por variante). Si una venta bloquea A y después B, y una compra al mismo tiempo B y
// después A, cada una espera a la otra y Postgres corta una con error. Regla para toda transacción de
// varias unidades: primero las filas de stock en este orden (sortUnits / lockUnits), y recién después las
// filas de producto que se tocan aparte (costo, publicación), también en orden.
function byUnit(a, b) {
  return ((a.productId ?? 0) - (b.productId ?? 0)) || ((a.variantId ?? 0) - (b.variantId ?? 0));
}
// Copia ordenada de una lista de líneas o unidades ({ productId, variantId, ... }).
function sortUnits(list) {
  return [...list].sort(byUnit);
}
// Toma el candado de varias unidades de una vez, en el orden de arriba, dentro de la transacción tx.
// Para los que después las van tocando en otro orden (las líneas de una compra, en el orden en que se
// cargaron): con las filas ya tomadas, ese orden ya no importa.
async function lockUnits(tx, units) {
  const list = uniqueUnits(units.filter((u) => u && (toId(u.productId) || toId(u.variantId)))).sort(byUnit);
  for (const u of list) {
    const model = u.variantId ? tx.productVariant : tx.product;
    try {
      await model.update({ where: { id: u.variantId || u.productId }, data: { updatedAt: new Date() } });
    } catch (err) {
      if (err?.code !== "P2025") throw err; // una fila que ya no existe no se bloquea
    }
  }
}

// Transacción para los que mueven varias unidades juntas (una compra, una venta manual): mismo
// prisma.$transaction de siempre, más el aviso a los oyentes cuando termina bien.
async function transaction(fn, opts = TX_OPTS) {
  let touched = [];
  const result = await prisma.$transaction(async (tx) => {
    touched = [];
    touchedByTx.set(tx, touched);
    return fn(tx);
  }, opts);
  notifyCommitted(uniqueUnits(touched));
  return result;
}

// ─── Quién hizo el cambio ───────────────────────────────────────────────────
// Sale de la sesión (req.user), nunca de lo que manda el navegador.
function actorOf(user) {
  if (!user) return null;
  if (user.role === "CUSTOMER") return `Cliente #${user.id}`;
  if (user.role === "ADMIN" || user.role === "SUPERADMIN") {
    return String(user.name || user.email || `Admin #${user.id}`).slice(0, 120);
  }
  return null;
}

// ─── Publicación automática según el stock ──────────────────────────────────
// Para productos con variantes: activa/desactiva el producto según si hay stock en alguna variante.
// Para productos sin variantes: según su propio stock.
// Ya no toca el campo visibility (MAYORISTA/MINORISTA/AMBOS) — ese lo controla el admin.
// Vivía en product.controller.js; se mudó acá porque la usa cada cambio de stock (el controller la
// sigue exportando para no romper a quien la importa de ahí).
//
// Primero toma el candado de la fila del producto y recién después mira las variantes. Sin eso, dos
// ventas al mismo tiempo que dejaban en 0 la última unidad de dos variantes distintas miraban cada una el
// stock viejo de la otra (todavía sin confirmar) y el producto quedaba publicado sin nada para vender. Con
// el candado, la segunda espera a que la primera termine y ve las dos en 0. Sin transacción de quien
// llama, abre la suya (si no, el candado duraría solo esa sentencia). Ojo: adentro de una transacción
// hay que pasarle esa tx; si no, abre otra que espera el candado que tiene la de afuera.
async function syncProductVisibility(productId, tx) {
  if (!tx) {
    return prisma.$transaction((t) => syncProductVisibility(productId, t), TX_OPTS);
  }
  try {
    await tx.product.update({ where: { id: productId }, data: { updatedAt: new Date() } });
  } catch (err) {
    if (err?.code === "P2025") return; // el producto ya no existe
    throw err;
  }
  const product = await tx.product.findUnique({
    where: { id: productId },
    include: { variants: { where: { active: true }, select: { stock: true, stockUnlimited: true } } },
  });
  if (!product) return;

  let hasStock;
  if (product.variants.length === 0) {
    // Producto sin variantes: visibilidad basada en su propio stock
    // Antes se salía con return acá y el producto nunca se ocultaba al quedarse sin stock
    hasStock = product.stockUnlimited || product.stock > 0;
  } else {
    // Producto con variantes: visible si al menos una variante activa tiene stock
    hasStock = product.variants.some((v) => v.stockUnlimited || v.stock > 0);
  }

  if (!hasStock && product.active) {
    await tx.product.update({ where: { id: productId }, data: { active: false } });
  // Antes: } else if (hasStock && !product.active) { — republicaba también lo que el admin ocultó a mano
  // (por ejemplo, por un precio mal cargado) en cuanto se aprobaba o cancelaba un pedido viejo.
  } else if (hasStock && !product.active && !product.hiddenByAdmin) {
    await tx.product.update({ where: { id: productId }, data: { active: true } });
  }
}

// ─── El ajuste ──────────────────────────────────────────────────────────────

function toId(value) {
  const n = typeof value === "number" ? value : parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function clip(text, max) {
  return text == null || text === "" ? null : String(text).slice(0, max);
}

function checkOptions(o) {
  const hasDelta = o.delta !== undefined && o.delta !== null;
  const hasSetTo = o.setTo !== undefined && o.setTo !== null;
  if (hasDelta === hasSetTo) throw new Error("adjustStock: hay que pasar delta o setTo (uno solo)");
  if (hasDelta && !Number.isInteger(o.delta)) throw new Error("adjustStock: delta tiene que ser un entero");
  if (hasSetTo && !Number.isInteger(o.setTo)) throw new Error("adjustStock: setTo tiene que ser un entero");
  if (!VALID_REASONS.has(o.reason)) throw new Error(`adjustStock: motivo desconocido "${o.reason}"`);
  if (!toId(o.productId) && !toId(o.variantId)) throw new Error("adjustStock: falta el producto o la variante");
  if (o.visibility !== undefined && o.visibility !== "sync" && o.visibility !== "none") {
    throw new Error("adjustStock: visibility es \"sync\" o \"none\"");
  }
}

async function adjustInTx(tx, o) {
  const variantId = toId(o.variantId);
  const askedProductId = toId(o.productId);
  const model = variantId ? tx.productVariant : tx.product;
  const id = variantId || askedProductId;

  const row = await model.findUnique({ where: { id } });
  const productId = variantId ? row?.productId : askedProductId;
  const unit = { productId: productId ?? askedProductId, variantId: variantId ?? null };
  // La variante tiene que ser de ese producto: un id de otro producto es un error del que llama.
  if (!row || (variantId && askedProductId && row.productId !== askedProductId)) {
    return { ok: false, skipped: "not_found", ...unit };
  }
  // Los ilimitados no se cuentan: venderlos o devolverlos no cambia nada (antes tampoco). Las compras
  // pasan respectUnlimited: false porque siempre sumaron igual.
  if (o.respectUnlimited !== false && row.stockUnlimited) {
    return { ok: false, skipped: "unlimited", ...unit };
  }

  // Tomar el candado de la fila. Un UPDATE en Postgres bloquea la fila hasta que termina la transacción,
  // y si otra transacción la tenía tomada, espera a que termine y trabaja sobre el número que dejó. Se
  // toca solo updatedAt (que igual cambia al escribir) para que la respuesta traiga el stock vigente.
  let locked;
  try {
    locked = await model.update({ where: { id }, data: { updatedAt: new Date() } });
  } catch (err) {
    if (err?.code === "P2025") return { ok: false, skipped: "not_found", ...unit }; // se borró recién
    throw err;
  }
  if (typeof locked?.stock !== "number") throw new Error(`stock: no se pudo leer el stock de ${unitKey(unit)}`);

  const before = locked.stock;
  let after = o.delta !== undefined && o.delta !== null ? before + o.delta : o.setTo;
  let shortfall = 0;
  if (o.clampAtZero !== false && after < 0) {
    // Mismo piso en 0 que tenía cada lugar. Lo que no alcanzó queda anotado en el movimiento.
    shortfall = -after;
    after = 0;
  }
  if (after !== before) {
    await model.update({ where: { id }, data: { stock: after } });
  }

  let movementId = null;
  if (after !== before || shortfall > 0) {
    const movement = await tx.stockMovement.create({
      data: {
        productId,
        variantId,
        requested: o.delta !== undefined && o.delta !== null ? o.delta : null,
        delta:     after - before,
        before,
        after,
        reason:    o.reason,
        refType:   clip(o.ref?.type, 30),
        refId:     o.ref?.id != null ? clip(o.ref.id, 60) : null,
        actor:     clip(o.actor, 120),
        note:      clip(o.note, 300),
      },
    });
    movementId = movement?.id ?? null;
  }

  if ((o.visibility ?? "sync") === "sync") {
    await syncProductVisibility(productId, tx);
  }

  return { ok: true, productId, variantId: variantId ?? null, before, after, applied: after - before, shortfall, movementId };
}

/**
 * Cambia el stock de un producto (sin variante) o de una variante.
 *
 * @param {Object}  o
 * @param {number}  o.productId          producto (obligatorio si no hay variantId)
 * @param {number}  [o.variantId]        variante: el stock vive en ella, no en el producto
 * @param {number}  [o.delta]            unidades a sumar (+) o restar (-)
 * @param {number}  [o.setTo]            o bien, el número que tiene que quedar (carga a mano)
 * @param {string}  o.reason             uno de REASONS
 * @param {Object}  [o.ref]              { type: "order"|"purchase"|"gasto", id }
 * @param {string}  [o.actor]            quién (ver actorOf)
 * @param {string}  [o.note]
 * @param {Object}  [o.tx]               transacción del que llama. Sin tx, el ajuste abre la suya.
 *                                       Si el que llama ya está en una, TIENE que pasarla: si no, el
 *                                       ajuste espera un candado que tiene la transacción de afuera.
 * @param {boolean} [o.respectUnlimited] true (por defecto): no toca los ilimitados
 * @param {boolean} [o.clampAtZero]      true (por defecto): nunca queda negativo
 * @param {string}  [o.visibility]       "sync" (por defecto) publica/despublica según el stock; "none" no
 * @returns {Promise<Object>} { ok: true, productId, variantId, before, after, applied, shortfall, movementId }
 *                            o { ok: false, skipped: "not_found" | "unlimited", productId, variantId }
 */
async function adjustStock(o) {
  checkOptions(o);
  if (o.tx) {
    const result = await adjustInTx(o.tx, o);
    if (result.ok && result.applied !== 0) touchedByTx.get(o.tx)?.push({ ...result, reason: o.reason });
    return result;
  }
  const result = await prisma.$transaction((tx) => adjustInTx(tx, o), TX_OPTS);
  if (result.ok && result.applied !== 0) notifyCommitted([{ productId: result.productId, variantId: result.variantId, reasons: [o.reason] }]);
  return result;
}

// Stock con el que nace un producto (alta en el panel o producto nuevo que crea una compra). La fila
// ya se creó con ese número: esto solo lo deja anotado en el historial.
async function recordInitial({ productId, variantId = null, stock, reason = REASONS.ALTA, ref = null, actor = null, note = null, tx = prisma }) {
  const n = parseInt(stock, 10);
  if (!toId(productId) || !Number.isInteger(n) || n <= 0) return null;
  return tx.stockMovement.create({
    data: {
      productId: toId(productId),
      variantId: toId(variantId),
      requested: n,
      delta:     n,
      before:    0,
      after:     n,
      reason,
      refType:   clip(ref?.type, 30),
      refId:     ref?.id != null ? clip(ref.id, 60) : null,
      actor:     clip(actor, 120),
      note:      clip(note, 300),
    },
  });
}

// Stock que desaparece sin pasar por adjustStock porque se borra la fila entera (variantes que se
// regeneran o se borran). Solo lo anota; el borrado lo hace quien llama.
async function recordRemoved({ productId, variantId = null, stock, reason = REASONS.VARIANTES, actor = null, note = null, tx = prisma }) {
  const n = parseInt(stock, 10);
  if (!toId(productId) || !Number.isInteger(n) || n <= 0) return null;
  return tx.stockMovement.create({
    data: {
      productId: toId(productId),
      variantId: toId(variantId),
      requested: null,
      delta:     -n,
      before:    n,
      after:     0,
      reason,
      actor:     clip(actor, 120),
      note:      clip(note, 300),
    },
  });
}

// Historial de un producto (incluye sus variantes), del más nuevo al más viejo.
async function listMovements(productId, { limit = 200 } = {}) {
  const take = Math.min(500, Math.max(1, parseInt(limit, 10) || 200));
  return prisma.stockMovement.findMany({
    where:   { productId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });
}

module.exports = {
  REASONS,
  adjustStock,
  transaction,
  recordInitial,
  recordRemoved,
  listMovements,
  syncProductVisibility,
  sortUnits,
  lockUnits,
  onCommitted,
  actorOf,
};

// Lectura y escritura de un pozo en Mercado Libre, a partir de sus publicaciones (ml_listings).
//
// Leer: se pide cada publicación del pozo de a una (la lectura en lote falla de a ratos y las ráfagas
// reciben 429). Solo cuentan publicaciones propias (seller_id de la tienda) activas o pausadas; las
// cerradas o en revisión no aportan número. Mercado Libre mantiene igual el stock de todas las del
// mismo user_product_id, así que tienen que coincidir: si no coinciden, probablemente está copiando el
// número de una a otra y conviene volver a leer en un rato.
//
// Escribir: alcanza con una publicación del pozo (Mercado Libre copia el número a las demás).
//
// Las publicaciones que traen "variations" (el modelo viejo) se leen por variación.
const api = require("./mlApi");

const COUNTED = new Set(["active", "paused"]);

function memberKey(m) {
  return m.variationId ? `${m.itemId}:${m.variationId}` : m.itemId;
}

// Datos de una publicación o variación, tal como los devuelve /items/{id}.
function unitOf(item, variationId) {
  if (!variationId) {
    return {
      qty:  item.available_quantity,
      sold: item.sold_quantity,
      userProductId: typeof item.user_product_id === "string" ? item.user_product_id : null,
    };
  }
  const v = Array.isArray(item.variations) ? item.variations.find((x) => String(x?.id) === String(variationId)) : null;
  if (!v) return null;
  return {
    qty:  v.available_quantity,
    sold: v.sold_quantity,
    userProductId: typeof v.user_product_id === "string" ? v.user_product_id : null,
  };
}

/**
 * Lee el pozo. members: [{ itemId, variationId }] (variationId "" o null si no tiene).
 * @returns {Promise<
 *   {ok:true, qty:number, sold:Object, target:{itemId,variationId}, statuses:Object} |
 *   {ok:false, kind:string, message:string, retryAfterMs?:number}>}
 * kind además de los de mlApi: closed (ninguna publicación activa o pausada), foreign (publicación de
 * otra cuenta), regrouped (cambió de user_product_id), mismatch (las del pozo muestran números distintos).
 */
async function readPool({ token, pool, members, expectedUserId, fetchImpl, sleep = null, paceMs = 150 }) {
  if (!members.length) return { ok: false, kind: "closed", message: "El pozo no tiene publicaciones" };
  const counted = [];
  const statuses = {};
  const cache = new Map();
  for (const m of members) {
    let item = cache.get(m.itemId);
    if (!item) {
      if (sleep && cache.size) await sleep(paceMs);
      const r = await api.getItem(token, m.itemId, { fetchImpl });
      if (!r.ok) {
        if (r.kind === "not_found") { statuses[memberKey(m)] = "not_found"; continue; }
        return r;
      }
      item = r.data;
      cache.set(m.itemId, item);
    }
    if (!item || typeof item !== "object") return { ok: false, kind: "bad_response", message: "Publicación sin datos" };
    if (String(item.seller_id) !== String(expectedUserId)) {
      return { ok: false, kind: "foreign", message: `La publicación ${m.itemId} no es de la cuenta de la tienda` };
    }
    const status = String(item.status || "");
    statuses[memberKey(m)] = status;
    const unit = unitOf(item, m.variationId);
    if (!unit) { statuses[memberKey(m)] = "not_found"; continue; }
    if (pool.userProductId && unit.userProductId && unit.userProductId !== pool.userProductId) {
      return { ok: false, kind: "regrouped", message: `La publicación ${memberKey(m)} pasó a otro producto de Mercado Libre (${unit.userProductId})` };
    }
    if (!COUNTED.has(status)) continue;
    if (!Number.isInteger(unit.qty) || unit.qty < 0) {
      return { ok: false, kind: "bad_response", message: `Mercado Libre devolvió un stock inválido para ${memberKey(m)}` };
    }
    counted.push({ member: m, status, qty: unit.qty, sold: unit.sold });
  }

  if (!counted.length) {
    const underReview = Object.values(statuses).includes("under_review");
    return underReview
      ? { ok: false, kind: "transient", message: "La publicación está en revisión en Mercado Libre" }
      : { ok: false, kind: "closed", message: "Ninguna publicación del pozo está activa o pausada" };
  }
  const qtys = new Set(counted.map((c) => c.qty));
  if (qtys.size > 1) {
    return { ok: false, kind: "mismatch", message: `Las publicaciones del pozo muestran números distintos (${[...qtys].join(", ")})`, min: Math.min(...qtys) };
  }

  const sold = {};
  for (const c of counted) if (Number.isInteger(c.sold) && c.sold >= 0) sold[memberKey(c.member)] = c.sold;
  const target = (counted.find((c) => c.status === "active") || counted[0]).member;
  return { ok: true, qty: counted[0].qty, sold, target, statuses };
}

/**
 * Escribe el stock del pozo en una de sus publicaciones.
 * @returns {Promise<{ok:true, stored:number|null}|{ok:false,kind:string,message:string}>}
 */
async function writePool({ token, target, quantity, fetchImpl }) {
  const r = await api.putItemQuantity(token, target.itemId, target.variationId || null, quantity, { fetchImpl });
  if (!r.ok) return r;
  return { ok: true, stored: r.stored };
}

module.exports = { readPool, writePool, memberKey, COUNTED };

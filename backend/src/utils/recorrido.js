// Recorrido por cliente (Analíticas → 👣 Recorrido). Pedido de la clienta (26/11/2026): "ver más específico
// QUIÉN buscó qué o miró qué en los últimos días, ordenado por cliente, el último que estuvo".
//
// La tienda ya registra cada página, búsqueda y producto visto en store_events, con la sesión del navegador
// (sessionId) y el cliente si había iniciado sesión (customerId). La sección "Quiénes entraron y qué vieron"
// de Búsquedas y vistas los muestra por NAVEGADOR (un cliente con compu y celular aparece dos veces, y
// mezclado con miles de visitas anónimas, casi todas robots). Acá se juntan por PERSONA:
//   - cliente con cuenta: "c:<id>"
//   - compró sin cuenta: "g:<email>" (el nombre sale del pedido)
// Lo que hizo ANTES de iniciar sesión o de comprar en esa misma visita también es suyo: si en una sesión
// aparece un cliente (o un pedido), toda la sesión se le atribuye. Si en un navegador compartido entraron
// dos clientes, lo anónimo de esa sesión queda para el primero que apareció.
// Funciones puras (sin base), para testearlas.

const personKeyOfOrder = (o) =>
  o.customerId ? `c:${o.customerId}` : o.customerEmail ? `g:${String(o.customerEmail).trim().toLowerCase()}` : null;

// sessionId → persona, con los eventos y pedidos del período
function sessionOwners(events, orders) {
  const owner = new Map();
  for (const e of events) if (e.customerId && !owner.has(e.sessionId)) owner.set(e.sessionId, `c:${e.customerId}`);
  for (const o of orders) {
    const key = personKeyOfOrder(o);
    if (key && o.sessionId && !owner.has(o.sessionId)) owner.set(o.sessionId, key);
  }
  return owner;
}

const keyOfEvent = (e, owner) => (e.customerId ? `c:${e.customerId}` : owner.get(e.sessionId) || null);

// Una fila por persona: { key, customerId, guestName, guestEmail, firstAt, lastAt, busquedas, productos (distintos),
// paginas, visitas (sesiones), device (el último), pedidos, terminos (últimas búsquedas distintas, hasta 3) }.
// Ordenadas por la última actividad.
function buildPeople(events, orders) {
  const owner = sessionOwners(events, orders);
  const people = new Map();
  const get = (key) => {
    if (!people.has(key)) {
      people.set(key, {
        key, customerId: key.startsWith("c:") ? Number(key.slice(2)) : null, guestName: null, guestEmail: key.startsWith("g:") ? key.slice(2) : null,
        firstAt: null, lastAt: null, busquedas: 0, productos: new Set(), paginas: 0, visitas: new Set(), device: null, deviceAt: null, pedidos: 0, terminos: [],
      });
    }
    return people.get(key);
  };
  const touch = (p, at) => {
    const t = new Date(at);
    if (!p.firstAt || t < p.firstAt) p.firstAt = t;
    if (!p.lastAt || t > p.lastAt) p.lastAt = t;
  };
  for (const e of events) {
    const key = keyOfEvent(e, owner);
    if (!key) continue;
    const p = get(key);
    touch(p, e.createdAt);
    p.visitas.add(e.sessionId);
    if (e.device && (!p.deviceAt || new Date(e.createdAt) > p.deviceAt)) { p.device = e.device; p.deviceAt = new Date(e.createdAt); }
    if (e.type === "SEARCH") { p.busquedas += 1; p.terminos.push({ term: e.term, at: new Date(e.createdAt) }); }
    else if (e.type === "PRODUCT_VIEW") { if (e.productId) p.productos.add(e.productId); }
    else p.paginas += 1;
  }
  for (const o of orders) {
    const key = personKeyOfOrder(o);
    if (!key) continue;
    const p = get(key);
    touch(p, o.createdAt);
    p.pedidos += 1;
    if (!p.customerId && o.customerName) p.guestName = o.customerName;
  }
  return [...people.values()]
    .map((p) => {
      // Últimas 3 búsquedas distintas, la más reciente primero
      const vistos = new Set();
      const terminos = p.terminos.sort((a, b) => b.at - a.at).map((t) => t.term).filter((t) => t && !vistos.has(t) && vistos.add(t)).slice(0, 3);
      return {
        key: p.key, customerId: p.customerId, guestName: p.guestName, guestEmail: p.guestEmail,
        firstAt: p.firstAt, lastAt: p.lastAt, busquedas: p.busquedas, productos: p.productos.size, paginas: p.paginas,
        visitas: p.visitas.size, device: p.device, pedidos: p.pedidos, terminos,
      };
    })
    .sort((a, b) => b.lastAt - a.lastAt);
}

// Sesiones con 2 o más acciones que no son de nadie identificado (para el "además, N visitas sin cuenta")
function anonymousSessions(events, orders) {
  const owner = sessionOwners(events, orders);
  const count = new Map();
  for (const e of events) {
    if (keyOfEvent(e, owner)) continue;
    count.set(e.sessionId, (count.get(e.sessionId) || 0) + 1);
  }
  return [...count.values()].filter((n) => n >= 2).length;
}

// El recorrido de una persona, del más reciente al más viejo. Cada ítem: { at, kind: "search" | "product" | "page"
// | "order", sessionId, device, term, results, productId, path, orderId, total, status }. Las páginas iguales
// seguidas en la misma visita (recargas, volver atrás) se muestran una sola vez.
function buildTimeline(events, orders, key, { limit = 500 } = {}) {
  const owner = sessionOwners(events, orders);
  const items = [];
  for (const e of events) {
    if (keyOfEvent(e, owner) !== key) continue;
    const base = { at: new Date(e.createdAt), sessionId: e.sessionId, device: e.device || null };
    if (e.type === "SEARCH") items.push({ ...base, kind: "search", term: e.term, results: e.results });
    else if (e.type === "PRODUCT_VIEW") items.push({ ...base, kind: "product", productId: e.productId });
    else items.push({ ...base, kind: "page", path: e.path });
  }
  for (const o of orders) {
    if (personKeyOfOrder(o) !== key) continue;
    items.push({ at: new Date(o.createdAt), sessionId: o.sessionId || null, device: null, kind: "order", orderId: o.id, total: o.total, totalUsd: o.totalUsd ?? null, status: o.status });
  }
  items.sort((a, b) => a.at - b.at);
  const out = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    if (it.kind === "page" && prev?.kind === "page" && prev.path === it.path && prev.sessionId === it.sessionId) continue;
    out.push(it);
  }
  return out.reverse().slice(0, limit);
}

module.exports = { buildPeople, buildTimeline, anonymousSessions, sessionOwners };

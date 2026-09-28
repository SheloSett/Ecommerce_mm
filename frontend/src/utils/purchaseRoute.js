// Orden de los proveedores en la orden de compra, según el recorrido a pie.
//
// Modos (los elige quien imprime):
//   "alfabetico" → como siempre, por nombre.
//   "corto"      → el orden en el que menos se camina. Sale desde `start` (tu casa) si está cargada;
//                  si no, arranca por el proveedor que más conviene. Termina en el último proveedor
//                  (la vuelta no cuenta: de ahí se vuelve en auto o taxi con todo).
//   "carga"      → igual, pero primero todos los livianos, después los medianos y al final los
//                  bultosos, para no andar cargado de un lado al otro. Cada proveedor se marca al
//                  imprimir (no hay pesos cargados en los productos).
//
// Con hasta EXACT_MAX proveedores ubicados el orden es el mejor posible (programación dinámica sobre
// todas las combinaciones); con más, una aproximación (vecino más cercano + 2-opt).
//
// Módulo sin React a propósito: se testea con node --test (purchaseRoute.test.js).

export const MODES = [
  { id: "alfabetico", label: "Alfabético" },
  { id: "corto",      label: "Camino más corto" },
  { id: "carga",      label: "Bultosos al final" },
];
export const TIER_LABELS = ["Liviano", "Mediano", "Bultoso"];
const EXACT_MAX = 15;
// Google Maps acepta hasta 9 paradas intermedias en un link de recorrido.
const MAPS_MAX_WAYPOINTS = 9;

// Metros a pie entre dos puntos { lat, lng }. En una ciudad cuadriculada se camina por las calles,
// no en diagonal: se suma lo que hay que avanzar en cada eje ("distancia manhattan"). En Once las
// calles corren casi exactas norte-sur y este-oeste, así que la aproximación es buena.
export function walkMeters(a, b) {
  const metersPerLat = 110540;
  const metersPerLng = 111320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.abs(a.lat - b.lat) * metersPerLat + Math.abs(a.lng - b.lng) * metersPerLng;
}

// "≈ 350 m" / "≈ 1,2 km" (0 → "0 m": dos proveedores en la misma dirección)
export function formatMeters(m) {
  if (m == null) return "";
  if (m < 1) return "0 m";
  if (m < 950) return `≈ ${Math.max(50, Math.round(m / 50) * 50)} m`;
  return `≈ ${(m / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} km`;
}

// Costo de recorrer `seq` (índices de `points`) saliendo de `from` (null = arranca en la primera).
function pathCost(seq, points, from) {
  let total = 0;
  let prev = from;
  for (const i of seq) {
    if (prev) total += walkMeters(prev, points[i]);
    prev = points[i];
  }
  return total;
}

// Orden exacto: programación dinámica (Held-Karp) sobre subconjuntos de paradas visitadas.
// tiers[i] = nivel de la parada i; no se puede visitar una parada mientras queden paradas de un
// nivel menor sin visitar (así los bultosos quedan al final).
function optimalOrder(points, tiers, start) {
  const n = points.length;
  if (n === 0) return [];
  const d = points.map((p) => points.map((q) => walkMeters(p, q)));
  const fromStart = points.map((p) => (start ? walkMeters(start, p) : 0));
  // lower[i]: máscara de las paradas de nivel menor que i (tienen que ir antes que i)
  const lower = points.map((_, i) => tiers.reduce((m, t, j) => (t < tiers[i] ? m | (1 << j) : m), 0));
  const full = (1 << n) - 1;
  const cost = new Float64Array((full + 1) * n).fill(Infinity);
  const prev = new Int8Array((full + 1) * n).fill(-1);

  for (let i = 0; i < n; i++) if (lower[i] === 0) cost[(1 << i) * n + i] = fromStart[i];
  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < n; last++) {
      if (!(mask & (1 << last))) continue;
      const c = cost[mask * n + last];
      if (c === Infinity) continue;
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue;
        if ((mask & lower[j]) !== lower[j]) continue; // quedan paradas de un nivel menor
        const next = mask | (1 << j);
        const nc = c + d[last][j];
        if (nc < cost[next * n + j]) {
          cost[next * n + j] = nc;
          prev[next * n + j] = last;
        }
      }
    }
  }

  let best = 0;
  for (let i = 1; i < n; i++) if (cost[full * n + i] < cost[full * n + best]) best = i;
  const order = [];
  let mask = full;
  let cur = best;
  while (cur !== -1) {
    order.push(cur);
    const p = prev[mask * n + cur];
    mask &= ~(1 << cur);
    cur = p;
  }
  return order.reverse();
}

// Aproximación para muchas paradas: por nivel, vecino más cercano desde donde quedaste y después
// 2-opt (dar vuelta un tramo si acorta) dentro de ese nivel.
function approxOrder(points, tiers, start) {
  const levels = [...new Set(tiers)].sort((a, b) => a - b);
  const order = [];
  let from = start;
  for (const t of levels) {
    const members = points.map((_, i) => i).filter((i) => tiers[i] === t);
    // Sin punto de partida, se prueba arrancar por cada parada del nivel y queda la mejor.
    const firsts = from ? [null] : members;
    let seg = null;
    for (const first of firsts) {
      const pending = members.filter((i) => i !== first);
      const cand = first == null ? [] : [first];
      let cur = first == null ? from : points[first];
      while (pending.length) {
        let k = 0;
        for (let q = 1; q < pending.length; q++) {
          if (walkMeters(cur, points[pending[q]]) < walkMeters(cur, points[pending[k]])) k = q;
        }
        const i = pending.splice(k, 1)[0];
        cand.push(i);
        cur = points[i];
      }
      if (!seg || pathCost(cand, points, from) < pathCost(seg, points, from)) seg = cand;
    }
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < seg.length - 1; i++) {
        for (let j = i + 1; j < seg.length; j++) {
          const trial = [...seg.slice(0, i), ...seg.slice(i, j + 1).reverse(), ...seg.slice(j + 1)];
          if (pathCost(trial, points, from) + 1e-6 < pathCost(seg, points, from)) {
            seg = trial;
            improved = true;
          }
        }
      }
    }
    order.push(...seg);
    from = points[seg[seg.length - 1]];
  }
  return order;
}

// Metros de cada tramo para un orden ya decidido (también después de moverlo a mano).
// orderedStops: [{ key, point }]. legs[key] = metros desde el punto anterior (null en la primera
// parada si no hay salida). Las paradas sin punto no suman ni cortan el recorrido.
// total = todo; fromStart = el primer tramo (salida → primer proveedor), que suele ser el viaje
// hasta Once y no se camina; between = lo que se camina de proveedor en proveedor.
export function routeLegs(start, orderedStops) {
  const legs = {};
  let total = 0;
  let fromStart = 0;
  let prev = start || null;
  for (const s of orderedStops) {
    if (!s.point) continue;
    const m = prev ? walkMeters(prev, s.point) : null;
    if (prev === start && start) fromStart = m;
    legs[s.key] = m;
    total += m || 0;
    prev = s.point;
  }
  return { legs, total, fromStart, between: total - fromStart };
}

// stops: [{ key, point: { lat, lng } | null, tier: 0 | 1 | 2 }], en el orden base (alfabético).
// Devuelve { order: [key...], legs, total }. Las paradas sin punto (sin dirección, o que el mapa no
// encontró) van al final en el orden base: no se pueden ubicar en el recorrido.
export function planRoute({ start = null, stops, useTiers = false }) {
  const located = stops.filter((s) => s.point);
  const unlocated = stops.filter((s) => !s.point);
  const points = located.map((s) => s.point);
  const tiers = located.map((s) => (useTiers ? s.tier || 0 : 0));
  const idx = located.length <= EXACT_MAX
    ? optimalOrder(points, tiers, start)
    : approxOrder(points, tiers, start);
  const ordered = [...idx.map((i) => located[i]), ...unlocated];
  return { order: ordered.map((s) => s.key), ...routeLegs(start, ordered) };
}

// Link de Google Maps con el recorrido a pie en el orden elegido. Va con coordenadas y no con el
// texto de la dirección: USIG escribe algunas calles como "PERON, JUAN DOMINGO, TTE. GENERAL 2310"
// y las comas confunden a Google. Si hay más paradas de las que Google acepta, el link cubre las
// primeras y truncated = true.
export function googleMapsUrl(start, orderedPoints) {
  const pts = orderedPoints.filter(Boolean);
  if (pts.length === 0) return null;
  const fmt = (p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const origin = start || pts[0];
  const rest = start ? pts : pts.slice(1);
  if (rest.length === 0) {
    return { url: `https://www.google.com/maps/search/?api=1&query=${fmt(origin)}`, truncated: false };
  }
  const shown = rest.slice(0, MAPS_MAX_WAYPOINTS + 1); // paradas intermedias + destino
  const params = new URLSearchParams({
    api: "1",
    origin: fmt(origin),
    destination: fmt(shown[shown.length - 1]),
    travelmode: "walking",
  });
  if (shown.length > 1) params.set("waypoints", shown.slice(0, -1).map(fmt).join("|"));
  return { url: `https://www.google.com/maps/dir/?${params}`, truncated: rest.length > shown.length };
}

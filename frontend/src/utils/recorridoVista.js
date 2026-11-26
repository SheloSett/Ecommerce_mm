// Cómo se muestra el recorrido de un cliente (Analíticas → 👣 Recorrido). Segunda versión (26/11/2026): la
// primera era una fila por paso y "se veía medio feo": muchos "Entró a Carrito / Entró a Checkout" seguidos
// tapaban lo importante. Ahora:
//   - resumen: qué buscó y qué productos miró, con cuántas veces (lo más repetido primero), y sus pedidos;
//   - el recorrido por VISITA (otro navegador, o volvió después de 30 minutos), con las páginas en una línea
//     como camino y los ida y vuelta juntos ("Carrito ⇄ Checkout ×4").
// Funciones puras; los ítems vienen de /api/analytics/recorrido/:key (del más reciente al más viejo).

const VISIT_GAP_MS = 30 * 60 * 1000;

// Qué buscó y qué miró, con cuántas veces; lo más repetido primero (y, a igualdad, lo más reciente)
export function resumenOf(items) {
  const terms = new Map();
  const prods = new Map();
  const orders = [];
  for (const it of items || []) {
    if (it.kind === "search") {
      const k = String(it.term || "").trim();
      if (!k) continue;
      const t = terms.get(k) || { term: k, veces: 0, sinResultados: false, last: new Date(it.at) };
      t.veces += 1;
      if (it.results === 0) t.sinResultados = true;
      terms.set(k, t);
    } else if (it.kind === "product") {
      const p = prods.get(it.productId) || { productId: it.productId, product: it.product, veces: 0, last: new Date(it.at) };
      p.veces += 1;
      prods.set(it.productId, p);
    } else if (it.kind === "order") {
      orders.push(it);
    }
  }
  const byCount = (a, b) => b.veces - a.veces || b.last - a.last;
  return { terms: [...terms.values()].sort(byCount), prods: [...prods.values()].sort(byCount), orders };
}

// Páginas seguidas → camino. Una ida y vuelta que se REPITE (A, B, A, B...) queda como { a, b, veces }; una
// sola (A, B, A) se deja como camino, que se entiende mejor. labels: los nombres de las páginas en orden.
export function compressCamino(labels) {
  const out = [];
  let i = 0;
  while (i < labels.length) {
    const a = labels[i];
    const b = labels[i + 1];
    if (b !== undefined && b !== a && labels[i + 2] === a && labels[i + 3] === b) {
      let j = i;
      while (j + 1 < labels.length && labels[j] === a && labels[j + 1] === b) j += 2;
      out.push({ a, b, veces: (j - i) / 2 });
      i = labels[j] === a ? j + 1 : j; // si terminó en A, esa A ya está dentro del "A ⇄ B"
    } else {
      out.push({ label: a });
      i += 1;
    }
  }
  return out;
}

// Visitas: se corta cuando cambia el navegador (sessionId) o pasan más de 30 minutos sin actividad. Cada visita
// con sus pasos en orden: las páginas seguidas juntas en un "camino"; búsquedas, productos y pedidos sueltos.
// Devuelve la visita más reciente primero.
export function visitsOf(items) {
  // Vienen del más reciente al más viejo: se dan vuelta ANTES de ordenar, así los pasos con la misma hora
  // quedan en el orden en que pasaron (el sort es estable).
  const asc = [...(items || [])].reverse().sort((x, y) => new Date(x.at) - new Date(y.at));
  const visits = [];
  for (const it of asc) {
    const t = new Date(it.at).getTime();
    const v = visits[visits.length - 1];
    const otherBrowser = v && it.sessionId && v.sessionId && it.sessionId !== v.sessionId;
    if (!v || otherBrowser || t - v.end > VISIT_GAP_MS) {
      visits.push({ sessionId: it.sessionId || null, start: t, end: t, device: it.device || null, items: [] });
    }
    const cur = visits[visits.length - 1];
    cur.items.push(it);
    cur.end = t;
    if (!cur.sessionId && it.sessionId) cur.sessionId = it.sessionId;
    if (it.device) cur.device = it.device;
  }
  return visits.reverse().map((v) => ({ ...v, steps: stepsOf(v.items) }));
}

function stepsOf(items) {
  const steps = [];
  for (const it of items) {
    if (it.kind === "page") {
      const last = steps[steps.length - 1];
      const label = it.label || it.path || "Página";
      if (last?.kind === "camino") last.labels.push(label);
      else steps.push({ kind: "camino", at: it.at, labels: [label] });
    } else {
      steps.push(it);
    }
  }
  return steps.map((s) => (s.kind === "camino" ? { ...s, camino: compressCamino(s.labels) } : s));
}

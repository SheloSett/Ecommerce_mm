// Helpers de jerarquía de categorías.
//
// POR QUÉ EXISTE ESTE ARCHIVO: hasta ahora el anidado estaba topeado en dos niveles (categoría →
// subcategoría), y con ese tope cada lugar que necesitaba "la categoría y las de abajo" lo resolvía
// a mano con `[c.id, ...c.children.map(ch => ch.id)]`. Eso estaba repetido en tres lugares de
// product.controller.js y en varios del frontend. Al levantar el tope, ese aplanado a mano deja de
// alcanzar: hay que recorrer hacia abajo hasta el fondo. En vez de escribir la recursión cuatro
// veces, vive acá.
//
// ESTRATEGIA: se trae la tabla de categorías ENTERA de una (id, parentId, slug) y se arma el mapa
// padre→hijos en memoria. Son decenas de filas, no miles, así que una query plana es más barata y
// mucho más simple que un CTE recursivo en SQL o que N queries encadenadas bajando nivel por nivel.

// Trae la tabla plana de categorías. Se pasa `prisma` como parámetro en vez de instanciar otro
// PrismaClient acá: cada `new PrismaClient()` abre su propio pool de conexiones.
async function loadFlatCategories(prisma) {
  return prisma.category.findMany({
    select: { id: true, parentId: true, slug: true, name: true },
    orderBy: { name: "asc" },
  });
}

// Mapa parentId → [hijos]. La clave null agrupa las raíces.
function childrenByParent(flat) {
  const map = new Map();
  for (const cat of flat) {
    const key = cat.parentId ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(cat);
  }
  return map;
}

// IDs de un conjunto de categorías MÁS todos sus descendientes, hasta el fondo del árbol.
// Es lo que necesita un filtro "mostrame todo lo que cuelga de esta categoría".
//
// El Set `seen` no es solo una optimización: es lo que evita colgarse si la tabla llegara a tener un
// ciclo (A es padre de B y B es padre de A). Guardar contra ciclos acá además de al escribir es
// barato y significa que un dato corrupto degrada el resultado en vez de colgar el request.
function collectDescendantIds(flat, rootIds) {
  const byParent = childrenByParent(flat);
  const seen = new Set();
  const queue = [...rootIds];

  while (queue.length > 0) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const child of byParent.get(id) || []) queue.push(child.id);
  }
  return [...seen];
}

// Versión por slug: resuelve los slugs a ids y devuelve esos ids + todos sus descendientes.
// Devuelve null si NINGUNO de los slugs existe, para que el caller pueda distinguir "no hay
// resultados" de "el filtro no aplica" (los tres callers devuelven lista vacía en ese caso).
async function descendantIdsBySlugs(prisma, slugs) {
  const flat = await loadFlatCategories(prisma);
  const rootIds = flat.filter((c) => slugs.includes(c.slug)).map((c) => c.id);
  if (rootIds.length === 0) return null;
  return collectDescendantIds(flat, rootIds);
}

// Arma el árbol anidado a partir de la lista plana. Cada nodo recibe `children` (array, vacío si es
// hoja) y `depth` (0 = raíz), que es lo que el frontend usa para sangrar sin tener que contar solo.
//
// `decorate(cat)` permite inyectar datos por nodo (ej: _count de productos) sin que este helper
// tenga que saber de dónde salen.
function buildTree(flat, decorate = (c) => c) {
  const byParent = childrenByParent(flat);

  // El Set de ancestros que se va arrastrando corta cualquier ciclo: si al bajar nos volvemos a
  // topar con una categoría que ya está en el camino, se ignora esa rama en vez de recursar para
  // siempre. Sin esto, un ciclo en la tabla revienta el proceso por stack overflow.
  const build = (parentId, depth, ancestors) =>
    (byParent.get(parentId) || [])
      .filter((cat) => !ancestors.has(cat.id))
      .map((cat) => ({
        ...decorate(cat),
        depth,
        children: build(cat.id, depth + 1, new Set([...ancestors, cat.id])),
      }));

  return build(null, 0, new Set());
}

// ¿Poner `newParentId` como padre de `categoryId` crearía un ciclo?
//
// POR QUÉ HACE FALTA: mientras el anidado estaba topeado en dos niveles, alcanzaba con prohibir que
// una categoría fuera su propio padre — no había forma de armar un ciclo más largo, porque el padre
// siempre tenía que ser una raíz. Sin ese tope se puede hacer A→B y después B→A: a partir de ahí,
// cualquier recorrido recursivo (armar el árbol, juntar descendientes, armar el breadcrumb) queda
// dando vueltas para siempre y cuelga el request. Hay que rechazarlo ANTES de escribir.
//
// Se sube por la cadena de ancestros del padre propuesto: si en el camino aparece la categoría que
// estamos moviendo, el movimiento la metería adentro de su propia descendencia.
async function wouldCreateCycle(prisma, categoryId, newParentId) {
  if (!newParentId) return false;              // pasar a raíz nunca cierra un ciclo
  if (categoryId === newParentId) return true; // su propio padre

  const flat = await loadFlatCategories(prisma);
  const byId = new Map(flat.map((c) => [c.id, c]));

  const visited = new Set();
  let current = byId.get(newParentId);
  while (current) {
    if (current.id === categoryId) return true;
    // Si la tabla YA tuviera un ciclo (dato corrupto anterior a esta validación), esto corta en vez
    // de girar para siempre. No es el caso que buscamos, pero no puede colgar el request.
    if (visited.has(current.id)) return false;
    visited.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return false;
}

// Ruta completa desde la raíz hasta la categoría, ej: ["Audio", "Auriculares", "Inalámbricos"].
// Se usa para los breadcrumbs, que antes se armaban con `category.parent.name` y por eso solo podían
// mostrar un nivel para arriba.
function ancestorPath(flat, categoryId) {
  const byId = new Map(flat.map((c) => [c.id, c]));
  const path = [];
  const visited = new Set();
  let current = byId.get(categoryId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return path;
}

module.exports = {
  loadFlatCategories,
  childrenByParent,
  collectDescendantIds,
  descendantIdsBySlugs,
  buildTree,
  wouldCreateCycle,
  ancestorPath,
};

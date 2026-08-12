// Helpers de jerarquía de categorías (lado frontend).
//
// El backend (GET /api/categories) devuelve las categorías RAÍZ con toda su descendencia anidada en
// `children`, y cada nodo trae `depth` (0 = raíz). Hasta que se levantó el tope de dos niveles,
// cada pantalla aplanaba ese árbol a mano con un `[padre, ...c.children.map(...)]`. Eso está
// repetido en cuatro pantallas y con anidado libre ya no alcanza: se pierden los nietos. La
// recursión vive acá una sola vez.
//
// Es el espejo de backend/src/utils/categoryTree.js — si cambia el criterio de uno, revisar el otro.

// Recorre el árbol en el orden en que se ve en pantalla (padre, después su descendencia, después el
// hermano siguiente) y devuelve una lista plana. Cada elemento conserva `depth` para poder sangrar.
//
// Se usa `node.depth ?? level` en vez de confiar solo en lo que manda el backend: así el helper
// sigue funcionando con un árbol armado en el cliente que no tenga el campo.
export function flattenTree(nodes, level = 0) {
  const out = [];
  for (const node of nodes || []) {
    const depth = node.depth ?? level;
    out.push({ ...node, depth });
    out.push(...flattenTree(node.children, depth + 1));
  }
  return out;
}

// Etiqueta con sangría para mostrar la categoría dentro de un <select> o una lista de checkboxes.
// Las raíces van sin prefijo; cada nivel más abajo agrega sangría y una flechita.
//
// Los <option> de un <select> no respetan padding por CSS, así que la sangría tiene que ir en el
// texto sí o sí (de ahí los espacios duros). En listas de checkboxes se puede usar `depth`
// directamente para el padding y pasar `arrow: false`.
export function indentedLabel(node, { arrow = true, space = "  " } = {}) {
  const depth = node.depth ?? 0;
  if (depth === 0) return node.name;
  return `${space.repeat(depth)}${arrow ? "↳ " : ""}${node.name}`;
}

// Busca una categoría por slug en todo el árbol, no solo en los dos primeros niveles.
export function findBySlug(nodes, slug) {
  for (const node of nodes || []) {
    if (node.slug === slug) return node;
    const found = findBySlug(node.children, slug);
    if (found) return found;
  }
  return null;
}

// Todos los slugs que cuelgan de un nodo, incluido el suyo. Sirve para saber si una rama está
// "activa" cuando el filtro seleccionado apunta a una subcategoría de cualquier profundidad.
export function slugsInBranch(node) {
  if (!node) return [];
  return [node.slug, ...(node.children || []).flatMap(slugsInBranch)];
}

// Ruta desde la raíz hasta la categoría con ese id, ej: [Audio, Auriculares, Inalámbricos].
// Devuelve [] si no está en el árbol.
export function pathToId(nodes, id, trail = []) {
  for (const node of nodes || []) {
    const here = [...trail, node];
    if (node.id === id) return here;
    const found = pathToId(node.children, id, here);
    if (found.length > 0) return found;
  }
  return [];
}

// Breadcrumb "Audio > Auriculares > Inalámbricos" a partir del árbol.
//
// Antes esto se armaba con `category.parent?.name`, que por definición solo podía mostrar UN nivel
// para arriba: con tres niveles, un producto en "Inalámbricos" se veía como "Auriculares >
// Inalámbricos" y no había forma de saber que colgaba de Audio. El árbol tiene la ruta completa.
// Si la categoría no está en el árbol (todavía cargando, o quedó huérfana), cae al nombre solo.
export function breadcrumbForId(nodes, id, fallbackName = null) {
  const path = pathToId(nodes, id);
  if (path.length === 0) return fallbackName;
  return path.map((c) => c.name).join(" > ");
}

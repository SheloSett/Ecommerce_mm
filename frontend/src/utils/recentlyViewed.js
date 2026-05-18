const KEY = "igwt_recent";
const MAX  = 8;

export function saveRecent(product) {
  try {
    const prev = JSON.parse(localStorage.getItem(KEY)) || [];
    const snapshot = {
      id:                 product.id,
      name:               product.name,
      images:             product.images,
      price:              product.price,
      salePrice:          product.salePrice,
      wholesalePrice:     product.wholesalePrice,
      wholesaleSalePrice: product.wholesaleSalePrice,
      stock:              product.stock,
      stockUnlimited:     product.stockUnlimited,
      featured:           product.featured,
      hotSeller:          product.hotSeller,
      visibility:         product.visibility,
      categories:         product.categories,
      // getById devuelve variants[] pero no _count — calculamos el conteo para que
      // ProductCard pueda detectar si tiene variantes y mostrar el modal correctamente.
      _count: product._count ?? { variants: product.variants?.length ?? 0 },
    };
    const updated = [snapshot, ...prev.filter((p) => p.id !== product.id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(updated));
  } catch {}
}

export function getRecent() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}

// Devuelve solo los IDs de los productos visitados recientemente (para re-fetchear desde API)
export function getRecentIds(max = 8) {
  try {
    const items = JSON.parse(localStorage.getItem(KEY)) || [];
    return items.slice(0, max).map((p) => p.id).filter(Boolean);
  } catch {
    return [];
  }
}

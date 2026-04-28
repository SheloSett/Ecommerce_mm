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
      _count:             product._count,
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

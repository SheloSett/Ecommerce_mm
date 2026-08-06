// Cálculo del precio unitario efectivo — fuente ÚNICA de verdad, compartida por el checkout
// (order.controller) y el carrito (cart.routes) para que no se desincronicen.
//
// Reglas (cada componente se resuelve por separado, NO por grupo entero):
//  - Precio BASE: si la variante define su precio, se usa; si no, cae al del producto.
//  - OFERTA: es propia de la variante. Si hay variante NO se hereda la del producto (variante sin
//    oferta = sin descuento, aunque el producto tenga oferta base).
//  - Descuentos por cantidad (TIERS): son propios de la variante. Si hay variante, salen SIEMPRE de la
//    variante — INDEPENDIENTE de si define su precio base (una variante que hereda la base del producto
//    igual puede tener sus propios tramos). Nunca se heredan los del producto.
//  - La oferta (sale) reemplaza al base si es menor. Un tier por cantidad, si aplica, gana sobre todo.
//
// product/variant: objetos con price/salePrice/wholesalePrice/wholesaleSalePrice/priceTiers/
// wholesalePriceTiers (variant puede ser null). quantity: cantidad pedida.
function effectiveUnitPrice({ product, variant, isMayorista, quantity }) {
  let base, sale, tiers;

  if (isMayorista) {
    base  = variant && variant.wholesalePrice != null
              ? variant.wholesalePrice
              : (product.wholesalePrice != null ? product.wholesalePrice : product.price);
    sale  = variant ? variant.wholesaleSalePrice : product.wholesaleSalePrice;
    tiers = variant ? variant.wholesalePriceTiers : product.wholesalePriceTiers;
  } else {
    base  = variant && variant.price != null ? variant.price : product.price;
    sale  = variant ? variant.salePrice : product.salePrice;
    tiers = variant ? variant.priceTiers : product.priceTiers;
  }

  let price = base;
  if (sale != null && sale < base) price = sale;

  // Tier por cantidad: el de mayor minQty que no supere la cantidad pedida (gana sobre base/oferta).
  if (Array.isArray(tiers) && tiers.length > 0 && quantity != null) {
    const applicable = [...tiers]
      .sort((a, b) => parseFloat(b.minQty) - parseFloat(a.minQty))
      .find((t) => parseFloat(quantity) >= parseFloat(t.minQty));
    if (applicable) price = parseFloat(applicable.price);
  }

  return price;
}

// Moneda efectiva de un ítem: la variante gana si la definió, si no cae al producto.
// Misma precedencia que effectiveUnitPrice, para que precio y moneda nunca se desincronicen.
function effectiveCurrency({ product, variant }) {
  return (variant && variant.currency != null) ? variant.currency : (product.currency || "ARS");
}

module.exports = { effectiveUnitPrice, effectiveCurrency };

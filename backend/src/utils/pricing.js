// Cálculo del precio unitario efectivo — fuente ÚNICA de verdad, compartida por el checkout
// (order.controller) y el carrito (cart.routes) para que no se desincronicen.
//
// Reglas:
//  - Fallback por GRUPO: si la variante define su precio base para el tipo de cliente, TODO sale de
//    la variante (base, oferta y tiers). Si no lo define, se usa el grupo del producto padre.
//  - Productos CON variantes IGNORAN los tiers del producto: si hay variante, los descuentos por
//    cantidad solo pueden venir de la variante (vacío = sin descuento, precio normal de la variante).
//  - La oferta (sale) reemplaza al base si es menor. Un tier por cantidad, si aplica, gana sobre todo.
//
// product/variant: objetos con price/salePrice/wholesalePrice/wholesaleSalePrice/priceTiers/
// wholesalePriceTiers (variant puede ser null). quantity: cantidad pedida.
function effectiveUnitPrice({ product, variant, isMayorista, quantity }) {
  let base, sale, tiers;

  if (isMayorista) {
    if (variant && variant.wholesalePrice != null) {
      base = variant.wholesalePrice; sale = variant.wholesaleSalePrice; tiers = variant.wholesalePriceTiers;
    } else {
      base = product.wholesalePrice != null ? product.wholesalePrice : product.price;
      // La OFERTA es propia de la variante: si hay variante NO se hereda la del producto (variante sin
      // oferta = sin descuento, aunque el producto tenga oferta base). El precio base sí cae al del producto.
      sale = variant ? variant.wholesaleSalePrice : product.wholesaleSalePrice;
      // Si hay variante (aunque no defina mayorista) NO se heredan los tiers del producto.
      tiers = variant ? null : product.wholesalePriceTiers;
    }
  } else {
    if (variant && variant.price != null) {
      base = variant.price; sale = variant.salePrice; tiers = variant.priceTiers;
    } else {
      base = product.price;
      // Oferta propia de la variante (ver comentario arriba): sin oferta en la variante = sin descuento.
      sale = variant ? variant.salePrice : product.salePrice;
      tiers = variant ? null : product.priceTiers;
    }
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

module.exports = { effectiveUnitPrice };

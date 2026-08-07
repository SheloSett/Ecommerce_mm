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
// Tramo por cantidad que aplica: el de mayor minQty que no supere la cantidad pedida.
// Vivía inline dentro de effectiveUnitPrice; se extrajo cuando effectiveCurrency necesitaba consultar
// el MISMO tramo. Esa versión de effectiveCurrency ya no existe (la moneda es del producto y listo),
// así que hoy el único llamador es effectiveUnitPrice — se deja como helper igual porque aísla la
// regla del tramo y la deja testeable por separado.
function applicableTier(tiers, quantity) {
  if (!Array.isArray(tiers) || tiers.length === 0 || quantity == null) return null;
  return [...tiers]
    .sort((a, b) => parseFloat(b.minQty) - parseFloat(a.minQty))
    .find((t) => parseFloat(quantity) >= parseFloat(t.minQty)) || null;
}

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
  // COMENTADO: la selección del tramo se movió al helper applicableTier() de arriba, sin cambiar el
  // criterio (mismo sort desc por minQty + primer tramo alcanzado). Se extrajo para que
  // effectiveCurrency pueda preguntar por el MISMO tramo y no duplicar la regla — si el precio sale
  // de un tier de la variante, la moneda tiene que salir de la variante también.
  // if (Array.isArray(tiers) && tiers.length > 0 && quantity != null) {
  //   const applicable = [...tiers]
  //     .sort((a, b) => parseFloat(b.minQty) - parseFloat(a.minQty))
  //     .find((t) => parseFloat(quantity) >= parseFloat(t.minQty));
  //   if (applicable) price = parseFloat(applicable.price);
  // }
  const applicable = applicableTier(tiers, quantity);
  if (applicable) price = parseFloat(applicable.price);

  return price;
}

// Moneda efectiva de un ítem: la variante gana si la definió, si no cae al producto.
// Misma precedencia que effectiveUnitPrice, para que precio y moneda nunca se desincronicen.
// COMENTADO: NO era la misma precedencia y por eso desincronizaba. effectiveUnitPrice cae al padre
// CAMPO POR CAMPO (variant.price == null → usa product.price), mientras que esta versión resolvía la
// moneda POR REGISTRO (si la variante declara moneda, gana entera). Una variante con currency propia
// pero SIN precio propio terminaba vendiendo el número del padre etiquetado con la otra moneda:
// producto en USD 25 + variante ARS sin precio → se cobraba AR$25 por un artículo de USD 25.
// function effectiveCurrency({ product, variant }) {
//   return (variant && variant.currency != null) ? variant.currency : (product.currency || "ARS");
// }

// COMENTADO (2º intento, también de más): esta versión rastreaba de dónde salía el precio efectivo
// —base propia de la variante, oferta propia, o tier propio del grupo que se estaba cobrando— para
// devolver la moneda de quien lo puso. Resolvía el desfasaje, pero atacaba el síntoma: seguía
// permitiendo que un mismo producto tuviera variantes en distintas monedas, con toda la complejidad
// que eso arrastra (y el mismo cruce rompía después el cálculo de costos del dashboard).
// Se descartó al pasar la moneda a ser propiedad EXCLUSIVA del producto (ver abajo).
// function effectiveCurrency({ product, variant, isMayorista, quantity }) {
//   const productCurrency = product.currency || "ARS";
//   if (!variant || variant.currency == null) return productCurrency;
//   if (variant.currency === productCurrency) return productCurrency;
//   let base, baseFromVariant, sale, tiers;
//   if (isMayorista) {
//     baseFromVariant = variant.wholesalePrice != null;
//     base  = baseFromVariant
//               ? variant.wholesalePrice
//               : (product.wholesalePrice != null ? product.wholesalePrice : product.price);
//     sale  = variant.wholesaleSalePrice;
//     tiers = variant.wholesalePriceTiers;
//   } else {
//     baseFromVariant = variant.price != null;
//     base  = baseFromVariant ? variant.price : product.price;
//     sale  = variant.salePrice;
//     tiers = variant.priceTiers;
//   }
//   let priceFromVariant = baseFromVariant;
//   if (sale != null && sale < base) priceFromVariant = true;
//   if (applicableTier(tiers, quantity) != null) priceFromVariant = true;
//   return priceFromVariant ? variant.currency : productCurrency;
// }

// MODELO VIGENTE: la moneda es del PRODUCTO y nada más. El producto define la UNIDAD, la variante
// define el NÚMERO — el precio de una variante siempre está expresado en la moneda de su producto.
// Así es imposible que precio y moneda se desincronicen: no importa si el precio salió de la variante
// o se heredó del padre, la unidad es la misma en los dos casos.
// El parámetro `variant` se mantiene en la firma (y se ignora) para no tocar los llamadores y para
// dejar explícito que la variante NO participa de esta decisión. ProductVariant.currency está
// deprecada en el schema y este es el único lugar que la leía.
function effectiveCurrency({ product }) {
  return product.currency || "ARS";
}

module.exports = { effectiveUnitPrice, effectiveCurrency, applicableTier };

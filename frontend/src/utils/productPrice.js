// Precio de lista y de oferta de un producto (o de una variante) para un tipo de cliente. Misma regla que
// backend/src/utils/pricing.js (effectiveUnitPrice), sin los tramos por cantidad: la variante define el
// número campo por campo y, si no lo define, cae al producto. Lo usan la venta manual y "Modificar pedido"
// del panel, para arrancar con el mismo precio que ve el cliente en la tienda.
//
// La oferta puede ser de una campaña vigente (que escribe salePrice / wholesaleSalePrice mientras dura) o
// una cargada a mano en el producto; para esta cuenta da lo mismo.
export function priceParts(product, variant, isMayorista) {
  let base, sale;
  if (isMayorista) {
    base = variant && variant.wholesalePrice != null
      ? variant.wholesalePrice
      : (product?.wholesalePrice != null ? product.wholesalePrice : product?.price);
    sale = variant ? variant.wholesaleSalePrice : product?.wholesaleSalePrice;
  } else {
    base = variant && variant.price != null ? variant.price : product?.price;
    sale = variant ? variant.salePrice : product?.salePrice;
  }
  const list = Number(base) || 0;
  const offer = sale != null && Number(sale) < list ? Number(sale) : null;
  return { list, offer, price: offer ?? list };
}

// Nombre de la campaña vigente que escribió el precio de oferta para ese público, si la hay. product.offerItems
// lo manda el buscador del panel (/products/admin/all); una oferta cargada a mano no tiene campaña.
export function activeOfferName(product, isMayorista) {
  const item = (product?.offerItems || []).find((oi) =>
    (isMayorista ? oi.appliedWholesaleSalePrice != null : oi.appliedSalePrice != null) || oi.appliedVariants
  );
  return item?.offer?.name || null;
}

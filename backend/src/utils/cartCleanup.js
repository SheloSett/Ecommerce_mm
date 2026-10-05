// Saca del carrito del cliente lo que ya compró en un pedido.
//
// Por qué en el servidor: antes el carrito lo vaciaba solo el navegador del cliente (Checkout y la
// pantalla de resultado del pago), y eso fallaba cuando ese navegador no llegaba a ejecutarlo:
//   - MercadoPago devolvía al cliente en OTRO navegador (ej. pagó desde incógnito y volvió al
//     Chrome normal, sin su sesión): el pago se aprobaba pero el carrito quedaba cargado.
//   - La llamada que vacía el carrito fallaba en silencio después de crear el pedido.
// Ahora lo hace el servidor en el momento justo: al crear el pedido (pagos manuales y cotizaciones)
// o cuando MercadoPago aprueba el pago (así un pago rechazado no le borra el carrito).
//
// Saca solo las líneas compradas (mismo producto y variante), no todo el carrito: si mientras
// pagaba agregó otra cosa en otra pestaña, eso queda. Si el carrito queda vacío, se borra.
// Nunca lanza: un problema acá no puede frenar un pedido ni un pago (se registra y sigue).

async function removeOrderedItemsFromCart(prisma, orderId) {
  try {
    const order = await prisma.order.findUnique({
      where:  { id: orderId },
      select: { customerId: true, items: { select: { productId: true, variantId: true } } },
    });
    if (!order?.customerId) return 0; // pedido sin cuenta (o venta manual): no hay carrito
    const cart = await prisma.cart.findUnique({
      where:   { customerId: order.customerId },
      include: { items: { select: { id: true, productId: true, variantId: true } } },
    });
    if (!cart) return 0;

    const key = (productId, variantId) => `${productId}:${variantId ?? ""}`;
    const bought = new Set(order.items.filter((i) => i.productId).map((i) => key(i.productId, i.variantId)));
    const toDelete = cart.items.filter((ci) => bought.has(key(ci.productId, ci.variantId))).map((ci) => ci.id);
    if (toDelete.length === 0) return 0;

    if (toDelete.length === cart.items.length) {
      await prisma.cart.delete({ where: { id: cart.id } }); // sus ítems se borran en cascada
    } else {
      await prisma.cartItem.deleteMany({ where: { id: { in: toDelete } } });
    }
    console.log(`[CARRITO] Pedido #${orderId}: se sacaron ${toDelete.length} producto(s) comprados del carrito del cliente #${order.customerId}`);
    return toDelete.length;
  } catch (err) {
    console.error(`[CARRITO] Pedido #${orderId}: no se pudo limpiar el carrito:`, err.message);
    return 0;
  }
}

module.exports = { removeOrderedItemsFromCart };

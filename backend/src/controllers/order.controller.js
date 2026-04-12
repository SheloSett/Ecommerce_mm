const { PrismaClient } = require("@prisma/client");
const { pushToClient } = require("../sse/notificationSSE");

// Dado un array de tiers y una cantidad, devuelve el precio del tier correspondiente.
// Los tiers son [{ minQty, price }] ordenados por minQty asc.
// Se aplica el tier con mayor minQty que no supere la cantidad pedida.
// Si no hay tiers o ninguno aplica, retorna null (usar precio normal).
function applyPriceTier(tiers, quantity) {
  if (!tiers || !Array.isArray(tiers) || tiers.length === 0) return null;
  let tierPrice = null;
  for (const tier of tiers) {
    // parseFloat: los tiers guardados antes de la corrección pueden ser strings
    if (quantity >= parseFloat(tier.minQty)) tierPrice = parseFloat(tier.price);
  }
  return tierPrice;
}
const {
  sendOrderConfirmationToCustomer,
  sendOrderNotificationToAdmin,
  sendCotizacionToCustomer,
  sendCotizacionToAdmin,
} = require("../services/email.service");

const prisma = new PrismaClient();

// GET /api/orders - Listar órdenes (solo admin)
async function getOrders(req, res) {
  try {
    const { status, paymentMethod, page = 1, limit = 20 } = req.query;

    const where = {};
    if (status) where.status = status;
    if (paymentMethod) {
      where.paymentMethod = paymentMethod; // Filtro por método de pago (ej: COTIZACION)
      // Las cotizaciones abonadas (APPROVED) ya aparecen en "Todos los pedidos",
      // así que las excluimos del panel de cotizaciones para no duplicarlas.
      if (paymentMethod === "COTIZACION" && !status) {
        where.status = { not: "APPROVED" };
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, images: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: parseInt(limit),
      }),
      prisma.order.count({ where }),
    ]);

    res.json({
      orders,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("getOrders error:", err);
    res.status(500).json({ error: "Error al obtener órdenes" });
  }
}

// GET /api/orders/:id - Obtener una orden
async function getOrder(req, res) {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id: parseInt(id) },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, images: true } },
          },
        },
        // Incluir cupón para mostrarlo en el detalle de la orden en el panel admin
        coupon: { select: { code: true, discountType: true, discountValue: true } },
      },
    });

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    res.json(order);
  } catch (err) {
    console.error("getOrder error:", err);
    res.status(500).json({ error: "Error al obtener la orden" });
  }
}

// POST /api/orders - Crear orden (desde el checkout público)
async function createOrder(req, res) {
  try {
    const { customerName, customerEmail, customerPhone, items, paymentMethod, customerId, couponCode } = req.body;

    if (!customerName || !customerEmail || !items || items.length === 0) {
      return res.status(400).json({ error: "Datos de la orden incompletos" });
    }

    // Métodos de pago válidos; MERCADOPAGO es el default si no se especifica
    const validMethods = ["MERCADOPAGO", "EFECTIVO", "TRANSFERENCIA", "COTIZACION"];
    const method = paymentMethod && validMethods.includes(paymentMethod) ? paymentMethod : "MERCADOPAGO";

    // Verificar stock y calcular total
    let total = 0;
    const orderItems = [];

    // Determinar si el cliente es mayorista para aplicar precios correctos
    const registeredCustomer = await prisma.customer.findUnique({
      where: { email: customerEmail },
      select: { type: true },
    });
    const isMayorista = registeredCustomer?.type === "MAYORISTA";

    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { id: parseInt(item.productId) },
      });

      if (!product || !product.active) {
        return res.status(400).json({ error: `Producto no disponible: ${item.productId}` });
      }

      if (!product.stockUnlimited && product.stock < item.quantity) {
        return res.status(400).json({
          error: `Stock insuficiente para "${product.name}". Disponible: ${product.stock}`,
        });
      }

      // Lógica de precios:
      // - Mayorista: usa wholesaleSalePrice si está definido, sino wholesalePrice, sino precio normal
      // - Minorista: usa salePrice si está definido Y es menor al precio normal, sino precio normal
      let effectivePrice = product.price;
      if (isMayorista && product.wholesalePrice) {
        effectivePrice = product.wholesalePrice;
        // Si hay precio de oferta mayorista válido, tiene prioridad sobre el precio mayorista base
        if (product.wholesaleSalePrice && product.wholesaleSalePrice < product.wholesalePrice) {
          effectivePrice = product.wholesaleSalePrice;
        }
      } else if (!isMayorista && product.salePrice && product.salePrice < product.price) {
        effectivePrice = product.salePrice;
      }

      // Descuentos por cantidad: se aplica el tier del tipo de cliente correspondiente.
      // Mayorista usa wholesalePriceTiers; minorista usa priceTiers.
      const activeTiers = isMayorista ? product.wholesalePriceTiers : product.priceTiers;
      const tierPrice = applyPriceTier(activeTiers, item.quantity);
      if (tierPrice !== null) effectivePrice = tierPrice;

      // Para cotizaciones: si el cliente envió un customPrice válido, se usa ese precio.
      // Esto permite negociar precios por pedido sin modificar el producto publicado.
      const isCotizacion = method === "COTIZACION";
      const customPrice = item.customPrice ? parseFloat(item.customPrice) : null;
      const finalPrice = (isCotizacion && customPrice && customPrice > 0)
        ? customPrice
        : effectivePrice;

      total += finalPrice * item.quantity;
      orderItems.push({
        productId: product.id,
        quantity: item.quantity,
        price: finalPrice,
      });
    }

    // Aplicar cupón si se envió uno (ahora también válido para COTIZACION)
    let appliedCoupon = null;
    let couponDiscount = 0;
    if (couponCode) {
      const coupon = await prisma.coupon.findUnique({
        where: { code: couponCode.toUpperCase().trim() },
        include: { customer: { select: { email: true } } },
      });
      // Validar cupón (misma lógica que /validate, pero sin abortar la orden si falla)
      const now = new Date();
      const isValid =
        coupon &&
        coupon.active &&
        (!coupon.expiresAt || now <= new Date(coupon.expiresAt)) &&
        (!coupon.minPurchase || total >= coupon.minPurchase) &&
        (!coupon.customerId || coupon.customer?.email.toLowerCase() === customerEmail.toLowerCase());

      if (isValid) {
        // Verificar usos totales
        const totalUsages = coupon.maxUses
          ? await prisma.couponUsage.count({ where: { couponId: coupon.id } })
          : 0;
        const underTotalLimit = !coupon.maxUses || totalUsages < coupon.maxUses;

        // Verificar usos por cliente
        const customerUsages = coupon.maxUsesPerCustomer
          ? await prisma.couponUsage.count({ where: { couponId: coupon.id, customerEmail: customerEmail.toLowerCase() } })
          : 0;
        const underCustomerLimit = !coupon.maxUsesPerCustomer || customerUsages < coupon.maxUsesPerCustomer;

        if (underTotalLimit && underCustomerLimit) {
          appliedCoupon = coupon;
          couponDiscount = coupon.discountType === "PERCENTAGE"
            ? Math.round((total * coupon.discountValue) / 100 * 100) / 100
            : Math.min(coupon.discountValue, total);
          total = Math.max(0, total - couponDiscount);
        }
      }
    }

    // Crear la orden en la base de datos con el método de pago elegido.
    // Si el cliente está registrado, vincular la orden a su cuenta via customerId.
    const order = await prisma.order.create({
      data: {
        customerName,
        customerEmail,
        customerPhone: customerPhone || null,
        customerId:    customerId ? parseInt(customerId) : null,
        total,
        status: "PENDING",
        paymentMethod: method,
        ...(appliedCoupon ? { couponId: appliedCoupon.id, couponDiscount } : {}),
        items: {
          create: orderItems,
        },
      },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, images: true } },
          },
        },
        // Incluir cupón para mostrarlo en el email de confirmación
        coupon: { select: { code: true } },
      },
    });

    // Registrar uso del cupón si se aplicó uno
    if (appliedCoupon) {
      await prisma.couponUsage.create({
        data: {
          couponId: appliedCoupon.id,
          orderId: order.id,
          customerEmail: customerEmail.toLowerCase(),
        },
      });
    }

    // Para cotizaciones: reservar stock inmediatamente al crear la orden.
    // Esto evita que el mismo producto pueda agregarse al carrito de nuevo
    // mientras la cotización está pendiente.
    if (method === "COTIZACION") {
      for (const item of orderItems) {
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        if (!product || product.stockUnlimited) continue;
        const newStock = Math.max(0, product.stock - item.quantity);
        await prisma.product.update({
          where: { id: item.productId },
          data: {
            stock: newStock,
            // Si llega a 0, despublicar para que no aparezca en el catálogo
            ...(newStock === 0 ? { active: false } : {}),
          },
        });
      }
    }

    // Para cotizaciones: guardar clientSnapshot con los items iniciales.
    // El cliente siempre verá esta copia hasta que el admin presione "Actualizar cotización".
    if (method === "COTIZACION") {
      const snapshot = order.items.map((i) => ({
        id:        i.id,
        productId: i.productId,
        name:      i.product?.name || "",
        price:     i.price,
        quantity:  i.quantity,
        image:     i.product?.images?.[0] || null,
      }));
      await prisma.order.update({
        where: { id: order.id },
        data:  { clientSnapshot: snapshot },
      });
      order.clientSnapshot = snapshot;
    }

    // Avanzar la secuencia del ID de forma aleatoria entre 3 y 8 posiciones.
    // Esto hace que el siguiente pedido no sea consecutivo (ej: #31 → #35, no #32).
    // Se suma entre 2 y 7 porque Prisma ya consumió 1 incremento al crear la orden.
    const randomJump = Math.floor(Math.random() * 6) + 2; // 2-7 extra → salto total 3-8
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"orders"', 'id'), currval(pg_get_serial_sequence('"orders"', 'id')) + ${randomJump})`
    );

    // Enviar emails según el método de pago:
    // - MERCADOPAGO: los emails se manejan via webhook cuando el pago se confirma
    // - EFECTIVO / TRANSFERENCIA: confirmar al cliente y notificar al admin
    // - COTIZACION: enviar cotización al cliente y notificar al admin
    if (method === "EFECTIVO" || method === "TRANSFERENCIA") {
      sendOrderConfirmationToCustomer(order).catch(() => {}); // fire-and-forget
      sendOrderNotificationToAdmin(order).catch(() => {});
    } else if (method === "COTIZACION") {
      sendCotizacionToCustomer(order).catch(() => {}); // fire-and-forget
      sendCotizacionToAdmin(order).catch(() => {});
    }

    res.status(201).json(order);
  } catch (err) {
    console.error("createOrder error:", err);
    res.status(500).json({ error: "Error al crear la orden" });
  }
}

// PATCH /api/orders/:id/status - Actualizar estado de la orden (admin)
async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["PENDING", "QUOTE_APPROVED", "APPROVED", "REJECTED", "CANCELLED"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Estado inválido" });
    }

    // Obtener el estado actual antes de actualizar
    const existing = await prisma.order.findUnique({
      where: { id: parseInt(id) },
      include: { items: true },
    });
    if (!existing) return res.status(404).json({ error: "Orden no encontrada" });

    const order = await prisma.order.update({
      where: { id: parseInt(id) },
      data: { status },
    });

    // Devolver stock si una COTIZACION pasa a CANCELLED o REJECTED
    // (el stock fue reservado al crear la cotización, hay que devolverlo)
    const wasCotizacion = existing.paymentMethod === "COTIZACION";
    const wasResolved   = ["APPROVED", "CANCELLED", "REJECTED"].includes(existing.status);
    if ((status === "CANCELLED" || status === "REJECTED") && wasCotizacion && !wasResolved) {
      for (const item of existing.items) {
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        if (!product || product.stockUnlimited) continue;
        await prisma.product.update({
          where: { id: item.productId },
          data:  {
            stock:  product.stock + item.quantity,
            active: true, // re-publicar si estaba sin stock por esta cotización
          },
        });
      }
    }

    // Descontar stock solo si pasa a APPROVED y antes NO estaba APPROVED.
    // EXCEPCIÓN: las cotizaciones ya descontaron el stock al crearse → no descontar de nuevo.
    // (evita doble descuento)
    if (status === "APPROVED" && existing.status !== "APPROVED" && !wasCotizacion) {
      for (const item of existing.items) {
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        if (!product || product.stockUnlimited) continue;

        const newStock = Math.max(0, product.stock - item.quantity);
        await prisma.product.update({
          where: { id: item.productId },
          data:  {
            stock: newStock,
            // Si el stock llega a 0 y no es ilimitado, despublicar automáticamente
            ...(newStock === 0 && !product.stockUnlimited ? { active: false } : {}),
          },
        });

        // Ajustar otras órdenes PENDING/QUOTE_APPROVED que tengan este producto.
        // Se excluyen las COTIZACIONES porque su stock ya está reservado por separado.
        // Se ordenan por ID ascendente (más antiguas primero) para respetar el orden de llegada.
        const affectedItems = await prisma.orderItem.findMany({
          where: {
            productId: item.productId,
            order: {
              id:            { not: existing.id },
              status:        { in: ["PENDING", "QUOTE_APPROVED"] },
              paymentMethod: { not: "COTIZACION" }, // cotizaciones tienen su propio stock reservado
            },
          },
          orderBy: { orderId: "asc" },
        });

        // Distribuir el stock restante entre las órdenes afectadas (first-come, first-served)
        let stockLeft = newStock;
        for (const affected of affectedItems) {
          if (affected.quantity <= stockLeft) {
            // Esta orden puede quedarse con su cantidad completa
            stockLeft -= affected.quantity;
            continue;
          }

          if (stockLeft > 0) {
            // Reducir cantidad al stock disponible
            await prisma.orderItem.update({
              where: { id: affected.id },
              data:  { quantity: stockLeft },
            });
            stockLeft = 0;
          } else {
            // Sin stock: eliminar el item de la orden
            await prisma.orderItem.delete({ where: { id: affected.id } });
          }

          // Recalcular el total y actualizar clientSnapshot con los items actuales en BD
          // (el snapshot es lo que el cliente ve — debe reflejar que su item fue reducido/eliminado)
          const remainingItems = await prisma.orderItem.findMany({
            where:   { orderId: affected.orderId },
            include: { product: { select: { name: true, images: true } } },
          });
          const newTotal    = remainingItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
          const newSnapshot = remainingItems.map((i) => ({
            id:        i.id,
            productId: i.productId,
            name:      i.product?.name || "",
            price:     i.price,
            quantity:  i.quantity,
            image:     i.product?.images?.[0] || null,
          }));

          // Notificar al cliente que su cotización fue ajustada por falta de stock
          const affectedOrder = await prisma.order.findUnique({ where: { id: affected.orderId } });
          const productName   = product.name || "un producto";
          const stockMsg = stockLeft > 0
            ? `La cantidad de "${productName}" fue reducida a ${stockLeft} por falta de stock.`
            : `"${productName}" fue eliminado de tu cotización porque se agotó el stock.`;

          // Si no quedan items, cancelar la orden automáticamente
          const autoCancel = remainingItems.length === 0;
          await prisma.order.update({
            where: { id: affected.orderId },
            data:  {
              total:          newTotal,
              clientSnapshot: newSnapshot,
              adminNotes:     stockMsg,
              ...(autoCancel ? { status: "CANCELLED", cancelReason: "Cancelada automáticamente: productos sin stock disponible." } : {}),
            },
          });
        }
      }

    }

    // Limpieza global: cancela cualquier orden QUOTE_APPROVED/PENDING sin items,
    // incluyendo datos que quedaron en ese estado antes de este fix.
    // Corre en cada cambio de estado para cubrir casos históricos.
    const allEmptyOrders = await prisma.order.findMany({
      where: {
        id:     { not: existing.id },
        status: { in: ["PENDING", "QUOTE_APPROVED"] },
        items:  { none: {} },
      },
    });
    for (const emptyOrder of allEmptyOrders) {
      await prisma.order.update({
        where: { id: emptyOrder.id },
        data:  {
          status:       "CANCELLED",
          cancelReason: "Cancelada automáticamente: productos sin stock disponible.",
          adminNotes:   emptyOrder.adminNotes || "Esta cotización fue cancelada porque los productos se agotaron.",
        },
      });
    }

    res.json(order);
  } catch (err) {
    console.error("updateOrderStatus error:", err);
    res.status(500).json({ error: "Error al actualizar el estado" });
  }
}

// GET /api/orders/stats - Estadísticas para el dashboard (admin)
// Soporta filtro por fecha: ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
async function getStats(req, res) {
  try {
    const { dateFrom, dateTo } = req.query;
    // Construir filtro de fecha si se pasan los parámetros
    const dateFilter = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    const orderDateWhere = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};

    const [totalOrders, approvedOrders, pendingOrders, totalRevenue, totalProducts, approvedItems] =
      await Promise.all([
        prisma.order.count({ where: { ...orderDateWhere } }),
        prisma.order.count({ where: { status: "APPROVED", ...orderDateWhere } }),
        prisma.order.count({ where: { status: "PENDING", ...orderDateWhere } }),
        prisma.order.aggregate({
          where: { status: "APPROVED", ...orderDateWhere },
          _sum: { total: true },
        }),
        prisma.product.count({ where: { active: true } }),
        // Traer todos los items de órdenes APPROVED con el costo del producto
        // para calcular ganancia bruta = ingresos - costo
        prisma.orderItem.findMany({
          where: { order: { status: "APPROVED", ...orderDateWhere } },
          include: { product: { select: { cost: true } } },
        }),
      ]);

    const revenue = totalRevenue._sum.total || 0;
    // Costo total = suma de (cantidad × costo unitario) por cada item
    const totalCost = approvedItems.reduce((sum, item) => {
      return sum + item.quantity * (item.product?.cost || 0);
    }, 0);
    const totalProfit = revenue - totalCost;

    res.json({
      totalOrders,
      approvedOrders,
      pendingOrders,
      totalRevenue: revenue,
      totalCost,
      totalProfit,
      totalProducts,
    });
  } catch (err) {
    console.error("getStats error:", err);
    res.status(500).json({ error: "Error al obtener estadísticas" });
  }
}

// DELETE /api/orders/:id - Eliminar una orden (admin)
async function deleteOrder(req, res) {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({ where: { id: parseInt(id) } });
    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    // Prisma borra los OrderItems en cascada gracias a onDelete: Cascade en el schema
    await prisma.order.delete({ where: { id: parseInt(id) } });

    res.json({ message: "Orden eliminada correctamente" });
  } catch (err) {
    console.error("deleteOrder error:", err);
    res.status(500).json({ error: "Error al eliminar la orden" });
  }
}

// GET /api/orders/my - Historial de pedidos del cliente logueado (APPROVED)
async function getMyOrders(req, res) {
  try {
    const customerId = req.user.id;

    // Filtramos por customerId (cuenta del cliente) en lugar de email,
    // para que aparezcan sin importar qué email ingresó en el formulario de checkout.
    const orders = await prisma.order.findMany({
      where: {
        customerId,
        status: "APPROVED", // Solo pedidos pagados/aprobados
      },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                images: true,
                active: true,
                stock: true,
                stockUnlimited: true,
                price: true,
                salePrice: true,
                wholesalePrice: true,
                wholesaleSalePrice: true,
                minQuantity: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(orders);
  } catch (err) {
    console.error("getMyOrders error:", err);
    res.status(500).json({ error: "Error al obtener el historial de pedidos" });
  }
}

// PATCH /api/orders/:orderId/items/:itemId - Admin: cambiar cantidad y/o precio de un item
async function updateOrderItem(req, res) {
  try {
    const orderId = parseInt(req.params.orderId);
    const itemId  = parseInt(req.params.itemId);
    const { quantity, price } = req.body;

    if (!quantity || quantity < 1) {
      return res.status(400).json({ error: "La cantidad debe ser al menos 1" });
    }

    // Verificar que el item pertenece a esta orden
    const item = await prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
    });
    if (!item) return res.status(404).json({ error: "Item no encontrado" });

    // Actualizar cantidad y, si se envió un precio válido, también el precio del item
    const updateData = { quantity };
    if (price !== undefined && parseFloat(price) > 0) {
      updateData.price = parseFloat(price);
    }

    await prisma.orderItem.update({
      where: { id: itemId },
      data:  updateData,
    });

    // Recalcular el total de la orden con los valores actualizados
    const allItems = await prisma.orderItem.findMany({ where: { orderId } });
    const updatedPrice = updateData.price ?? item.price;
    const newTotal = allItems.reduce((sum, i) => sum + (i.id === itemId ? updatedPrice : i.price) * (i.id === itemId ? quantity : i.quantity), 0);

    const order = await prisma.order.update({
      where: { id: orderId },
      data:  { total: newTotal },
      include: { items: { include: { product: { select: { id: true, name: true, images: true } } } } },
    });

    res.json(order);
  } catch (err) {
    console.error("updateOrderItem error:", err);
    res.status(500).json({ error: "Error al actualizar el item" });
  }
}

// DELETE /api/orders/:orderId/items/:itemId - Admin: eliminar un item de una orden
async function deleteOrderItem(req, res) {
  try {
    const orderId = parseInt(req.params.orderId);
    const itemId  = parseInt(req.params.itemId);

    const item = await prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
    });
    if (!item) return res.status(404).json({ error: "Item no encontrado" });

    await prisma.orderItem.delete({ where: { id: itemId } });

    // Recalcular el total de la orden con los items restantes
    const allItems = await prisma.orderItem.findMany({ where: { orderId } });
    const newTotal = allItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

    const order = await prisma.order.update({
      where: { id: orderId },
      data:  { total: newTotal },
      include: { items: { include: { product: { select: { id: true, name: true, images: true } } } } },
    });

    res.json(order);
  } catch (err) {
    console.error("deleteOrderItem error:", err);
    res.status(500).json({ error: "Error al eliminar el item" });
  }
}

// GET /api/orders/my-quotes - Cotizaciones enviadas por el cliente MAYORISTA
async function getMyCotizaciones(req, res) {
  try {
    const customerId = req.user.id;

    const orders = await prisma.order.findMany({
      where: {
        customerId,
        paymentMethod: "COTIZACION",
        // Las APPROVED ya aparecen en la pestaña Pedidos — excluirlas de Cotizaciones
        status: { not: "APPROVED" },
      },
      orderBy: { createdAt: "desc" },
    });

    // El cliente siempre ve clientSnapshot (versión publicada por el admin).
    // Si no hay snapshot (orden recién creada), se retorna array vacío como items.
    const result = orders.map((o) => ({
      ...o,
      items: Array.isArray(o.clientSnapshot) ? o.clientSnapshot : [],
    }));

    res.json(result);
  } catch (err) {
    console.error("getMyCotizaciones error:", err);
    res.status(500).json({ error: "Error al obtener las cotizaciones" });
  }
}

// ── Helper: crear snapshot de items actuales de una orden ─────────────────────
async function buildSnapshot(orderId) {
  const items = await prisma.orderItem.findMany({
    where:   { orderId },
    include: { product: { select: { name: true, images: true } } },
  });
  return items.map((i) => ({
    id:        i.id,
    productId: i.productId,
    name:      i.product?.name || "",
    price:     i.price,
    quantity:  i.quantity,
    image:     i.product?.images?.[0] || null,
  }));
}

// ── Helper: crear notificación para el cliente ────────────────────────────────
async function createNotification(customerId, orderId, type, message) {
  if (!customerId) return; // No notificar si la orden no está vinculada a cuenta
  const notification = await prisma.notification.create({
    data: { customerId, orderId, type, message },
  });
  // Pushear en tiempo real si el cliente tiene una conexión SSE activa
  // Si no está conectado, no pasa nada — verá la notificación cuando abra la app
  pushToClient(customerId, { type: "notification", notification });
}

// POST /api/orders/:id/publish - Admin: publica cambios de items al cliente
// Actualiza clientSnapshot + crea notificación + envía email
async function publishCotizacion(req, res) {
  try {
    const orderId    = parseInt(req.params.id);
    const { adminNotes } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    const snapshot = await buildSnapshot(orderId);
    const total    = snapshot.reduce((s, i) => s + i.price * i.quantity, 0);

    const updated = await prisma.order.update({
      where: { id: orderId },
      data:  { clientSnapshot: snapshot, adminNotes: adminNotes || null, total },
    });

    // Notificar al cliente
    await createNotification(
      order.customerId,
      orderId,
      "COTIZACION_ACTUALIZADA",
      `Tu cotización #${orderId} fue actualizada por el vendedor.${adminNotes ? " Nota: " + adminNotes : ""}`
    );

    res.json(updated);
  } catch (err) {
    console.error("publishCotizacion error:", err);
    res.status(500).json({ error: "Error al publicar la cotización" });
  }
}

// POST /api/orders/:id/approve - Admin: aprueba la cotización
async function approveCotizacion(req, res) {
  try {
    const orderId    = parseInt(req.params.id);
    const { adminNotes } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    // Publicar snapshot con el estado actual y marcar como APPROVED
    const snapshot = await buildSnapshot(orderId);
    const total    = snapshot.reduce((s, i) => s + i.price * i.quantity, 0);

    // QUOTE_APPROVED: admin confirmó la cotización, el cliente debe pagar.
    // Solo pasa a APPROVED cuando se confirma el pago (manual o via webhook).
    const updated = await prisma.order.update({
      where: { id: orderId },
      data:  { status: "QUOTE_APPROVED", clientSnapshot: snapshot, adminNotes: adminNotes || null, total },
    });

    await createNotification(
      order.customerId,
      orderId,
      "COTIZACION_APROBADA",
      `¡Tu cotización #${orderId} fue aprobada! Ya podés proceder con el pago.${adminNotes ? " Nota: " + adminNotes : ""}`
    );

    res.json(updated);
  } catch (err) {
    console.error("approveCotizacion error:", err);
    res.status(500).json({ error: "Error al aprobar la cotización" });
  }
}

// GET /api/orders/my-quotes/:id - Cliente: obtener una cotización propia por ID
async function getMyQuoteById(req, res) {
  try {
    const orderId    = parseInt(req.params.id);
    const customerId = req.user.id;

    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId, paymentMethod: "COTIZACION" },
    });

    if (!order) return res.status(404).json({ error: "Cotización no encontrada" });

    // El cliente siempre ve el clientSnapshot (versión publicada por el admin)
    const result = {
      ...order,
      items: Array.isArray(order.clientSnapshot) ? order.clientSnapshot : [],
    };

    res.json(result);
  } catch (err) {
    console.error("getMyQuoteById error:", err);
    res.status(500).json({ error: "Error al obtener la cotización" });
  }
}

// POST /api/orders/:id/cancel-by-customer - Cliente: cancela la cotización con motivo
async function cancelByCustomer(req, res) {
  try {
    const orderId     = parseInt(req.params.id);
    const customerId  = req.user.id;
    const { reason }  = req.body;

    // Incluir items para poder devolver el stock reservado
    const order = await prisma.order.findFirst({
      where:   { id: orderId, customerId, paymentMethod: "COTIZACION" },
      include: { items: true },
    });
    if (!order) return res.status(404).json({ error: "Cotización no encontrada" });

    // Devolver el stock reservado si la cotización aún no estaba resuelta
    const wasResolved = ["APPROVED", "CANCELLED", "REJECTED"].includes(order.status);
    if (!wasResolved) {
      for (const item of order.items) {
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        if (!product || product.stockUnlimited) continue;
        await prisma.product.update({
          where: { id: item.productId },
          data:  {
            stock:  product.stock + item.quantity,
            active: true, // re-publicar si estaba sin stock por esta cotización
          },
        });
      }
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data:  { status: "CANCELLED", cancelReason: reason || null },
    });

    res.json(updated);
  } catch (err) {
    console.error("cancelByCustomer error:", err);
    res.status(500).json({ error: "Error al cancelar la cotización" });
  }
}

// POST /api/orders/:id/confirm-payment - Cliente MAYORISTA: confirma pago manual (efectivo o transferencia)
// Envía email con datos bancarios (si es transferencia) y notifica al admin
async function confirmCotizacionPayment(req, res) {
  try {
    const orderId    = parseInt(req.params.id);
    const customerId = req.user.id;
    const { paymentMethod } = req.body; // "EFECTIVO" | "TRANSFERENCIA"

    if (!["EFECTIVO", "TRANSFERENCIA"].includes(paymentMethod)) {
      return res.status(400).json({ error: "Método de pago inválido" });
    }

    // Verificar que la orden pertenece al cliente y es una cotización aprobada
    const order = await prisma.order.findFirst({
      where: {
        id:            orderId,
        customerId,
        paymentMethod: "COTIZACION",
        status:        "QUOTE_APPROVED",
      },
      include: {
        items: {
          include: { product: { select: { id: true, name: true, images: true } } },
        },
        // Incluir cupón para mostrarlo en el email
        coupon: { select: { code: true } },
      },
    });
    if (!order) return res.status(404).json({ error: "Cotización no encontrada o no disponible" });

    // Construir objeto de orden con el método de pago elegido (para los emails)
    // No se modifica paymentMethod en DB para no romper lógica de cotizaciones
    const orderForEmail = { ...order, paymentMethod };

    // Enviar email al cliente (con datos bancarios si eligió transferencia)
    sendOrderConfirmationToCustomer(orderForEmail).catch(() => {});
    // Notificar al admin
    sendOrderNotificationToAdmin(orderForEmail).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    console.error("confirmCotizacionPayment error:", err);
    res.status(500).json({ error: "Error al confirmar el pago" });
  }
}

// GET /api/orders/metrics - Métricas: top clientes, top productos vendidos, top productos rentables
async function getMetrics(req, res) {
  try {
    const { dateFrom, dateTo } = req.query;
    const dateFilter = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    const orderDateWhere = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};

    // Traer todos los items de órdenes APPROVED con producto y cliente
    const items = await prisma.orderItem.findMany({
      where: { order: { status: "APPROVED", ...orderDateWhere } },
      include: {
        order: { select: { customerId: true, customerName: true, customerEmail: true, total: true } },
        product: { select: { id: true, name: true, images: true, cost: true } },
      },
    });

    // ── Top 10 clientes que más compraron (por monto total) ──────────────────
    const clientMap = {};
    for (const item of items) {
      const key = item.order.customerId || item.order.customerEmail;
      if (!clientMap[key]) {
        clientMap[key] = {
          name: item.order.customerName,
          email: item.order.customerEmail,
          total: 0,
          orders: new Set(),
        };
      }
      clientMap[key].total += item.price * item.quantity;
      clientMap[key].orders.add(item.orderId);
    }
    const topClients = Object.values(clientMap)
      .map((c) => ({ ...c, orders: c.orders.size }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // ── Top 10 productos más vendidos (por cantidad) ─────────────────────────
    const productSalesMap = {};
    for (const item of items) {
      const pid = item.productId;
      if (!productSalesMap[pid]) {
        productSalesMap[pid] = {
          id: pid,
          name: item.product?.name || "Producto eliminado",
          image: item.product?.images?.[0] || null,
          quantity: 0,
          revenue: 0,
          cost: item.product?.cost || 0,
          profit: 0,
        };
      }
      productSalesMap[pid].quantity += item.quantity;
      productSalesMap[pid].revenue += item.price * item.quantity;
      productSalesMap[pid].profit += item.price * item.quantity - (item.product?.cost || 0) * item.quantity;
    }
    const allProducts = Object.values(productSalesMap);

    const topByQuantity = [...allProducts].sort((a, b) => b.quantity - a.quantity).slice(0, 10);
    const topByProfit   = [...allProducts].sort((a, b) => b.profit  - a.profit ).slice(0, 10);

    res.json({ topClients, topByQuantity, topByProfit });
  } catch (err) {
    console.error("getMetrics error:", err);
    res.status(500).json({ error: "Error al obtener métricas" });
  }
}

// PATCH /api/orders/:id/apply-coupon — Aplicar cupón a una cotización ya creada (cliente MAYORISTA)
// Valida el cupón, actualiza el total de la orden y registra el uso.
async function applyCouponToOrder(req, res) {
  try {
    const orderId = parseInt(req.params.id);
    const { couponCode, customerEmail } = req.body;

    if (!couponCode || !customerEmail) {
      return res.status(400).json({ valid: false, error: "Código y email son requeridos" });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { couponUsage: true },
    });
    if (!order) return res.status(404).json({ valid: false, error: "Orden no encontrada" });
    if (order.couponId) return res.status(400).json({ valid: false, error: "Esta cotización ya tiene un cupón aplicado" });

    const coupon = await prisma.coupon.findUnique({
      where: { code: couponCode.toUpperCase().trim() },
      include: { customer: { select: { email: true } } },
    });

    if (!coupon || !coupon.active) {
      return res.json({ valid: false, error: "Cupón inválido o inactivo" });
    }
    if (coupon.expiresAt && new Date() > new Date(coupon.expiresAt)) {
      return res.json({ valid: false, error: "El cupón ya venció" });
    }
    // El total de la cotización es el precio acordado por el admin (sin descuentos previos)
    if (coupon.minPurchase && order.total < coupon.minPurchase) {
      return res.json({
        valid: false,
        error: `El cupón requiere una compra mínima de $${coupon.minPurchase.toLocaleString("es-AR")}`,
      });
    }
    if (coupon.customerId && coupon.customer) {
      if (coupon.customer.email.toLowerCase() !== customerEmail.toLowerCase()) {
        return res.json({ valid: false, error: "Este cupón no es válido para tu cuenta" });
      }
    }

    // Verificar límites de uso
    if (coupon.maxUses) {
      const totalUsages = await prisma.couponUsage.count({ where: { couponId: coupon.id } });
      if (totalUsages >= coupon.maxUses) {
        return res.json({ valid: false, error: "El cupón alcanzó su límite de usos" });
      }
    }
    if (coupon.maxUsesPerCustomer) {
      const customerUsages = await prisma.couponUsage.count({
        where: { couponId: coupon.id, customerEmail: customerEmail.toLowerCase() },
      });
      if (customerUsages >= coupon.maxUsesPerCustomer) {
        return res.json({ valid: false, error: "Ya usaste este cupón el máximo de veces permitido" });
      }
    }

    // Calcular descuento y nuevo total
    const discount = coupon.discountType === "PERCENTAGE"
      ? Math.round((order.total * coupon.discountValue) / 100 * 100) / 100
      : Math.min(coupon.discountValue, order.total);
    const newTotal = Math.max(0, order.total - discount);

    // Actualizar orden y registrar uso en una transacción
    const [updatedOrder] = await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data: { total: newTotal, couponId: coupon.id, couponDiscount: discount },
      }),
      prisma.couponUsage.create({
        data: { couponId: coupon.id, orderId, customerEmail: customerEmail.toLowerCase() },
      }),
    ]);

    return res.json({
      valid: true,
      discountAmount: discount,
      newTotal: updatedOrder.total,
      coupon: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
      },
    });
  } catch (err) {
    console.error("applyCouponToOrder error:", err);
    res.status(500).json({ valid: false, error: "Error al aplicar el cupón" });
  }
}

// POST /api/orders/admin/manual — Admin registra una venta manual (presencial/teléfono/etc.)
// A diferencia del checkout público, el admin fija explícitamente el precio de cada item.
// El stock se descuenta igual que en una venta normal.
async function createManualOrder(req, res) {
  try {
    const { customerName, customerEmail, customerPhone, customerId, items, paymentMethod, notes, status } = req.body;

    if (!customerName || !customerEmail) {
      return res.status(400).json({ error: "Nombre y email del cliente son requeridos" });
    }
    if (!items || items.length === 0) {
      return res.status(400).json({ error: "La venta debe tener al menos un producto" });
    }

    const validMethods = ["MERCADOPAGO", "EFECTIVO", "TRANSFERENCIA"];
    const method = validMethods.includes(paymentMethod) ? paymentMethod : "EFECTIVO";

    const validStatuses = ["PENDING", "APPROVED"];
    const orderStatus = validStatuses.includes(status) ? status : "APPROVED";

    // Verificar stock y armar items con el precio que fijó el admin
    let total = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await prisma.product.findUnique({ where: { id: parseInt(item.productId) } });
      if (!product) {
        return res.status(400).json({ error: `Producto no encontrado: ${item.productId}` });
      }

      const qty = parseInt(item.quantity);
      const price = parseFloat(item.price);

      if (qty <= 0 || isNaN(price) || price < 0) {
        return res.status(400).json({ error: `Cantidad o precio inválido para "${product.name}"` });
      }

      // Verificar stock (solo si no es ilimitado)
      if (!product.stockUnlimited && product.stock < qty) {
        return res.status(400).json({
          error: `Stock insuficiente para "${product.name}". Disponible: ${product.stock}`,
        });
      }

      total += price * qty;
      orderItems.push({ productId: product.id, quantity: qty, price });
    }

    // Crear la orden y descontar stock en una transacción
    const order = await prisma.$transaction(async (tx) => {
      // Descontar stock
      for (const item of orderItems) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product.stockUnlimited) {
          await tx.product.update({
            where: { id: item.productId },
            data:  { stock: { decrement: item.quantity } },
          });
        }
      }

      return tx.order.create({
        data: {
          customerName,
          customerEmail,
          customerPhone: customerPhone || null,
          customerId:    customerId ? parseInt(customerId) : null,
          total,
          status:        orderStatus,
          paymentMethod: method,
          adminNotes:    notes || null,
          items: { create: orderItems },
        },
        include: {
          items: { include: { product: { select: { id: true, name: true, images: true } } } },
        },
      });
    });

    res.status(201).json(order);
  } catch (err) {
    console.error("createManualOrder error:", err);
    res.status(500).json({ error: "Error al registrar la venta" });
  }
}

module.exports = {
  getOrders, getOrder, createOrder, updateOrderStatus, getStats, getMetrics, deleteOrder,
  getMyOrders, getMyCotizaciones, getMyQuoteById,
  updateOrderItem, deleteOrderItem,
  publishCotizacion, approveCotizacion, cancelByCustomer, confirmCotizacionPayment,
  applyCouponToOrder, createManualOrder,
};

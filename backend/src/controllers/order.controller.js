const { PrismaClient } = require("@prisma/client");
const { pushToClient } = require("../sse/notificationSSE");
const { syncProductVisibility } = require("./product.controller");

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
  sendOrderPaymentStatusEmail,
  sendOrderFulfillmentEmail,
} = require("../services/email.service");

const prisma = new PrismaClient();

// GET /api/orders - Listar órdenes (solo admin)
async function getOrders(req, res) {
  try {
    const { status, paymentMethod, page = 1, limit = 20, search, sortOrder, customerType } = req.query;

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

    // Búsqueda por nombre de cliente o número de orden
    if (search && search.trim()) {
      const trimmed = search.trim();
      const searchNum = parseInt(trimmed);
      where.OR = [
        { customerName: { contains: trimmed, mode: "insensitive" } },
        // Si el texto es un número, buscar también por ID de orden
        ...(!isNaN(searchNum) ? [{ id: searchNum }] : []),
      ];
    }

    // Filtro por tipo de cliente (MINORISTA / MAYORISTA)
    if (customerType && ["MINORISTA", "MAYORISTA"].includes(customerType)) {
      where.customerType = customerType;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Ordenamiento por fecha: "asc" = más viejo primero, "desc" (default) = más nuevo primero
    const orderDirection = sortOrder === "asc" ? "asc" : "desc";

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, images: true } },
            },
          },
          // Incluir datos del cupón para mostrar en detalle y en impresión
          coupon: { select: { code: true, discountType: true, discountValue: true } },
        },
        orderBy: { createdAt: orderDirection },
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
    const { customerName, customerEmail, customerPhone, items, paymentMethod, customerId, couponCode, wantsInvoice, customerNote, shippingMethod } = req.body;

    if (!customerName || !customerEmail || !items || items.length === 0) {
      return res.status(400).json({ error: "Datos de la orden incompletos" });
    }

    // Métodos de pago válidos; MERCADOPAGO es el default si no se especifica
    const validMethods = ["MERCADOPAGO", "EFECTIVO", "TRANSFERENCIA", "COTIZACION"];
    const method = paymentMethod && validMethods.includes(paymentMethod) ? paymentMethod : "MERCADOPAGO";

    // Verificar stock y calcular total
    let total = 0;
    const orderItems = [];
    const itemHasVariants = {}; // productId -> bool: si el producto tiene variantes activas

    // Determinar si el cliente es mayorista para aplicar precios correctos.
    // Preferimos buscar por customerId (más confiable) y solo hacemos fallback por email si no viene ID.
    let registeredCustomer = null;
    if (customerId) {
      registeredCustomer = await prisma.customer.findUnique({
        where: { id: parseInt(customerId) },
        select: { type: true },
      });
    }
    if (!registeredCustomer && customerEmail) {
      registeredCustomer = await prisma.customer.findUnique({
        where: { email: customerEmail },
        select: { type: true },
      });
    }
    const isMayorista = registeredCustomer?.type === "MAYORISTA";

    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { id: parseInt(item.productId) },
      });

      if (!product || !product.active) {
        return res.status(400).json({ error: `Producto no disponible: ${item.productId}` });
      }

      // Determinar si el producto tiene variantes activas para el control de stock
      const activeVariants = await prisma.productVariant.findMany({
        where: { productId: product.id, active: true },
        select: { stock: true, stockUnlimited: true },
      });
      const productHasVariants = activeVariants.length > 0;
      itemHasVariants[product.id] = productHasVariants;

      // Validación de stock: con variantes usar la suma de stocks de variantes; sin variantes usar product.stock
      if (productHasVariants) {
        const anyUnlimited = activeVariants.some((v) => v.stockUnlimited);
        if (!anyUnlimited) {
          const totalVariantStock = activeVariants.reduce((sum, v) => sum + v.stock, 0);
          if (totalVariantStock < item.quantity) {
            return res.status(400).json({
              error: `Stock insuficiente para "${product.name}". Stock total disponible: ${totalVariantStock}`,
            });
          }
        }
      } else {
        if (!product.stockUnlimited && product.stock < item.quantity) {
          return res.status(400).json({
            error: `Stock insuficiente para "${product.name}". Disponible: ${product.stock}`,
          });
        }
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

      // SEGURIDAD: el precio SIEMPRE se calcula server-side a partir de la BD.
      // Nunca se acepta un precio enviado por el cliente — cualquier customPrice del body se ignora.
      // (El campo customPrice solo lo puede aplicar el ADMIN al editar una cotización desde el panel.)
      const finalPrice = effectivePrice;

      total += finalPrice * item.quantity;

      // Buscar SKU de la variante seleccionada si se proporcionó variantId
      let variantSku = null;
      if (item.variantId) {
        const variant = await prisma.productVariant.findUnique({
          where: { id: parseInt(item.variantId) },
          select: { sku: true },
        });
        variantSku = variant?.sku || null;
      }

      orderItems.push({
        productId:    product.id,
        quantity:     item.quantity,
        price:        finalPrice,
        variantId:    item.variantId ? parseInt(item.variantId) : null,
        variantLabel: item.variantLabel || null,
        variantSku,
      });
    }

    // Validar compra mínima para clientes mayoristas
    if (isMayorista) {
      const configRows = await prisma.siteConfig.findMany({ where: { key: "mayoristaMinimoCompra" } });
      const minimo = parseFloat(configRows[0]?.value || "0");
      if (minimo > 0 && total < minimo) {
        return res.status(400).json({
          error: `El pedido no llega al monto mínimo mayorista de ${new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(minimo)}`,
        });
      }
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

    // Aplicar IVA si el cliente es mayorista y lo solicitó.
    // SEGURIDAD: solo se aplica si el cliente está registrado como MAYORISTA en la DB.
    // El flag wantsInvoice del body se ignora para minoristas.
    // El IVA se calcula por producto según su campo ivaRate (10.5% o 21%).
    const applyIva = isMayorista && wantsInvoice === true;
    let ivaAmount = 0;
    if (applyIva) {
      // Para cada item de la orden, buscar el ivaRate del producto y calcular su IVA
      for (const item of orderItems) {
        const prod = await prisma.product.findUnique({
          where: { id: item.productId },
          select: { ivaRate: true },
        });
        const rate = (prod?.ivaRate ?? 21) / 100;
        ivaAmount += Math.round(item.price * item.quantity * rate * 100) / 100;
      }
      ivaAmount = Math.round(ivaAmount * 100) / 100;
      total = Math.round((total + ivaAmount) * 100) / 100;
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
        // Pedidos MINORISTA con efectivo o transferencia pasan a QUOTE_APPROVED ("Aprobada sin pagar"):
        // el pedido está aceptado pero el pago aún no fue confirmado por el admin.
        // MercadoPago queda PENDING hasta que el webhook confirme el pago.
        // COTIZACION siempre sigue su flujo propio.
        status: (!isMayorista && ["EFECTIVO", "TRANSFERENCIA"].includes(method)) ? "QUOTE_APPROVED" : "PENDING",
        // fulfillmentStatus queda PENDIENTE hasta que el admin confirme el pago (APPROVED)
        fulfillmentStatus: "PENDIENTE",
        paymentMethod: method,
        // customerType se determina a partir del tipo de cliente registrado
        // isMayorista ya fue calculado arriba consultando la DB por el email
        customerType: isMayorista ? "MAYORISTA" : "MINORISTA",
        wantsInvoice: applyIva,
        ivaAmount,
        customerNote: customerNote?.trim() || null,
        // shippingMethod: "RETIRO" (retiro en el local) o "ENVIO" (acordar envío).
        // Solo se aceptan los dos valores válidos; cualquier otro valor usa el default "RETIRO".
        shippingMethod: ["RETIRO", "ENVIO"].includes(shippingMethod) ? shippingMethod : "RETIRO",
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
    // SOLO para productos sin variantes — para productos con variantes el stock se descuenta
    // cuando el admin asigna las variantes al confirmar la cotización (approveCotizacion).
    if (method === "COTIZACION") {
      for (const item of orderItems) {
        if (itemHasVariants[item.productId]) continue; // variantes: stock se descuenta al confirmar
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

    // El stock se descuenta cuando el admin confirma el pago (APPROVED via updateOrderStatus).
    // QUOTE_APPROVED no descuenta stock — el pedido está aceptado pero el pago aún no está confirmado.

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

    const validStatuses = ["PENDING", "QUOTE_APPROVED", "PAYMENT_REVIEW", "APPROVED", "REJECTED", "CANCELLED"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Estado inválido" });
    }

    // Obtener el estado actual antes de actualizar
    const existing = await prisma.order.findUnique({
      where: { id: parseInt(id) },
      include: { items: true },
    });
    if (!existing) return res.status(404).json({ error: "Orden no encontrada" });

    const updateData = { status };
    // Al abonar, pasar automáticamente a "En preparación" si estaba en Pendiente
    if (status === "APPROVED" && existing.fulfillmentStatus === "PENDIENTE") {
      updateData.fulfillmentStatus = "EN_PREPARACION";
    }

    const order = await prisma.order.update({
      where: { id: parseInt(id) },
      data: updateData,
    });

    // Devolver stock si una COTIZACION pasa a CANCELLED o REJECTED
    // - Productos sin variantes: stock fue reservado al crear → devolverlo
    // - Productos con variantes Y variantId asignado: stock fue descontado al confirmar → devolverlo
    // - Productos con variantes SIN variantId: nunca se reservó stock → nada que devolver
    const wasCotizacion = existing.paymentMethod === "COTIZACION";
    const wasResolved   = ["APPROVED", "CANCELLED", "REJECTED"].includes(existing.status);
    if ((status === "CANCELLED" || status === "REJECTED") && wasCotizacion && !wasResolved) {
      // Recargar items frescos para capturar variantIds asignados en approveCotizacion
      const freshItems = await prisma.orderItem.findMany({ where: { orderId: existing.id } });
      for (const item of freshItems) {
        if (item.variantId) {
          // Variante asignada en confirmación → devolver stock a la variante
          const variant = await prisma.productVariant.findUnique({ where: { id: item.variantId } });
          if (!variant || variant.stockUnlimited) continue;
          await prisma.productVariant.update({
            where: { id: item.variantId },
            data:  { stock: variant.stock + item.quantity },
          });
          await syncProductVisibility(item.productId);
          continue;
        }
        // Sin variantId: verificar si el producto tiene variantes
        const variantCount = await prisma.productVariant.count({ where: { productId: item.productId, active: true } });
        if (variantCount > 0) continue; // variante sin asignar — nunca se reservó stock
        // Producto sin variantes: stock fue reservado al crear → devolver
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        if (!product || product.stockUnlimited) continue;
        await prisma.product.update({
          where: { id: item.productId },
          data:  { stock: product.stock + item.quantity, active: true },
        });
      }
    }

    // Descontar stock solo si pasa a APPROVED y antes NO estaba APPROVED.
    // EXCEPCIÓN: las cotizaciones ya descontaron el stock al crearse → no descontar de nuevo.
    // (evita doble descuento)
    if (status === "APPROVED" && existing.status !== "APPROVED" && !wasCotizacion) {
      for (const item of existing.items) {
        // Si el item tiene variante, descontar stock de la variante; si no, del producto base.
        if (item.variantId) {
          const variant = await prisma.productVariant.findUnique({ where: { id: item.variantId } });
          if (!variant || variant.stockUnlimited) continue;
          const newVariantStock = Math.max(0, variant.stock - item.quantity);
          await prisma.productVariant.update({
            where: { id: item.variantId },
            data:  { stock: newVariantStock },
          });
          await syncProductVisibility(item.productId);
          continue;
        }

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
        await syncProductVisibility(item.productId);

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

    // Al aprobar un pedido de un cliente MAYORISTA, resetear su contador de restock
    // para que el cron no le envíe recordatorios hasta que vuelvan a pasar 20 días sin comprar.
    if (status === "APPROVED" && existing.status !== "APPROVED" && existing.customerId) {
      const cust = await prisma.customer.findUnique({ where: { id: existing.customerId } });
      if (cust?.type === "MAYORISTA") {
        await prisma.customer.update({
          where: { id: existing.customerId },
          data: { restockEmailCount: 0, restockEmailSentAt: null },
        });
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

    // Notificar al cliente si el estado de pago cambió a APPROVED, REJECTED o CANCELLED.
    // El email se envía de forma no bloqueante para no retrasar la respuesta al admin.
    sendOrderPaymentStatusEmail({ ...existing, ...order }, status).catch((e) =>
      console.error("[EMAIL] sendOrderPaymentStatusEmail falló:", e.message)
    );

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

// GET /api/orders/my/:id - Detalle completo de un pedido propio
async function getMyOrderById(req, res) {
  try {
    const customerId = req.user.id;
    const orderId    = parseInt(req.params.id);

    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId, status: { in: ["PENDING", "QUOTE_APPROVED", "APPROVED", "PAYMENT_REVIEW"] } },
      include: {
        coupon: { select: { code: true } },
        items: {
          include: {
            product: {
              select: {
                id: true, name: true, images: true, active: true,
                stock: true, stockUnlimited: true,
                price: true, salePrice: true,
                wholesalePrice: true, wholesaleSalePrice: true,
                minQuantity: true,
              },
            },
          },
        },
      },
    });

    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
    res.json(order);
  } catch (err) {
    console.error("getMyOrderById error:", err);
    res.status(500).json({ error: "Error al obtener el pedido" });
  }
}

// GET /api/orders/my - Historial de pedidos del cliente logueado (PENDING + APPROVED)
async function getMyOrders(req, res) {
  try {
    const customerId = req.user.id;

    // Filtramos por customerId (cuenta del cliente) en lugar de email,
    // para que aparezcan sin importar qué email ingresó en el formulario de checkout.
    // Estados incluidos:
    //   PENDING         — recién hecho, sin pagar (ej. MercadoPago pendiente)
    //   QUOTE_APPROVED  — minorista con efectivo/transferencia (aprobada sin pagar)
    //                     o mayorista con cotización ya aprobada
    //   PAYMENT_REVIEW  — pago en revisión (transferencia con comprobante subido)
    //   APPROVED        — pagada/confirmada
    const orders = await prisma.order.findMany({
      where: {
        customerId,
        status: { in: ["PENDING", "QUOTE_APPROVED", "APPROVED", "PAYMENT_REVIEW"] },
      },
      include: {
        coupon: { select: { code: true } },
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

// ── Helpers para modificación post-pago ──────────────────────────────────────

// Si es la primera modificación: guarda el clientSnapshot actual como originalSnapshot
// y marca isModified = true. Solo actúa si la orden todavía no fue modificada.
async function saveOriginalAndMarkModified(orderId, order) {
  if (!order.isModified) {
    // Consultar los items reales de la DB en el momento de la llamada (pre-modificación).
    // Antes usábamos order.clientSnapshot, pero ese campo solo existe en cotizaciones mayoristas
    // y podría estar desactualizado — esto captura el estado real de la orden antes del cambio.
    const preItems = await prisma.orderItem.findMany({
      where:   { orderId },
      include: { product: { select: { name: true, images: true } } },
    });
    // El snapshot ahora es un objeto { items, total, ivaAmount, couponDiscount }
    // para poder mostrar el desglose de precios originales al cliente.
    const snapshot = {
      items: preItems.map((i) => ({
        id:        i.id,
        productId: i.productId,
        name:      i.product?.name || "",
        price:     i.price,
        quantity:  i.quantity,
        image:     i.product?.images?.[0] || null,
      })),
      total:          order.total,
      ivaAmount:      order.ivaAmount      || 0,
      couponDiscount: order.couponDiscount || 0,
    };
    await prisma.order.update({
      where: { id: orderId },
      data:  { isModified: true, originalSnapshot: snapshot },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────

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
    const item = await prisma.orderItem.findFirst({ where: { id: itemId, orderId } });
    if (!item) return res.status(404).json({ error: "Item no encontrado" });

    const order   = await prisma.order.findUnique({ where: { id: orderId } });
    const newQty  = parseInt(quantity);
    const qtyDiff = newQty - item.quantity; // + = aumenta (deducir stock), - = reduce (restaurar stock)

    // Si el pedido está APPROVED, ajustar stock por el delta de cantidad
    if (order.status === "APPROVED" && qtyDiff !== 0) {
      if (item.variantId) {
        const variant = await prisma.productVariant.findUnique({ where: { id: item.variantId } });
        if (variant && !variant.stockUnlimited) {
          await prisma.productVariant.update({ where: { id: item.variantId }, data: { stock: Math.max(0, variant.stock - qtyDiff) } });
          await syncProductVisibility(variant.productId);
        }
      } else {
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        if (product && !product.stockUnlimited) {
          await prisma.product.update({ where: { id: item.productId }, data: { stock: Math.max(0, product.stock - qtyDiff) } });
          await syncProductVisibility(item.productId);
        }
      }
      await saveOriginalAndMarkModified(orderId, order);
    }

    // Actualizar item
    const updateData = { quantity: newQty };
    if (price !== undefined && parseFloat(price) > 0) updateData.price = parseFloat(price);
    await prisma.orderItem.update({ where: { id: itemId }, data: updateData });

    // Recalcular total y snapshot
    const allItems    = await prisma.orderItem.findMany({ where: { orderId } });
    const updatedPrice = updateData.price ?? item.price;
    const newTotal    = allItems.reduce(
      (sum, i) => sum + (i.id === itemId ? updatedPrice : i.price) * (i.id === itemId ? newQty : i.quantity), 0
    );
    const snapshot = await buildSnapshot(orderId);

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data:  { total: newTotal, ...(order.status === "APPROVED" ? { clientSnapshot: snapshot } : {}) },
      include: { items: { include: { product: { select: { id: true, name: true, images: true } } } } },
    });

    res.json(updatedOrder);
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

    const item = await prisma.orderItem.findFirst({ where: { id: itemId, orderId } });
    if (!item) return res.status(404).json({ error: "Item no encontrado" });

    const order = await prisma.order.findUnique({ where: { id: orderId } });

    // Si el pedido está APPROVED, restaurar stock del item eliminado
    if (order.status === "APPROVED") {
      if (item.variantId) {
        const variant = await prisma.productVariant.findUnique({ where: { id: item.variantId } });
        if (variant && !variant.stockUnlimited) {
          await prisma.productVariant.update({ where: { id: item.variantId }, data: { stock: variant.stock + item.quantity } });
          await syncProductVisibility(variant.productId);
        }
      } else {
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        if (product && !product.stockUnlimited) {
          await prisma.product.update({ where: { id: item.productId }, data: { stock: product.stock + item.quantity } });
          await syncProductVisibility(item.productId);
        }
      }
      await saveOriginalAndMarkModified(orderId, order);
    }

    await prisma.orderItem.delete({ where: { id: itemId } });

    const allItems = await prisma.orderItem.findMany({ where: { orderId } });
    const newTotal = allItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const snapshot = await buildSnapshot(orderId);

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data:  { total: newTotal, ...(order.status === "APPROVED" ? { clientSnapshot: snapshot } : {}) },
      include: { items: { include: { product: { select: { id: true, name: true, images: true } } } } },
    });

    res.json(updatedOrder);
  } catch (err) {
    console.error("deleteOrderItem error:", err);
    res.status(500).json({ error: "Error al eliminar el item" });
  }
}

// POST /api/orders/:id/items - Admin: agregar un nuevo producto a un pedido existente
async function addItemToOrder(req, res) {
  try {
    const orderId = parseInt(req.params.id);
    const { productId, variantId, quantity, price: priceOverride } = req.body;

    if (!productId || !quantity || parseInt(quantity) < 1) {
      return res.status(400).json({ error: "productId y quantity son requeridos" });
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    const product = await prisma.product.findUnique({ where: { id: parseInt(productId) } });
    if (!product) return res.status(404).json({ error: "Producto no encontrado" });

    const qty = parseInt(quantity);
    let finalPrice        = priceOverride ? parseFloat(priceOverride) : product.price;
    let variantLabel      = null;
    let variantSku        = null;
    let resolvedVariantId = null;

    if (variantId) {
      const variant = await prisma.productVariant.findUnique({ where: { id: parseInt(variantId) } });
      if (!variant) return res.status(404).json({ error: "Variante no encontrada" });
      if (!variant.stockUnlimited && variant.stock < qty) {
        return res.status(400).json({ error: `Stock insuficiente. Disponible: ${variant.stock}` });
      }
      if (!variant.stockUnlimited) {
        await prisma.productVariant.update({ where: { id: variant.id }, data: { stock: Math.max(0, variant.stock - qty) } });
        await syncProductVisibility(product.id);
      }
      resolvedVariantId = variant.id;
      finalPrice   = priceOverride ? parseFloat(priceOverride) : (variant.price ?? product.price);
      const combo  = Array.isArray(variant.combination) ? variant.combination : JSON.parse(String(variant.combination || "[]"));
      variantLabel = combo.map((c) => `${c.name}: ${c.value}`).join(" / ");
      variantSku   = variant.sku || null;
    } else {
      if (!product.stockUnlimited && product.stock < qty) {
        return res.status(400).json({ error: `Stock insuficiente. Disponible: ${product.stock}` });
      }
      if (!product.stockUnlimited) {
        await prisma.product.update({ where: { id: product.id }, data: { stock: Math.max(0, product.stock - qty) } });
        await syncProductVisibility(product.id);
      }
    }

    // Guardar el snapshot ANTES de crear el nuevo item para que refleje el estado previo a la modificación
    await saveOriginalAndMarkModified(orderId, order);

    await prisma.orderItem.create({
      data: { orderId, productId: product.id, quantity: qty, price: finalPrice, variantId: resolvedVariantId, variantLabel, variantSku },
    });

    const allItems = await prisma.orderItem.findMany({ where: { orderId } });
    const newTotal  = allItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const snapshot  = await buildSnapshot(orderId);

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data:  { total: newTotal, clientSnapshot: snapshot },
      include: { items: { include: { product: { select: { id: true, name: true, images: true } } } } },
    });

    res.json(updatedOrder);
  } catch (err) {
    console.error("addItemToOrder error:", err);
    res.status(500).json({ error: "Error al agregar el producto" });
  }
}

// COMENTADO: esta primera versión de modifyOrder es una versión simplificada que no maneja IVA ni
// visibilidad de producto al devolver stock en eliminaciones. La versión completa y activa está
// definida más abajo (línea ~1790). En JS, la segunda declaración de función con el mismo nombre
// sobreescribe la primera, así que esta quedó como código muerto. Se comenta para evitar confusión.
/*
// POST /api/orders/:id/modify - Admin: modificación batch de un pedido (agrega/edita/elimina items)
// Body: { items: [{ itemId?, productId, quantity, price, variantId?, variantLabel? }] }
// Items con itemId = existentes (update). Items sin itemId = nuevos (add). Items actuales ausentes = eliminados.
async function modifyOrder(req, res) {
  try {
    const orderId = parseInt(req.params.id);
    const { items: newItems } = req.body;

    if (!Array.isArray(newItems) || newItems.length === 0) {
      return res.status(400).json({ error: "Se requiere al menos un producto" });
    }

    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    const currentItems  = order.items;
    const newItemIdSet  = new Set(newItems.filter((i) => i.itemId).map((i) => parseInt(i.itemId)));

    // Eliminar items que ya no están en la nueva lista
    for (const item of currentItems) {
      if (!newItemIdSet.has(item.id)) {
        if (order.status === "APPROVED") {
          if (item.variantId) {
            const v = await prisma.productVariant.findUnique({ where: { id: item.variantId } });
            if (v && !v.stockUnlimited) {
              await prisma.productVariant.update({ where: { id: v.id }, data: { stock: v.stock + item.quantity } });
              await syncProductVisibility(v.productId);
            }
          } else {
            const p = await prisma.product.findUnique({ where: { id: item.productId } });
            if (p && !p.stockUnlimited) {
              await prisma.product.update({ where: { id: p.id }, data: { stock: p.stock + item.quantity } });
              await syncProductVisibility(p.id);
            }
          }
        }
        await prisma.orderItem.delete({ where: { id: item.id } });
      }
    }

    // Actualizar items existentes (con itemId)
    for (const ni of newItems.filter((i) => i.itemId)) {
      const cur = currentItems.find((i) => i.id === parseInt(ni.itemId));
      if (!cur) continue;
      const newQty  = parseInt(ni.quantity);
      const qtyDiff = newQty - cur.quantity;
      if (order.status === "APPROVED" && qtyDiff !== 0) {
        if (cur.variantId) {
          const v = await prisma.productVariant.findUnique({ where: { id: cur.variantId } });
          if (v && !v.stockUnlimited) {
            await prisma.productVariant.update({ where: { id: v.id }, data: { stock: Math.max(0, v.stock - qtyDiff) } });
            await syncProductVisibility(v.productId);
          }
        } else {
          const p = await prisma.product.findUnique({ where: { id: cur.productId } });
          if (p && !p.stockUnlimited) {
            await prisma.product.update({ where: { id: p.id }, data: { stock: Math.max(0, p.stock - qtyDiff) } });
            await syncProductVisibility(p.id);
          }
        }
      }
      await prisma.orderItem.update({ where: { id: cur.id }, data: { quantity: newQty, price: parseFloat(ni.price) } });
    }

    // Agregar items nuevos (sin itemId)
    for (const ni of newItems.filter((i) => !i.itemId)) {
      const product = await prisma.product.findUnique({ where: { id: parseInt(ni.productId) } });
      if (!product) continue;
      const qty = parseInt(ni.quantity);
      if (ni.variantId) {
        const v = await prisma.productVariant.findUnique({ where: { id: parseInt(ni.variantId) } });
        if (v && !v.stockUnlimited) {
          await prisma.productVariant.update({ where: { id: v.id }, data: { stock: Math.max(0, v.stock - qty) } });
          await syncProductVisibility(product.id);
        }
      } else if (!product.stockUnlimited) {
        await prisma.product.update({ where: { id: product.id }, data: { stock: Math.max(0, product.stock - qty) } });
        await syncProductVisibility(product.id);
      }
      await prisma.orderItem.create({
        data: {
          orderId, productId: product.id, quantity: qty, price: parseFloat(ni.price),
          variantId: ni.variantId ? parseInt(ni.variantId) : null,
          variantLabel: ni.variantLabel || null,
        },
      });
    }

    // Marcar como modificado, recalcular total y snapshot
    await saveOriginalAndMarkModified(orderId, order);
    const allItems = await prisma.orderItem.findMany({ where: { orderId } });
    const newTotal = allItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const snapshot = await buildSnapshot(orderId);

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data:  { total: newTotal, clientSnapshot: snapshot },
      include: {
        items: { include: { product: { select: { id: true, name: true, images: true } } } },
        coupon: { select: { code: true, discountType: true, discountValue: true } },
      },
    });

    res.json(updatedOrder);
  } catch (err) {
    console.error("modifyOrder error:", err);
    res.status(500).json({ error: "Error al modificar el pedido" });
  }
}
*/

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
// Body: { adminNotes?, variantAssignments?: [{ itemId, variantId, quantity }] }
// variantAssignments: para items de productos con variantes, el admin indica qué variante
// se va a enviar (y en qué cantidad). El stock se descuenta de esas variantes.
async function approveCotizacion(req, res) {
  try {
    const orderId = parseInt(req.params.id);
    const { adminNotes, variantAssignments = [] } = req.body;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: { select: { id: true, name: true } } } } },
    });
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    // Procesar asignaciones de variantes: validar y descontar stock
    if (variantAssignments.length > 0) {
      // Agrupar por itemId para validar que el total asignado coincida con lo pedido
      const byItem = {};
      for (const a of variantAssignments) {
        const key = String(a.itemId);
        if (!byItem[key]) byItem[key] = [];
        byItem[key].push(a);
      }

      for (const [itemIdStr, assignments] of Object.entries(byItem)) {
        const itemId = parseInt(itemIdStr);
        const orderItem = order.items.find((i) => i.id === itemId);
        if (!orderItem) continue;

        const totalAssigned = assignments.reduce((sum, a) => sum + parseInt(a.quantity), 0);
        if (totalAssigned !== orderItem.quantity) {
          return res.status(400).json({
            error: `La cantidad asignada para "${orderItem.product?.name}" (${totalAssigned}) no coincide con lo pedido (${orderItem.quantity})`,
          });
        }

        // Descontar stock de cada variante asignada
        for (const a of assignments) {
          const variant = await prisma.productVariant.findUnique({ where: { id: parseInt(a.variantId) } });
          if (!variant) return res.status(400).json({ error: `Variante ${a.variantId} no encontrada` });
          const qty = parseInt(a.quantity);
          if (!variant.stockUnlimited && variant.stock < qty) {
            const combo = Array.isArray(variant.combination)
              ? variant.combination.map((c) => c.value).join(" / ")
              : String(a.variantId);
            return res.status(400).json({
              error: `Stock insuficiente en "${combo}" para "${orderItem.product?.name}". Disponible: ${variant.stock}, requerido: ${qty}`,
            });
          }
          if (!variant.stockUnlimited) {
            await prisma.productVariant.update({
              where: { id: variant.id },
              data:  { stock: Math.max(0, variant.stock - qty) },
            });
            await syncProductVisibility(variant.productId);
          }
        }

        // Actualizar el OrderItem con la variante asignada (o label de surtido si hay varias)
        let newVariantId = null;
        let newVariantLabel = null;
        if (assignments.length === 1) {
          newVariantId = parseInt(assignments[0].variantId);
          const v = await prisma.productVariant.findUnique({ where: { id: newVariantId }, select: { combination: true } });
          if (v) {
            const combo = Array.isArray(v.combination) ? v.combination : JSON.parse(String(v.combination));
            newVariantLabel = combo.map((c) => `${c.name}: ${c.value}`).join(" / ");
          }
        } else {
          // Surtido: múltiples variantes → buscar el nombre real de cada variante y armar el label
          const parts = [];
          for (const a of assignments) {
            const v = await prisma.productVariant.findUnique({
              where: { id: parseInt(a.variantId) },
              select: { combination: true },
            });
            if (v) {
              const combo = Array.isArray(v.combination) ? v.combination : JSON.parse(String(v.combination));
              const variantName = combo.map((c) => `${c.name}: ${c.value}`).join(" / ");
              parts.push(`${variantName} × ${a.quantity}u`);
            } else {
              parts.push(`Variante ${a.variantId} × ${a.quantity}u`);
            }
          }
          newVariantLabel = parts.join(" | ");
        }
        await prisma.orderItem.update({
          where: { id: itemId },
          data:  { variantId: newVariantId, variantLabel: newVariantLabel },
        });
      }
    }

    // Publicar snapshot con el estado actual y marcar como QUOTE_APPROVED
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

    // Actualizar paymentMethod y status en DB.
    // PAYMENT_REVIEW indica que el cliente ya eligió cómo pagar — el admin debe verificar
    // y luego marcarlo como Abonada (APPROVED). Esto hace que aparezca en "Pedidos" del cliente.
    await prisma.order.update({
      where: { id: orderId },
      data:  { paymentMethod, status: "PAYMENT_REVIEW" },
    });

    // El email usa el método elegido (ya coincide con lo guardado en DB)
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
    const { customerName, customerEmail, customerPhone, customerId, items, paymentMethod, notes, status, salesChannel, customerType } = req.body;

    // Email es opcional en ventas manuales — solo el nombre es obligatorio
    if (!customerName) {
      return res.status(400).json({ error: "El nombre del cliente es requerido" });
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
          // customerEmail es opcional en ventas manuales — si viene vacío se guarda como ""
          // (el schema no permite null sin migración, string vacío es equivalente a "sin email")
          customerEmail: customerEmail || "",
          customerPhone: customerPhone || null,
          customerId:    customerId ? parseInt(customerId) : null,
          total,
          status:        orderStatus,
          paymentMethod: method,
          adminNotes:    notes || null,
          // salesChannel: canal de venta ingresado por el admin. Si no viene, se usa "MANUAL" como fallback.
          salesChannel:  salesChannel || "MANUAL",
          // customerType: MINORISTA o MAYORISTA según seleccionó el admin al registrar la venta.
          customerType:  customerType || "MINORISTA",
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

// PATCH /api/orders/:id/fields — actualiza paymentMethod, fulfillmentStatus y/o shippingMethod
async function updateOrderFields(req, res) {
  try {
    const { id } = req.params;
    // shippingMethod: antes no estaba incluido → al enviarlo desde el frontend data quedaba vacío → 400
    const { paymentMethod, fulfillmentStatus, shippingMethod } = req.body;

    const data = {};

    if (paymentMethod) {
      const validMethods = ["MERCADOPAGO", "EFECTIVO", "TRANSFERENCIA", "COTIZACION"];
      if (!validMethods.includes(paymentMethod)) {
        return res.status(400).json({ error: "Método de pago inválido" });
      }
      data.paymentMethod = paymentMethod;
    }

    if (fulfillmentStatus) {
      const validFulfillment = ["PENDIENTE", "EN_PREPARACION", "ENVIADO", "ENTREGADO"];
      if (!validFulfillment.includes(fulfillmentStatus)) {
        return res.status(400).json({ error: "Estado de pedido inválido" });
      }
      data.fulfillmentStatus = fulfillmentStatus;
    }

    if (shippingMethod) {
      const validShipping = ["RETIRO", "ENVIO", "CORREO_ARGENTINO"];
      if (!validShipping.includes(shippingMethod)) {
        return res.status(400).json({ error: "Método de entrega inválido" });
      }
      data.shippingMethod = shippingMethod;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "No se envió ningún campo para actualizar" });
    }

    // Obtener la orden antes de actualizar para tener customerEmail y shippingMethod
    const existing = await prisma.order.findUnique({ where: { id: parseInt(id) } });

    const order = await prisma.order.update({
      where: { id: parseInt(id) },
      data,
    });

    // Notificar al cliente si cambió el estado logístico (no bloquea la respuesta)
    if (fulfillmentStatus && existing) {
      sendOrderFulfillmentEmail({ ...existing, ...order }, fulfillmentStatus).catch((e) =>
        console.error("[EMAIL] sendOrderFulfillmentEmail falló:", e.message)
      );
    }

    res.json(order);
  } catch (err) {
    console.error("updateOrderFields error:", err);
    res.status(500).json({ error: "Error al actualizar la orden" });
  }
}

// GET /api/orders/badge-counts — contadores NO leídos para el sidebar del admin
async function getBadgeCounts(req, res) {
  try {
    const [cotizaciones, devoluciones, clientes, solicitudesMayorista, ordenesPendientes] = await Promise.all([
      // Cotizaciones no vistas por el admin (activas, no aprobadas/canceladas)
      prisma.order.count({
        where: { paymentMethod: "COTIZACION", status: { notIn: ["APPROVED", "CANCELLED", "REJECTED"] }, seenByAdmin: false },
      }),
      // Devoluciones PENDIENTES no vistas (las ya resueltas no generan contador)
      prisma.returnRequest.count({ where: { seenByAdmin: false, status: "PENDING" } }),
      // Clientes pendientes no vistos
      prisma.customer.count({ where: { status: "PENDING", seenByAdmin: false } }),
      // Solicitudes mayorista pendientes
      prisma.mayoristaRequest.count({ where: { status: "PENDING" } }),
      // Órdenes minoristas pendientes no vistas (excluye cotizaciones)
      prisma.order.count({
        where: { paymentMethod: { not: "COTIZACION" }, status: "PENDING", seenByAdmin: false },
      }),
    ]);
    res.json({ cotizaciones, devoluciones, clientes, solicitudesMayorista, ordenesPendientes });
  } catch (err) {
    console.error("getBadgeCounts error:", err);
    res.status(500).json({ error: "Error al obtener contadores" });
  }
}

// POST /api/orders/:id/modify — Admin: modifica un pedido ya aprobado (post-pago)
// Body: { items: [{ itemId?, productId, quantity, price, variantId?, variantLabel? }] }
// Items con itemId = actualizar/mantener item existente.
// Items sin itemId pero con productId = agregar item nuevo (descuenta stock).
// Items existentes ausentes en la lista = eliminar (devuelve stock).
async function modifyOrder(req, res) {
  try {
    const orderId = parseInt(req.params.id);
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "La lista de items no puede estar vacía" });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: { select: { id: true, name: true, images: true } } } },
      },
    });
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    // Guardar snapshot original solo en la primera modificación.
    // Formato: { items: [...], total, ivaAmount, couponDiscount } para poder mostrar el total original al cliente.
    const originalSnapshot = order.originalSnapshot
      ? order.originalSnapshot
      : {
          items: order.items.map((i) => ({
            id:        i.id,
            productId: i.productId,
            name:      i.product?.name || "",
            price:     i.price,
            quantity:  i.quantity,
            image:     i.product?.images?.[0] || null,
          })),
          total:          order.total,
          ivaAmount:      order.ivaAmount      || 0,
          couponDiscount: order.couponDiscount || 0,
        };

    // Separar items entrantes: los que tienen itemId (existentes) vs los nuevos
    const incomingMap = {}; // itemId (int) -> item
    const newItems    = []; // items a agregar
    for (const item of items) {
      if (item.itemId) {
        incomingMap[parseInt(item.itemId)] = item;
      } else {
        newItems.push(item);
      }
    }

    // Determinar items a eliminar (están en DB pero no en la lista entrante)
    const toRemove = order.items.filter((i) => !incomingMap[i.id]);

    // Devolver stock de los items eliminados
    for (const item of toRemove) {
      if (item.variantId) {
        const v = await prisma.productVariant.findUnique({ where: { id: item.variantId } });
        if (v && !v.stockUnlimited) {
          await prisma.productVariant.update({ where: { id: v.id }, data: { stock: v.stock + item.quantity } });
          await syncProductVisibility(item.productId);
        }
      } else {
        const p = await prisma.product.findUnique({ where: { id: item.productId } });
        if (p && !p.stockUnlimited) {
          await prisma.product.update({ where: { id: p.id }, data: { stock: p.stock + item.quantity, active: true } });
        }
      }
      await prisma.orderItem.delete({ where: { id: item.id } });
    }

    // Actualizar items existentes: ajustar qty/precio y stock por la diferencia
    for (const existingItem of order.items) {
      const incoming = incomingMap[existingItem.id];
      if (!incoming) continue; // ya fue eliminado arriba

      const newQty   = parseInt(incoming.quantity);
      const newPrice = incoming.price !== undefined ? parseFloat(incoming.price) : existingItem.price;
      const qtyDiff  = newQty - existingItem.quantity; // positivo = más unidades (descontar stock); negativo = menos (devolver)

      if (qtyDiff !== 0) {
        if (existingItem.variantId) {
          const v = await prisma.productVariant.findUnique({ where: { id: existingItem.variantId } });
          if (v && !v.stockUnlimited) {
            const newStock = Math.max(0, v.stock - qtyDiff);
            await prisma.productVariant.update({ where: { id: v.id }, data: { stock: newStock } });
            await syncProductVisibility(existingItem.productId);
          }
        } else {
          const p = await prisma.product.findUnique({ where: { id: existingItem.productId } });
          if (p && !p.stockUnlimited) {
            const newStock = Math.max(0, p.stock - qtyDiff);
            await prisma.product.update({ where: { id: p.id }, data: { stock: newStock } });
            // syncProductVisibility ahora maneja productos sin variantes correctamente
            await syncProductVisibility(p.id);
          }
        }
      }

      await prisma.orderItem.update({
        where: { id: existingItem.id },
        data:  { quantity: newQty, price: newPrice },
      });
    }

    // Agregar nuevos items y descontar stock
    for (const newItem of newItems) {
      const pid = parseInt(newItem.productId);
      const qty = parseInt(newItem.quantity);
      const price = parseFloat(newItem.price);

      if (isNaN(pid) || isNaN(qty) || qty < 1 || isNaN(price) || price < 0) {
        return res.status(400).json({ error: "Datos de item inválidos" });
      }

      const product = await prisma.product.findUnique({ where: { id: pid } });
      if (!product) return res.status(400).json({ error: `Producto ${pid} no encontrado` });

      if (!product.stockUnlimited && product.stock < qty) {
        return res.status(400).json({ error: `Stock insuficiente para "${product.name}". Disponible: ${product.stock}` });
      }

      if (!product.stockUnlimited) {
        const newStock = Math.max(0, product.stock - qty);
        await prisma.product.update({
          where: { id: pid },
          data: { stock: newStock, ...(newStock === 0 ? { active: false } : {}) },
        });
        await syncProductVisibility(pid);
      }

      await prisma.orderItem.create({
        data: {
          order:        { connect: { id: orderId } },
          product:      { connect: { id: pid } },
          quantity:     qty,
          price:        price,
          variantId:    newItem.variantId ? parseInt(newItem.variantId) : null,
          variantLabel: newItem.variantLabel || null,
        },
      });
    }

    // Recalcular total: subtotal de items + IVA (si aplica) - descuento cupón
    const allItems = await prisma.orderItem.findMany({ where: { orderId } });
    const newSubtotal = allItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

    // Recalcular IVA si el pedido lo tiene
    let newIvaAmount = 0;
    if (order.wantsInvoice) {
      for (const item of allItems) {
        const p = await prisma.product.findUnique({ where: { id: item.productId }, select: { ivaRate: true } });
        const rate = ((p?.ivaRate ?? 21) / 100);
        newIvaAmount += Math.round(item.price * item.quantity * rate * 100) / 100;
      }
      newIvaAmount = Math.round(newIvaAmount * 100) / 100;
    }

    const newTotal = Math.max(0, Math.round((newSubtotal - (order.couponDiscount || 0) + newIvaAmount) * 100) / 100);

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        total:            newTotal,
        ivaAmount:        newIvaAmount,
        isModified:       true,
        originalSnapshot: order.originalSnapshot ? undefined : originalSnapshot, // solo setear la primera vez
      },
      include: {
        items: { include: { product: { select: { id: true, name: true, images: true } } } },
        coupon: { select: { code: true, discountType: true, discountValue: true } },
      },
    });

    res.json(updated);
  } catch (err) {
    console.error("modifyOrder error:", err);
    res.status(500).json({ error: "Error al modificar el pedido" });
  }
}

// PATCH /api/orders/:id/seen — marcar cotización como vista por el admin
async function markOrderSeen(req, res) {
  try {
    await prisma.order.update({ where: { id: parseInt(req.params.id) }, data: { seenByAdmin: true } });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Error al marcar como visto" }); }
}

module.exports = {
  getOrders, getOrder, createOrder, updateOrderStatus, updateOrderFields, getStats, getMetrics, deleteOrder,
  getMyOrders, getMyOrderById, getMyCotizaciones, getMyQuoteById,
  updateOrderItem, deleteOrderItem, addItemToOrder, modifyOrder,
  publishCotizacion, approveCotizacion, cancelByCustomer, confirmCotizacionPayment,
  applyCouponToOrder, createManualOrder, getBadgeCounts, markOrderSeen,
  // COMENTADO: estas dos líneas eran duplicados que sobreescribían las entradas correctas de arriba.
  // "modifyOrder" duplicado es un no-op pero confuso; "addItemToOrder: modifyOrder" era incorrecto
  // porque exportaba la función modifyOrder bajo el nombre addItemToOrder, borrando la función real.
  // modifyOrder,
  // addItemToOrder: modifyOrder,
};

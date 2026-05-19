const { PrismaClient } = require("@prisma/client");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");
const { sendOrderNotificationToAdmin, sendOrderConfirmationToCustomer } = require("../services/email.service");

const prisma = new PrismaClient();

// Inicializar el cliente de MercadoPago con el access token
const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 5000 },
});

// POST /api/payments/create-preference
// Crea una preferencia de pago en MercadoPago para una orden existente
async function createPreference(req, res) {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: "orderId es requerido" });
    }

    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    if (order.status !== "PENDING") {
      return res.status(400).json({ error: "La orden ya fue procesada" });
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    // Construir los items para la preferencia de MercadoPago
    const mpItems = order.items.map((item) => ({
      id: item.product.id.toString(),
      title: item.product.name,
      quantity: item.quantity,
      unit_price: item.price,
      currency_id: "ARS",
    }));

    const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";

    // MercadoPago rechaza preferencias con URLs localhost en back_urls, notification_url, etc.
    // Solo incluimos estas URLs si apuntan a un dominio público (producción / ngrok).
    const isPublicFrontend = !frontendUrl.includes("localhost") && !frontendUrl.includes("127.0.0.1");
    const isPublicBackend  = !backendUrl.includes("localhost")  && !backendUrl.includes("127.0.0.1");

    const preferenceData = {
      items: mpItems,
      payer: {
        name: order.customerName,
        email: order.customerEmail,
      },
      external_reference: order.id.toString(),
      statement_descriptor: "TiendaTech",
      // back_urls y auto_return solo en producción: MP rechaza localhost
      ...(isPublicFrontend && {
        back_urls: {
          success: `${frontendUrl}/pago/exitoso?orderId=${order.id}`,
          failure: `${frontendUrl}/pago/fallido?orderId=${order.id}`,
          pending: `${frontendUrl}/pago/pendiente?orderId=${order.id}`,
        },
        auto_return: "approved",
      }),
      // notification_url solo en producción
      ...(isPublicBackend && {
        notification_url: `${backendUrl}/api/payments/webhook`,
      }),
    };

    const preference = new Preference(mp);
    const response = await preference.create({ body: preferenceData });

    // Guardar el ID de preferencia en la orden
    await prisma.order.update({
      where: { id: order.id },
      data: { mpPreferenceId: response.id },
    });

    res.json({
      preferenceId: response.id,
      initPoint: response.init_point,
      sandboxInitPoint: response.sandbox_init_point,
    });
  } catch (err) {
    console.error("createPreference error:", err);
    res.status(500).json({ error: "Error al crear la preferencia de pago" });
  }
}

// POST /api/payments/webhook
// MercadoPago notifica aquí cuando cambia el estado de un pago
async function handleWebhook(req, res) {
  try {
    // Log para debug: MP envía la info en query, en body, o en ambos. Distintos
    // formatos según la integración: viejo (topic+id), nuevo (type+data.id), v2 con body JSON.
    console.log("[MP WEBHOOK] query:", JSON.stringify(req.query), "body:", JSON.stringify(req.body));

    // Tipo: aceptar "type" (nuevo) o "topic" (viejo) de query o body
    const type = req.query.type || req.query.topic || req.body?.type || req.body?.topic;

    // Solo procesamos notificaciones de pagos
    if (type !== "payment") {
      return res.sendStatus(200);
    }

    // Payment ID: probar múltiples ubicaciones porque MP no es consistente.
    // - req.query["data.id"]: cuando MP manda ?data.id=123 (Express no anida con dots)
    // - req.query.data?.id:   cuando algún proxy anida el query
    // - req.query.id:         formato viejo ?topic=payment&id=123
    // - req.body?.data?.id:   cuando MP manda el JSON en el body POST
    // - req.body?.id:         payload viejo en body
    const paymentId = req.query["data.id"]
                   || req.query.data?.id
                   || req.query.id
                   || req.body?.data?.id
                   || req.body?.id;

    if (!paymentId) {
      console.log("[MP WEBHOOK] paymentId no encontrado, ignorando");
      return res.sendStatus(200);
    }

    console.log("[MP WEBHOOK] procesando paymentId:", paymentId);

    // Consultar el pago en MercadoPago para obtener el estado real
    const paymentClient = new Payment(mp);
    const payment = await paymentClient.get({ id: paymentId });

    const orderId = parseInt(payment.external_reference);
    if (!orderId || isNaN(orderId)) {
      return res.sendStatus(200);
    }

    // Mapear el estado de MP a nuestro enum
    const statusMap = {
      approved: "APPROVED",
      rejected: "REJECTED",
      cancelled: "CANCELLED",
      pending: "PENDING",
      in_process: "PENDING",
    };

    const newStatus = statusMap[payment.status] || "PENDING";

    // Actualizar la orden con el resultado del pago
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: newStatus,
        mpPaymentId: paymentId.toString(),
        mpStatus: payment.status,
      },
    });

    // Si el pago fue aprobado: descontar stock + notificar al admin + email al cliente
    if (newStatus === "APPROVED") {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { product: true } }, coupon: true },
      });

      if (order) {
        for (const item of order.items) {
          const updated = await prisma.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: item.quantity } },
          });
          // Si el stock quedó en 0 o menos (y no es ilimitado), despublicar el producto
          if (!updated.stockUnlimited && updated.stock <= 0) {
            await prisma.product.update({
              where: { id: item.productId },
              data: { stock: 0, active: false },
            });
          }
        }

        // Emails: notificar al admin con el ID de pago de MP (para buscar el comprobante en su cuenta)
        // y enviar confirmación al cliente. No bloqueamos la respuesta del webhook si fallan.
        try {
          await sendOrderNotificationToAdmin({ ...order, mpPaymentId: paymentId.toString() });
        } catch (err) { console.error("[WEBHOOK] Error enviando email al admin:", err.message); }
        try {
          await sendOrderConfirmationToCustomer({ ...order, mpPaymentId: paymentId.toString() });
        } catch (err) { console.error("[WEBHOOK] Error enviando email al cliente:", err.message); }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    // Devolvemos 200 de todas formas para que MP no reintente
    res.sendStatus(200);
  }
}

// GET /api/payments/order/:orderId/status
// Consultar el estado de pago de una orden (para la página de resultado).
// Si la orden sigue PENDING y se recibe paymentId por query, hace una sincronización
// activa con MP — esto cubre el caso de que el webhook nunca haya llegado.
async function getOrderPaymentStatus(req, res) {
  try {
    const { orderId } = req.params;
    const orderIdInt = parseInt(orderId);

    const order = await prisma.order.findUnique({
      where: { id: orderIdInt },
      select: {
        id: true,
        status: true,
        mpStatus: true,
        mpPaymentId: true,
        customerName: true,
        total: true,
      },
    });

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    // Si la orden todavía está PENDING, intentar sincronizar con MP por external_reference.
    // El frontend manda ?paymentId=X cuando MP redirige a /pago/exitoso con ese param en la URL.
    const needsSync = order.status === "PENDING" || order.status === "PAYMENT_REVIEW";
    if (needsSync) {
      try {
        const queryPaymentId = req.query.paymentId;
        const paymentClient  = new Payment(mp);
        let payment = null;

        if (queryPaymentId) {
          // Caso A: el frontend nos pasó el payment_id desde la URL de redirect
          payment = await paymentClient.get({ id: queryPaymentId });
        } else {
          // Caso B: buscar payments por external_reference (orderId) en MP
          const search = await paymentClient.search({ options: { external_reference: orderId } });
          const results = search?.results || [];
          // Quedarse con el más reciente que tenga status definido
          payment = results.sort((a, b) => new Date(b.date_created) - new Date(a.date_created))[0] || null;
        }

        if (payment && payment.external_reference === orderId.toString()) {
          const statusMap = {
            approved:   "APPROVED",
            rejected:   "REJECTED",
            cancelled:  "CANCELLED",
            pending:    "PENDING",
            in_process: "PENDING",
          };
          const newStatus = statusMap[payment.status] || order.status;

          if (newStatus !== order.status) {
            console.log(`[MP SYNC] Orden #${orderIdInt}: ${order.status} → ${newStatus} (payment ${payment.id})`);
            await prisma.order.update({
              where: { id: orderIdInt },
              data:  {
                status:      newStatus,
                mpPaymentId: payment.id.toString(),
                mpStatus:    payment.status,
              },
            });
            // Si pasó a APPROVED, descontar stock una sola vez
            if (newStatus === "APPROVED" && order.status !== "APPROVED") {
              const fullOrder = await prisma.order.findUnique({
                where:   { id: orderIdInt },
                include: { items: true },
              });
              if (fullOrder) {
                for (const item of fullOrder.items) {
                  const updated = await prisma.product.update({
                    where: { id: item.productId },
                    data:  { stock: { decrement: item.quantity } },
                  });
                  if (!updated.stockUnlimited && updated.stock <= 0) {
                    await prisma.product.update({
                      where: { id: item.productId },
                      data:  { stock: 0, active: false },
                    });
                  }
                }
              }
            }
            // Refrescar el objeto que devolvemos al frontend
            order.status      = newStatus;
            order.mpStatus    = payment.status;
            order.mpPaymentId = payment.id.toString();
          }
        }
      } catch (syncErr) {
        // No fallar el endpoint si la sync falla — devolvemos el order con su estado actual
        console.error("[MP SYNC] error:", syncErr.message);
      }
    }

    res.json(order);
  } catch (err) {
    console.error("getOrderPaymentStatus error:", err);
    res.status(500).json({ error: "Error al consultar el estado del pago" });
  }
}

// POST /api/payments/cotizacion-preference
// Cliente crea preferencia de MP para pagar su cotización QUOTE_APPROVED
async function createCotizacionPreference(req, res) {
  try {
    const { orderId } = req.body;
    const customerId  = req.user.id;

    if (!orderId) {
      return res.status(400).json({ error: "orderId es requerido" });
    }

    const order = await prisma.order.findFirst({
      where: {
        id:            parseInt(orderId),
        customerId,                       // Verificar que pertenece al cliente
        paymentMethod: "COTIZACION",      // Solo cotizaciones
        status:        "QUOTE_APPROVED",  // Solo si el admin ya aprobó
      },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ error: "Cotización no encontrada o no está aprobada" });
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const backendUrl  = process.env.BACKEND_URL  || "http://localhost:4000";

    // Usar los items reales de la orden (el admin puede haber ajustado cantidades/precios)
    const mpItems = order.items.map((item) => ({
      id:         item.product.id.toString(),
      title:      item.product.name,
      quantity:   item.quantity,
      unit_price: item.price,
      currency_id: "ARS",
    }));

    const isPublicFrontend = !frontendUrl.includes("localhost") && !frontendUrl.includes("127.0.0.1");
    const isPublicBackend  = !backendUrl.includes("localhost")  && !backendUrl.includes("127.0.0.1");

    const preferenceData = {
      items: mpItems,
      payer: {
        name:  order.customerName,
        email: order.customerEmail,
      },
      external_reference: order.id.toString(),
      statement_descriptor: "TiendaTech",
      ...(isPublicFrontend && {
        back_urls: {
          success: `${frontendUrl}/pago/exitoso?orderId=${order.id}`,
          failure: `${frontendUrl}/pago/fallido?orderId=${order.id}`,
          pending: `${frontendUrl}/pago/pendiente?orderId=${order.id}`,
        },
        auto_return: "approved",
      }),
      ...(isPublicBackend && {
        notification_url: `${backendUrl}/api/payments/webhook`,
      }),
    };

    const preference = new Preference(mp);
    const response   = await preference.create({ body: preferenceData });

    await prisma.order.update({
      where: { id: order.id },
      data:  { mpPreferenceId: response.id },
    });

    res.json({
      preferenceId:      response.id,
      initPoint:         response.init_point,
      sandboxInitPoint:  response.sandbox_init_point,
    });
  } catch (err) {
    console.error("createCotizacionPreference error:", err);
    res.status(500).json({ error: "Error al crear la preferencia de pago" });
  }
}

module.exports = { createPreference, handleWebhook, getOrderPaymentStatus, createCotizacionPreference };

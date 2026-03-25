const { PrismaClient } = require("@prisma/client");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

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
    const { type, data } = req.query;

    // Solo procesamos notificaciones de pagos
    if (type !== "payment") {
      return res.sendStatus(200);
    }

    const paymentId = data?.id;
    if (!paymentId) {
      return res.sendStatus(200);
    }

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

    // Si el pago fue aprobado, descontar el stock de los productos
    if (newStatus === "APPROVED") {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
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
// Consultar el estado de pago de una orden (para la página de resultado)
async function getOrderPaymentStatus(req, res) {
  try {
    const { orderId } = req.params;

    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
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

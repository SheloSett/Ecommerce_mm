const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");
const { sendOrderNotificationToAdmin, sendOrderConfirmationToCustomer } = require("../services/email.service");

const prisma = new PrismaClient();

// Inicializar el cliente de MercadoPago con el access token
const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 5000 },
});

// ¿esta orden se puede cobrar por MercadoPago?
// MP cobra SIEMPRE en pesos (currency_id: "ARS" en las preferencias de abajo) y el sistema NO hace
// conversión de moneda en ningún punto. Entonces una orden con ítems en USD no puede pasar por acá:
// el unit_price que se le manda a MP es el número crudo del ítem, así que un artículo de USD 500 se
// cobraría como AR$500.
//
// SEGURIDAD: este chequeo es el que hace valer server-side el gating de A_CONVENIR. createOrder
// fuerza el método a A_CONVENIR cuando un minorista lleva ítems en USD, pero esa orden queda en
// status PENDING igual que una de MercadoPago — sin este guard, pegarle directo a
// POST /api/payments/create-preference con el orderId (endpoint público, sin auth) alcanzaba para
// generar el link de pago y pagar el pedido en dólares como si fueran pesos.
// Devuelve null si está todo bien, o el mensaje de error si no se puede cobrar.
function mpPaymentBlockedReason(order) {
  if (order.paymentMethod === "A_CONVENIR") {
    return "Este pedido tiene precios en dólares: el pago se coordina con la tienda, no se puede pagar por MercadoPago.";
  }
  if ((order.items || []).some((i) => i.currency === "USD")) {
    return "Este pedido incluye artículos con precio en dólares y no se puede pagar por MercadoPago. Contactanos para coordinar el pago.";
  }
  return null;
}

// Valida la firma "x-signature" que manda MercadoPago (HMAC-SHA256 sobre un manifest con el
// data.id de la URL + el header x-request-id + el timestamp de la firma). Sirve para asegurar que
// el webhook viene de verdad de MP y no de alguien que conoce la URL.
// Devuelve: true (firma válida) | false (firma inválida) | null (no se puede validar).
// DISEÑO DEFENSIVO: si no está configurado MP_WEBHOOK_SECRET, devuelve null y el webhook se procesa
// igual que antes (no rompemos los pagos que ya funcionan). La validación se ACTIVA sola recién
// cuando pongas MP_WEBHOOK_SECRET en el .env con el mismo valor que configures en el panel de MP.
function verifyMpSignature(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return null; // sin secret → no validar (comportamiento previo, no romper pagos)

  const signature = req.headers["x-signature"];
  const requestId = req.headers["x-request-id"];
  if (!signature) return false;

  // x-signature tiene forma "ts=1700000000,v1=<hash hex>"
  const parts = Object.fromEntries(
    signature.split(",").map((kv) => kv.split("=").map((s) => (s || "").trim()))
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  // data.id viene del query string; MP lo pide en minúsculas si es alfanumérico.
  const dataId = (req.query["data.id"] || req.query.id || "").toString().toLowerCase();

  // Manifest EXACTO que arma y firma MercadoPago.
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const computed  = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  try {
    // Comparación en tiempo constante (evita timing attacks). Si los largos difieren, timingSafeEqual
    // tira excepción → lo tratamos como firma inválida.
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(v1, "hex"));
  } catch {
    return false;
  }
}

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

    // Órdenes en dólares / "a convenir": no se pueden cobrar por MP (ver mpPaymentBlockedReason).
    const blockedReason = mpPaymentBlockedReason(order);
    if (blockedReason) {
      return res.status(400).json({ error: blockedReason });
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
    // FIX: index.js monta express.raw() en esta ruta, por lo que req.body llega como Buffer
    // crudo, NUNCA como objeto JSON. Todos los accesos req.body?.type / req.body?.data?.id
    // de abajo devolvían siempre undefined (el webhook solo funcionaba si MP mandaba los
    // datos por query string). Parseamos el Buffer a JSON acá, con try/catch por si el
    // body viene vacío o no es JSON válido.
    let body = req.body;
    if (Buffer.isBuffer(body)) {
      try {
        body = JSON.parse(body.toString("utf8") || "{}");
      } catch {
        body = {};
      }
    }

    // Log para debug: MP envía la info en query, en body, o en ambos. Distintos
    // formatos según la integración: viejo (topic+id), nuevo (type+data.id), v2 con body JSON.
    // console.log("[MP WEBHOOK] query:", JSON.stringify(req.query), "body:", JSON.stringify(req.body));
    // ↑ Comentado: req.body es un Buffer y se logueaba como {"type":"Buffer","data":[...]} (ilegible).
    //   Se reemplaza por el log de abajo que muestra el body ya parseado.
    console.log("[MP WEBHOOK] query:", JSON.stringify(req.query), "body:", JSON.stringify(body));

    // Tipo: aceptar "type" (nuevo) o "topic" (viejo) de query o body
    // const type = req.query.type || req.query.topic || req.body?.type || req.body?.topic;
    // ↑ Comentado: usaba req.body (Buffer) — los campos del body nunca se leían. Ahora usa `body` parseado.
    const type = req.query.type || req.query.topic || body?.type || body?.topic;

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
    // const paymentId = req.query["data.id"]
    //                || req.query.data?.id
    //                || req.query.id
    //                || req.body?.data?.id
    //                || req.body?.id;
    // ↑ Comentado: req.body era un Buffer, así que body.data.id / body.id nunca se leían.
    //   Ahora se usa el `body` parseado a JSON al inicio del handler.
    const paymentId = req.query["data.id"]
                   || req.query.data?.id
                   || req.query.id
                   || body?.data?.id
                   || body?.id;

    if (!paymentId) {
      console.log("[MP WEBHOOK] paymentId no encontrado, ignorando");
      return res.sendStatus(200);
    }

    // Validar la firma de MercadoPago (solo si MP_WEBHOOK_SECRET está configurado).
    // sigResult: true = firma OK | false = firma inválida (rechazar) | null = no configurado (procesar igual).
    const sigResult = verifyMpSignature(req);
    if (sigResult === false) {
      console.warn("[MP WEBHOOK] firma x-signature inválida — se ignora la notificación");
      return res.sendStatus(401);
    }
    if (sigResult === null) {
      console.warn("[MP WEBHOOK] MP_WEBHOOK_SECRET no configurado; se procesa el webhook SIN validar firma");
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

    // FIX idempotencia: MercadoPago puede enviar la MISMA notificación varias veces
    // (reintentos si tarda la respuesta, eventos payment.updated duplicados, etc.).
    // Antes, cada webhook "approved" repetido volvía a descontar el stock y re-enviaba
    // los emails (doble descuento de stock por una sola venta). Ahora consultamos el
    // estado previo de la orden: si ya estaba APPROVED, actualizamos los datos de MP
    // pero NO repetimos el descuento ni los emails.
    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });
    if (!existingOrder) {
      console.log("[MP WEBHOOK] orden no encontrada:", orderId);
      return res.sendStatus(200);
    }
    const wasAlreadyApproved = existingOrder.status === "APPROVED";

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
    // if (newStatus === "APPROVED") {
    // ↑ Comentado: sin el chequeo de estado previo, un webhook repetido descontaba stock de nuevo.
    if (newStatus === "APPROVED" && !wasAlreadyApproved) {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { product: true } }, coupon: true },
      });

      if (order) {
        for (const item of order.items) {
          // FIX variantes: si el ítem tiene variante, el stock vive en la VARIANTE, no en el
          // producto base. Antes este loop descontaba siempre del producto base, así que en
          // pagos por MercadoPago la variante nunca perdía stock (y el producto base perdía
          // stock que no correspondía). Mismo criterio que updateOrderStatus en order.controller.
          if (item.variantId) {
            const variant = await prisma.productVariant.findUnique({ where: { id: item.variantId } });
            if (variant && !variant.stockUnlimited) {
              await prisma.productVariant.update({
                where: { id: item.variantId },
                data: { stock: Math.max(0, variant.stock - item.quantity) },
              });
            }
            continue;
          }

          // Producto sin variante: descontar del stock base (comportamiento original).
          // Los ilimitados no se tocan: antes se les descontaba igual y el número quedaba
          // negativo/confuso en el admin aunque no afectara la venta.
          const baseProduct = await prisma.product.findUnique({ where: { id: item.productId } });
          if (!baseProduct || baseProduct.stockUnlimited) continue;

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

        // Registrar el uso del cupón AHORA que el pago está confirmado (no al crear la orden).
        // Antes el uso se registraba al crear la orden y un pago rechazado/abandonado igual consumía
        // el cupón (los de un solo uso quedaban inutilizables). Idempotente: el findFirst evita
        // duplicar el registro si MercadoPago reenvía el webhook.
        if (order.couponId) {
          try {
            const already = await prisma.couponUsage.findFirst({ where: { orderId: order.id } });
            if (!already) {
              await prisma.couponUsage.create({
                data: {
                  couponId:      order.couponId,
                  orderId:       order.id,
                  customerEmail: (order.customerEmail || "").toLowerCase(),
                },
              });
            }
          } catch (err) { console.error("[WEBHOOK] Error registrando uso de cupón:", err.message); }
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

    // Mismo guard que createPreference: una cotización con ítems en USD no se puede cobrar por MP.
    // Este es el camino MÁS expuesto de los dos — los mayoristas sí pueden tener ítems en dólares
    // (siguen yendo por COTIZACION, el gating de A_CONVENIR no les aplica), así que sin este
    // chequeo la cotización se pagaba por el total en pesos con los dólares contados 1:1.
    // En PayQuotation.jsx ya se avisa al cliente, pero eso es solo la UI: el bloqueo va acá.
    const blockedReason = mpPaymentBlockedReason(order);
    if (blockedReason) {
      return res.status(400).json({ error: blockedReason });
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

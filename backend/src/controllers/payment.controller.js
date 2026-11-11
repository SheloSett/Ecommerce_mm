const crypto = require("crypto");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");
const { sendOrderNotificationToAdmin, sendOrderConfirmationToCustomer } = require("../services/email.service");
const { removeOrderedItemsFromCart } = require("../utils/cartCleanup");
const { customerFromToken } = require("../middleware/auth.middleware");
const { reportError } = require("../services/errorAlerts.service");
// Meta (Facebook / Instagram): aviso de compra a la API de conversiones al aprobarse el pago
const { sendPurchaseEvent } = require("../services/meta.service");
// Todo cambio de stock pasa por services/stock.service.js (ver ahí el porqué).
const stockService = require("../services/stock.service");
const { adjustStock, syncProductVisibility, sortUnits, REASONS } = stockService;

const prisma = require("../lib/prisma"); // cliente único (ver lib/prisma.js)

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

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Ítems de la preferencia de MP. Tienen que sumar EXACTAMENTE order.total, que ya trae el cupón, el
// descuento del vendedor y el IVA. Antes se mandaba precio × cantidad de cada ítem: con cupón se le
// cobraba de más al cliente y una cotización con factura se cobraba sin el IVA. Si la suma de los
// ítems ya da el total, van los ítems (MP los muestra en su checkout); si no, una sola línea con el
// total del pedido. Los ítems libres o de productos borrados (sin product) usan su nombre guardado.
function mpItemsFor(order) {
  const items = order.items.map((item) => ({
    id:          String(item.product?.id ?? item.productId ?? `item-${item.id}`),
    title:       item.product?.name || item.productName || "Producto",
    quantity:    item.quantity,
    unit_price:  item.price,
    currency_id: "ARS",
  }));
  // El envío va como una línea más, para que el cliente vea en MP qué está pagando.
  if (order.shippingCost > 0) {
    items.push({ id: "envio", title: "Envío", quantity: 1, unit_price: order.shippingCost, currency_id: "ARS" });
  }
  const sum = round2(items.reduce((s, i) => s + i.unit_price * i.quantity, 0));
  if (Math.abs(sum - round2(order.total)) < 0.01) return items;
  return [{
    id:          `pedido-${order.id}`,
    title:       `Pedido #${order.id} - IGWT Store`,
    quantity:    1,
    unit_price:  round2(order.total),
    currency_id: "ARS",
  }];
}

// Estados desde los que un pago aprobado de MP puede aprobar el pedido. REJECTED entra porque el
// cliente puede reintentar con el mismo link después de un rechazo. CANCELLED no: si el admin lo
// canceló (y devolvió el stock), un pago que llega después lo tiene que mirar él.
const MP_PAYABLE_STATUSES = ["PENDING", "QUOTE_APPROVED", "PAYMENT_REVIEW", "REJECTED"];

// ¿Este pago aprobado cubre este pedido? null si sí; si no, el motivo (para el log).
// Antes se aprobaba con solo ver "approved" y el número de pedido: pagando el link viejo de $100 de
// una cotización que después se agrandó a $5.000.000, o un pedido ya cancelado, quedaba Abonado y
// se descontaba todo el stock. Margen de $1 por redondeos.
function approvalMismatch(payment, order) {
  if (!MP_PAYABLE_STATUSES.includes(order.status)) return `el pedido estaba ${order.status}`;
  if (payment.currency_id !== "ARS") return `el pago es en ${payment.currency_id}`;
  const paid = Number(payment.transaction_amount);
  if (!Number.isFinite(paid) || Math.abs(paid - Number(order.total)) >= 1) {
    return `se pagaron $${payment.transaction_amount} y el pedido es de $${order.total}`;
  }
  return null;
}

// Lo que se revisa en la base antes de aprobar un pago de MP (además de approvalMismatch). Devuelve el
// motivo para mandarlo a "Revisión de pago", o null si se puede aprobar.
//  - Cupón (P6 de la auditoría): el uso se registra recién al aprobar, así que al crear el pedido no se
//    ven los pedidos que todavía no se pagaron. Armando varios pedidos con un cupón de 1 uso antes de
//    pagar el primero, se pagaban todos con descuento. Acá se cuenta lo ya aprobado.
//  - Stock (P10): crear el pedido no reserva nada y el link de MP no vence. Con 5 unidades, dos pedidos
//    de 5 pagados quedaban los dos aprobados y había que devolverle la plata a uno sin que nadie
//    avisara. Acá se mira si todavía alcanza. (Dos pagos en el MISMO segundo todavía podrían pasar los
//    dos; para eso haría falta reservar stock al crear el pedido.)
async function approvalBlockReason(orderId) {
  const order = await prisma.order.findUnique({
    where:   { id: orderId },
    include: { items: true, coupon: true },
  });
  if (!order) return null;

  const c = order.coupon;
  if (order.couponId && c) {
    const others = { couponId: order.couponId, orderId: { not: orderId } };
    if (c.maxUses && (await prisma.couponUsage.count({ where: others })) >= c.maxUses) {
      return `el cupón ${c.code} ya se usó las ${c.maxUses} veces permitidas`;
    }
    if (c.maxUsesPerCustomer) {
      const byCustomer = await prisma.couponUsage.count({ where: { ...others, customerEmail: (order.customerEmail || "").toLowerCase() } });
      if (byCustomer >= c.maxUsesPerCustomer) return `el cliente ya usó el cupón ${c.code} las veces permitidas`;
    }
  }

  if (!order.stockDeducted) {
    for (const item of order.items || []) {
      if (!item.productId) continue;
      if (item.variantId) {
        const v = await prisma.productVariant.findUnique({ where: { id: item.variantId } });
        if (v && !v.stockUnlimited && v.stock < item.quantity) return `no queda stock suficiente de una variante (hay ${v.stock}, el pedido lleva ${item.quantity})`;
        continue;
      }
      // Surtido viejo sin variante en un producto con variantes: su stock no se puede medir acá
      if ((await prisma.productVariant.count({ where: { productId: item.productId, active: true } })) > 0) continue;
      const p = await prisma.product.findUnique({ where: { id: item.productId } });
      if (p && !p.stockUnlimited && p.stock < item.quantity) return `no queda stock suficiente de "${p.name}" (hay ${p.stock}, el pedido lleva ${item.quantity})`;
    }
  }
  return null;
}

// Clave del pedido para la página de resultado de pago (PaymentResult): viaja en las back_urls de MP
// y la página la manda al consultar el estado. Sin clave (ni sesión del dueño) el estado responde
// solo { id, status }: antes cualquiera que probara números de pedido —son casi correlativos— veía
// el nombre del cliente, qué compró y cuánto pagó.
function orderAccessKey(orderId) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET).update(`order-status-${orderId}`).digest("hex").slice(0, 32);
}
async function hasOrderAccess(req, order) {
  const key = typeof req.query?.k === "string" ? req.query.k : "";
  const expected = orderAccessKey(order.id);
  if (key.length === expected.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected))) return true;
  // Sesión vigente del dueño (antes: customerIdFromToken, que solo miraba la firma)
  const customer = await customerFromToken(req);
  return !!customer && customer.id === order.customerId;
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

    // Solo pedidos que se pagan por Mercado Pago. Antes servía cualquier pedido PENDING, incluida una
    // cotización que el admin todavía no revisó (esas se pagan por createCotizacionPreference, una vez
    // aprobadas).
    if (order.paymentMethod !== "MERCADOPAGO") {
      return res.status(400).json({ error: "Este pedido no se paga por Mercado Pago" });
    }

    // Órdenes en dólares / "a convenir": no se pueden cobrar por MP (ver mpPaymentBlockedReason).
    const blockedReason = mpPaymentBlockedReason(order);
    if (blockedReason) {
      return res.status(400).json({ error: blockedReason });
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    // Construir los items para la preferencia de MercadoPago: suman el total del pedido (ver mpItemsFor).
    // Antes: order.items.map((item) => ({ id: item.product.id.toString(), title: item.product.name,
    //   quantity: item.quantity, unit_price: item.price, currency_id: "ARS" }))
    const mpItems = mpItemsFor(order);
    const accessKey = orderAccessKey(order.id);

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
      // back_urls y auto_return solo en producción: MP rechaza localhost.
      // k = clave del pedido para ver su detalle en la página de resultado (ver orderAccessKey).
      ...(isPublicFrontend && {
        back_urls: {
          success: `${frontendUrl}/pago/exitoso?orderId=${order.id}&k=${accessKey}`,
          failure: `${frontendUrl}/pago/fallido?orderId=${order.id}&k=${accessKey}`,
          pending: `${frontendUrl}/pago/pendiente?orderId=${order.id}&k=${accessKey}`,
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

// Pasa el pedido a APPROVED solo si todavía no lo estaba, en UNA operación de la base. El aviso de MP
// (webhook) y la consulta desde la pantalla de resultado pueden llegar a la vez, y MP a veces manda
// el mismo aviso dos veces: antes cada uno leía "pendiente" por su lado, los dos aprobaban y el
// stock se descontaba dos o tres veces. Devuelve true solo para el que lo aprobó, que es el único
// que después corre applyMpApproval.
async function claimApproval(orderId, paymentId, mpStatus) {
  const { count } = await prisma.order.updateMany({
    where: { id: orderId, status: { not: "APPROVED" } },
    data:  { status: "APPROVED", mpPaymentId: String(paymentId), mpStatus },
  });
  return count === 1;
}

// Todo lo que pasa cuando MP aprueba un pago: descontar stock, registrar el cupón, limpiar el carrito,
// avisar a Meta y mandar los emails. Lo usan el webhook y la consulta de la pantalla de resultado,
// siempre después de ganar claimApproval. Antes cada camino tenía su copia y la de la pantalla de
// resultado no registraba el cupón ni mandaba los emails.
async function applyMpApproval(orderId, paymentId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } }, coupon: true },
  });
  if (!order) return;

  // stockDeducted: la orden ya tiene el stock descontado por otro camino — una venta manual
  // (descuenta al registrarse) o una cotización vieja, de cuando reservaban stock al crearse.
  // Sin este chequeo se descontaba dos veces. Una cotización de ahora llega con esto en false:
  // no reserva nada, así que su stock sale acá, al confirmarse el pago.
  if (order.stockDeducted) {
    console.log(`[MP] Orden #${orderId}: el stock ya estaba descontado, no se toca`);
  } else {
    // El descuento se reclama con stockDeducted en UNA operación con condición, igual que el "Abonado"
    // del panel (updateOrderStatus), y va en la misma transacción que todos los movimientos. Antes se
    // decidía con la lectura de arriba y la marca se ponía al final: si el admin marcaba el pedido
    // abonado justo cuando llegaba el pago, los dos descontaban.
    // Cada línea pasa por el servicio de stock: no baja de 0, no toca los ilimitados y queda en el
    // historial con el número de pedido. Siempre en el mismo orden, y la publicación se decide al final.
    const ref = { type: "order", id: orderId };
    const claimed = await stockService.transaction(async (tx) => {
      const { count } = await tx.order.updateMany({ where: { id: orderId, stockDeducted: false }, data: { stockDeducted: true } });
      if (count !== 1) return false;

      const touched = new Set();
      for (const item of sortUnits(order.items)) {
        // Ítems libres (productId null): no existen en el catálogo, no hay stock que descontar.
        if (!item.productId) continue;
        // FIX variantes: si el ítem tiene variante, el stock vive en la VARIANTE, no en el
        // producto base. Antes este loop descontaba siempre del producto base, así que en
        // pagos por MercadoPago la variante nunca perdía stock (y el producto base perdía
        // stock que no correspondía). Mismo criterio que updateOrderStatus en order.controller.
        if (item.variantId) {
          const r = await adjustStock({ variantId: item.variantId, delta: -item.quantity, reason: REASONS.VENTA, ref, actor: "Mercado Pago", tx, visibility: "none" });
          if (r.ok) touched.add(r.productId);
          continue;
        }

        // Línea sin variante de un producto CON variantes (surtido de una cotización, repartido entre
        // variantes al aprobarla): su stock vive en las variantes y el del producto es 0. Antes se
        // descontaba igual de ese 0 y el producto se DESPUBLICABA aunque sus variantes tuvieran
        // unidades. Mismo criterio que updateOrderStatus (order.controller.js).
        const variantCount = await tx.productVariant.count({ where: { productId: item.productId, active: true } });
        if (variantCount > 0) continue;

        // Producto sin variante: descontar del stock base (nunca baja de 0).
        // Antes: decrement (podía quedar negativo un instante) y después stock: 0 + active: false.
        const r = await adjustStock({ productId: item.productId, delta: -item.quantity, reason: REASONS.VENTA, ref, actor: "Mercado Pago", tx, visibility: "none" });
        if (r.ok) touched.add(item.productId);
      }
      // Si quedó sin nada para vender (el producto, o su última variante con stock), se despublica.
      // Antes, con variante, acá no se miraba la publicación y quedaba publicado sin stock.
      for (const pid of [...touched].sort((a, b) => a - b)) {
        await syncProductVisibility(pid, tx);
      }
      return true;
    });
    if (!claimed) console.log(`[MP] Orden #${orderId}: el stock ya lo descontó otro camino (el panel), no se toca`);
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
    } catch (err) { console.error("[MP] Error registrando uso de cupón:", err.message); }
  }

  // Lo comprado sale del carrito del cliente acá, cuando el pago se aprueba, y no en el
  // navegador: MP a veces devuelve al cliente en otro navegador (sin su sesión) y el carrito
  // quedaba cargado. Ver utils/cartCleanup.js.
  await removeOrderedItemsFromCart(prisma, order.id);

  // Meta: Purchase a la API de conversiones (si está configurada). El navegador manda el mismo
  // evento con el mismo event_id al volver de MercadoPago; Meta lo cuenta una sola vez.
  sendPurchaseEvent(order.id).catch(() => {});

  // Emails: notificar al admin con el ID de pago de MP (para buscar el comprobante en su cuenta)
  // y enviar confirmación al cliente. Si fallan no se corta nada (el pago ya está registrado).
  try {
    await sendOrderNotificationToAdmin({ ...order, mpPaymentId: String(paymentId) });
  } catch (err) { console.error("[MP] Error enviando email al admin:", err.message); }
  try {
    await sendOrderConfirmationToCustomer({ ...order, mpPaymentId: String(paymentId) });
  } catch (err) { console.error("[MP] Error enviando email al cliente:", err.message); }
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
      // Devolución, contracargo o reclamo: "Revisión de pago" para que el admin decida. Antes caían en
      // el default PENDING y un pedido cobrado (o devuelto) quedaba figurando "Pendiente", sin ninguna
      // pista y con la posibilidad de generarle otro link de pago. El stock NO se mueve solo: la
      // mercadería pudo haberse entregado.
      refunded:     "PAYMENT_REVIEW",
      charged_back: "PAYMENT_REVIEW",
      in_mediation: "PAYMENT_REVIEW",
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
      // Antes: select: { id: true, status: true }
      select: { id: true, status: true, mpPaymentId: true, total: true },
    });
    if (!existingOrder) {
      console.log("[MP WEBHOOK] orden no encontrada:", orderId);
      return res.sendStatus(200);
    }
    const wasAlreadyApproved = existingOrder.status === "APPROVED";

    // Un pedido ya aprobado no se baja por el aviso de OTRO intento de pago. Un mismo pedido puede
    // tener varios intentos (ej. uno abandonado o rechazado en una pestaña y otro aprobado en otro
    // navegador) y MP avisa de todos, en cualquier orden: antes el aviso del rechazado, si llegaba
    // después, pasaba a REJECTED un pedido cobrado. El aviso del mismo pago aprobado (reintentos,
    // devoluciones) se sigue procesando como siempre.
    if (wasAlreadyApproved && newStatus !== "APPROVED" && existingOrder.mpPaymentId !== paymentId.toString()) {
      console.log(`[MP WEBHOOK] Orden #${orderId} ya aprobada (pago ${existingOrder.mpPaymentId}): se ignora el pago ${paymentId} (${payment.status})`);
      return res.sendStatus(200);
    }

    // Un pago aprobado que no cubre el pedido (otro monto, otra moneda, pedido cancelado) no lo
    // aprueba: queda en "Revisión de pago", sin tocar stock ni mandar emails, marcado como nuevo
    // para que el admin lo vea y decida (aprobarlo a mano o devolver la plata). Ver approvalMismatch.
    if (newStatus === "APPROVED" && !wasAlreadyApproved) {
      // Antes: const mismatch = approvalMismatch(payment, existingOrder);
      const mismatch = approvalMismatch(payment, existingOrder) || await approvalBlockReason(orderId);
      if (mismatch) {
        console.warn(`[MP WEBHOOK] Orden #${orderId}: pago ${paymentId} aprobado pero no coincide (${mismatch}) → Revisión de pago`);
        reportError("Mercado Pago", `Pedido #${orderId}: pago aprobado que quedó en Revisión de pago`, `Motivo: ${mismatch}. Revisalo en el panel y aprobalo a mano o devolvé la plata.`);
        await prisma.order.update({
          where: { id: orderId },
          data:  { status: "PAYMENT_REVIEW", mpPaymentId: paymentId.toString(), mpStatus: payment.status, seenByAdmin: false },
        });
        return res.sendStatus(200);
      }
    }

    // Si el pago fue aprobado: pasar a APPROVED y, solo si este aviso fue el que lo aprobó, descontar
    // stock, registrar el cupón, mandar los emails, etc. (ver claimApproval y applyMpApproval).
    // if (newStatus === "APPROVED") {
    // ↑ Comentado: sin el chequeo de estado previo, un webhook repetido descontaba stock de nuevo.
    if (newStatus === "APPROVED" && !wasAlreadyApproved) {
      if (await claimApproval(orderId, paymentId, payment.status)) {
        await applyMpApproval(orderId, paymentId);
      }
    } else {
      // Actualizar la orden con el resultado del pago
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: newStatus,
          mpPaymentId: paymentId.toString(),
          mpStatus: payment.status,
          // Un pedido a revisar se marca como nuevo para que el admin lo vea en el panel
          ...(newStatus === "PAYMENT_REVIEW" ? { seenByAdmin: false } : {}),
        },
      });
      if (["refunded", "charged_back", "in_mediation"].includes(payment.status)) {
        reportError("Mercado Pago", `Pedido #${orderId}: el pago ${paymentId} quedó "${payment.status}" (devolución, contracargo o reclamo)`,
          "El pedido pasó a Revisión de pago. El stock no se tocó: revisalo y decidí a mano.");
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
        // Lo que necesita el Pixel de Meta para el evento Purchase en el navegador (PaymentResult).
        totalUsd: true,
        customerType: true,
        items: { select: { productId: true, variantId: true, quantity: true, price: true, currency: true } },
        // Para decidir si quien pregunta puede ver el detalle (ver hasOrderAccess). No se devuelve.
        customerId: true,
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
          // Si alguno de los intentos de pago está aprobado, ese manda: un pedido puede tener un
          // intento rechazado o abandonado más nuevo que el aprobado (ej. pagó en otro navegador).
          // Antes: el más reciente, aunque fuera el rechazado. Si no hay aprobado, el más reciente.
          payment = results.find((p) => p.status === "approved")
            || results.sort((a, b) => new Date(b.date_created) - new Date(a.date_created))[0]
            || null;
        }

        if (payment && payment.external_reference === orderId.toString()) {
          const statusMap = {
            approved:   "APPROVED",
            rejected:   "REJECTED",
            cancelled:  "CANCELLED",
            pending:    "PENDING",
            in_process: "PENDING",
            // Devolución, contracargo o reclamo: ver el statusMap del webhook
            refunded:     "PAYMENT_REVIEW",
            charged_back: "PAYMENT_REVIEW",
            in_mediation: "PAYMENT_REVIEW",
          };
          // Antes: const newStatus = statusMap[payment.status] || order.status;
          let newStatus = statusMap[payment.status] || order.status;
          // Mismo control que el webhook: un pago aprobado que no cubre el pedido lo deja en
          // "Revisión de pago" en vez de aprobarlo (ver approvalMismatch).
          if (newStatus === "APPROVED" && order.status !== "APPROVED") {
            // Antes: const mismatch = approvalMismatch(payment, order);
            const mismatch = approvalMismatch(payment, order) || await approvalBlockReason(orderIdInt);
            if (mismatch) {
              console.warn(`[MP SYNC] Orden #${orderIdInt}: pago ${payment.id} aprobado pero no coincide (${mismatch}) → Revisión de pago`);
              newStatus = "PAYMENT_REVIEW";
            }
          }

          if (newStatus !== order.status) {
            console.log(`[MP SYNC] Orden #${orderIdInt}: ${order.status} → ${newStatus} (payment ${payment.id})`);
            if (newStatus === "APPROVED") {
              // Mismo camino que el webhook. Antes este lado descontaba stock pero NO registraba el
              // cupón ni mandaba los emails: si el cliente volvía de MP antes que el aviso, el pedido
              // quedaba aprobado sin email al admin ni al cliente y con el cupón sin contar.
              if (await claimApproval(orderIdInt, payment.id, payment.status)) {
                await applyMpApproval(orderIdInt, payment.id);
              }
            } else {
              await prisma.order.update({
                where: { id: orderIdInt },
                data:  {
                  status:      newStatus,
                  mpPaymentId: payment.id.toString(),
                  mpStatus:    payment.status,
                  // Un pago a revisar se marca como nuevo para que el admin lo vea en el panel.
                  ...(newStatus === "PAYMENT_REVIEW" ? { seenByAdmin: false } : {}),
                },
              });
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

    // Detalle (nombre, total, productos) solo con la clave del pedido o la sesión de su dueño; si no,
    // solo el estado. Ver orderAccessKey. Antes: res.json(order) para cualquiera.
    const { customerId: _owner, ...publicOrder } = order;
    if (!(await hasOrderAccess(req, order))) {
      return res.json({ id: order.id, status: order.status });
    }
    res.json(publicOrder);
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

    // Usar los items reales de la orden (el admin puede haber ajustado cantidades/precios), sumando
    // el total del pedido: descuento del vendedor, cupón e IVA de la factura (ver mpItemsFor).
    // Antes: order.items.map((item) => ({ id: item.product.id.toString(), title: item.product.name,
    //   quantity: item.quantity, unit_price: item.price, currency_id: "ARS" }))
    const mpItems = mpItemsFor(order);
    const accessKey = orderAccessKey(order.id);

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
          success: `${frontendUrl}/pago/exitoso?orderId=${order.id}&k=${accessKey}`,
          failure: `${frontendUrl}/pago/fallido?orderId=${order.id}&k=${accessKey}`,
          pending: `${frontendUrl}/pago/pendiente?orderId=${order.id}&k=${accessKey}`,
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

// Emails masivos (Admin → Emails): emails escritos por el admin y avisos de campañas de ofertas.
//
// COLA: crear un envío solo guarda un EmailRecipient PENDING por destinatario. El cron
// (processEmailQueue, cada minuto) los manda de a PER_TICK, sin pasar el tope diario
// (SiteConfig "emailDailyLimit"). Por qué no se manda todo de una:
//   - Gmail permite ~500 destinatarios por día y corta (o manda a spam) si se pasa o si recibe
//     ráfagas grandes. Lo que no entra hoy sale solo mañana.
//   - Si el servidor se reinicia a mitad de un envío, lo pendiente sigue PENDING y lo ya mandado
//     queda SENT: no se pierde ni se duplica nada.
//
// BAJA: todos estos emails llevan un link para darse de baja de las promociones
// (Customer.unsubscribeMarketing) y el header List-Unsubscribe (Gmail muestra "Anular suscripción").
// Los envíos a un público (todos / minoristas / mayoristas) saltean a los dados de baja; el envío a
// clientes elegidos uno por uno es un mensaje directo y les llega igual.

const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { offerState } = require("./offers.service");
const { createBulkTransporter } = require("./email.service");
const { buildCustomEmail, buildPlainEmail, buildOfferEmail, buildPlainOfferEmail } = require("./broadcast.templates");
const { AVAILABLE_STOCK_FILTER } = require("../utils/stockFilter");

const prisma = new PrismaClient();

const DAY_MS = 86400000;
const PER_TICK = 20;               // emails por minuto como máximo
const DEFAULT_DAILY_LIMIT = 400;   // Gmail: ~500/día; se deja margen para pedidos, recomendaciones, etc.
const AUDIENCES = ["ALL", "MINORISTA", "MAYORISTA", "SELECTED"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const storeName   = () => process.env.STORE_NAME || "IGWT Store";
const frontendUrl = () => process.env.FRONTEND_URL || "http://localhost:3000";
const backendUrl  = () => process.env.BACKEND_URL || "http://localhost:4000";

// Error con status HTTP para que el controller lo devuelva tal cual.
class BroadcastError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ── Destinatarios ─────────────────────────────────────────────────────────────

// El tipo que define precios y descuento del email: mayorista solo si está APROBADO (igual que
// resolvePriceViewer). Un mayorista pendiente recibe la versión minorista, sin precios mayoristas.
const effectiveType = (c) => (c.type === "MAYORISTA" && c.status === "APPROVED" ? "MAYORISTA" : "MINORISTA");

// Clientes → destinatarios de un público. Puro (sin base) para poder testearlo.
//   ALL / MINORISTA / MAYORISTA: sin rechazados ni dados de baja de las promociones.
//   SELECTED: los elegidos por el admin, tal cual (mensaje directo).
// Deduplica por email (sin distinguir mayúsculas) y descarta emails inválidos.
function pickRecipients(customers, audience) {
  const seen = new Set();
  const out = [];
  for (const c of customers) {
    const type = effectiveType(c);
    if (audience !== "SELECTED") {
      if (c.status === "REJECTED" || c.unsubscribeMarketing) continue;
      if (audience === "MINORISTA" && type !== "MINORISTA") continue;
      if (audience === "MAYORISTA" && type !== "MAYORISTA") continue;
    }
    const email = String(c.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ customerId: c.id, email, name: c.name || "", type });
  }
  return out;
}

const CUSTOMER_SELECT = { id: true, name: true, email: true, type: true, status: true, unsubscribeMarketing: true };

async function resolveRecipients(audience, customerIds = []) {
  const where = audience === "SELECTED" ? { id: { in: customerIds } } : {};
  const customers = await prisma.customer.findMany({ where, select: CUSTOMER_SELECT, orderBy: { id: "asc" } });
  return pickRecipients(customers, audience);
}

// Cuántos lo recibirían y cuántos quedan afuera por estar dados de baja (para el formulario).
async function audienceStats(audience) {
  const customers = await prisma.customer.findMany({ select: CUSTOMER_SELECT });
  const count = pickRecipients(customers, audience).length;
  const unsubscribed = pickRecipients(customers.map((c) => ({ ...c, unsubscribeMarketing: false })), audience).length - count;
  return { count, unsubscribed: Math.max(0, unsubscribed) };
}

// ── Link de baja ──────────────────────────────────────────────────────────────
// HMAC del id: no hace falta guardarlo y nadie puede dar de baja a otro cambiando el id.
function marketingUnsubscribeToken(customerId) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET).update(`unsubscribe-marketing-${customerId}`).digest("hex");
}
function verifyMarketingUnsubscribeToken(customerId, token) {
  const expected = Buffer.from(marketingUnsubscribeToken(customerId));
  const got = Buffer.from(String(token || ""));
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}
function unsubscribeUrls(customerId) {
  const q = `id=${customerId}&token=${marketingUnsubscribeToken(customerId)}`;
  return {
    page:     `${frontendUrl()}/desuscribirse?${q}`,                          // link del pie del email
    oneClick: `${backendUrl()}/api/customers/unsubscribe/marketing?${q}`,    // header List-Unsubscribe
  };
}

// ── Crear envíos ──────────────────────────────────────────────────────────────

// Valida y normaliza lo que manda el formulario de "Enviar email". Devuelve { data } o { error }.
function validateCustomPayload(body) {
  const subject = String(body.subject || "").trim();
  const text = String(body.body || "").trim();
  const title = String(body.title || "").trim();
  const buttonText = String(body.buttonText || "").trim();
  const buttonUrl = String(body.buttonUrl || "").trim();
  if (!subject) return { error: "Falta el asunto" };
  if (subject.length > 150) return { error: "El asunto es demasiado largo (máximo 150 caracteres)" };
  if (!text) return { error: "Falta el mensaje" };
  if (text.length > 10000) return { error: "El mensaje es demasiado largo" };
  if (buttonText && !/^https?:\/\/\S+$/i.test(buttonUrl)) return { error: "El link del botón tiene que empezar con http:// o https://" };
  return {
    data: {
      subject, title: title || null, body: text,
      buttonText: buttonText || null, buttonUrl: buttonText ? buttonUrl : null,
    },
  };
}

// recipients: opcional, ya resueltos (el aviso a clientes elegidos los filtra antes por público).
async function createBroadcast({ kind, audience, customerIds = [], offerId = null, createdBy = null, content, recipients: given = null }) {
  if (!AUDIENCES.includes(audience)) throw new BroadcastError(400, "Destinatarios inválidos");
  if (audience === "SELECTED" && customerIds.length === 0 && !given) throw new BroadcastError(400, "Elegí al menos un cliente");
  const recipients = given || (await resolveRecipients(audience, customerIds));
  if (recipients.length === 0) throw new BroadcastError(400, "No hay ningún cliente para mandarle este email");

  return prisma.$transaction(async (tx) => {
    const broadcast = await tx.emailBroadcast.create({
      data: { kind, audience, offerId, createdBy, total: recipients.length, ...content },
    });
    await tx.emailRecipient.createMany({
      data: recipients.map((r) => ({ ...r, broadcastId: broadcast.id })),
    });
    return broadcast;
  });
}

// Formato de los avisos de campaña (Admin → Emails → Avisos de campañas), en SiteConfig
// "emailOfferFormat": PLAIN = simple, como un mensaje personal (por defecto: más chances de llegar a
// Principal en Gmail, donde el celular avisa) | DESIGN = con encabezado de color, fotos y precios.
async function getOfferFormat() {
  const row = await prisma.siteConfig.findUnique({ where: { key: "emailOfferFormat" } });
  return row?.value === "DESIGN" ? "DESIGN" : "PLAIN";
}
async function setOfferFormat(format) {
  const value = format === "DESIGN" ? "DESIGN" : "PLAIN";
  await prisma.siteConfig.upsert({ where: { key: "emailOfferFormat" }, update: { value }, create: { key: "emailOfferFormat", value } });
}
// kind del envío: OFFER (con diseño) u OFFER_PLAIN (simple)
const offerKind = async () => ((await getOfferFormat()) === "DESIGN" ? "OFFER" : "OFFER_PLAIN");
const isOfferKind = (kind) => kind === "OFFER" || kind === "OFFER_PLAIN";
// Formatos simples: van sin el header List-Unsubscribe (Gmail lo usa para detectar newsletters y
// mandarlas a Promociones). El link de baja sigue en el texto del email, como pide la ley.
const isPlainKind = (kind) => kind === "PLAIN" || kind === "OFFER_PLAIN";

// Público del aviso según a quién aplica la campaña.
const offerAudience = (offer) => (offer.appliesTo === "AMBOS" ? "ALL" : offer.appliesTo);

// Aviso de una campaña. Solo con la campaña ACTIVA (antes de empezar los productos no tienen el
// descuento) y una sola vez, salvo force (el admin confirma que quiere mandarlo de nuevo).
async function announceOffer(offerId, { createdBy = null, force = false } = {}) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer) throw new BroadcastError(404, "Campaña no encontrada");
  if (offerState(offer) !== "ACTIVA") throw new BroadcastError(400, "Solo se puede avisar una campaña activa (vigente y sin pausar)");
  if (offer.announcedAt && !force) throw new BroadcastError(409, "Esta campaña ya se avisó por email");

  // "Reservar" el aviso con un update condicional: si el cron y el admin avisan a la vez, solo uno
  // lo consigue y el otro recibe el 409 en vez de mandar el email dos veces.
  const claimed = await prisma.offer.updateMany({
    where: { id: offerId, ...(force ? {} : { announcedAt: null }) },
    data: { announcedAt: new Date() },
  });
  if (claimed.count === 0) throw new BroadcastError(409, "Esta campaña ya se avisó por email");

  try {
    return await createBroadcast({
      kind: await offerKind(), audience: offerAudience(offer), offerId, createdBy,
      content: { subject: offer.name },
    });
  } catch (err) {
    // Sin destinatarios (o cualquier error): se libera el aviso para poder intentarlo de nuevo.
    await prisma.offer.update({ where: { id: offerId }, data: { announcedAt: offer.announcedAt } });
    throw err;
  }
}

// Destinatarios a los que una campaña les sirve: una "solo mayorista" no tiene descuento que mostrarle
// a un minorista (el email saldría sin descuento ni productos), y al revés. Puro, para testearlo.
function recipientsForOffer(recipients, appliesTo) {
  if (appliesTo === "MAYORISTA") return recipients.filter((r) => r.type === "MAYORISTA");
  if (appliesTo === "MINORISTA") return recipients.filter((r) => r.type === "MINORISTA");
  return recipients;
}

// Aviso de una campaña a clientes elegidos uno por uno (pedido del cliente: "¿no puedo elegir a una
// persona en específico?"). No marca la campaña como avisada: el aviso general sigue disponible.
// Devuelve { broadcast, skipped } — skipped = elegidos a los que la campaña no aplica.
async function sendOfferTo(offerId, customerIds, { createdBy = null } = {}) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer) throw new BroadcastError(404, "Campaña no encontrada");
  if (offerState(offer) !== "ACTIVA") throw new BroadcastError(400, "Solo se puede mandar una campaña activa (vigente y sin pausar)");
  if (!customerIds.length) throw new BroadcastError(400, "Elegí al menos un cliente");

  const chosen = await resolveRecipients("SELECTED", customerIds);
  const recipients = recipientsForOffer(chosen, offer.appliesTo);
  if (recipients.length === 0) {
    throw new BroadcastError(400, offer.appliesTo === "MAYORISTA"
      ? "La campaña es solo para mayoristas aprobados y ninguno de los elegidos lo es"
      : "La campaña es solo para minoristas y los elegidos son mayoristas");
  }
  const broadcast = await createBroadcast({
    kind: await offerKind(), audience: "SELECTED", offerId, createdBy, recipients,
    content: { subject: offer.name },
  });
  return { broadcast, skipped: chosen.length - recipients.length };
}

// Cron: las campañas con "Avisar por email" que ya empezaron y todavía no se avisaron. Se espera a
// que el cron de campañas haya escrito los precios (applied) para que el email muestre los
// productos con el descuento.
async function announceStartedOffers() {
  const now = new Date();
  const due = await prisma.offer.findMany({
    where: { emailAnnounce: true, announcedAt: null, active: true, applied: true, startsAt: { lte: now }, endsAt: { gt: now } },
    select: { id: true, name: true },
  });
  for (const o of due) {
    try {
      const b = await announceOffer(o.id);
      console.log(`[EMAIL] Aviso de la campaña "${o.name}" en cola para ${b.total} cliente(s)`);
    } catch (err) {
      if (err.status !== 409) console.error(`[EMAIL] No se pudo avisar la campaña ${o.id}:`, err.message);
    }
  }
}

// ── Armado de cada email ──────────────────────────────────────────────────────

// Campaña + sus productos con descuento para un público. null si la campaña ya no está activa.
async function offerEmailData(offerId, side, { allowInactive = false } = {}) {
  if (!offerId) return null;
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: { items: { select: { productId: true, discountValue: true, wholesaleDiscountValue: true } } },
  });
  if (!offer || (!allowInactive && offerState(offer) !== "ACTIVA")) return null;

  const type = side === "wholesale" ? "MAYORISTA" : "MINORISTA";
  const products = await prisma.product.findMany({
    where: {
      id: { in: offer.items.map((i) => i.productId) },
      active: true,
      visibility: { in: ["AMBOS", type] },
      ...(side === "wholesale" ? { wholesaleSalePrice: { not: null } } : { salePrice: { not: null } }),
      ...AVAILABLE_STOCK_FILTER,
    },
    select: {
      id: true, name: true, images: true, currency: true, price: true, salePrice: true,
      ...(side === "wholesale" ? { wholesalePrice: true, wholesaleSalePrice: true } : {}),
    },
  });
  // Solo los que de verdad quedaron con descuento para este público, el mayor descuento primero.
  const pct = (p) => (side === "wholesale" ? 1 - p.wholesaleSalePrice / p.wholesalePrice : 1 - p.salePrice / p.price);
  const withDiscount = products
    .filter((p) => (side === "wholesale" ? p.wholesalePrice && p.wholesaleSalePrice < p.wholesalePrice : p.salePrice < p.price))
    .sort((a, b) => pct(b) - pct(a));
  return { offer, products: withDiscount };
}

const emailCtx = (unsubscribeUrl) => ({
  storeName: storeName(), frontendUrl: frontendUrl(), backendUrl: backendUrl(), unsubscribeUrl,
});

// { subject, html } de un envío para un destinatario. cache: Map compartido en la tanda para no
// consultar la campaña una vez por email.
// Tipos de envío: OFFER (aviso de campaña), CUSTOM (escrito por el admin, con diseño) y PLAIN
// (escrito por el admin, formato simple como un email personal: más chances de llegar a Principal).
const CUSTOM_KINDS = ["CUSTOM", "PLAIN"];

// ¿Es un mensaje directo? El email escrito en formato simple a clientes elegidos uno por uno no es
// publicidad masiva: va sin link de baja ni header List-Unsubscribe, que Gmail usa para detectar
// newsletters y mandarlas a Promociones.
const isDirectMessage = (broadcast) => broadcast.kind === "PLAIN" && broadcast.audience === "SELECTED";

async function renderFor(broadcast, recipient, cache = new Map(), { preview = false } = {}) {
  const unsubscribeUrl = isDirectMessage(broadcast)
    ? ""
    : recipient.customerId ? unsubscribeUrls(recipient.customerId).page : `${frontendUrl()}/desuscribirse`;
  const ctx = emailCtx(unsubscribeUrl);
  if (isOfferKind(broadcast.kind)) {
    const side = recipient.type === "MAYORISTA" ? "wholesale" : "retail";
    const key = `${broadcast.offerId}:${side}:${preview}`;
    if (!cache.has(key)) cache.set(key, await offerEmailData(broadcast.offerId, side, { allowInactive: preview }));
    const data = cache.get(key);
    if (!data) {
      const err = new Error("La campaña terminó, se pausó o se borró antes de que se mandaran todos los avisos");
      err.code = "OFFER_GONE";
      throw err;
    }
    if (broadcast.kind === "OFFER_PLAIN") return buildPlainOfferEmail(data.offer, side, recipient, ctx);
    return buildOfferEmail(data.offer, data.products, side, recipient, ctx);
  }
  if (broadcast.kind === "PLAIN") return buildPlainEmail(broadcast, recipient, ctx);
  return buildCustomEmail(broadcast, recipient, ctx);
}

// ── Cola ──────────────────────────────────────────────────────────────────────

// ¿El error es "de este destinatario" (casilla inexistente → FAILED) o "del servidor/cuenta"
// (límite de Gmail, SMTP caído, mal configurado → se pausa y se reintenta en el próximo minuto)?
function isRetryableSendError(err) {
  if (!err) return false;
  if (["NO_SMTP", "ECONNECTION", "ETIMEDOUT", "ESOCKET", "EAUTH", "EDNS", "ECONNREFUSED", "ECONNRESET"].includes(err.code)) return true;
  const text = `${err.response || ""} ${err.message || ""}`;
  if (/5\.4\.5|limit exceeded|rate limit|quota|too many/i.test(text)) return true;
  const rc = err.responseCode;
  return rc >= 400 && rc < 500;
}

function pauseReason(err) {
  if (err.code === "NO_SMTP") return "El servidor de email (SMTP) no está configurado";
  const text = `${err.response || ""} ${err.message || ""}`;
  if (/5\.4\.5|limit exceeded|quota/i.test(text)) return "Gmail alcanzó su límite diario de envíos: se sigue solo más tarde";
  if (err.code === "EAUTH") return "El servidor de email rechazó el usuario o la contraseña";
  return `No se pudo conectar con el servidor de email (${err.code || err.responseCode || "error"}): se reintenta solo`;
}

async function getDailyLimit() {
  const row = await prisma.siteConfig.findUnique({ where: { key: "emailDailyLimit" } });
  const n = parseInt(row?.value);
  return n > 0 ? n : DEFAULT_DAILY_LIMIT;
}
async function setDailyLimit(n) {
  await prisma.siteConfig.upsert({
    where: { key: "emailDailyLimit" },
    update: { value: String(n) },
    create: { key: "emailDailyLimit", value: String(n) },
  });
}
const sentLast24h = (now = new Date()) =>
  prisma.emailRecipient.count({ where: { status: "SENT", sentAt: { gt: new Date(now.getTime() - DAY_MS) } } });

let queueRunning = false;

// Cron, cada minuto. transporter: inyectable para los tests.
async function processEmailQueue({ transporter: injected } = {}) {
  if (queueRunning) return { skipped: true };
  queueRunning = true;
  let transporter = null;
  const result = { sent: 0, failed: 0, paused: null };
  try {
    const now = new Date();
    const budget = Math.min(PER_TICK, (await getDailyLimit()) - (await sentLast24h(now)));
    const batch = budget > 0
      ? await prisma.emailRecipient.findMany({
          where: { status: "PENDING", broadcast: { status: "SENDING" } },
          orderBy: [{ broadcastId: "asc" }, { id: "asc" }],
          take: budget,
          include: { broadcast: true },
        })
      : [];

    if (batch.length) {
      transporter = injected || createBulkTransporter();
      const cache = new Map();
      const gone = new Set(); // envíos de campañas que ya no están activas
      for (const r of batch) {
        const b = r.broadcast;
        if (gone.has(b.id)) continue;
        // Si el admin canceló el envío mientras corría esta tanda, los que faltaban ya no van.
        const fresh = await prisma.emailRecipient.findUnique({ where: { id: r.id }, select: { status: true } });
        if (fresh?.status !== "PENDING") continue;
        try {
          if (!transporter) throw Object.assign(new Error("SMTP no configurado"), { code: "NO_SMTP" });
          const { subject, html, text } = await renderFor(b, r, cache);
          await transporter.sendMail({
            from: `"${storeName()}" <${process.env.SMTP_USER}>`,
            to: r.email,
            subject,
            html,
            text,
            // Content-Language: Gmail ofrecía "Traducir al español" (los nombres de productos y el
            // "OFF" lo confundían). Antes: solo los headers de baja.
            headers: {
              "Content-Language": "es",
              // List-Unsubscribe solo en los envíos a un público con diseño: en los dirigidos a clientes
              // elegidos y en los de formato simple no va, porque ese header hace que Gmail lo trate
              // como newsletter (Promociones). El link de baja sigue en el texto del email.
              ...(r.customerId && b.audience !== "SELECTED" && !isPlainKind(b.kind)
                ? { "List-Unsubscribe": `<${unsubscribeUrls(r.customerId).oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
                : {}),
            },
          });
          await prisma.$transaction([
            prisma.emailRecipient.update({ where: { id: r.id }, data: { status: "SENT", sentAt: new Date(), error: null } }),
            prisma.emailBroadcast.update({ where: { id: b.id }, data: { sentCount: { increment: 1 }, lastError: null } }),
          ]);
          result.sent++;
        } catch (err) {
          if (err.code === "OFFER_GONE") {
            // La campaña terminó o se pausó: avisar a los que faltan sería mandar ofertas que no existen.
            gone.add(b.id);
            await prisma.$transaction([
              prisma.emailRecipient.updateMany({ where: { broadcastId: b.id, status: "PENDING" }, data: { status: "CANCELLED" } }),
              prisma.emailBroadcast.update({ where: { id: b.id }, data: { status: "CANCELLED", finishedAt: new Date(), lastError: err.message } }),
            ]);
            continue;
          }
          if (isRetryableSendError(err)) {
            result.paused = pauseReason(err);
            await prisma.emailBroadcast.update({ where: { id: b.id }, data: { lastError: result.paused } });
            console.error("[EMAIL] Envíos pausados:", result.paused, "-", err.message);
            break; // el resto de la tanda queda PENDING para el próximo minuto
          }
          await prisma.$transaction([
            prisma.emailRecipient.update({ where: { id: r.id }, data: { status: "FAILED", error: String(err.response || err.message).slice(0, 300) } }),
            prisma.emailBroadcast.update({ where: { id: b.id }, data: { failedCount: { increment: 1 } } }),
          ]);
          result.failed++;
        }
      }
    }

    // Cerrar los envíos que ya no tienen nada pendiente.
    const open = await prisma.emailBroadcast.findMany({ where: { status: "SENDING" }, select: { id: true } });
    for (const { id } of open) {
      const pending = await prisma.emailRecipient.count({ where: { broadcastId: id, status: "PENDING" } });
      if (pending === 0) {
        await prisma.emailBroadcast.update({ where: { id }, data: { status: "DONE", finishedAt: new Date(), lastError: null } });
      }
    }
    return result;
  } catch (err) {
    console.error("[EMAIL] Error en la cola de emails:", err.message);
    return result;
  } finally {
    if (transporter && !injected) transporter.close();
    queueRunning = false;
  }
}

async function cancelBroadcast(id) {
  const b = await prisma.emailBroadcast.findUnique({ where: { id } });
  if (!b) throw new BroadcastError(404, "Envío no encontrado");
  if (b.status !== "SENDING") throw new BroadcastError(400, "Este envío ya terminó");
  await prisma.$transaction([
    prisma.emailRecipient.updateMany({ where: { broadcastId: id, status: "PENDING" }, data: { status: "CANCELLED" } }),
    prisma.emailBroadcast.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date() } }),
  ]);
}

// Cron: avisos de campañas que empezaron + una tanda de la cola.
async function runEmailJobs() {
  try {
    await announceStartedOffers();
  } catch (err) {
    console.error("[EMAIL] Error revisando avisos de campañas:", err.message);
  }
  await processEmailQueue();
}

module.exports = {
  BroadcastError,
  AUDIENCES,
  CUSTOM_KINDS,
  PER_TICK,
  DEFAULT_DAILY_LIMIT,
  effectiveType,
  pickRecipients,
  resolveRecipients,
  audienceStats,
  marketingUnsubscribeToken,
  verifyMarketingUnsubscribeToken,
  unsubscribeUrls,
  validateCustomPayload,
  createBroadcast,
  announceOffer,
  recipientsForOffer,
  sendOfferTo,
  announceStartedOffers,
  offerEmailData,
  renderFor,
  isRetryableSendError,
  getDailyLimit,
  setDailyLimit,
  getOfferFormat,
  setOfferFormat,
  isOfferKind,
  sentLast24h,
  processEmailQueue,
  cancelBroadcast,
  runEmailJobs,
};

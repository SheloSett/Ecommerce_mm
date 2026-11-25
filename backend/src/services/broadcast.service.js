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
const { offerState } = require("./offers.service");
const { createBulkTransporter } = require("./email.service");
const { buildCustomEmail, buildPlainEmail, buildOfferEmail, buildPlainOfferEmail, buildLightOfferEmail, buildLightPromoEmail, buildPlainPromoEmail } = require("./broadcast.templates");
const { AVAILABLE_STOCK_FILTER } = require("../utils/stockFilter");
// Aviso del descuento por monto (25/11/2026)
const { isPromoLive, promoForCustomer } = require("../utils/cartPromo");
// Avisos de campañas por WhatsApp (25/11/2026)
const { whatsappConfigured, toWhatsappNumber, phoneDisplay, sendWhatsapp, getWhatsappSettings } = require("./whatsapp.service");
const { whatsappPromoText, whatsappOfferText } = require("./broadcast.templates");
const { resolveScope } = require("./cartPromo.service");
const { loadFlatCategories } = require("../utils/categoryTree");

const prisma = require("../lib/prisma"); // cliente único (ver lib/prisma.js)

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

// phone: para los avisos por WhatsApp (25/11/2026)
const CUSTOMER_SELECT = { id: true, name: true, email: true, phone: true, type: true, status: true, unsubscribeMarketing: true };

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
// cartPromoId: el descuento por monto que se avisa (kind PROMO_*). Antes solo offerId.
// channel: "EMAIL" | "WHATSAPP" (25/11/2026; los de WhatsApp llegan con recipients ya resueltos, con phone).
async function createBroadcast({ kind, channel = "EMAIL", audience, customerIds = [], offerId = null, cartPromoId = null, createdBy = null, content, recipients: given = null }) {
  if (!AUDIENCES.includes(audience)) throw new BroadcastError(400, "Destinatarios inválidos");
  if (audience === "SELECTED" && customerIds.length === 0 && !given) throw new BroadcastError(400, "Elegí al menos un cliente");
  const recipients = given || (await resolveRecipients(audience, customerIds));
  if (recipients.length === 0) throw new BroadcastError(400, "No hay ningún cliente para mandarle este email");

  return prisma.$transaction(async (tx) => {
    const broadcast = await tx.emailBroadcast.create({
      data: { kind, channel, audience, offerId, cartPromoId, createdBy, total: recipients.length, ...content },
    });
    await tx.emailRecipient.createMany({
      data: recipients.map((r) => ({ ...r, broadcastId: broadcast.id })),
    });
    return broadcast;
  });
}

// Formato de los avisos de campaña (Admin → Emails → Avisos de campañas), en SiteConfig
// "emailOfferFormat":
//   LIGHT  = liviano (por defecto): lindo pero sin imágenes ni precios, como el email de restock, que
//            al cliente le llega a Principal
//   PLAIN  = simple, solo texto, como un mensaje escrito a mano
//   DESIGN = con encabezado de color, fotos y precios (casi siempre cae en Promociones)
const OFFER_FORMATS = ["LIGHT", "PLAIN", "DESIGN"];
async function getOfferFormat() {
  const row = await prisma.siteConfig.findUnique({ where: { key: "emailOfferFormat" } });
  return OFFER_FORMATS.includes(row?.value) ? row.value : "LIGHT";
}
async function setOfferFormat(format) {
  const value = OFFER_FORMATS.includes(format) ? format : "LIGHT";
  await prisma.siteConfig.upsert({ where: { key: "emailOfferFormat" }, update: { value }, create: { key: "emailOfferFormat", value } });
}
// kind del envío según el formato: OFFER (con diseño), OFFER_LIGHT (liviano) u OFFER_PLAIN (simple)
const OFFER_KIND_BY_FORMAT = { DESIGN: "OFFER", LIGHT: "OFFER_LIGHT", PLAIN: "OFFER_PLAIN" };
const offerKind = async () => OFFER_KIND_BY_FORMAT[await getOfferFormat()];
const isOfferKind = (kind) => kind === "OFFER" || kind === "OFFER_LIGHT" || kind === "OFFER_PLAIN";
// Formatos simples: van sin el header List-Unsubscribe (Gmail lo usa para detectar newsletters y
// mandarlas a Promociones). El link de baja sigue en el texto del email, como pide la ley.
// Antes: sin PROMO_* (el aviso del descuento por monto, 25/11/2026, sale en los mismos formatos livianos).
const isPlainKind = (kind) => kind === "PLAIN" || kind === "OFFER_PLAIN" || kind === "OFFER_LIGHT" || kind === "PROMO_PLAIN" || kind === "PROMO_LIGHT";
// Aviso de un descuento por monto: mismo formato elegido para las campañas. La promo no tiene fotos de
// productos, así que "con fotos y precios" (DESIGN) sale como el liviano.
const PROMO_KIND_BY_FORMAT = { DESIGN: "PROMO_LIGHT", LIGHT: "PROMO_LIGHT", PLAIN: "PROMO_PLAIN" };
const promoKind = async () => PROMO_KIND_BY_FORMAT[await getOfferFormat()];
const isPromoKind = (kind) => kind === "PROMO_LIGHT" || kind === "PROMO_PLAIN";

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

// ── Aviso de un descuento por monto (model CartPromo) ─────────────────────────
// Pedido de la clienta (25/11/2026): "no llega mail" al crear el Black Friday. Funciona igual que el aviso
// de las campañas: a mano ("Avisar ahora", una vez salvo force), a clientes elegidos, o solo cuando empieza
// (emailAnnounce, lo manda el cron). A cada cliente le llega SU versión: un mayorista, con los escalones de
// mayoristas si la promo los tiene (promoForCustomer) y "Exclusivo para mayoristas".

async function announcePromo(promoId, { createdBy = null, force = false } = {}) {
  const promo = await prisma.cartPromo.findUnique({ where: { id: promoId } });
  if (!promo) throw new BroadcastError(404, "Promo no encontrada");
  if (!isPromoLive(promo)) throw new BroadcastError(400, "Solo se puede avisar una promo vigente (en fecha y sin pausar)");
  if (promo.announcedAt && !force) throw new BroadcastError(409, "Esta promo ya se avisó por email");

  // "Reservar" el aviso (mismo criterio que announceOffer): si el cron y el admin avisan a la vez, solo uno
  // lo consigue.
  const claimed = await prisma.cartPromo.updateMany({
    where: { id: promoId, ...(force ? {} : { announcedAt: null }) },
    data: { announcedAt: new Date() },
  });
  if (claimed.count === 0) throw new BroadcastError(409, "Esta promo ya se avisó por email");

  try {
    return await createBroadcast({
      kind: await promoKind(), audience: offerAudience(promo), cartPromoId: promoId, createdBy,
      content: { subject: promo.name },
    });
  } catch (err) {
    await prisma.cartPromo.update({ where: { id: promoId }, data: { announcedAt: promo.announcedAt } });
    throw err;
  }
}

// A clientes elegidos uno por uno (no marca la promo como avisada). { broadcast, skipped }.
async function sendPromoTo(promoId, customerIds, { createdBy = null } = {}) {
  const promo = await prisma.cartPromo.findUnique({ where: { id: promoId } });
  if (!promo) throw new BroadcastError(404, "Promo no encontrada");
  if (!isPromoLive(promo)) throw new BroadcastError(400, "Solo se puede mandar una promo vigente (en fecha y sin pausar)");
  if (!customerIds.length) throw new BroadcastError(400, "Elegí al menos un cliente");

  const chosen = await resolveRecipients("SELECTED", customerIds);
  const recipients = recipientsForOffer(chosen, promo.appliesTo);
  if (recipients.length === 0) {
    throw new BroadcastError(400, promo.appliesTo === "MAYORISTA"
      ? "La promo es solo para mayoristas aprobados y ninguno de los elegidos lo es"
      : "La promo es solo para minoristas y los elegidos son mayoristas");
  }
  const broadcast = await createBroadcast({
    kind: await promoKind(), audience: "SELECTED", cartPromoId: promoId, createdBy, recipients,
    content: { subject: promo.name },
  });
  return { broadcast, skipped: chosen.length - recipients.length };
}

// Cron: las promos con "Avisar por email" que ya empezaron y todavía no se avisaron.
async function announceStartedPromos() {
  const now = new Date();
  const due = await prisma.cartPromo.findMany({
    where: { emailAnnounce: true, announcedAt: null, active: true, startsAt: { lte: now }, endsAt: { gt: now } },
    select: { id: true, name: true },
  });
  for (const p of due) {
    try {
      const b = await announcePromo(p.id);
      console.log(`[EMAIL] Aviso de la promo "${p.name}" en cola para ${b.total} cliente(s)`);
    } catch (err) {
      if (err.status !== 409) console.error(`[EMAIL] No se pudo avisar la promo ${p.id}:`, err.message);
    }
  }
}

// La promo para armar el email, con scopeLabel si es para algunos productos. null si ya no está vigente
// (salvo la vista previa).
async function promoEmailData(promoId, { allowInactive = false } = {}) {
  if (!promoId) return null;
  const promo = await prisma.cartPromo.findUnique({ where: { id: promoId } });
  if (!promo || (!allowInactive && !isPromoLive(promo))) return null;
  let scopeLabel = null;
  if ((promo.categoryIds || []).length || (promo.productIds || []).length) {
    scopeLabel = (await resolveScope(promo, await loadFlatCategories(prisma))).label;
  }
  return { ...promo, scopeLabel };
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
  // Aviso de un descuento por monto: la versión de la promo de este cliente (sus escalones)
  if (isPromoKind(broadcast.kind)) {
    const key = `promo:${broadcast.cartPromoId}:${preview}`;
    if (!cache.has(key)) cache.set(key, await promoEmailData(broadcast.cartPromoId, { allowInactive: preview }));
    const data = cache.get(key);
    if (!data) {
      const err = new Error("La promo terminó, se pausó o se borró antes de que se mandaran todos los avisos");
      err.code = "OFFER_GONE"; // la cola cancela lo que falta, igual que con una campaña
      throw err;
    }
    const promo = promoForCustomer(data, recipient.type === "MAYORISTA" ? "MAYORISTA" : "MINORISTA");
    return broadcast.kind === "PROMO_PLAIN" ? buildPlainPromoEmail(promo, recipient, ctx) : buildLightPromoEmail(promo, recipient, ctx);
  }
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
    if (broadcast.kind === "OFFER_LIGHT") return buildLightOfferEmail(data.offer, side, recipient, ctx);
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
// Antes: sin filtrar el canal. Los avisos por WhatsApp (25/11/2026) no cuentan para el tope de Gmail.
const sentLast24h = (now = new Date(), channel = "EMAIL") =>
  prisma.emailRecipient.count({ where: { status: "SENT", sentAt: { gt: new Date(now.getTime() - DAY_MS) }, broadcast: { channel } } });

let queueRunning = false;

// Por qué ya no le corresponde un email de un envío a un público, mirado AL MANDAR (null = va). Un envío
// "a todos" puede tardar días por el tope diario: quien se dio de baja en el medio no tiene que recibirlo.
// Antes solo se filtraba al armar el envío (pickRecipients). Los mensajes a clientes elegidos (SELECTED)
// son directos y van igual, como al armarlos.
function skipReasonAtSend(broadcast, customer) {
  if (broadcast.audience === "SELECTED") return null;
  if (!customer) return "La cuenta ya no existe";
  if (customer.unsubscribeMarketing) return "Se dio de baja de las promociones";
  if (customer.status === "REJECTED") return "Cuenta rechazada";
  return null;
}

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
          // Antes: broadcast: { status: "SENDING" }. Los de WhatsApp los manda processWhatsappQueue.
          where: { status: "PENDING", broadcast: { status: "SENDING", channel: "EMAIL" } },
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
        if (b.audience !== "SELECTED" && r.customerId) {
          const customer = await prisma.customer.findUnique({ where: { id: r.customerId }, select: { status: true, unsubscribeMarketing: true } });
          const skip = skipReasonAtSend(b, customer);
          if (skip) {
            await prisma.emailRecipient.update({ where: { id: r.id }, data: { status: "CANCELLED", error: skip } });
            continue;
          }
        }
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

// ── Avisos de campañas por WhatsApp (Evolution, 25/11/2026) ───────────────────
// Pedido de la clienta: las campañas y los descuentos por monto también por WhatsApp, desde la eSIM de
// avisos (whatsapp.service.js; NO es la API oficial: el número se puede banear). Usa las mismas tablas que
// los emails (channel "WHATSAPP", kind WA_OFFER | WA_PROMO), pero su propia cola, mucho más lenta:
//   - UN mensaje cada 1,5 a 3 minutos (al azar): ráfagas iguales es lo que hace que WhatsApp mire el número
//   - solo entre las 9 y las 21 (hora argentina): a las 3 de la mañana parece un robot y molesta
//   - con un tope por día (Emails → WhatsApp, 100 por defecto)
//   - si la sesión de la eSIM se cae, se pausa y sigue sola cuando vuelve (no marca a nadie como fallido)
// A cada cliente le llega su versión (sus escalones / su descuento) y el link de baja de las promociones.

const WA_FROM_HOUR = 9;
const WA_TO_HOUR = 21;
let waLastSentAt = 0;
let waNextGapMs = 0;
let waRunning = false;

// Clientes → destinatarios por WhatsApp de un público (ALL | MINORISTA | MAYORISTA): sin rechazados, sin
// dados de baja y con un celular válido, sin repetir el número. Puro, para testearlo.
function pickWhatsappRecipients(customers, audience) {
  const seen = new Set();
  const out = [];
  for (const c of customers) {
    const type = effectiveType(c);
    if (c.status === "REJECTED" || c.unsubscribeMarketing) continue;
    if (audience === "MINORISTA" && type !== "MINORISTA") continue;
    if (audience === "MAYORISTA" && type !== "MAYORISTA") continue;
    const phone = toWhatsappNumber(c.phone);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push({ customerId: c.id, email: String(c.email || "").trim().toLowerCase(), phone, name: c.name || "", type });
  }
  return out;
}

// La campaña o promo a avisar: { item, live, kind, ref } (ref = { offerId } | { cartPromoId }).
async function waTarget(target, id) {
  if (target === "promo") {
    const item = await prisma.cartPromo.findUnique({ where: { id } });
    return { item, live: !!item && isPromoLive(item), kind: "WA_PROMO", ref: { cartPromoId: id } };
  }
  const item = await prisma.offer.findUnique({ where: { id } });
  return { item, live: !!item && offerState(item) === "ACTIVA", kind: "WA_OFFER", ref: { offerId: id } };
}

// Texto del aviso para un destinatario. cache: Map compartido (la promo / campaña y la configuración).
async function renderWhatsapp(broadcast, recipient, cache = new Map(), { preview = false } = {}) {
  if (!cache.has("waSettings")) cache.set("waSettings", await getWhatsappSettings());
  const ctx = {
    storeName: storeName(),
    frontendUrl: frontendUrl(),
    unsubscribeUrl: recipient.customerId ? unsubscribeUrls(recipient.customerId).page : `${frontendUrl()}/desuscribirse`,
    storePhone: phoneDisplay(cache.get("waSettings").storePhone),
  };
  const type = recipient.type === "MAYORISTA" ? "MAYORISTA" : "MINORISTA";
  const gone = () => Object.assign(new Error("La campaña terminó, se pausó o se borró antes de que se mandaran todos los avisos"), { code: "OFFER_GONE" });
  if (broadcast.kind === "WA_PROMO") {
    const key = `promo:${broadcast.cartPromoId}:${preview}`;
    if (!cache.has(key)) cache.set(key, await promoEmailData(broadcast.cartPromoId, { allowInactive: preview }));
    if (!cache.get(key)) throw gone();
    return whatsappPromoText(promoForCustomer(cache.get(key), type), recipient, ctx);
  }
  const side = type === "MAYORISTA" ? "wholesale" : "retail";
  const key = `offer:${broadcast.offerId}:${side}:${preview}`;
  if (!cache.has(key)) cache.set(key, await offerEmailData(broadcast.offerId, side, { allowInactive: preview }));
  if (!cache.get(key)) throw gone();
  return whatsappOfferText(cache.get(key).offer, side, recipient, ctx);
}

// Antes de mandar: a cuántos les llega y cómo se ve (minorista y mayorista, con un nombre de ejemplo).
async function whatsappPreview(target, id) {
  const { item, kind, ref } = await waTarget(target, id);
  if (!item) throw new BroadcastError(404, target === "promo" ? "Promo no encontrada" : "Campaña no encontrada");
  const audience = offerAudience(item);
  const customers = await prisma.customer.findMany({ select: CUSTOMER_SELECT, orderBy: { id: "asc" } });
  const recipients = pickWhatsappRecipients(customers, audience);
  const settings = await getWhatsappSettings();
  const cache = new Map();
  const b = { kind, ...ref };
  const sample = (type) => renderWhatsapp(b, { customerId: null, name: "Juan", type }, cache, { preview: true });
  return {
    configured: whatsappConfigured(),
    count: recipients.length,
    dailyLimit: settings.dailyLimit,
    retail: audience === "MAYORISTA" ? null : await sample("MINORISTA"),
    wholesale: audience === "MINORISTA" ? null : await sample("MAYORISTA"),
  };
}

// Encola el aviso por WhatsApp de una campaña o promo VIGENTE, a todos los que les aplica. Una sola vez
// salvo force (el admin confirma que lo quiere mandar de nuevo).
async function announceWhatsapp(target, id, { createdBy = null, force = false } = {}) {
  if (!whatsappConfigured()) throw new BroadcastError(400, "El WhatsApp de avisos todavía no está configurado (Emails → WhatsApp)");
  const { item, live, kind, ref } = await waTarget(target, id);
  if (!item) throw new BroadcastError(404, target === "promo" ? "Promo no encontrada" : "Campaña no encontrada");
  if (!live) throw new BroadcastError(400, "Solo se puede avisar mientras está vigente (en fecha y sin pausar)");
  if (!force) {
    const prev = await prisma.emailBroadcast.findFirst({
      where: { channel: "WHATSAPP", ...ref, status: { in: ["SENDING", "DONE"] } }, select: { createdAt: true },
    });
    if (prev) throw new BroadcastError(409, "Esto ya se mandó por WhatsApp");
  }
  const audience = offerAudience(item);
  const customers = await prisma.customer.findMany({ select: CUSTOMER_SELECT, orderBy: { id: "asc" } });
  const recipients = pickWhatsappRecipients(customers, audience);
  if (recipients.length === 0) throw new BroadcastError(400, "Ningún cliente al que le aplica tiene un celular cargado");
  return createBroadcast({
    kind, channel: "WHATSAPP", audience, offerId: ref.offerId ?? null, cartPromoId: ref.cartPromoId ?? null,
    createdBy, recipients, content: { subject: item.name },
  });
}

// Hora en Argentina (0-23), para el horario de envío.
const argentinaHour = (d) => Number(d.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires", hour: "numeric", hourCycle: "h23" }));

// Cron, cada minuto: manda COMO MUCHO un mensaje (ver arriba). send/random: inyectables para los tests.
async function processWhatsappQueue({ now = new Date(), send = sendWhatsapp, random = Math.random } = {}) {
  if (waRunning || !whatsappConfigured()) return { skipped: "sin configurar" };
  const hour = argentinaHour(now);
  if (hour < WA_FROM_HOUR || hour >= WA_TO_HOUR) return { skipped: "fuera de horario" };
  if (now.getTime() - waLastSentAt < waNextGapMs) return { skipped: "esperando" };
  waRunning = true;
  try {
    const settings = await getWhatsappSettings();
    if ((await sentLast24h(now, "WHATSAPP")) >= settings.dailyLimit) return { skipped: "tope diario" };
    const r = await prisma.emailRecipient.findFirst({
      where: { status: "PENDING", broadcast: { status: "SENDING", channel: "WHATSAPP" } },
      orderBy: [{ broadcastId: "asc" }, { id: "asc" }],
      include: { broadcast: true },
    });
    if (!r) return { idle: true };
    const b = r.broadcast;

    // Quien se dio de baja mientras esperaba en la cola ya no lo recibe (mismo criterio que el email)
    if (b.audience !== "SELECTED" && r.customerId) {
      const customer = await prisma.customer.findUnique({ where: { id: r.customerId }, select: { status: true, unsubscribeMarketing: true } });
      const skip = skipReasonAtSend(b, customer);
      if (skip) {
        await prisma.emailRecipient.update({ where: { id: r.id }, data: { status: "CANCELLED", error: skip } });
        return { cancelled: skip };
      }
    }

    let text;
    try {
      text = await renderWhatsapp(b, r);
    } catch (err) {
      if (err.code !== "OFFER_GONE") throw err;
      await prisma.$transaction([
        prisma.emailRecipient.updateMany({ where: { broadcastId: b.id, status: "PENDING" }, data: { status: "CANCELLED" } }),
        prisma.emailBroadcast.update({ where: { id: b.id }, data: { status: "CANCELLED", finishedAt: new Date(), lastError: err.message } }),
      ]);
      return { cancelled: err.message };
    }

    const res = await send({ to: r.phone, text });
    waLastSentAt = now.getTime();
    waNextGapMs = Math.round((90 + random() * 90) * 1000);
    if (res.ok) {
      await prisma.$transaction([
        prisma.emailRecipient.update({ where: { id: r.id }, data: { status: "SENT", sentAt: new Date(), error: null } }),
        prisma.emailBroadcast.update({ where: { id: b.id }, data: { sentCount: { increment: 1 }, lastError: null } }),
      ]);
      return { sent: 1 };
    }
    // El número no tiene WhatsApp: falla ese y se sigue. Cualquier otra cosa (sesión cerrada, Evolution
    // caído, llave mal) es del servidor: se pausa y se reintenta en el próximo turno, sin marcar a nadie.
    if (/"exists"\s*:\s*false|no es un celular/i.test(res.motivo)) {
      await prisma.$transaction([
        prisma.emailRecipient.update({ where: { id: r.id }, data: { status: "FAILED", error: "Ese número no tiene WhatsApp" } }),
        prisma.emailBroadcast.update({ where: { id: b.id }, data: { failedCount: { increment: 1 } } }),
      ]);
      return { failed: 1 };
    }
    await prisma.emailBroadcast.update({ where: { id: b.id }, data: { lastError: `WhatsApp en pausa: ${res.motivo}`.slice(0, 300) } });
    console.error("[WHATSAPP] Cola en pausa:", res.motivo);
    return { paused: res.motivo };
  } catch (err) {
    console.error("[WHATSAPP] Error en la cola:", err.message);
    return { error: err.message };
  } finally {
    waRunning = false;
  }
}

// Cron: avisos de campañas que empezaron + una tanda de la cola.
async function runEmailJobs() {
  try {
    await announceStartedOffers();
  } catch (err) {
    console.error("[EMAIL] Error revisando avisos de campañas:", err.message);
  }
  // Los descuentos por monto con "Avisar por email al empezar" (25/11/2026)
  try {
    await announceStartedPromos();
  } catch (err) {
    console.error("[EMAIL] Error revisando avisos de promos:", err.message);
  }
  await processEmailQueue();
  // Avisos por WhatsApp (25/11/2026): como mucho uno por turno, ver processWhatsappQueue
  await processWhatsappQueue();
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
  announcePromo,
  sendPromoTo,
  announceStartedPromos,
  promoEmailData,
  PROMO_KIND_BY_FORMAT,
  pickWhatsappRecipients,
  renderWhatsapp,
  whatsappPreview,
  announceWhatsapp,
  processWhatsappQueue,
  argentinaHour,
  renderFor,
  isRetryableSendError,
  getDailyLimit,
  setDailyLimit,
  getOfferFormat,
  setOfferFormat,
  isOfferKind,
  OFFER_FORMATS,
  OFFER_KIND_BY_FORMAT,
  sentLast24h,
  processEmailQueue,
  skipReasonAtSend,
  cancelBroadcast,
  runEmailJobs,
};

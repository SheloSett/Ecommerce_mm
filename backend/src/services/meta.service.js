// ─── Meta (Facebook / Instagram): Conversions API ─────────────────────────────
// Cuando un pedido web queda APROBADO (pago confirmado), le avisamos a Meta desde el servidor con
// un evento "Purchase". El Pixel del navegador manda el mismo evento con el mismo event_id
// ("order-<id>"), así Meta deduplica y cuenta la compra una sola vez. Mandarlo también desde acá
// cubre los casos en que el navegador no lo manda: pagos por transferencia/efectivo que el admin
// aprueba después, iPhone con bloqueo de rastreo, bloqueadores de anuncios, cliente que cierra la
// pestaña antes de volver de MercadoPago.
//
// Configuración (Admin → Configuración → Meta / Instagram, tabla site_config):
//   metaPixelId        → ID del Pixel / conjunto de datos
//   metaCapiToken      → token de acceso de la API de conversiones (secreto: nunca sale por GET)
//   metaTrackWholesale → "true" para mandar también las compras de MAYORISTAS (por defecto no:
//                        sus montos son otros y confunden la optimización de los anuncios)
//   metaTestEventCode  → código de "Probar eventos" de Events Manager (vacío en producción)
//
// Nada de esto bloquea el flujo de la tienda: si falta configuración o Meta no responde, se loguea
// y listo. Los datos personales (email, teléfono, nombre) viajan hasheados con SHA-256, como exige
// Meta.
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const SITE_URL = (process.env.FRONTEND_URL || "https://igwtstore.com.ar").split(",")[0].trim();
// Versión de la Graph API. Meta mantiene cada versión ~2 años; si una queda vieja se cambia acá o
// con la variable de entorno sin tocar código.
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v26.0";
const GRAPH_URL = "https://graph.facebook.com";
const REQUEST_TIMEOUT_MS = 8000;

const META_KEYS = ["metaPixelId", "metaCapiToken", "metaTrackWholesale", "metaTestEventCode"];

async function getMetaSettings() {
  const rows = await prisma.siteConfig.findMany({ where: { key: { in: META_KEYS } } });
  const map = {};
  rows.forEach((r) => { map[r.key] = r.value; });
  return {
    pixelId: (map.metaPixelId || "").trim(),
    token: (map.metaCapiToken || "").trim(),
    trackWholesale: map.metaTrackWholesale === "true",
    testEventCode: (map.metaTestEventCode || "").trim(),
  };
}

// ── Normalización + hash de datos personales (formato que pide Meta) ──────────
function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hashEmail(email) {
  const s = String(email || "").trim().toLowerCase();
  return s ? sha256(s) : null;
}

// Teléfono: solo dígitos, sin ceros a la izquierda, con código de país. Los clientes suelen
// escribir "11 5039 5166" (10 dígitos, sin el 54): se le antepone 54. Es el mejor esfuerzo posible
// sin un campo de país en el formulario.
function hashPhone(phone) {
  let d = String(phone || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return null;
  if (d.length <= 10) d = `54${d}`;
  return sha256(d);
}

// Nombre y apellido: minúsculas, sin espacios alrededor. "Juan Pérez" → fn "juan", ln "pérez".
function hashName(fullName) {
  const parts = String(fullName || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { fn: null, ln: null };
  const fn = sha256(parts[0]);
  const ln = parts.length > 1 ? sha256(parts.slice(1).join(" ")) : null;
  return { fn, ln };
}

// ── Datos del navegador que guarda el checkout en orders.metaBrowser ──────────
// El Pixel deja dos cookies en la tienda: _fbp (identifica el navegador) y _fbc (el click en el
// anuncio). El checkout las manda en el body; acá se validan (son texto que escribe el navegador)
// y se les suma la IP y el user agent de la request, que es lo que Meta usa para atribuir la
// compra cuando el evento sale del servidor.
const FBP_RE = /^fb\.\d\.\d+\.\d+$/;
const FBC_RE = /^fb\.\d\.\d+\.[A-Za-z0-9_-]+$/;

function browserDataFromRequest(req, body) {
  const src = body && typeof body === "object" ? body : {};
  const out = {};
  if (typeof src.fbp === "string" && FBP_RE.test(src.fbp) && src.fbp.length <= 64) out.fbp = src.fbp;
  if (typeof src.fbc === "string" && FBC_RE.test(src.fbc) && src.fbc.length <= 300) out.fbc = src.fbc;
  const ip = typeof req?.ip === "string" ? req.ip.trim() : "";
  if (ip && ip.length <= 64) out.ip = ip;
  const ua = typeof req?.headers?.["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 400) : "";
  if (ua) out.ua = ua;
  return Object.keys(out).length ? out : null;
}

// ── Armado del evento Purchase ───────────────────────────────────────────────
// Mismo criterio de ids que el feed del catálogo (seo.controller) y que el Pixel del navegador:
// producto sin variante → "<productId>"; con variante → "<productId>-<variantId>".
function contentIdFor(item) {
  return item.variantId ? `${item.productId}-${item.variantId}` : String(item.productId);
}

// order: pedido con items (productId, variantId, quantity, price, currency). Devuelve el body que
// se le manda a Meta (sin el token). Función pura, testeable.
function buildPurchasePayload(order, { eventSourceUrl, testEventCode, now = Date.now() } = {}) {
  // Un evento lleva UNA moneda. El pedido guarda pesos en total y dólares en totalUsd: se manda la
  // parte en pesos si existe; si el pedido es 100% en dólares, se manda en USD.
  const totalArs = Number(order.total) || 0;
  const totalUsd = Number(order.totalUsd) || 0;
  const currency = totalArs > 0 || totalUsd <= 0 ? "ARS" : "USD";
  const value = currency === "ARS" ? totalArs : totalUsd;

  const items = (order.items || []).filter((i) => i.productId && (i.currency || "ARS") === currency);
  const contents = items.map((i) => ({
    id: contentIdFor(i),
    quantity: Number(i.quantity) || 1,
    item_price: Number(i.price) || 0,
  }));

  const userData = {};
  const em = hashEmail(order.customerEmail);
  if (em) userData.em = [em];
  const ph = hashPhone(order.customerPhone);
  if (ph) userData.ph = [ph];
  const { fn, ln } = hashName(order.customerName);
  if (fn) userData.fn = [fn];
  if (ln) userData.ln = [ln];
  if (order.customerId) userData.external_id = [sha256(String(order.customerId))];
  userData.country = [sha256("ar")];
  const mb = order.metaBrowser && typeof order.metaBrowser === "object" ? order.metaBrowser : {};
  if (mb.ip) userData.client_ip_address = mb.ip;
  if (mb.ua) userData.client_user_agent = mb.ua;
  if (mb.fbp) userData.fbp = mb.fbp;
  if (mb.fbc) userData.fbc = mb.fbc;

  const event = {
    event_name: "Purchase",
    event_time: Math.floor(now / 1000),
    event_id: `order-${order.id}`,
    action_source: "website",
    event_source_url: eventSourceUrl || `${SITE_URL}/checkout`,
    user_data: userData,
    custom_data: {
      currency,
      value: Math.round(value * 100) / 100,
      content_type: "product",
      content_ids: contents.map((c) => c.id),
      contents,
      num_items: contents.reduce((acc, c) => acc + c.quantity, 0),
      order_id: String(order.id),
      // Para poder separar en los informes de Meta si alguna vez se mandan compras mayoristas.
      customer_type: order.customerType || "MINORISTA",
    },
  };

  const payload = { data: [event] };
  if (testEventCode) payload.test_event_code = testEventCode;
  return payload;
}

// ── Envío ────────────────────────────────────────────────────────────────────
async function postEvents(pixelId, token, payload) {
  const url = `${GRAPH_URL}/${GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, access_token: token }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body?.error?.error_user_msg || body?.error?.message || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.meta = body?.error;
    throw err;
  }
  return body;
}

// Manda el Purchase de un pedido. Se llama en cada lugar donde un pedido pasa a APPROVED. Nunca
// tira: devuelve { ok } o { skipped } o { error } y loguea.
async function sendPurchaseEvent(orderId) {
  const id = parseInt(orderId);
  if (!Number.isInteger(id)) return { skipped: "id inválido" };
  try {
    const settings = await getMetaSettings();
    if (!settings.pixelId || !settings.token) return { skipped: "sin configurar" };

    const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) return { skipped: "pedido inexistente" };
    if (order.status !== "APPROVED") return { skipped: `estado ${order.status}` };
    // Ventas manuales (mostrador, teléfono): no vienen de un navegador, no hay anuncio que atribuir.
    if (order.salesChannel !== "WEB") return { skipped: "venta manual" };
    if (order.customerType === "MAYORISTA" && !settings.trackWholesale) return { skipped: "mayorista" };

    const payload = buildPurchasePayload(order, { testEventCode: settings.testEventCode });
    const body = await postEvents(settings.pixelId, settings.token, payload);
    console.log(`[META CAPI] Pedido #${id}: Purchase enviado (${body?.events_received ?? "?"} evento/s)`);
    return { ok: true };
  } catch (err) {
    console.error(`[META CAPI] Pedido #${id}: no se pudo enviar el Purchase:`, err.message);
    return { error: err.message };
  }
}

// Prueba de conexión desde el panel: manda un evento personalizado inofensivo ("PruebaConexion")
// con la configuración guardada. Si el Pixel o el token están mal, Meta responde con el motivo.
async function testConnection() {
  const settings = await getMetaSettings();
  if (!settings.pixelId) throw new Error("Falta el ID del Pixel");
  if (!settings.token) throw new Error("Falta el token de la API de conversiones");
  const payload = {
    data: [{
      event_name: "PruebaConexion",
      event_time: Math.floor(Date.now() / 1000),
      action_source: "website",
      event_source_url: SITE_URL,
      user_data: { client_user_agent: "IGWT Store (prueba desde el panel)" },
    }],
  };
  if (settings.testEventCode) payload.test_event_code = settings.testEventCode;
  const body = await postEvents(settings.pixelId, settings.token, payload);
  return { eventsReceived: body?.events_received ?? null, testEventCode: settings.testEventCode || null };
}

module.exports = {
  getMetaSettings,
  browserDataFromRequest,
  sendPurchaseEvent,
  testConnection,
  _internals: { buildPurchasePayload, hashEmail, hashPhone, hashName, contentIdFor, GRAPH_VERSION },
};

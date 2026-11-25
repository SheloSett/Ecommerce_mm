// WhatsApp de avisos por Evolution API (pedido de la clienta, 25/11/2026: "prefiero Evolution, él también
// me puede avisar los pedidos; ya lo uso en Shiraf"). Copiado y adaptado de Shiraf
// (src/server/services/evolution.service.ts), que ya lo tiene andando en el mismo VPS.
//
// 🔴 QUÉ ES Y EL TRATO QUE LO HACE ACEPTABLE
// Evolution habla WhatsApp como un dispositivo vinculado (como WhatsApp Web), no por la API oficial de
// Meta: va contra los términos de WhatsApp y, cuando lo detectan, banean el número. Por eso acá va SOLO
// la eSIM de avisos, comprada para esto, y NUNCA el número de la tienda (web, flyers, Mercado Libre). Si
// la banean se pierde ese chip y los emails siguen saliendo igual. (Se le ofreció la API oficial de Meta:
// la descartó por el costo de las campañas, ~USD 0,07 por mensaje.)
//
// REGLA DE ORO (igual que en Shiraf): sin configurar no falla, no manda y lo dice. Un pedido nunca se
// frena porque WhatsApp no ande: todo acá es "fire-and-forget" y devuelve { ok } o { ok:false, motivo }.
//
// Qué manda (los tres avisos que eligió la clienta):
//   1. Pedido nuevo → a los números de la tienda (Admin → Emails → WhatsApp). Son mensajes a ellos mismos.
//   2. Estado del pedido → al cliente: pago aprobado, y listo para retirar / despachado.
//   3. Campañas → a los clientes (broadcast.service.js, cola lenta con tope por día).
//
// Variables (deploy/.env, ver deploy/docker-compose.vps.yml):
//   EVOLUTION_URL        http://evolution:8080 (adentro del compose; el nombre del servicio, no localhost)
//   EVOLUTION_API_KEY    la llave del contenedor (AUTHENTICATION_API_KEY). Abre TODO Evolution, incluido
//                        leer conversaciones: nunca sale del servidor.
//   EVOLUTION_INSTANCIA  el nombre de la instancia vinculada a la eSIM. Un 404 casi siempre es que no
//                        coincide con la creada en el panel de Evolution.
//   EVOLUTION_DELAY_MS   cuánto "escribe" antes de cada mensaje (por defecto 1200). No es cosmético: sin
//                        pausa, varios avisos salen juntos y con la misma forma, que es lo que mira WhatsApp.

const prisma = require("../lib/prisma"); // cliente único (ver lib/prisma.js)

const DELAY_POR_DEFECTO = 1200;
const variable = (nombre) => {
  const v = process.env[nombre];
  return v === undefined || v === "" ? undefined : v;
};

function whatsappConfigured() {
  return Boolean(variable("EVOLUTION_URL") && variable("EVOLUTION_API_KEY") && variable("EVOLUTION_INSTANCIA"));
}
const baseUrl = () => variable("EVOLUTION_URL").replace(/\/+$/, "");
const instancia = () => encodeURIComponent(variable("EVOLUTION_INSTANCIA"));

// ── Números ───────────────────────────────────────────────────────────────────

// Un teléfono como lo carga la gente ("11 5039-5166", "15 3385 2327", "+54 9 11 ...", "011 15 ...") →
// formato internacional de WhatsApp, solo dígitos ("5491150395166"). null si no se puede armar un
// celular argentino. Copiado de Shiraf (toWhatsappNumber en notifications.ts), con sus dos arreglos:
//   - "15 3385 2327" pelado (sin el 11, como lo dicta la gente de Buenos Aires): es 11 + 3385 2327.
//   - un número de diez dígitos ya completo ("341 555 1234") no tiene un 15 de más que sacar.
function toWhatsappNumber(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("549") && digits.length >= 12) return digits;           // ya con país y el 9
  if (digits.startsWith("54") && digits.length >= 11) return `549${digits.slice(2)}`; // con país, sin el 9
  const sinCero = digits.replace(/^0/, "");
  const local = sinCero.length === 10 && sinCero.startsWith("15")
    ? `11${sinCero.slice(2)}`
    : sinCero.length > 10
      ? sinCero.replace(/^(\d{2,4})15/, "$1")
      : sinCero;
  return local.length >= 10 ? `549${local}` : null;
}

// "5491150395166" / "1150395166" → "11 5039-5166" (para mostrar en los mensajes)
function phoneDisplay(raw) {
  const n = toWhatsappNumber(raw);
  if (!n) return String(raw || "").trim();
  const local = n.slice(3); // sin el 549
  if (local.startsWith("11") && local.length === 10) return `11 ${local.slice(2, 6)}-${local.slice(6)}`;
  return local;
}

// ── Envío ─────────────────────────────────────────────────────────────────────

// Manda un texto. to: cualquier formato (se pasa por toWhatsappNumber). → { ok } | { ok:false, motivo }
async function sendWhatsapp({ to, text }) {
  if (!whatsappConfigured()) return { ok: false, motivo: "WhatsApp (Evolution) todavía no está configurado" };
  const number = toWhatsappNumber(to);
  if (!number) return { ok: false, motivo: `El teléfono "${to}" no es un celular válido` };
  if (!String(text || "").trim()) return { ok: false, motivo: "El mensaje vino vacío" };

  const pedido = Number(variable("EVOLUTION_DELAY_MS"));
  const delay = Number.isFinite(pedido) && pedido >= 0 ? pedido : DELAY_POR_DEFECTO;
  try {
    const res = await fetch(`${baseUrl()}/message/sendText/${instancia()}`, {
      method: "POST",
      // Evolution autentica con el header `apikey`, no con Authorization/Bearer
      headers: { apikey: variable("EVOLUTION_API_KEY"), "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ number, text, delay }),
    });
    if (!res.ok) {
      const detalle = await res.text().catch(() => "");
      return { ok: false, motivo: `Evolution respondió ${res.status}: ${detalle.slice(0, 300) || "sin detalle"}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: `No se pudo llamar a Evolution: ${err.message}` };
  }
}

// Estado de la sesión de la eSIM: "open" (conectada) | "close" | "connecting" | null (no se pudo saber)
async function whatsappState() {
  if (!whatsappConfigured()) return null;
  try {
    const res = await fetch(`${baseUrl()}/instance/connectionState/${instancia()}`, {
      headers: { apikey: variable("EVOLUTION_API_KEY") }, signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const state = (await res.json())?.instance?.state;
    return ["open", "close", "connecting"].includes(state) ? state : null;
  } catch {
    return null;
  }
}

// Reinicia la instancia: reabre una sesión cerrada pero todavía válida (sin volver a escanear el QR).
// POST y no PUT: con PUT da 404 (lección de Shiraf).
async function restartWhatsapp() {
  if (!whatsappConfigured()) return { ok: false, motivo: "WhatsApp (Evolution) todavía no está configurado" };
  try {
    const res = await fetch(`${baseUrl()}/instance/restart/${instancia()}`, {
      method: "POST", headers: { apikey: variable("EVOLUTION_API_KEY") }, signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { ok: false, motivo: `Evolution respondió ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: `No se pudo llamar a Evolution: ${err.message}` };
  }
}

// ── Configuración (Admin → Emails → WhatsApp), en SiteConfig ─────────────────
//   whatsappAdminNumbers   números de la tienda para "pedido nuevo" (separados por coma)
//   whatsappNewOrder       "false" = no avisar pedidos nuevos (por defecto sí, si hay números)
//   whatsappCustomerStatus "false" = no avisarle al cliente el estado del pedido (por defecto sí)
//   whatsappDailyLimit     tope de avisos de campañas por día (cola lenta, ver broadcast.service.js)
//   whatsappAbandonedCart  "false" = el recordatorio de carrito abandonado solo por email (por defecto también
//                          por WhatsApp; el recordatorio en sí se prende en Emails → Automáticos)
//   whatsappRestock        "false" = el recordatorio de restock a mayoristas solo por email (por defecto también)
//   footerPhone            el teléfono de la tienda (el del pie de la web): va en la firma de los avisos
// (whatsappAbandonedCart / whatsappRestock: pedido de la clienta, 25/11/2026, "carritos abandonados... restock")
const SETTING_KEYS = ["whatsappAdminNumbers", "whatsappNewOrder", "whatsappCustomerStatus", "whatsappDailyLimit", "whatsappAbandonedCart", "whatsappRestock", "footerPhone"];
const DEFAULT_DAILY_LIMIT = 100;
const MAX_DAILY_LIMIT = 400;

async function getWhatsappSettings() {
  const rows = await prisma.siteConfig.findMany({ where: { key: { in: SETTING_KEYS } } });
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    adminNumbers: String(v.whatsappAdminNumbers || "").split(",").map((s) => s.trim()).filter(Boolean),
    newOrder: v.whatsappNewOrder !== "false",
    customerStatus: v.whatsappCustomerStatus !== "false",
    dailyLimit: Math.min(MAX_DAILY_LIMIT, parseInt(v.whatsappDailyLimit, 10) > 0 ? parseInt(v.whatsappDailyLimit, 10) : DEFAULT_DAILY_LIMIT),
    abandonedCart: v.whatsappAbandonedCart !== "false",
    restock: v.whatsappRestock !== "false",
    storePhone: v.footerPhone || "1150395166",
  };
}

async function saveWhatsappSettings({ adminNumbers, newOrder, customerStatus, dailyLimit, abandonedCart, restock }) {
  const upsert = (key, value) => prisma.siteConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
  const ops = [];
  if (adminNumbers !== undefined) {
    const list = (Array.isArray(adminNumbers) ? adminNumbers : String(adminNumbers).split(","))
      .map((s) => String(s).trim()).filter(Boolean);
    const bad = list.filter((n) => !toWhatsappNumber(n));
    if (bad.length) return { error: `Estos números no son celulares válidos: ${bad.join(", ")}` };
    if (list.length > 5) return { error: "Hasta 5 números" };
    ops.push(upsert("whatsappAdminNumbers", list.join(",")));
  }
  if (newOrder !== undefined) ops.push(upsert("whatsappNewOrder", newOrder ? "true" : "false"));
  if (customerStatus !== undefined) ops.push(upsert("whatsappCustomerStatus", customerStatus ? "true" : "false"));
  if (abandonedCart !== undefined) ops.push(upsert("whatsappAbandonedCart", abandonedCart ? "true" : "false"));
  if (restock !== undefined) ops.push(upsert("whatsappRestock", restock ? "true" : "false"));
  if (dailyLimit !== undefined) {
    const n = parseInt(dailyLimit, 10);
    if (!(n >= 10 && n <= MAX_DAILY_LIMIT)) return { error: `El tope por día tiene que ser entre 10 y ${MAX_DAILY_LIMIT}` };
    ops.push(upsert("whatsappDailyLimit", String(n)));
  }
  await Promise.all(ops);
  return { data: await getWhatsappSettings() };
}

// ── Textos (puros, para testear) ──────────────────────────────────────────────

const money = (n) => `$ ${Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";
const METHOD_LABEL = {
  EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", MERCADOPAGO: "Mercado Pago",
  COTIZACION: "Cotización", A_CONVENIR: "A convenir",
};
const SHIPPING_LABEL = { RETIRO: "Retiro", MOTO: "Moto", CORREO_ARGENTINO: "Correo" };

// Línea que va al final de los avisos AL CLIENTE: la eSIM no la lee nadie (lección de Shiraf: una clienta
// que contesta "no puedo ir" le escribe a un teléfono en un cajón).
const firma = (storePhone) => `Este número solo envía avisos. Si necesitás algo, escribinos al ${phoneDisplay(storePhone)}.`;

// Pedido nuevo → a la tienda. frontendUrl: para el link al panel.
function newOrderText(order, { frontendUrl }) {
  const usd = order.totalUsd != null && order.totalUsd > 0 ? ` + USD ${Number(order.totalUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "";
  const items = (order.items || []).reduce((n, i) => n + (Number(i.quantity) || 0), 0);
  const quien = [order.customerName, order.customerType === "MAYORISTA" ? "mayorista" : null].filter(Boolean).join(" · ");
  return [
    `🛒 Pedido nuevo #${order.id}`,
    quien,
    `Total: ${money(order.total)}${usd} · ${METHOD_LABEL[order.paymentMethod] || order.paymentMethod || ""}`,
    [items ? `${items} producto${items === 1 ? "" : "s"}` : null, SHIPPING_LABEL[order.shippingMethod] || null].filter(Boolean).join(" · ") || null,
    `${frontendUrl}/admin/ordenes/${order.id}`,
  ].filter(Boolean).join("\n");
}

// Estado del pedido → al cliente. kind: "payment" (status) | "fulfillment" (fulfillmentStatus).
// null = ese cambio no se avisa por WhatsApp (solo aprobado y listo/despachado: lo que eligió la clienta).
function customerStatusText(order, { kind, status }, { storePhone }) {
  const hola = `Hola${firstName(order.customerName) ? ` ${firstName(order.customerName)}` : ""}! 👋`;
  const retiro = (order.shippingMethod || "RETIRO") === "RETIRO";
  let body = null;
  if (kind === "payment" && status === "APPROVED") {
    body = `Confirmamos el pago de tu pedido #${order.id} en IGWT Store. Te avisamos por acá cuando esté ${retiro ? "listo para retirar" : "en camino"}.`;
  } else if (kind === "fulfillment" && status === "ENVIADO") {
    if (retiro) body = `Tu pedido #${order.id} está listo para retirar en Av. La Plata 744, timbre 3, CABA. Coordinamos el horario al ${phoneDisplay(storePhone)}.`;
    else if (order.shippingMethod === "MOTO") body = `Tu pedido #${order.id} salió en moto y llega a la dirección que nos pasaste.`;
    else if (order.shippingMethod === "CORREO_ARGENTINO") {
      body = `Tu pedido #${order.id} fue despachado por correo.${order.trackingNumber ? ` Número de seguimiento: ${order.trackingNumber}.` : " Te pasamos el número de seguimiento apenas lo tengamos."}`;
    } else body = `Tu pedido #${order.id} ya está en camino.`;
  }
  if (!body) return null;
  return [hola, body, "", firma(storePhone)].join("\n");
}

// Recordatorio de carrito abandonado (el mismo que sale por email, cartReminder.service.js). items: los del
// carrito con stock ({ name, variantLabel, quantity }). ctx: { frontendUrl, unsubscribeUrl, storePhone }
function abandonedCartText(customer, items, ctx) {
  const lista = items.slice(0, 4).map((i) => `• ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ""}${i.quantity > 1 ? ` x${i.quantity}` : ""}`);
  if (items.length > 4) lista.push(`• y ${items.length - 4} más`);
  return [
    `Hola${firstName(customer.name) ? ` ${firstName(customer.name)}` : ""}! 👋`,
    `Te quedó esto en el carrito de IGWT Store:\n${lista.join("\n")}`,
    `Lo terminás acá: ${ctx.frontendUrl}/carrito`,
    [ctx.unsubscribeUrl ? `Si no querés recibir más recordatorios: ${ctx.unsubscribeUrl}` : null, firma(ctx.storePhone)].filter(Boolean).join("\n"),
  ].join("\n\n");
}

// Recordatorio de restock a un mayorista (el mismo que sale por email, runMayoristaRestock en cron.service.js)
function restockText(customer, ctx) {
  return [
    `Hola${firstName(customer.name) ? ` ${firstName(customer.name)}` : ""}! 👋`,
    "Hace un tiempo que no hacés un pedido en IGWT Store. ¿Reponemos? Tus clientes te están esperando.",
    `Catálogo mayorista: ${ctx.frontendUrl}/catalogo`,
    [ctx.unsubscribeUrl ? `Si no querés recibir más recordatorios: ${ctx.unsubscribeUrl}` : null, firma(ctx.storePhone)].filter(Boolean).join("\n"),
  ].join("\n\n");
}

// ── Avisos (fire-and-forget: nunca tiran error) ───────────────────────────────

const frontendUrl = () => process.env.FRONTEND_URL || "http://localhost:3000";

async function notifyNewOrderWhatsapp(order) {
  try {
    if (!whatsappConfigured()) return;
    const s = await getWhatsappSettings();
    if (!s.newOrder || s.adminNumbers.length === 0) return;
    const text = newOrderText(order, { frontendUrl: frontendUrl() });
    for (const to of s.adminNumbers) { // de a uno: el delay de Evolution los espacia
      const r = await sendWhatsapp({ to, text });
      if (!r.ok) console.error(`[WHATSAPP] Pedido #${order.id} → ${to}: ${r.motivo}`);
    }
  } catch (err) {
    console.error("[WHATSAPP] notifyNewOrderWhatsapp:", err.message);
  }
}

async function notifyOrderStatusWhatsapp(order, change) {
  try {
    if (!whatsappConfigured() || !order?.customerPhone) return;
    const s = await getWhatsappSettings();
    if (!s.customerStatus) return;
    const text = customerStatusText(order, change, { storePhone: s.storePhone });
    if (!text) return;
    const r = await sendWhatsapp({ to: order.customerPhone, text });
    if (!r.ok) console.error(`[WHATSAPP] Estado del pedido #${order.id} (${change.status}): ${r.motivo}`);
  } catch (err) {
    console.error("[WHATSAPP] notifyOrderStatusWhatsapp:", err.message);
  }
}

// ── Vigilante (cron cada 10 min) ──────────────────────────────────────────────
// Lección de Shiraf: si el teléfono de la eSIM se apaga, la sesión queda "close" y no vuelve sola. Se
// reinicia la instancia (alcanza si la sesión sigue viva); si sigue cerrada, UN email a la tienda para
// que la vuelvan a vincular (como mucho uno cada 12 horas).
let lastDownAlert = 0;
async function whatsappWatchdog({ sendAlert } = {}) {
  if (!whatsappConfigured()) return null;
  let state = await whatsappState();
  if (state === "open") return state;
  await restartWhatsapp();
  await new Promise((r) => setTimeout(r, 15_000));
  state = await whatsappState();
  if (state !== "open" && Date.now() - lastDownAlert > 12 * 3600_000) {
    lastDownAlert = Date.now();
    console.error(`[WHATSAPP] La eSIM de avisos está desconectada (${state || "sin respuesta"})`);
    sendAlert?.(
      "WhatsApp de avisos desconectado",
      "El WhatsApp de avisos (la eSIM) está desconectado y no se pudo reconectar solo.\n\n" +
      "1. Fijate que el teléfono de la eSIM esté prendido y con internet.\n" +
      "2. Si sigue igual, hay que volver a escanear el QR (Admin → Emails → WhatsApp explica cómo).\n\n" +
      "Mientras tanto los avisos siguen saliendo por email.",
    );
  }
  return state;
}

module.exports = {
  whatsappConfigured,
  toWhatsappNumber,
  phoneDisplay,
  sendWhatsapp,
  whatsappState,
  restartWhatsapp,
  getWhatsappSettings,
  saveWhatsappSettings,
  newOrderText,
  customerStatusText,
  abandonedCartText,
  restockText,
  notifyNewOrderWhatsapp,
  notifyOrderStatusWhatsapp,
  whatsappWatchdog,
};

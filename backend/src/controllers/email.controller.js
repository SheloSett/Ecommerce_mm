// Admin → Emails: escribir y mandar emails a los clientes, avisar campañas, ver el historial y el
// tope diario. La lógica (destinatarios, cola, plantillas) vive en services/broadcast.service.js.

const {
  BroadcastError,
  AUDIENCES,
  audienceStats,
  validateCustomPayload,
  createBroadcast,
  announceOffer,
  sendOfferTo,
  announcePromo,
  sendPromoTo,
  PROMO_KIND_BY_FORMAT,
  whatsappPreview,
  announceWhatsapp,
  processWhatsappQueue,
  renderWhatsapp,
  renderFor,
  getDailyLimit,
  setDailyLimit,
  getOfferFormat,
  setOfferFormat,
  OFFER_FORMATS,
  OFFER_KIND_BY_FORMAT,
  sentLast24h,
  cancelBroadcast,
  processEmailQueue,
  PER_TICK,
} = require("../services/broadcast.service");
const { createBulkTransporter } = require("../services/email.service");
// Historial de todo lo que sale de a uno (26/11/2026)
const { logMessage, listMessages } = require("../services/messageLog.service");
// WhatsApp de avisos (25/11/2026)
const {
  whatsappConfigured, whatsappState, restartWhatsapp, sendWhatsapp, getWhatsappSettings, saveWhatsappSettings, whatsappQr,
} = require("../services/whatsapp.service");

const prisma = require("../lib/prisma"); // cliente único (ver lib/prisma.js)

function handleError(res, err, fallback) {
  if (err instanceof BroadcastError) return res.status(err.status).json({ error: err.message });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
}

// Quién mandó el envío, para el historial: el NOMBRE del usuario del panel ("Susy"). Antes era su
// email, y en el historial parecía la casilla desde la que salía el email (sale de SMTP_USER).
const senderLabel = (req) => req.user?.name || req.user?.email || null;

// Arranca la cola apenas se crea un envío, sin esperar el tic del cron (que es una vez por minuto):
// un email a un cliente sale en segundos. Los que pasan de PER_TICK siguen con el cron.
const kickQueue = () => setImmediate(() => processEmailQueue().catch((e) => console.error("[EMAIL] cola:", e.message)));

// Formato del email escrito por el admin: "PLAIN" (simple) o "CUSTOM" (con diseño, el de siempre).
const customKind = (kind) => (kind === "PLAIN" ? "PLAIN" : "CUSTOM");

const parseIds = (ids) => (Array.isArray(ids) ? [...new Set(ids.map((x) => parseInt(x)).filter((x) => x > 0))] : []);

// Lo que se previsualiza o se manda de prueba: un email escrito (CUSTOM) o el aviso de una campaña
// (OFFER, con side "retail" | "wholesale" para ver la versión de cada público).
function draftFromBody(body) {
  // Aviso de un descuento por monto (25/11/2026), con side como el de las campañas
  if (body.kind === "PROMO") {
    const cartPromoId = parseInt(body.cartPromoId);
    if (!cartPromoId) return { error: "Falta la promo" };
    return {
      broadcast: { kind: PROMO_KIND_BY_FORMAT[body.format] || PROMO_KIND_BY_FORMAT.LIGHT, cartPromoId },
      type: body.side === "wholesale" ? "MAYORISTA" : "MINORISTA",
    };
  }
  if (body.kind === "OFFER") {
    const offerId = parseInt(body.offerId);
    if (!offerId) return { error: "Falta la campaña" };
    // format: el que se está mirando en la vista previa ("LIGHT" | "PLAIN" | "DESIGN")
    return {
      broadcast: { kind: OFFER_KIND_BY_FORMAT[body.format] || OFFER_KIND_BY_FORMAT.LIGHT, offerId },
      type: body.side === "wholesale" ? "MAYORISTA" : "MINORISTA",
    };
  }
  const { data, error } = validateCustomPayload(body);
  if (error) return { error };
  // kind PLAIN = formato simple (como un email personal); audience: para saber si es un mensaje directo
  return { broadcast: { kind: customKind(body.kind), audience: body.audience || "ALL", ...data }, type: "MINORISTA" };
}

// ── GET /api/emails/audience?audience=ALL ─────────────────────────────────────
async function getAudience(req, res) {
  try {
    const audience = req.query.audience || "ALL";
    if (!AUDIENCES.includes(audience) || audience === "SELECTED") return res.status(400).json({ error: "Público inválido" });
    res.json(await audienceStats(audience));
  } catch (err) {
    handleError(res, err, "Error al contar los destinatarios");
  }
}

// ── GET /api/emails/customers?search= — buscador del "Elegir clientes" ─────────
async function searchCustomers(req, res) {
  try {
    const search = String(req.query.search || "").trim();
    if (search.length < 2) return res.json([]);
    const customers = await prisma.customer.findMany({
      where: {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, email: true, type: true, status: true, unsubscribeMarketing: true },
      orderBy: { name: "asc" },
      take: 20,
    });
    res.json(customers);
  } catch (err) {
    handleError(res, err, "Error al buscar clientes");
  }
}

// ── POST /api/emails/preview → { subject, html } ──────────────────────────────
async function previewEmail(req, res) {
  try {
    const draft = draftFromBody(req.body);
    if (draft.error) return res.status(400).json({ error: draft.error });
    const recipient = { customerId: null, name: req.body.previewName || "Juan", type: draft.type };
    res.json(await renderFor(draft.broadcast, recipient, new Map(), { preview: true }));
  } catch (err) {
    if (err.code === "OFFER_GONE") return res.status(404).json({ error: "Campaña no encontrada" });
    handleError(res, err, "Error al armar la vista previa");
  }
}

// ── POST /api/emails/test — manda el borrador al email del admin logueado ──────
async function sendTestEmail(req, res) {
  let transporter;
  try {
    const draft = draftFromBody(req.body);
    if (draft.error) return res.status(400).json({ error: draft.error });
    const to = req.user?.email;
    if (!to) return res.status(400).json({ error: "Tu usuario no tiene email" });
    transporter = createBulkTransporter();
    if (!transporter) return res.status(503).json({ error: "El servidor de email (SMTP) no está configurado" });

    const recipient = { customerId: null, name: req.user?.name || "", type: draft.type };
    const { subject, html, text } = await renderFor(draft.broadcast, recipient, new Map(), { preview: true });
    try {
      await transporter.sendMail({
        from: `"${process.env.STORE_NAME || "IGWT Store"}" <${process.env.SMTP_USER}>`,
        to,
        subject: `[PRUEBA] ${subject}`,
        html,
        text,
        headers: { "Content-Language": "es" },
      });
      // Al historial (26/11/2026): este transporte es el de la cola, que no anota solo
      logMessage({ channel: "EMAIL", to, subject: `[PRUEBA] ${subject}`, ok: true });
    } catch (err) {
      logMessage({ channel: "EMAIL", to, subject: `[PRUEBA] ${subject}`, ok: false, error: err.message });
      throw err;
    }
    res.json({ sentTo: to });
  } catch (err) {
    handleError(res, err, "No se pudo mandar el email de prueba");
  } finally {
    transporter?.close();
  }
}

// ── POST /api/emails/broadcasts — email escrito por el admin ───────────────────
async function createCustomBroadcast(req, res) {
  try {
    const { data, error } = validateCustomPayload(req.body);
    if (error) return res.status(400).json({ error });
    const broadcast = await createBroadcast({
      kind: customKind(req.body.kind),
      audience: req.body.audience,
      customerIds: parseIds(req.body.customerIds),
      createdBy: senderLabel(req),
      content: data,
    });
    kickQueue();
    res.status(201).json(broadcast);
  } catch (err) {
    handleError(res, err, "Error al crear el envío");
  }
}

// ── POST /api/emails/offers/:id/announce — aviso manual de una campaña ─────────
async function announceOfferNow(req, res) {
  try {
    const broadcast = await announceOffer(parseInt(req.params.id), {
      createdBy: senderLabel(req),
      force: req.body?.force === true,
    });
    kickQueue();
    res.status(201).json(broadcast);
  } catch (err) {
    handleError(res, err, "Error al avisar la campaña");
  }
}

// ── POST /api/emails/offers/:id/send — aviso de una campaña a clientes elegidos ─
async function sendOfferToSelected(req, res) {
  try {
    const { broadcast, skipped } = await sendOfferTo(parseInt(req.params.id), parseIds(req.body?.customerIds), {
      createdBy: senderLabel(req),
    });
    kickQueue();
    res.status(201).json({ ...broadcast, skipped });
  } catch (err) {
    handleError(res, err, "Error al mandar la campaña");
  }
}

// ── Descuentos por monto en "Avisos de campañas" (25/11/2026) ──────────────────
// Con el permiso "emails" alcanza (como con las campañas): la lista para la pestaña y prender o apagar el
// aviso automático, sin poder tocar escalones ni productos (eso pide "productos" en /api/cart-promos).

// GET /api/emails/promos — las que no terminaron, con su estado
async function listPromosForEmails(req, res) {
  try {
    const now = new Date();
    const promos = await prisma.cartPromo.findMany({
      where: { endsAt: { gt: now } },
      select: { id: true, name: true, appliesTo: true, startsAt: true, endsAt: true, active: true, emailAnnounce: true, announcedAt: true },
      orderBy: { startsAt: "desc" },
    });
    // Mismos nombres de estado que las campañas, para la misma pantalla
    const state = (p) => (!p.active ? "PAUSADA" : new Date(p.startsAt) > now ? "PROGRAMADA" : "ACTIVA");
    res.json(promos.map((p) => ({ ...p, state: state(p) })));
  } catch (err) {
    handleError(res, err, "Error al cargar las promos");
  }
}

// PUT /api/emails/promos/:id/auto — { emailAnnounce } (avisar sola cuando empieza)
async function setPromoAutoAnnounce(req, res) {
  try {
    const promo = await prisma.cartPromo.update({
      where: { id: parseInt(req.params.id) },
      data: { emailAnnounce: req.body?.emailAnnounce === true },
      select: { id: true, emailAnnounce: true },
    });
    res.json(promo);
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "Promo no encontrada" });
    handleError(res, err, "Error al guardar el aviso");
  }
}

// POST /api/emails/promos/:id/announce — aviso manual (force: mandarlo otra vez)
async function announcePromoNow(req, res) {
  try {
    const broadcast = await announcePromo(parseInt(req.params.id), {
      createdBy: senderLabel(req),
      force: req.body?.force === true,
    });
    kickQueue();
    res.status(201).json(broadcast);
  } catch (err) {
    handleError(res, err, "Error al avisar la promo");
  }
}

// POST /api/emails/promos/:id/send — a clientes elegidos
async function sendPromoToSelected(req, res) {
  try {
    const { broadcast, skipped } = await sendPromoTo(parseInt(req.params.id), parseIds(req.body?.customerIds), {
      createdBy: senderLabel(req),
    });
    kickQueue();
    res.status(201).json({ ...broadcast, skipped });
  } catch (err) {
    handleError(res, err, "Error al mandar la promo");
  }
}

// ── WhatsApp de avisos (Evolution, 25/11/2026) ────────────────────────────────
// Ver services/whatsapp.service.js (envío, configuración) y broadcast.service.js (cola de campañas).

// GET /api/emails/whatsapp — estado de la eSIM y configuración
async function getWhatsappPanel(req, res) {
  try {
    const [settings, state] = await Promise.all([getWhatsappSettings(), whatsappState()]);
    const sentToday = await sentLast24h(new Date(), "WHATSAPP");
    res.json({ configured: whatsappConfigured(), state, sentToday, ...settings });
  } catch (err) {
    handleError(res, err, "Error al leer la configuración de WhatsApp");
  }
}

// PUT /api/emails/whatsapp — { adminNumbers, newOrder, customerStatus, dailyLimit }
async function updateWhatsappPanel(req, res) {
  try {
    // abandonedCart / restock: los recordatorios automáticos también por WhatsApp (25/11/2026)
    const { adminNumbers, newOrder, customerStatus, dailyLimit, abandonedCart, restock } = req.body || {};
    const out = await saveWhatsappSettings({ adminNumbers, newOrder, customerStatus, dailyLimit, abandonedCart, restock });
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out.data);
  } catch (err) {
    handleError(res, err, "Error al guardar la configuración de WhatsApp");
  }
}

// POST /api/emails/whatsapp/test — { to }: un mensaje de prueba
async function sendWhatsappTest(req, res) {
  try {
    const r = await sendWhatsapp({
      to: req.body?.to,
      text: "✅ Prueba del WhatsApp de avisos de IGWT Store. Si te llegó, está andando.",
      kind: "[PRUEBA] WhatsApp de avisos",
    });
    if (!r.ok) return res.status(400).json({ error: r.motivo });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err, "Error al mandar la prueba");
  }
}

// POST /api/emails/whatsapp/restart — reconectar la sesión (si el teléfono se cortó)
async function restartWhatsappNow(req, res) {
  try {
    const r = await restartWhatsapp();
    if (!r.ok) return res.status(400).json({ error: r.motivo });
    res.json({ ok: true, state: await whatsappState() });
  } catch (err) {
    handleError(res, err, "Error al reconectar WhatsApp");
  }
}

// GET /api/emails/whatsapp/qr — el QR para vincular la eSIM desde el panel (25/11/2026: "un botón de
// reconectar en la web misma"). → { state: "open" } | { base64, pairingCode }
async function getWhatsappQr(req, res) {
  try {
    const out = await whatsappQr();
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
  } catch (err) {
    handleError(res, err, "Error al pedir el QR");
  }
}

// POST /api/emails/(offers|promos)/:id/whatsapp/test — { to, side }: el aviso de esa campaña SOLO a ese
// número, para probarlo antes de mandarlo a todos (25/11/2026: "quiero probarlo"). No cuenta como enviado.
async function testWhatsappAnnounce(req, res) {
  try {
    const target = waTargetOf(req);
    const id = parseInt(req.params.id);
    const type = req.body?.side === "wholesale" ? "MAYORISTA" : "MINORISTA";
    const b = target === "promo" ? { kind: "WA_PROMO", cartPromoId: id } : { kind: "WA_OFFER", offerId: id };
    const text = await renderWhatsapp(b, { customerId: null, name: req.user?.name || "", type }, new Map(), { preview: true });
    const r = await sendWhatsapp({ to: req.body?.to, text, kind: "[PRUEBA] Aviso de campaña" });
    if (!r.ok) return res.status(400).json({ error: r.motivo });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "OFFER_GONE") return res.status(404).json({ error: "No encontrada" });
    handleError(res, err, "Error al mandar la prueba");
  }
}

// GET /api/emails/(offers|promos)/:id/whatsapp — a cuántos les llega y cómo se ve
const waTargetOf = (req) => (req.baseUrl + req.path).includes("/promos/") ? "promo" : "offer";
async function previewWhatsappAnnounce(req, res) {
  try {
    res.json(await whatsappPreview(waTargetOf(req), parseInt(req.params.id)));
  } catch (err) {
    if (err.code === "OFFER_GONE") return res.status(404).json({ error: "No encontrada" });
    handleError(res, err, "Error al armar el aviso por WhatsApp");
  }
}

// POST /api/emails/(offers|promos)/:id/whatsapp — { force }: encola el aviso (sale de a poco)
async function announceWhatsappNow(req, res) {
  try {
    const broadcast = await announceWhatsapp(waTargetOf(req), parseInt(req.params.id), {
      createdBy: senderLabel(req),
      force: req.body?.force === true,
    });
    // El primero sale enseguida (si es horario); el resto, de a uno, con el cron.
    setImmediate(() => processWhatsappQueue().catch((e) => console.error("[WHATSAPP] cola:", e.message)));
    res.status(201).json(broadcast);
  } catch (err) {
    handleError(res, err, "Error al avisar por WhatsApp");
  }
}

// ── GET /api/emails/messages — todo lo que salió de a uno (26/11/2026) ─────────
// ?channel=EMAIL|WHATSAPP &status=FAILED &q=texto &before=id (para "ver más"). Ver services/messageLog.service.js.
async function listSentMessages(req, res) {
  try {
    const before = parseInt(req.query.before, 10);
    res.json(await listMessages({
      channel: req.query.channel, status: req.query.status, q: req.query.q,
      before: Number.isInteger(before) ? before : undefined,
    }));
  } catch (err) {
    handleError(res, err, "Error al cargar los mensajes enviados");
  }
}

// ── GET /api/emails/broadcasts — historial ────────────────────────────────────
async function listBroadcasts(req, res) {
  try {
    const broadcasts = await prisma.emailBroadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      // cartPromo: el descuento por monto avisado (25/11/2026)
      include: { offer: { select: { id: true, name: true } }, cartPromo: { select: { id: true, name: true } } },
    });
    res.json(broadcasts);
  } catch (err) {
    handleError(res, err, "Error al cargar el historial");
  }
}

// ── GET /api/emails/broadcasts/:id — detalle con los que fallaron ──────────────
async function getBroadcast(req, res) {
  try {
    const id = parseInt(req.params.id);
    const broadcast = await prisma.emailBroadcast.findUnique({
      where: { id },
      // cartPromo: el descuento por monto avisado (25/11/2026)
      include: { offer: { select: { id: true, name: true } }, cartPromo: { select: { id: true, name: true } } },
    });
    if (!broadcast) return res.status(404).json({ error: "Envío no encontrado" });
    const [byStatus, failed] = await Promise.all([
      prisma.emailRecipient.groupBy({ by: ["status"], where: { broadcastId: id }, _count: true }),
      prisma.emailRecipient.findMany({
        where: { broadcastId: id, status: "FAILED" },
        select: { id: true, email: true, name: true, error: true },
        take: 200,
      }),
    ]);
    res.json({
      ...broadcast,
      counts: Object.fromEntries(byStatus.map((g) => [g.status, g._count])),
      failed,
    });
  } catch (err) {
    handleError(res, err, "Error al cargar el envío");
  }
}

// ── GET /api/emails/broadcasts/:id/recipients?search=&status= ──────────────────
// A quién le salió cada email y a qué hora, con buscador: para poder comprobar si un cliente puntual
// (o una cuenta propia) estaba en el envío.
async function listRecipients(req, res) {
  try {
    const broadcastId = parseInt(req.params.id);
    const search = String(req.query.search || "").trim();
    const status = ["PENDING", "SENT", "FAILED", "CANCELLED"].includes(req.query.status) ? req.query.status : undefined;
    const where = {
      broadcastId,
      ...(status ? { status } : {}),
      ...(search ? { OR: [{ email: { contains: search, mode: "insensitive" } }, { name: { contains: search, mode: "insensitive" } }] } : {}),
    };
    const [total, items] = await Promise.all([
      prisma.emailRecipient.count({ where }),
      prisma.emailRecipient.findMany({
        where,
        // phone: los avisos por WhatsApp (25/11/2026)
        select: { id: true, email: true, phone: true, name: true, type: true, status: true, error: true, sentAt: true },
        orderBy: [{ sentAt: "asc" }, { id: "asc" }],
        take: 300,
      }),
    ]);
    res.json({ total, items });
  } catch (err) {
    handleError(res, err, "Error al cargar los destinatarios");
  }
}

// ── POST /api/emails/broadcasts/:id/cancel ─────────────────────────────────────
async function cancelBroadcastNow(req, res) {
  try {
    await cancelBroadcast(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err, "Error al cancelar el envío");
  }
}

// ── GET / PUT /api/emails/settings — tope diario ───────────────────────────────
async function getEmailSettings(req, res) {
  try {
    const [dailyLimit, sent24h, pending, offerFormat] = await Promise.all([
      getDailyLimit(),
      sentLast24h(),
      prisma.emailRecipient.count({ where: { status: "PENDING", broadcast: { status: "SENDING" } } }),
      getOfferFormat(),
    ]);
    res.json({ dailyLimit, sentLast24h: sent24h, pending, offerFormat, perMinute: PER_TICK, smtpConfigured: !!(process.env.SMTP_USER && process.env.SMTP_PASS) });
  } catch (err) {
    handleError(res, err, "Error al cargar la configuración de emails");
  }
}

// Acepta cualquiera de los dos por separado: el tope diario (Historial) y el formato de los avisos de
// campaña (Avisos de campañas).
async function updateEmailSettings(req, res) {
  try {
    const out = {};
    if (req.body?.dailyLimit !== undefined) {
      const n = parseInt(req.body.dailyLimit);
      if (!(n >= 10 && n <= 5000)) return res.status(400).json({ error: "El tope diario tiene que estar entre 10 y 5000" });
      await setDailyLimit(n);
      out.dailyLimit = n;
    }
    if (req.body?.offerFormat !== undefined) {
      if (!OFFER_FORMATS.includes(req.body.offerFormat)) return res.status(400).json({ error: "Formato inválido" });
      await setOfferFormat(req.body.offerFormat);
      out.offerFormat = req.body.offerFormat;
    }
    res.json(out);
  } catch (err) {
    handleError(res, err, "Error al guardar la configuración de emails");
  }
}

module.exports = {
  getAudience,
  searchCustomers,
  previewEmail,
  sendTestEmail,
  createCustomBroadcast,
  announceOfferNow,
  sendOfferToSelected,
  listPromosForEmails,
  setPromoAutoAnnounce,
  announcePromoNow,
  sendPromoToSelected,
  getWhatsappPanel,
  updateWhatsappPanel,
  sendWhatsappTest,
  restartWhatsappNow,
  previewWhatsappAnnounce,
  announceWhatsappNow,
  getWhatsappQr,
  testWhatsappAnnounce,
  listSentMessages,
  listBroadcasts,
  getBroadcast,
  listRecipients,
  cancelBroadcastNow,
  getEmailSettings,
  updateEmailSettings,
};

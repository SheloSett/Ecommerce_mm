// Admin → Emails: escribir y mandar emails a los clientes, avisar campañas, ver el historial y el
// tope diario. La lógica (destinatarios, cola, plantillas) vive en services/broadcast.service.js.

const { PrismaClient } = require("@prisma/client");
const {
  BroadcastError,
  AUDIENCES,
  audienceStats,
  validateCustomPayload,
  createBroadcast,
  announceOffer,
  renderFor,
  getDailyLimit,
  setDailyLimit,
  sentLast24h,
  cancelBroadcast,
  PER_TICK,
} = require("../services/broadcast.service");
const { createBulkTransporter } = require("../services/email.service");

const prisma = new PrismaClient();

function handleError(res, err, fallback) {
  if (err instanceof BroadcastError) return res.status(err.status).json({ error: err.message });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
}

const parseIds = (ids) => (Array.isArray(ids) ? [...new Set(ids.map((x) => parseInt(x)).filter((x) => x > 0))] : []);

// Lo que se previsualiza o se manda de prueba: un email escrito (CUSTOM) o el aviso de una campaña
// (OFFER, con side "retail" | "wholesale" para ver la versión de cada público).
function draftFromBody(body) {
  if (body.kind === "OFFER") {
    const offerId = parseInt(body.offerId);
    if (!offerId) return { error: "Falta la campaña" };
    return { broadcast: { kind: "OFFER", offerId }, type: body.side === "wholesale" ? "MAYORISTA" : "MINORISTA" };
  }
  const { data, error } = validateCustomPayload(body);
  if (error) return { error };
  return { broadcast: { kind: "CUSTOM", ...data }, type: "MINORISTA" };
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
    const { subject, html } = await renderFor(draft.broadcast, recipient, new Map(), { preview: true });
    await transporter.sendMail({
      from: `"${process.env.STORE_NAME || "IGWT Store"}" <${process.env.SMTP_USER}>`,
      to,
      subject: `[PRUEBA] ${subject}`,
      html,
      headers: { "Content-Language": "es" },
    });
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
      kind: "CUSTOM",
      audience: req.body.audience,
      customerIds: parseIds(req.body.customerIds),
      createdBy: req.user?.email || null,
      content: data,
    });
    res.status(201).json(broadcast);
  } catch (err) {
    handleError(res, err, "Error al crear el envío");
  }
}

// ── POST /api/emails/offers/:id/announce — aviso manual de una campaña ─────────
async function announceOfferNow(req, res) {
  try {
    const broadcast = await announceOffer(parseInt(req.params.id), {
      createdBy: req.user?.email || null,
      force: req.body?.force === true,
    });
    res.status(201).json(broadcast);
  } catch (err) {
    handleError(res, err, "Error al avisar la campaña");
  }
}

// ── GET /api/emails/broadcasts — historial ────────────────────────────────────
async function listBroadcasts(req, res) {
  try {
    const broadcasts = await prisma.emailBroadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { offer: { select: { id: true, name: true } } },
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
      include: { offer: { select: { id: true, name: true } } },
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
        select: { id: true, email: true, name: true, type: true, status: true, error: true, sentAt: true },
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
    const [dailyLimit, sent24h, pending] = await Promise.all([
      getDailyLimit(),
      sentLast24h(),
      prisma.emailRecipient.count({ where: { status: "PENDING", broadcast: { status: "SENDING" } } }),
    ]);
    res.json({ dailyLimit, sentLast24h: sent24h, pending, perMinute: PER_TICK, smtpConfigured: !!(process.env.SMTP_USER && process.env.SMTP_PASS) });
  } catch (err) {
    handleError(res, err, "Error al cargar la configuración de emails");
  }
}

async function updateEmailSettings(req, res) {
  try {
    const n = parseInt(req.body?.dailyLimit);
    if (!(n >= 10 && n <= 5000)) return res.status(400).json({ error: "El tope diario tiene que estar entre 10 y 5000" });
    await setDailyLimit(n);
    res.json({ dailyLimit: n });
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
  listBroadcasts,
  getBroadcast,
  listRecipients,
  cancelBroadcastNow,
  getEmailSettings,
  updateEmailSettings,
};

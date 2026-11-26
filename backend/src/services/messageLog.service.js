// Historial de todo lo que sale de a uno: emails y WhatsApp (pedido de la clienta, 26/11/2026: "en Emails →
// Historial hay cosas que no se guardan; debería aparecer al 100% todo lo que se manda"). Antes el historial
// mostraba solo los envíos masivos; los emails de pedidos, cotizaciones, estados, recordatorios y los WhatsApp
// de avisos no quedaban en ningún lado.
//
// Se registra solo, sin tocar cada aviso:
//   - emails: createTransporter (email.service.js) anota cada sendMail, salga o falle. El de la cola masiva
//     (createBulkTransporter) no, porque ya queda uno por uno en EmailRecipient.
//   - WhatsApp: sendWhatsapp (whatsapp.service.js), salvo la cola de campañas (misma razón).
// Guardar el registro NUNCA frena ni hace fallar un envío: si la tabla no está o la base falla, queda un
// aviso en el log y listo.

const prisma = require("../lib/prisma"); // cliente único (ver lib/prisma.js)

const KEEP_DAYS = 180;
const clip = (s, n) => String(s ?? "").slice(0, n);

// { channel: "EMAIL" | "WHATSAPP", to (texto o lista), subject, ok, error }
function logMessage({ channel, to, subject, ok = true, error = null }) {
  try {
    const toText = Array.isArray(to) ? to.join(", ") : to && typeof to === "object" && to.address ? to.address : to;
    prisma.messageLog
      .create({
        data: {
          channel,
          to: clip(toText, 300),
          subject: clip(subject || "(sin asunto)", 300),
          status: ok ? "SENT" : "FAILED",
          error: error ? clip(error, 300) : null,
        },
      })
      .catch((e) => console.error("[HISTORIAL] No se pudo guardar el mensaje:", e.message));
  } catch (e) {
    console.error("[HISTORIAL] No se pudo guardar el mensaje:", e.message);
  }
}

// Para Emails → Historial. channel: EMAIL | WHATSAPP; status: FAILED; q: busca en destinatario y asunto;
// before: id (para "ver más"). Los más nuevos primero.
async function listMessages({ channel, status, q, before, take = 100 } = {}) {
  const where = {};
  if (channel === "EMAIL" || channel === "WHATSAPP") where.channel = channel;
  if (status === "FAILED" || status === "SENT") where.status = status;
  if (q && String(q).trim()) {
    const s = String(q).trim().slice(0, 100);
    where.OR = [{ to: { contains: s, mode: "insensitive" } }, { subject: { contains: s, mode: "insensitive" } }];
  }
  if (Number.isInteger(before) && before > 0) where.id = { lt: before };
  return prisma.messageLog.findMany({ where, orderBy: { id: "desc" }, take: Math.min(Math.max(take, 1), 200) });
}

// Cron diario: se borra lo de más de 180 días
async function pruneMessages(now = new Date()) {
  const { count } = await prisma.messageLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - KEEP_DAYS * 86400000) } } });
  if (count) console.log(`[HISTORIAL] Borrados ${count} mensajes de más de ${KEEP_DAYS} días`);
  return count;
}

module.exports = { logMessage, listMessages, pruneMessages, KEEP_DAYS };

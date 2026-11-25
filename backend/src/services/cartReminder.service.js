// Recordatorio automático de carrito abandonado (M5 de la auditoría, 30/10/2026).
//
// Analíticas ya medía los carritos abandonados (y cuánta plata suman), pero nadie intentaba recuperarlos:
// el único aviso era el botón manual de Admin → Clientes → Carritos. Una vez por hora se toman los
// carritos que cumplen todo esto:
//  - tienen productos y nadie los tocó hace más de 24 h (y menos de 7 días: no se le escribe a alguien
//    por un carrito de hace meses, ni se manda todo junto el día que se prende);
//  - no se avisó desde su último cambio (reminderSentAt): un aviso por versión del carrito. Si el cliente
//    vuelve, lo cambia y lo deja otra vez, puede llegar otro;
//  - el cliente no se dio de baja de las promociones, no está rechazado y no hizo un pedido después.
// El email va con los precios VIGENTES y sin lo que se agotó (si se agotó todo, no se manda).
// Se prende en Admin → Emails → Automatizaciones (emailAbandonedCart); arranca apagado.

const prisma = require("../lib/prisma"); // cliente único (ver lib/prisma.js)
const { sendAbandonedCartEmail } = require("./email.service");
// Antes: { unsubscribeUrls }. queueWhatsappMessages: el mismo recordatorio por WhatsApp (25/11/2026)
const { unsubscribeUrls, queueWhatsappMessages } = require("./broadcast.service");
const { whatsappConfigured, getWhatsappSettings, abandonedCartText } = require("./whatsapp.service");

const HOUR_MS = 60 * 60 * 1000;
const MIN_AGE_MS = 24 * HOUR_MS;
const MAX_AGE_MS = 7 * 24 * HOUR_MS;
// Tope por pasada (una por hora): el SMTP tiene un límite diario que comparte con el resto de los emails.
const PER_RUN = 10;

async function runAbandonedCartReminders({ now = new Date(), send = sendAbandonedCartEmail } = {}) {
  const setting = await prisma.siteConfig.findUnique({ where: { key: "emailAbandonedCart" } });
  if (setting?.value !== "true") return { skipped: true };

  const carts = await prisma.cart.findMany({
    where: {
      updatedAt: { lte: new Date(now.getTime() - MIN_AGE_MS), gte: new Date(now.getTime() - MAX_AGE_MS) },
      items:     { some: {} },
      customer:  { unsubscribeMarketing: false, status: { not: "REJECTED" } },
    },
    include: {
      // type: para el precio mayorista al recalcular (ver enrichCarts). phone: el WhatsApp (25/11/2026)
      customer: { select: { id: true, name: true, email: true, type: true, phone: true } },
      items:    { orderBy: { id: "asc" } },
    },
    orderBy: { updatedAt: "asc" },
  });
  // Ya avisado por esta versión del carrito (Prisma no compara dos columnas en el where).
  const pending = carts.filter((c) => !c.reminderSentAt || c.reminderSentAt < c.updatedAt);

  const { enrichCarts } = require("../routes/cart.routes");
  let sent = 0;
  let skipped = 0;
  // WhatsApp (25/11/2026): a quienes les salió el email, el mismo recordatorio por la cola lenta de WhatsApp
  const wa = whatsappConfigured() ? await getWhatsappSettings() : null;
  const waMessages = [];
  for (const cart of pending) {
    if (sent >= PER_RUN) break;
    // ¿Hizo un pedido después de dejar el carrito? (por otro medio, o uno de MP sin pagar todavía)
    const ordered = await prisma.order.count({ where: { customerId: cart.customerId, createdAt: { gt: cart.updatedAt } } });
    let items = [];
    if (!ordered) {
      const [enriched] = await enrichCarts([cart]);
      items = enriched.items.filter((i) => !i.outOfStock);
    }
    if (items.length > 0) {
      const ok = await send(cart.customer, items, { unsubscribe: unsubscribeUrls(cart.customerId) });
      if (!ok) continue; // SMTP caído o sin configurar: se reintenta en la próxima pasada
      sent++;
      if (wa?.abandonedCart && cart.customer.phone) {
        waMessages.push({
          customer: cart.customer,
          text: abandonedCartText(cart.customer, items, {
            frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
            unsubscribeUrl: unsubscribeUrls(cart.customerId).page,
            storePhone: wa.storePhone,
          }),
        });
      }
    } else {
      skipped++;
    }
    // También se marca lo salteado (compró, se agotó todo): si no, se volvería a revisar cada hora.
    // updatedAt explícito: si no, Prisma lo pisa con la hora actual (@updatedAt) y el carrito parecería
    // recién tocado por el cliente.
    await prisma.cart.update({ where: { id: cart.id }, data: { reminderSentAt: now, updatedAt: cart.updatedAt } });
  }
  if (sent || skipped) console.log(`[CARRITOS] Recordatorios: ${sent} enviados, ${skipped} salteados`);
  if (waMessages.length) await queueWhatsappMessages("Recordatorio de carrito", waMessages, { audience: "ALL" });
  return { sent, skipped };
}

module.exports = { runAbandonedCartReminders, PER_RUN };

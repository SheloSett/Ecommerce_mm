const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// GET /api/notifications/my - Devuelve notificaciones del cliente logueado
async function getMyNotifications(req, res) {
  try {
    const customerId = req.user.id;
    const notifications = await prisma.notification.findMany({
      where:   { customerId },
      orderBy: { createdAt: "desc" },
      take:    50,
    });
    const unreadCount = notifications.filter((n) => !n.read).length;
    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error("getMyNotifications error:", err);
    res.status(500).json({ error: "Error al obtener notificaciones" });
  }
}

// PATCH /api/notifications/read-all - Marca todas las notificaciones como leídas
async function markAllRead(req, res) {
  try {
    const customerId = req.user.id;
    await prisma.notification.updateMany({
      where: { customerId, read: false },
      data:  { read: true },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("markAllRead error:", err);
    res.status(500).json({ error: "Error al marcar notificaciones" });
  }
}

module.exports = { getMyNotifications, markAllRead };

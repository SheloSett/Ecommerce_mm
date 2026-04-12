const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { addClient, removeClient } = require("../sse/notificationSSE");

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

// GET /api/notifications/stream - Abre conexión SSE para notificaciones en tiempo real
// El cliente mantiene esta conexión abierta; el servidor pushea cuando hay novedades.
// Usa token vía query param (?token=) porque EventSource del browser no soporta headers.
async function streamNotifications(req, res) {
  const customerId = req.user.id;

  // Cabeceras SSE estándar
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // Necesario para nginx/proxies que bufferean la respuesta
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Enviar notificaciones existentes como evento inicial para que el cliente las tenga al conectar
  try {
    const notifications = await prisma.notification.findMany({
      where:   { customerId },
      orderBy: { createdAt: "desc" },
      take:    50,
    });
    const unreadCount = notifications.filter((n) => !n.read).length;
    res.write(`data: ${JSON.stringify({ type: "init", notifications, unreadCount })}\n\n`);
  } catch (err) {
    console.error("streamNotifications init error:", err);
  }

  // Registrar esta conexión para poder pushear luego
  addClient(customerId, res);

  // Heartbeat cada 25s para mantener la conexión viva (proxies suelen cortar conexiones idle ~30s)
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      // Silencioso — el evento "close" ya lo limpia
    }
  }, 25000);

  // Limpiar al desconectar (pestaña cerrada, red caída, logout)
  req.on("close", () => {
    clearInterval(heartbeat);
    removeClient(customerId, res);
  });
}

module.exports = { getMyNotifications, markAllRead, streamNotifications };

const express = require("express");
const router  = express.Router();
const { authMiddleware, customerMiddleware } = require("../middleware/auth.middleware");
const { getMyNotifications, markAllRead, streamNotifications } = require("../controllers/notification.controller");

// Cliente: stream SSE — conexión persistente; el servidor pushea notificaciones en tiempo real
// El token va en query param (?token=) porque EventSource del browser no soporta headers custom
router.get("/stream", authMiddleware, customerMiddleware, streamNotifications);

// Cliente: ver sus notificaciones (fallback / carga inicial sin SSE)
router.get("/my", authMiddleware, customerMiddleware, getMyNotifications);

// Cliente: marcar todas como leídas
router.patch("/read-all", authMiddleware, customerMiddleware, markAllRead);

module.exports = router;

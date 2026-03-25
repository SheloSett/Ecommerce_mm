const express = require("express");
const router  = express.Router();
const { authMiddleware, customerMiddleware } = require("../middleware/auth.middleware");
const { getMyNotifications, markAllRead } = require("../controllers/notification.controller");

// Cliente: ver sus notificaciones
router.get("/my", authMiddleware, customerMiddleware, getMyNotifications);

// Cliente: marcar todas como leídas
router.patch("/read-all", authMiddleware, customerMiddleware, markAllRead);

module.exports = router;

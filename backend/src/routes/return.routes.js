const express = require("express");
const router = express.Router();
const {
  lookupOrdersByEmail,
  createReturnRequest,
  getMyReturnRequests,
  getAllReturnRequests,
  updateReturnRequestStatus,
  markReturnSeen,
} = require("../controllers/return.controller");
const { authMiddleware, adminMiddleware, customerMiddleware, requireAnyPermission } = require("../middleware/auth.middleware");
const { validateReturnRequest } = require("../middleware/validate.middleware");
const rateLimit = require("express-rate-limit");

// El formulario de arrepentimiento es público y cada envío le manda un email al cliente: tope por
// IP para que no se pueda usar en bucle para mandar emails desde la cuenta de la tienda (y agotar
// el cupo diario de Gmail, que también usan las confirmaciones de pedidos).
const returnRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Recibimos varias solicitudes desde tu conexión. Esperá un rato o escribinos por WhatsApp." },
});

// Rutas públicas / semi-públicas
// DESACTIVADA: buscar pedidos por email. Nadie la usa y con ?email=% devolvía los pedidos de todos
// los clientes (ver la nota en lookupOrdersByEmail). Un pedido a /lookup ahora da 404.
// router.get("/lookup", lookupOrdersByEmail);

// Crear solicitud — público (el customerId es opcional). Antes: router.post("/", createReturnRequest);
router.post("/", returnRequestLimiter, validateReturnRequest, createReturnRequest);

// Rutas del cliente autenticado
router.get("/my", authMiddleware, customerMiddleware, getMyReturnRequests);

// Rutas del admin
router.get("/", authMiddleware, adminMiddleware, requireAnyPermission("devoluciones"), getAllReturnRequests);
router.patch("/:id/seen", authMiddleware, adminMiddleware, requireAnyPermission("devoluciones"), markReturnSeen);
router.patch("/:id/status", authMiddleware, adminMiddleware, requireAnyPermission("devoluciones"), updateReturnRequestStatus);

module.exports = router;

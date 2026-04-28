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
const { authMiddleware, adminMiddleware, customerMiddleware } = require("../middleware/auth.middleware");

// Rutas públicas / semi-públicas
// Buscar pedidos por email — público para que clientes sin cuenta puedan usar el form
router.get("/lookup", lookupOrdersByEmail);

// Crear solicitud — público (el form valida email + orderId; el customerId es opcional)
router.post("/", createReturnRequest);

// Rutas del cliente autenticado
router.get("/my", authMiddleware, customerMiddleware, getMyReturnRequests);

// Rutas del admin
router.get("/", authMiddleware, adminMiddleware, getAllReturnRequests);
router.patch("/:id/seen", authMiddleware, adminMiddleware, markReturnSeen);
router.patch("/:id/status", authMiddleware, adminMiddleware, updateReturnRequestStatus);

module.exports = router;

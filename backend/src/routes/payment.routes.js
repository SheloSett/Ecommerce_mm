const express = require("express");
const {
  createPreference,
  handleWebhook,
  getOrderPaymentStatus,
  createCotizacionPreference,
} = require("../controllers/payment.controller");
const { authMiddleware, customerMiddleware } = require("../middleware/auth.middleware");

const router = express.Router();

// Pública: crear preferencia de pago y webhook
router.post("/create-preference", createPreference);
router.post("/webhook", handleWebhook);
router.get("/order/:orderId/status", getOrderPaymentStatus);

// Cliente: crear preferencia de MP para pagar su cotización aprobada
router.post("/cotizacion-preference", authMiddleware, customerMiddleware, createCotizacionPreference);

module.exports = router;

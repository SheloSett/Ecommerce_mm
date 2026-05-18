const express = require("express");
const router = express.Router();
const {
  shippingRates,
  generateShipping,
  refreshTracking,
  updateTrackingManual,
} = require("../controllers/shipping.controller");
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");

// POST /api/shipping/rates — público: cotizar envío por código postal
router.post("/rates", shippingRates);

// POST /api/shipping/generate/:orderId — admin: generar envío en MiCorreo
router.post("/generate/:orderId", authMiddleware, adminMiddleware, generateShipping);

// GET /api/shipping/tracking/:orderId — admin: refrescar tracking desde MiCorreo
router.get("/tracking/:orderId", authMiddleware, adminMiddleware, refreshTracking);

// PATCH /api/shipping/tracking/:orderId — admin: ingresar tracking manualmente
router.patch("/tracking/:orderId", authMiddleware, adminMiddleware, updateTrackingManual);

module.exports = router;

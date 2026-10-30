const express = require("express");
const router = express.Router();
const {
  shippingRates,
  generateShipping,
  refreshTracking,
  updateTrackingManual,
} = require("../controllers/shipping.controller");
const { authMiddleware, adminMiddleware, requireAnyPermission } = require("../middleware/auth.middleware");

// POST /api/shipping/rates — DESMONTADA (30/10/2026). Era pública y el checkout ya no la usa (la opción
// Correo Argentino está comentada): cada llamada hacía que el servidor se logueara en MiCorreo con la
// cuenta de la tienda, y si el login fallaba lo reintentaba en cada pedido. Llamándola en bucle se podía
// hacer bloquear esa cuenta. Al reactivar los envíos: volver a montarla con un rate limit propio y
// cacheando las tarifas por código postal (y los errores de login por unos minutos).
// router.post("/rates", shippingRates);

// POST /api/shipping/generate/:orderId — admin: generar envío en MiCorreo
router.post("/generate/:orderId", authMiddleware, adminMiddleware, requireAnyPermission("ordenes"), generateShipping);

// GET /api/shipping/tracking/:orderId — admin: refrescar tracking desde MiCorreo
router.get("/tracking/:orderId", authMiddleware, adminMiddleware, requireAnyPermission("ordenes"), refreshTracking);

// PATCH /api/shipping/tracking/:orderId — admin: ingresar tracking manualmente
router.patch("/tracking/:orderId", authMiddleware, adminMiddleware, requireAnyPermission("ordenes"), updateTrackingManual);

module.exports = router;

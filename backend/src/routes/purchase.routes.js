const express = require("express");
const router  = express.Router();
const { authMiddleware, adminMiddleware, requireAnyPermission } = require("../middleware/auth.middleware");
const {
  getPurchases,
  getPurchaseById,
  createPurchase,
  updatePurchase,
  deletePurchase,
} = require("../controllers/purchase.controller");

// Todas las rutas requieren autenticación de admin
// FIX seguridad: antes solo tenían authMiddleware (token válido) → un cliente logueado podía
// leer/crear/editar/borrar compras (que suman stock y tocan costos). Ahora exigen rol admin.
router.get("/",    authMiddleware, adminMiddleware, requireAnyPermission("compras"), getPurchases);
router.get("/:id", authMiddleware, adminMiddleware, requireAnyPermission("compras"), getPurchaseById);
router.post("/",   authMiddleware, adminMiddleware, requireAnyPermission("compras"), createPurchase);
router.put("/:id",    authMiddleware, adminMiddleware, requireAnyPermission("compras"), updatePurchase); // editar compra (revierte y reaplica)
router.delete("/:id", authMiddleware, adminMiddleware, requireAnyPermission("compras"), deletePurchase); // eliminar compra (revierte su efecto)

module.exports = router;

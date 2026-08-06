const express = require("express");
const router  = express.Router();
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");
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
router.get("/",    authMiddleware, adminMiddleware, getPurchases);
router.get("/:id", authMiddleware, adminMiddleware, getPurchaseById);
router.post("/",   authMiddleware, adminMiddleware, createPurchase);
router.put("/:id",    authMiddleware, adminMiddleware, updatePurchase); // editar compra (revierte y reaplica)
router.delete("/:id", authMiddleware, adminMiddleware, deletePurchase); // eliminar compra (revierte su efecto)

module.exports = router;

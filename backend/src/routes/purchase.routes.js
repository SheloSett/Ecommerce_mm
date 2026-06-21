const express = require("express");
const router  = express.Router();
const { authMiddleware } = require("../middleware/auth.middleware");
const {
  getPurchases,
  getPurchaseById,
  createPurchase,
  updatePurchase,
  deletePurchase,
} = require("../controllers/purchase.controller");

// Todas las rutas requieren autenticación de admin
router.get("/",    authMiddleware, getPurchases);
router.get("/:id", authMiddleware, getPurchaseById);
router.post("/",   authMiddleware, createPurchase);
router.put("/:id",    authMiddleware, updatePurchase); // editar compra (revierte y reaplica)
router.delete("/:id", authMiddleware, deletePurchase); // eliminar compra (revierte su efecto)

module.exports = router;

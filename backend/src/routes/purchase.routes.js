const express = require("express");
const router  = express.Router();
const { authMiddleware } = require("../middleware/auth.middleware");
const {
  getPurchases,
  getPurchaseById,
  createPurchase,
} = require("../controllers/purchase.controller");

// Todas las rutas requieren autenticación de admin
router.get("/",    authMiddleware, getPurchases);
router.get("/:id", authMiddleware, getPurchaseById);
router.post("/",   authMiddleware, createPurchase);

module.exports = router;

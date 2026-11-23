const express = require("express");
const { getActivePromos, getPromos, createPromo, updatePromo, deletePromo } = require("../controllers/cartPromo.controller");
const { authMiddleware, adminMiddleware, requireAnyPermission } = require("../middleware/auth.middleware");

const router = express.Router();

// Pública: promos vigentes para el carrito y el checkout ("Te faltan $X para el 10%").
// Va ANTES de /:id para que Express no lea "active" como un id.
router.get("/active", getActivePromos);

// Admin: mismo permiso que los cupones (es un descuento sobre el total del pedido, como un cupón).
router.get("/", authMiddleware, adminMiddleware, requireAnyPermission("cupones"), getPromos);
router.post("/", authMiddleware, adminMiddleware, requireAnyPermission("cupones"), createPromo);
router.patch("/:id", authMiddleware, adminMiddleware, requireAnyPermission("cupones"), updatePromo);
router.delete("/:id", authMiddleware, adminMiddleware, requireAnyPermission("cupones"), deletePromo);

module.exports = router;

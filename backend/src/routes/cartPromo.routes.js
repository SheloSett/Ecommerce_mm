const express = require("express");
const { getActivePromos, getPromos, createPromo, updatePromo, deletePromo } = require("../controllers/cartPromo.controller");
const { authMiddleware, adminMiddleware, requireAnyPermission } = require("../middleware/auth.middleware");

const router = express.Router();

// Pública: promos vigentes para el carrito y el checkout ("Te faltan $X para el 10%").
// Va ANTES de /:id para que Express no lea "active" como un id.
router.get("/active", getActivePromos);

// Admin. Antes solo con el permiso de los cupones: requireAnyPermission("cupones"). La pantalla se movió
// adentro de Productos (al lado de Ofertas / Campañas), así que ahora alcanza con cualquiera de los dos.
router.get("/", authMiddleware, adminMiddleware, requireAnyPermission("productos", "cupones"), getPromos);
router.post("/", authMiddleware, adminMiddleware, requireAnyPermission("productos", "cupones"), createPromo);
router.patch("/:id", authMiddleware, adminMiddleware, requireAnyPermission("productos", "cupones"), updatePromo);
router.delete("/:id", authMiddleware, adminMiddleware, requireAnyPermission("productos", "cupones"), deletePromo);

module.exports = router;

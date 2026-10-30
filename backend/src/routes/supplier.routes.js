const express = require("express");
const {
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  geocodeAddresses,
} = require("../controllers/supplier.controller");
const { authMiddleware, adminMiddleware, requireAnyPermission } = require("../middleware/auth.middleware");

const router = express.Router();

// Todas las rutas de proveedores son solo para admin: los proveedores son
// información interna que no se expone a los clientes.
router.get("/", authMiddleware, adminMiddleware, requireAnyPermission("compras", "ordenes", "productos"), getSuppliers);
router.post("/", authMiddleware, adminMiddleware, requireAnyPermission("compras", "productos"), createSupplier);
router.put("/:id", authMiddleware, adminMiddleware, requireAnyPermission("compras"), updateSupplier);
router.delete("/:id", authMiddleware, adminMiddleware, requireAnyPermission("compras"), deleteSupplier);
// Ubica direcciones en el mapa para ordenar la orden de compra por recorrido a pie
router.post("/geocode", authMiddleware, adminMiddleware, requireAnyPermission("ordenes"), geocodeAddresses);

module.exports = router;

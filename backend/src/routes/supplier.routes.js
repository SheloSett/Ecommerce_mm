const express = require("express");
const {
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  geocodeAddresses,
} = require("../controllers/supplier.controller");
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");

const router = express.Router();

// Todas las rutas de proveedores son solo para admin: los proveedores son
// información interna que no se expone a los clientes.
router.get("/", authMiddleware, adminMiddleware, getSuppliers);
router.post("/", authMiddleware, adminMiddleware, createSupplier);
router.put("/:id", authMiddleware, adminMiddleware, updateSupplier);
router.delete("/:id", authMiddleware, adminMiddleware, deleteSupplier);
// Ubica direcciones en el mapa para ordenar la orden de compra por recorrido a pie
router.post("/geocode", authMiddleware, adminMiddleware, geocodeAddresses);

module.exports = router;

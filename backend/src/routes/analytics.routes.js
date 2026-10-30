const express = require("express");
const { getVentas, getOrigen, getEmbudo, getClientes, getStock, getOfertas, getInteres, getEnVivo } = require("../controllers/analytics.controller");
const { authMiddleware, adminMiddleware, requireAnyPermission } = require("../middleware/auth.middleware");

const router = express.Router();

// Sección "Analíticas" del panel admin — solo lectura, solo admin.
router.get("/ventas",   authMiddleware, adminMiddleware, requireAnyPermission("analiticas"), getVentas);
router.get("/origen",   authMiddleware, adminMiddleware, requireAnyPermission("analiticas"), getOrigen);
router.get("/embudo",   authMiddleware, adminMiddleware, requireAnyPermission("analiticas"), getEmbudo);
router.get("/clientes", authMiddleware, adminMiddleware, requireAnyPermission("analiticas"), getClientes);
router.get("/stock",    authMiddleware, adminMiddleware, requireAnyPermission("analiticas"), getStock);
router.get("/ofertas",  authMiddleware, adminMiddleware, requireAnyPermission("analiticas"), getOfertas);
router.get("/interes",  authMiddleware, adminMiddleware, requireAnyPermission("analiticas"), getInteres);
router.get("/en-vivo",  authMiddleware, adminMiddleware, requireAnyPermission("analiticas"), getEnVivo);

module.exports = router;

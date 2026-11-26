const express = require("express");
const { getVentas, getOrigen, getEmbudo, getClientes, getStock, getOfertas, getInteres, getEnVivo, getRecorrido, getRecorridoPersona } = require("../controllers/analytics.controller");
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
// Recorrido por cliente (26/11/2026): quién anduvo por la tienda y qué buscó / miró
router.get("/recorrido",      authMiddleware, adminMiddleware, requireAnyPermission("analiticas"), getRecorrido);
router.get("/recorrido/:key", authMiddleware, adminMiddleware, requireAnyPermission("analiticas"), getRecorridoPersona);

module.exports = router;

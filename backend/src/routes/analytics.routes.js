const express = require("express");
const { getVentas, getOrigen, getEmbudo, getClientes, getStock, getOfertas, getInteres, getEnVivo } = require("../controllers/analytics.controller");
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");

const router = express.Router();

// Sección "Analíticas" del panel admin — solo lectura, solo admin.
router.get("/ventas",   authMiddleware, adminMiddleware, getVentas);
router.get("/origen",   authMiddleware, adminMiddleware, getOrigen);
router.get("/embudo",   authMiddleware, adminMiddleware, getEmbudo);
router.get("/clientes", authMiddleware, adminMiddleware, getClientes);
router.get("/stock",    authMiddleware, adminMiddleware, getStock);
router.get("/ofertas",  authMiddleware, adminMiddleware, getOfertas);
router.get("/interes",  authMiddleware, adminMiddleware, getInteres);
router.get("/en-vivo",  authMiddleware, adminMiddleware, getEnVivo);

module.exports = router;

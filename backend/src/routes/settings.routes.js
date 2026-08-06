const express = require("express");
const router  = express.Router();
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");
const { getSettings, updateSettings } = require("../controllers/settings.controller");

// GET: público (el frontend necesita leer el tema y estado de mantenimiento sin auth)
router.get("/", getSettings);

// PUT: solo admin (para cambiar tema, activar mantenimiento, etc.)
// FIX seguridad: antes solo tenía authMiddleware → cualquier cliente logueado podía cambiar la
// config del sitio (activar mantenimiento, cambiar el anuncio). Ahora exige rol admin.
router.put("/", authMiddleware, adminMiddleware, updateSettings);

module.exports = router;

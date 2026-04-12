const express = require("express");
const router  = express.Router();
const { authMiddleware } = require("../middleware/auth.middleware");
const { getSettings, updateSettings } = require("../controllers/settings.controller");

// GET: público (el frontend necesita leer el tema y estado de mantenimiento sin auth)
router.get("/", getSettings);

// PUT: solo admin (para cambiar tema, activar mantenimiento, etc.)
router.put("/", authMiddleware, updateSettings);

module.exports = router;

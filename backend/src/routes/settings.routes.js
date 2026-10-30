const express = require("express");
const router  = express.Router();
const { authMiddleware, adminMiddleware, requireAnyPermission, hasPermission, denyPermission } = require("../middleware/auth.middleware");
const { getSettings, updateSettings, testMetaConnection } = require("../controllers/settings.controller");

// Permisos del panel (A2): con "configuracion" se guarda todo. Con "emails" (sin "configuracion") solo lo
// de Emails → Automatizaciones: la campaña automática (claves emailMinorista*) y el recordatorio de carrito
// (emailAbandonedCart). Antes cualquier admin podía cambiar toda la configuración (mantenimiento, Meta,
// textos del sitio…).
const EMAIL_AUTOMATION_KEY = /^(emailMinorista|emailAbandonedCart$)/;
function settingsWriteAccess(req, res, next) {
  if (hasPermission(req.user, "configuracion")) return next();
  const keys = Object.keys(req.body || {});
  const onlyEmailCampaign = keys.length > 0 && keys.every((k) => EMAIL_AUTOMATION_KEY.test(k));
  if (onlyEmailCampaign && hasPermission(req.user, "emails")) return next();
  denyPermission(req, res, next, ["configuracion"]);
}

// GET: público (el frontend necesita leer el tema y estado de mantenimiento sin auth)
router.get("/", getSettings);

// PUT: solo admin (para cambiar tema, activar mantenimiento, etc.)
// FIX seguridad: antes solo tenía authMiddleware → cualquier cliente logueado podía cambiar la
// config del sitio (activar mantenimiento, cambiar el anuncio). Ahora exige rol admin.
router.put("/", authMiddleware, adminMiddleware, settingsWriteAccess, updateSettings);

// POST: prueba de conexión con Meta (Pixel + API de conversiones), solo admin
router.post("/meta/test", authMiddleware, adminMiddleware, requireAnyPermission("configuracion"), testMetaConnection);

module.exports = router;

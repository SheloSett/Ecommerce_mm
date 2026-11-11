// Mercado Libre en el panel (/api/ml). La dirección pública de avisos va aparte, en mlWebhook.routes.js.
//
// Permisos: conectar, desconectar y cambiar el modo, solo el superadministrador (es la cuenta de
// ventas de la tienda). Ver el estado: Configuración o Productos. Publicaciones y vínculos: Productos.
const express = require("express");
const router  = express.Router();
const { authMiddleware, adminMiddleware, superAdminMiddleware, requireAnyPermission } = require("../middleware/auth.middleware");
const ml = require("../controllers/ml.controller");

router.get("/status",            authMiddleware, adminMiddleware, requireAnyPermission("configuracion", "productos"), ml.getStatus);
router.post("/oauth/start",      authMiddleware, adminMiddleware, superAdminMiddleware, ml.startOAuth);
router.post("/oauth/exchange",   authMiddleware, adminMiddleware, superAdminMiddleware, ml.exchangeOAuth);
router.post("/disconnect",       authMiddleware, adminMiddleware, superAdminMiddleware, ml.disconnect);
router.put("/settings",          authMiddleware, adminMiddleware, superAdminMiddleware, ml.updateSettings);

router.post("/listings/refresh", authMiddleware, adminMiddleware, requireAnyPermission("productos"), ml.refresh);
router.get("/pools",             authMiddleware, adminMiddleware, requireAnyPermission("productos"), ml.listPools);
router.get("/units",             authMiddleware, adminMiddleware, requireAnyPermission("productos"), ml.searchUnits);
router.get("/pools/:id/cycles",  authMiddleware, adminMiddleware, requireAnyPermission("productos"), ml.poolCycles);
router.get("/pools/:id/peek",    authMiddleware, adminMiddleware, requireAnyPermission("productos"), ml.peekPool);
router.post("/pools/:id/link",       authMiddleware, adminMiddleware, requireAnyPermission("productos"), ml.linkPool);
router.post("/pools/:id/unlink",     authMiddleware, adminMiddleware, requireAnyPermission("productos"), ml.unlinkPool);
router.post("/pools/:id/activate",   authMiddleware, adminMiddleware, requireAnyPermission("productos"), ml.activatePool);
router.post("/pools/:id/deactivate", authMiddleware, adminMiddleware, requireAnyPermission("productos"), ml.deactivate);
router.post("/pools/:id/resolve",    authMiddleware, adminMiddleware, requireAnyPermission("productos"), ml.resolvePool);
router.post("/pools/:id/check",      authMiddleware, adminMiddleware, requireAnyPermission("productos"), ml.checkPool);

module.exports = router;

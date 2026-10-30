const express = require("express");
const {
  getActiveOffers,
  getOffers,
  getOffer,
  createOffer,
  updateOffer,
  deleteOffer,
  syncOfferNow,
  previewOfferPrices,
} = require("../controllers/offer.controller");
const { authMiddleware, adminMiddleware, requireAnyPermission, hasPermission, denyPermission } = require("../middleware/auth.middleware");

const router = express.Router();

// Permisos del panel (A2): editar una campaña pide "productos". Con "emails" solo se puede prender o
// apagar el aviso por email de la campaña (el botón de Emails), no cambiar precios ni productos.
function offerPatchAccess(req, res, next) {
  if (hasPermission(req.user, "productos")) return next();
  const keys = Object.keys(req.body || {});
  if (keys.length === 1 && keys[0] === "emailAnnounce" && hasPermission(req.user, "emails")) return next();
  denyPermission(req, res, next, ["productos"]);
}

// Pública: campañas vigentes para renderizar sus secciones en el Home.
// Va ANTES de cualquier ruta con :id para que Express no lea "active" como un id.
router.get("/active", getActiveOffers);

// Admin
router.get("/", authMiddleware, adminMiddleware, requireAnyPermission("productos", "emails"), getOffers);
// Preview de precios — antes de /:id por el mismo motivo que /active
router.post("/preview", authMiddleware, adminMiddleware, requireAnyPermission("productos"), previewOfferPrices);
router.get("/:id", authMiddleware, adminMiddleware, requireAnyPermission("productos"), getOffer);
router.post("/", authMiddleware, adminMiddleware, requireAnyPermission("productos"), createOffer);
router.patch("/:id", authMiddleware, adminMiddleware, offerPatchAccess, updateOffer);
router.post("/:id/sync", authMiddleware, adminMiddleware, requireAnyPermission("productos"), syncOfferNow);
router.delete("/:id", authMiddleware, adminMiddleware, requireAnyPermission("productos"), deleteOffer);

module.exports = router;

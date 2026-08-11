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
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");

const router = express.Router();

// Pública: campañas vigentes para renderizar sus secciones en el Home.
// Va ANTES de cualquier ruta con :id para que Express no lea "active" como un id.
router.get("/active", getActiveOffers);

// Admin
router.get("/", authMiddleware, adminMiddleware, getOffers);
// Preview de precios — antes de /:id por el mismo motivo que /active
router.post("/preview", authMiddleware, adminMiddleware, previewOfferPrices);
router.get("/:id", authMiddleware, adminMiddleware, getOffer);
router.post("/", authMiddleware, adminMiddleware, createOffer);
router.patch("/:id", authMiddleware, adminMiddleware, updateOffer);
router.post("/:id/sync", authMiddleware, adminMiddleware, syncOfferNow);
router.delete("/:id", authMiddleware, adminMiddleware, deleteOffer);

module.exports = router;

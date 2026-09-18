const express = require("express");
const { getSlides, createSlide, updateSlide, deleteSlide } = require("../controllers/slide.controller");
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");
const { verifyImageBytes } = require("../middleware/upload.middleware");

const router = express.Router();

// image = banner ancho (compu/tablet) · mobileImage = versión para celular (opcional)
const slideUpload = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "mobileImage", maxCount: 1 },
]);

// Pública: obtener slides activos para el carrusel del home
router.get("/", getSlides);

// Admin: crear/editar/eliminar slides
router.post("/", authMiddleware, adminMiddleware, slideUpload, verifyImageBytes, createSlide);
router.patch("/:id", authMiddleware, adminMiddleware, slideUpload, verifyImageBytes, updateSlide);
router.delete("/:id", authMiddleware, adminMiddleware, deleteSlide);

module.exports = router;

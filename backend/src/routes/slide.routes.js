const express = require("express");
const { getSlides, createSlide, updateSlide, deleteSlide } = require("../controllers/slide.controller");
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");
const { verifyImageBytes } = require("../middleware/upload.middleware");

const router = express.Router();

// Pública: obtener slides activos para el carrusel del home
router.get("/", getSlides);

// Admin: crear/editar/eliminar slides
router.post("/", authMiddleware, adminMiddleware, upload.single("image"), verifyImageBytes, createSlide);
router.patch("/:id", authMiddleware, adminMiddleware, upload.single("image"), verifyImageBytes, updateSlide);
router.delete("/:id", authMiddleware, adminMiddleware, deleteSlide);

module.exports = router;

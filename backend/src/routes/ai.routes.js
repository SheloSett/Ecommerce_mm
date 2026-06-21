const express = require("express");
const { suggestText, suggestImages } = require("../controllers/ai.controller");
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");
const { verifyImageBytes } = require("../middleware/upload.middleware");

const router = express.Router();

// Ambos endpoints son solo para admin y reciben UNA imagen (campo "image").
// suggest-text: foto → { name, description, sku }
// suggest-images: foto → variantes generadas (el admin elige cuáles agregar)
router.post("/suggest-text",   authMiddleware, adminMiddleware, upload.single("image"), verifyImageBytes, suggestText);
router.post("/suggest-images", authMiddleware, adminMiddleware, upload.single("image"), verifyImageBytes, suggestImages);

module.exports = router;

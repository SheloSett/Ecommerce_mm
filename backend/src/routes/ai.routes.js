const express = require("express");
const { suggestText, suggestImages } = require("../controllers/ai.controller");
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");
const { verifyImageBytes } = require("../middleware/upload.middleware");

const router = express.Router();

// Ambos endpoints son solo para admin.
// suggest-text: fotos → { name, description, sku, weight, length, width, height, measuresSource }.
//   Acepta varias fotos en "images" (la etiqueta del empaque suele estar en otra) o una en "image".
//   Antes: upload.single("image")
// suggest-images: UNA foto (campo "image") → variantes generadas (el admin elige cuáles agregar)
router.post("/suggest-text",   authMiddleware, adminMiddleware, upload.fields([{ name: "images", maxCount: 5 }, { name: "image", maxCount: 1 }]), verifyImageBytes, suggestText);
router.post("/suggest-images", authMiddleware, adminMiddleware, upload.single("image"), verifyImageBytes, suggestImages);

module.exports = router;

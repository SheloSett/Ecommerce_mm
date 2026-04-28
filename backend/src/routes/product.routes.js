const express = require("express");
const {
  getProducts,
  getProductsAdmin,
  getProduct,
  createProduct,
  updateProduct,
  quickUpdateProduct,
  deleteProduct,
  bulkPriceAdjust,
  getProductFacets,
} = require("../controllers/product.controller");
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");
const { verifyImageBytes } = require("../middleware/upload.middleware");

const router = express.Router();

// Rutas públicas
router.get("/", getProducts);
// Facetas de atributos para filtros dinámicos en el catálogo — debe ir ANTES de /:id
router.get("/facets", getProductFacets);
router.get("/:id", getProduct);

// Rutas de admin (requieren autenticación)
router.get("/admin/all", authMiddleware, adminMiddleware, getProductsAdmin);
router.post("/", authMiddleware, adminMiddleware, upload.array("images", 10), verifyImageBytes, createProduct);
router.put("/:id", authMiddleware, adminMiddleware, upload.array("images", 10), verifyImageBytes, updateProduct);
// Edición rápida: actualiza campos simples sin multipart (precio, stock, estado, precios especiales)
router.patch("/:id/quick", authMiddleware, adminMiddleware, quickUpdateProduct);
// Ajuste masivo de precios por porcentaje (suma o resta) para MINORISTA, MAYORISTA o AMBOS
// Va ANTES de /:id para que Express no confunda "bulk-price-adjust" con un id
router.post("/bulk-price-adjust", authMiddleware, adminMiddleware, bulkPriceAdjust);
router.delete("/:id", authMiddleware, adminMiddleware, deleteProduct);

module.exports = router;

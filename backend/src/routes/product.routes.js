const express = require("express");
const {
  getProducts,
  getProductsAdmin,
  getProduct,
  createProduct,
  updateProduct,
  quickUpdateProduct,
  deleteProduct,
} = require("../controllers/product.controller");
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");
const { verifyImageBytes } = require("../middleware/upload.middleware");

const router = express.Router();

// Rutas públicas
router.get("/", getProducts);
router.get("/:id", getProduct);

// Rutas de admin (requieren autenticación)
router.get("/admin/all", authMiddleware, adminMiddleware, getProductsAdmin);
router.post("/", authMiddleware, adminMiddleware, upload.array("images", 10), verifyImageBytes, createProduct);
router.put("/:id", authMiddleware, adminMiddleware, upload.array("images", 10), verifyImageBytes, updateProduct);
// Edición rápida: actualiza campos simples sin multipart (precio, stock, estado, precios especiales)
router.patch("/:id/quick", authMiddleware, adminMiddleware, quickUpdateProduct);
router.delete("/:id", authMiddleware, adminMiddleware, deleteProduct);

module.exports = router;

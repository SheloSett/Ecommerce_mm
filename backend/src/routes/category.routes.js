const express = require("express");
const {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getRuleMatchesForProduct,
} = require("../controllers/category.controller");
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");

const router = express.Router();

// Pública: ver categorías
router.get("/", getCategories);

// Admin: categorías con regla en las que cae un producto (la ficha las muestra como automáticas)
router.get("/rule-matches/:productId", authMiddleware, adminMiddleware, getRuleMatchesForProduct);

// Admin: crear, editar, borrar
router.post("/", authMiddleware, adminMiddleware, createCategory);
router.put("/:id", authMiddleware, adminMiddleware, updateCategory);
router.delete("/:id", authMiddleware, adminMiddleware, deleteCategory);

module.exports = router;

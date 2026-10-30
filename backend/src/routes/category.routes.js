const express = require("express");
const {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getRuleMatchesForProduct,
} = require("../controllers/category.controller");
const { authMiddleware, adminMiddleware, requireAnyPermission } = require("../middleware/auth.middleware");

const router = express.Router();

// Pública: ver categorías
router.get("/", getCategories);

// Admin: categorías con regla en las que cae un producto (la ficha las muestra como automáticas)
router.get("/rule-matches/:productId", authMiddleware, adminMiddleware, requireAnyPermission("productos"), getRuleMatchesForProduct);

// Admin: crear, editar, borrar
router.post("/", authMiddleware, adminMiddleware, requireAnyPermission("categorias", "productos"), createCategory);
router.put("/:id", authMiddleware, adminMiddleware, requireAnyPermission("categorias"), updateCategory);
router.delete("/:id", authMiddleware, adminMiddleware, requireAnyPermission("categorias"), deleteCategory);

module.exports = router;

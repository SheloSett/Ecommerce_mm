const express = require("express");
const {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require("../controllers/category.controller");
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");

const router = express.Router();

// Pública: ver categorías
router.get("/", getCategories);

// Admin: crear, editar, borrar
router.post("/", authMiddleware, adminMiddleware, createCategory);
router.put("/:id", authMiddleware, adminMiddleware, updateCategory);
router.delete("/:id", authMiddleware, adminMiddleware, deleteCategory);

module.exports = router;

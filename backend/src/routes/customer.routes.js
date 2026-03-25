const express = require("express");
const router = express.Router();
const {
  register,
  customerLogin,
  getAll,
  updateStatus,
  updateType,
  updateCustomer,
  deleteCustomer,
  getMe,
  updateMe,
  changeEmail,
  uploadAvatar,
} = require("../controllers/customer.controller");
const { authMiddleware, adminMiddleware, customerMiddleware } = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");

// Rutas públicas
router.post("/register", register);
router.post("/login", customerLogin);

// Rutas self-service: el propio cliente autenticado gestiona su perfil
// IMPORTANTE: deben ir ANTES de /:id para que "/me" no sea interpretado como un id
router.get("/me", authMiddleware, customerMiddleware, getMe);
router.put("/me", authMiddleware, customerMiddleware, updateMe);
router.put("/me/email", authMiddleware, customerMiddleware, changeEmail);
router.post("/me/avatar", authMiddleware, customerMiddleware, upload.single("avatar"), uploadAvatar);

// Rutas protegidas: solo el admin puede gestionar clientes
router.get("/", authMiddleware, adminMiddleware, getAll);
router.patch("/:id/status", authMiddleware, adminMiddleware, updateStatus);
router.patch("/:id/type", authMiddleware, adminMiddleware, updateType);
router.put("/:id", authMiddleware, adminMiddleware, updateCustomer);
router.delete("/:id", authMiddleware, adminMiddleware, deleteCustomer);

module.exports = router;

const express = require("express");
const rateLimit = require("express-rate-limit");
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
  // changeEmail, // REEMPLAZADO por el sistema de solicitudes
  uploadAvatar,
  requestEmailChange,
  getMyEmailChangeRequest,
  getAllEmailChangeRequests,
  approveEmailChangeRequest,
  rejectEmailChangeRequest,
  createCustomerAdmin,
} = require("../controllers/customer.controller");
const { authMiddleware, adminMiddleware, customerMiddleware } = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");
const { verifyImageBytes } = require("../middleware/upload.middleware");
const { validateRegister, validateCustomerLogin } = require("../middleware/validate.middleware");

// Rate limiter estricto para registro y login de clientes
// Mitiga creación masiva de cuentas falsas y ataques de fuerza bruta
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Esperá 15 minutos e intentá de nuevo." },
});

// Rutas públicas
router.post("/register", authLimiter, validateRegister, register);
router.post("/login", authLimiter, validateCustomerLogin, customerLogin);

// Rutas self-service: el propio cliente autenticado gestiona su perfil
// IMPORTANTE: deben ir ANTES de /:id para que "/me" no sea interpretado como un id
router.get("/me", authMiddleware, customerMiddleware, getMe);
router.put("/me", authMiddleware, customerMiddleware, updateMe);
// router.put("/me/email", authMiddleware, customerMiddleware, changeEmail); // REEMPLAZADO
router.post("/me/avatar", authMiddleware, customerMiddleware, upload.single("avatar"), verifyImageBytes, uploadAvatar);

// Solicitudes de cambio de email (cliente)
router.post("/me/email-change-request", authMiddleware, customerMiddleware, requestEmailChange);
router.get("/me/email-change-request",  authMiddleware, customerMiddleware, getMyEmailChangeRequest);

// Rutas protegidas: solo el admin puede gestionar clientes
// IMPORTANTE: /admin/create debe ir ANTES de /:id
router.post("/admin/create", authMiddleware, adminMiddleware, createCustomerAdmin);
router.get("/", authMiddleware, adminMiddleware, getAll);

// Solicitudes de cambio de email (admin)
router.get("/email-change-requests",                     authMiddleware, adminMiddleware, getAllEmailChangeRequests);
router.patch("/email-change-requests/:id/approve",       authMiddleware, adminMiddleware, approveEmailChangeRequest);
router.patch("/email-change-requests/:id/reject",        authMiddleware, adminMiddleware, rejectEmailChangeRequest);
router.patch("/:id/status", authMiddleware, adminMiddleware, updateStatus);
router.patch("/:id/type", authMiddleware, adminMiddleware, updateType);
router.put("/:id", authMiddleware, adminMiddleware, updateCustomer);
router.delete("/:id", authMiddleware, adminMiddleware, deleteCustomer);

module.exports = router;

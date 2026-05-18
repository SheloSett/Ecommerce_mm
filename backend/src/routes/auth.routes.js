const express = require("express");
// rateLimit: movido a middleware/loginLimiter.js para poder resetearlo desde el controller tras login exitoso
// const rateLimit = require("express-rate-limit");
const { login, changePassword, me, updateProfile } = require("../controllers/auth.controller");
const { authMiddleware } = require("../middleware/auth.middleware");
const { validateLogin } = require("../middleware/validate.middleware");
const { loginLimiter } = require("../middleware/loginLimiter");

const router = express.Router();

// loginLimiter: 10 intentos por IP cada 5 min — se resetea automáticamente tras un login exitoso
// Antes era 5 intentos cada 15 min (sin reset en éxito) — ahora definido en middleware/loginLimiter.js

router.post("/login", loginLimiter, validateLogin, login);
router.get("/me", authMiddleware, me);
router.put("/change-password", authMiddleware, changePassword);
router.put("/profile", authMiddleware, updateProfile);

module.exports = router;

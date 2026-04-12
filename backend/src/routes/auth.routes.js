const express = require("express");
const rateLimit = require("express-rate-limit");
const { login, changePassword, me } = require("../controllers/auth.controller");
const { authMiddleware } = require("../middleware/auth.middleware");
const { validateLogin } = require("../middleware/validate.middleware");

const router = express.Router();

// Rate limiter estricto para login: máx 5 intentos por IP cada 15 min
// Mitiga ataques de fuerza bruta contra las credenciales del admin
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de login. Esperá 15 minutos e intentá de nuevo." },
});

router.post("/login", loginLimiter, validateLogin, login);
router.get("/me", authMiddleware, me);
router.put("/change-password", authMiddleware, changePassword);

module.exports = router;

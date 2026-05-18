const rateLimit = require("express-rate-limit");

// Límite de intentos de login para el panel admin.
// Se expone como módulo compartido para que auth.controller.js pueda
// llamar loginLimiter.resetKey(ip) y reiniciar el contador tras un login exitoso.
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de login. Esperá 5 minutos e intentá de nuevo." },
});

module.exports = { loginLimiter };

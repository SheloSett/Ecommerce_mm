const express = require("express");
// rateLimit: movido a middleware/loginLimiter.js para poder resetearlo desde el controller tras login exitoso
// const rateLimit = require("express-rate-limit");
const { login, changePassword, me, updateProfile } = require("../controllers/auth.controller");
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");
const { validateLogin } = require("../middleware/validate.middleware");
const { loginLimiter } = require("../middleware/loginLimiter");

const router = express.Router();

// loginLimiter: 10 intentos por IP cada 5 min — se resetea automáticamente tras un login exitoso
// Antes era 5 intentos cada 15 min (sin reset en éxito) — ahora definido en middleware/loginLimiter.js

router.post("/login", loginLimiter, validateLogin, login);
// Rutas del panel: operan sobre la tabla de admins (users) con el id del token. Antes alcanzaba con
// cualquier token válido, y un CLIENTE cuyo id coincidiera con el de un admin (son tablas distintas,
// las dos arrancan en 1) veía el email y los permisos de ese admin y le podía cambiar el email.
// Antes: router.get("/me", authMiddleware, me); (ídem change-password y profile)
router.get("/me", authMiddleware, adminMiddleware, me);
router.put("/change-password", authMiddleware, adminMiddleware, changePassword);
router.put("/profile", authMiddleware, adminMiddleware, updateProfile);

module.exports = router;

const rateLimit = require("express-rate-limit");
const { isCloudflareIp } = require("../utils/cloudflareIp");

// Límites del login de CLIENTES (A3 de la auditoría del 28/10/2026).
//
// Historia: había un límite de 8 intentos cada 15 min por IP y se sacó ("los clientes no deben tener
// límite de intentos de login"). El problema real era que el backend veía la IP del nodo de Cloudflare
// y no la del cliente: muchos clientes compartían un mismo contador y a gente que no había hecho nada le
// salía "Demasiados intentos". Sin límite, en cambio, se podía probar contraseñas sin freno.
//
// Ahora, contando SOLO los intentos fallidos (un login correcto nunca suma, así que un cliente normal no
// se entera de que existe):
//  - por cuenta: 10 contraseñas incorrectas para el mismo email en 15 min traban ESE email 15 min. Frena
//    a quien intenta adivinar la contraseña de alguien. Un login correcto le vuelve el contador a cero.
//  - por IP: 30 fallidos en 15 min desde la misma conexión. Frena a quien prueba muchas cuentas.
//    Si la IP es de Cloudflare (Caddy todavía sin la config de CF-Connecting-IP) este límite no se
//    aplica, para no volver a castigar a todos los clientes juntos.

const WINDOW_MS = 15 * 60 * 1000;
const accountKey = (req) => `cuenta:${String(req.body?.email || "").trim().toLowerCase()}`;

const loginByAccountLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  skipSuccessfulRequests: true,
  keyGenerator: accountKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos con este email. Probá de nuevo en 15 minutos o recuperá tu contraseña." },
});

const loginByIpLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 30,
  skipSuccessfulRequests: true,
  skip: (req) => isCloudflareIp(req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos fallidos desde tu conexión. Probá de nuevo en 15 minutos." },
});

// Después de un login correcto: el contador de ESA cuenta vuelve a cero. El de la IP no, a propósito:
// si no, alguien podría alternar intentos contra otras cuentas con logins a la suya para resetearlo.
function resetAccountLoginLimit(req) {
  try { loginByAccountLimiter.resetKey(accountKey(req)); } catch { /* el límite nunca rompe el login */ }
}

module.exports = { loginByAccountLimiter, loginByIpLimiter, resetAccountLoginLimit };

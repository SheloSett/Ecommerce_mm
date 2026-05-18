// Rutas de testing para admins — disparar manualmente jobs que normalmente corren por cron.
// Útiles para verificar que los emails automáticos se envían bien sin tener que esperar
// los thresholds reales (20 días mayoristas, semanal minoristas).
const express = require("express");
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");
const {
  forceRestockEmailForEmail,
  forceRecommendationEmailForEmail,
} = require("../services/cron.service");

const router = express.Router();

// Todas las rutas requieren admin autenticado
router.use(authMiddleware, adminMiddleware);

// Lista blanca de mensajes seguros para exponer al cliente.
// Errores de Prisma u otros sistemas se loggean al servidor pero NUNCA se envían al frontend
// — esos mensajes pueden contener el schema completo de la DB (info sensible).
const SAFE_ERROR_MESSAGES = new Set([
  "Falta email del cliente destino",
  "Cliente no encontrado",
  "El cliente no es mayorista",
  "El cliente no es minorista",
  "El cliente no tiene pedidos aprobados",
  "No hay productos para recomendar",
]);

function sanitizeError(err, fallback = "Error interno al procesar la solicitud") {
  // Loggear el error completo para debugging (solo en servidor)
  console.error("[admin-test] Error:", err);
  // Solo devolver mensajes que estén en la lista blanca
  if (err && err.message && SAFE_ERROR_MESSAGES.has(err.message)) {
    return err.message;
  }
  return fallback;
}

// POST /api/admin-test/email-restock  body: { email }
router.post("/email-restock", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Falta email del cliente destino" });
    const result = await forceRestockEmailForEmail(email);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: sanitizeError(err) });
  }
});

// POST /api/admin-test/email-recommendation  body: { email }
router.post("/email-recommendation", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Falta email del cliente destino" });
    const result = await forceRecommendationEmailForEmail(email);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: sanitizeError(err) });
  }
});

module.exports = router;

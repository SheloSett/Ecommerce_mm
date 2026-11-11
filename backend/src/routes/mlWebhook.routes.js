// Dirección pública de avisos de Mercado Libre: POST /api/ml/webhook/<ML_WEBHOOK_TOKEN>.
// Se monta en index.js ANTES del límite general de /api y del lector de JSON general, con su propio
// límite de pedidos y de tamaño. Ver ml.controller.webhook.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { webhook, webhookGate } = require("../controllers/ml.controller");

const router = express.Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados avisos" },
});

router.post("/:token", webhookLimiter, webhookGate, express.json({ limit: "10kb" }), webhook);
// Cualquier otra cosa en esta dirección: lo mismo que una ruta inexistente.
router.all("*", (req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

module.exports = router;

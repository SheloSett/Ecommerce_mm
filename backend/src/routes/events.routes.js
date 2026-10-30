const express = require("express");
const rateLimit = require("express-rate-limit");
const { track, ping, contact } = require("../controllers/events.controller");
const { reportError } = require("../services/errorAlerts.service");

const router = express.Router();

// Errores del navegador (main.jsx → AppErrorBoundary): se registran y se avisan al admin por email.
// Pública porque el error le pasa a cualquier visitante: tope por IP, textos recortados, y el servicio
// de alertas limita los emails (mismo error una vez cada 15 min, y un máximo por hora).
const clientErrorLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
router.post("/client-error", clientErrorLimiter, (req, res) => {
  const text = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  const message = text(req.body?.message, 500);
  if (!message) return res.sendStatus(400);
  reportError("navegador", message, `${text(req.body?.url, 300)}\n${text(req.body?.stack, 3000)}`);
  res.sendStatus(204);
});

// Públicas: las llama el storefront (visitantes anónimos o clientes logueados).
// Si viene el token del cliente se usa para identificarlo; si no, el evento es anónimo.
router.post("/", track);
router.post("/ping", ping);
// Clic en WhatsApp → "Contact" a Meta por la API de conversiones (mismo event_id que el Pixel).
// Antes no tenía tope propio (solo el general de 1500 cada 15 min) y cada event_id inventado contaba
// como un contacto nuevo: un script podía inflar los "Contact" y Meta optimizaba los anuncios hacia
// tráfico basura. Ahora: hasta 10 por hora por IP y cada event_id una sola vez.
const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const seenContactIds = new Map(); // eventId → cuándo se vio (se limpia solo a la hora)
function dedupeContact(req, res, next) {
  const id = typeof req.body?.eventId === "string" ? req.body.eventId : "";
  const now = Date.now();
  for (const [k, t] of seenContactIds) if (now - t > 60 * 60 * 1000) seenContactIds.delete(k);
  if (id && seenContactIds.has(id)) return res.status(200).json({ ok: true, duplicado: true });
  if (id) seenContactIds.set(id, now);
  next();
}
router.post("/contact", contactLimiter, dedupeContact, contact);

module.exports = router;

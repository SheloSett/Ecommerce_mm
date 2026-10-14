const express = require("express");
const { track, ping, contact } = require("../controllers/events.controller");

const router = express.Router();

// Públicas: las llama el storefront (visitantes anónimos o clientes logueados).
// Si viene el token del cliente se usa para identificarlo; si no, el evento es anónimo.
router.post("/", track);
router.post("/ping", ping);
// Clic en WhatsApp → "Contact" a Meta por la API de conversiones (mismo event_id que el Pixel)
router.post("/contact", contact);

module.exports = router;

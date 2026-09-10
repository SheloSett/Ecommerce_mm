const express = require("express");
const { track, ping } = require("../controllers/events.controller");

const router = express.Router();

// Públicas: las llama el storefront (visitantes anónimos o clientes logueados).
// Si viene el token del cliente se usa para identificarlo; si no, el evento es anónimo.
router.post("/", track);
router.post("/ping", ping);

module.exports = router;

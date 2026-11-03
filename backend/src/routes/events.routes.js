const express = require("express");
const rateLimit = require("express-rate-limit");
const { track, ping, contact } = require("../controllers/events.controller");
const { reportError } = require("../services/errorAlerts.service");

const router = express.Router();

// Errores del navegador (main.jsx → AppErrorBoundary): se registran y se avisan al admin por email.
// Pública porque el error le pasa a cualquier visitante: tope por IP, textos recortados, y el servicio
// de alertas limita los emails (mismo error una vez cada 15 min, y un máximo por hora).
//
// "Failed to fetch dynamically imported module": al visitante no le bajó un archivo de la tienda. Casi
// siempre es su conexión (datos móviles, un corte), que no es un error de la tienda, y antes llegaba un
// email por cada uno. Ahora se mira si el archivo está en el servidor: si está, queda solo en el log; si
// no está (un deploy que salió mal), el email sale como siempre.
const clientErrorLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
// La misma expresión que ERROR_DE_DESCARGA en frontend/src/main.jsx: si se agrega un mensaje nuevo, va en los dos.
const DOWNLOAD_ERROR = /dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk/i;

// true: el archivo está; false: no está; null: no se pudo saber (se avisa igual). Solo se consulta la
// propia tienda (FRONTEND_URL): la ruta es pública y no tiene que servir para hacerle pedidos a otros sitios.
// Lo consultado se recuerda 10 minutos: el mismo archivo no se pide una vez por cada visitante.
const ASSET_CACHE_MS = 10 * 60 * 1000;
const assetCache = new Map(); // url → { exists, at }
let lastFetchWarn = 0;
async function assetExists(message) {
  const base = process.env.FRONTEND_URL;
  const found = message.match(/https?:\/\/[^\s"')]+/);
  if (!base || !found) return null;
  let url;
  try {
    url = new URL(found[0]);
    if (url.origin !== new URL(base).origin) return null;
  } catch { return null; }
  const cached = assetCache.get(url.href);
  if (cached && Date.now() - cached.at < ASSET_CACHE_MS) return cached.exists;
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5000) });
    // nginx responde index.html (200, text/html) a cualquier ruta que no existe: eso es "no está"
    const exists = res.status === 200 && !/text\/html/i.test(res.headers.get("content-type") || "");
    if (assetCache.size > 200) assetCache.clear();
    assetCache.set(url.href, { exists, at: Date.now() });
    return exists;
  } catch (err) {
    // Si el servidor no llega a su propia tienda (DNS o red del contenedor), que se vea en el log
    if (Date.now() - lastFetchWarn > 60 * 60 * 1000) {
      lastFetchWarn = Date.now();
      console.warn(`[navegador] No se pudo comprobar ${url.href}: ${err.message}. Los errores de descarga se avisan por email igual.`);
    }
    return null;
  }
}

router.post("/client-error", clientErrorLimiter, async (req, res) => {
  const text = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  const message = text(req.body?.message, 500);
  if (!message) return res.sendStatus(400);
  res.sendStatus(204);
  const details = `${text(req.body?.url, 300)}\n${text(req.body?.stack, 3000)}`;
  if (DOWNLOAD_ERROR.test(message) && (await assetExists(message)) === true) {
    console.warn(`[navegador] ${message} (${text(req.body?.url, 300)}): el archivo está en el servidor, conexión del visitante, sin email`);
    return;
  }
  reportError("navegador", message, details);
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

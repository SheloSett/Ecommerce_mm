// Avisos de errores de producción: quedan en el log del contenedor y le llega un email al admin.
//
// Antes los errores no le llegaban a nadie: el backend solo hacía console.error y el navegador los
// disfrazaba de "Sesión expirada". Un bug que rompía una ficha o el checkout se descubría cuando un
// cliente escribía por WhatsApp.
//
// Quién recibe: ALERT_EMAIL (si está en el .env) o ADMIN_EMAIL. No se usa la lista de casillas de
// pedidos y cotizaciones: los avisos técnicos no tienen que mezclarse con las ventas.
// Para no inundar la casilla, el mismo error (tipo + comienzo del mensaje) se avisa como mucho una vez
// cada 15 minutos; el log lo registra siempre.
const { sendErrorAlert } = require("./email.service");

const THROTTLE_MS = 15 * 60 * 1000;
const MAX_PER_HOUR = 20; // tope total: aunque lleguen muchos errores distintos, no más de 20 emails por hora
const lastSent = new Map();
let sentThisHour = [];

function reportError(kind, message, details = "") {
  const msg = String(message || "(sin mensaje)");
  console.error(`[ERROR ${kind}] ${msg}${details ? `\n${details}` : ""}`);

  const key = `${kind}:${msg.slice(0, 120)}`;
  const now = Date.now();
  if (now - (lastSent.get(key) || 0) < THROTTLE_MS) return;
  sentThisHour = sentThisHour.filter((t) => now - t < 60 * 60 * 1000);
  if (sentThisHour.length >= MAX_PER_HOUR) return;
  if (lastSent.size > 500) lastSent.clear(); // que el registro no crezca sin límite
  lastSent.set(key, now);
  sentThisHour.push(now);

  sendErrorAlert(
    `[IGWT Store] Error (${kind}): ${msg.slice(0, 80)}`,
    `${msg}\n\n${String(details || "").slice(0, 5000)}\n\nMás detalle: docker compose -f deploy/docker-compose.vps.yml logs --since 1h backend`
  ).catch(() => {});
}

module.exports = { reportError };

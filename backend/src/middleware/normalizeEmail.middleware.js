// Middleware global: normaliza los emails del body a minúsculas (y sin espacios).
//
// PROBLEMA QUE RESUELVE:
// Los emails son case-insensitive en la práctica (Gmail, Outlook, etc. tratan
// "Juan@Gmail.com" y "juan@gmail.com" como la misma casilla), pero en la DB la
// columna `email` es UNIQUE y sensible a mayúsculas. Resultado: un cliente que se
// registraba (o al que le creaban la cuenta) escribiendo la primera letra en
// mayúscula después no podía entrar si la tipeaba distinto — "no le entra".
//
// SOLUCIÓN:
// En vez de arreglar controlador por controlador (register, login, checkout,
// devoluciones, cupones, admin-users, cambio de email...), se normaliza una sola
// vez acá, en la puerta de entrada. Todo lo que se guarda y todo lo que se busca
// queda en minúsculas, así que siempre coinciden.
//
// CUIDADOS:
// - Solo toca claves que terminan en "email" (email, newEmail, customerEmail...).
// - Solo toca el valor si REALMENTE parece un email (tiene "@" y no tiene espacios
//   internos), para no romper campos como el cuerpo de una plantilla de email.
// - Recorre objetos y arrays anidados con un límite de profundidad, para no
//   quedarse dando vueltas en estructuras grandes o con referencias circulares.
// - No toca req.query: las búsquedas de admin ya usan `mode: "insensitive"`.

const EMAIL_KEY_REGEX = /email$/i; // email, newEmail, customerEmail, contactEmail, ...
const MAX_DEPTH = 4;

// Devuelve el email normalizado, o null si el valor no parece un email.
function normalizeEmailValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 254) return null;
  // Debe tener exactamente un "@", algo antes y después, y ningún espacio adentro.
  if (!/^[^\s@]+@[^\s@]+$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function walk(node, depth) {
  if (depth > MAX_DEPTH || node === null || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) walk(item, depth + 1);
    return;
  }

  for (const key of Object.keys(node)) {
    const value = node[key];
    if (value !== null && typeof value === "object") {
      walk(value, depth + 1);
      continue;
    }
    if (EMAIL_KEY_REGEX.test(key)) {
      const normalized = normalizeEmailValue(value);
      if (normalized !== null) node[key] = normalized;
    }
  }
}

function normalizeEmails(req, res, next) {
  // req.body puede no existir (GET) o ser un Buffer (webhook de MP con express.raw)
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    walk(req.body, 0);
  }
  next();
}

module.exports = { normalizeEmails, normalizeEmailValue };

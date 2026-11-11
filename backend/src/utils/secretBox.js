// ─── Secretos guardados en la base, cifrados ──────────────────────────────────
// Los tokens de Mercado Libre (y más adelante la clave y el ticket de ARCA) se guardan en la base,
// pero nunca en claro: el repo es público, los backups de la base viajan, y GET /api/settings es
// público. Acá se cifran con AES-256-GCM usando SECRETS_KEY, que vive SOLO en backend/.env del VPS.
// Con una copia de la base sin esa clave, los tokens no sirven para nada.
//
// Cada dato va atado a su "casillero" (slot, por ejemplo "ml.refresh_token"): el casillero entra como
// dato autenticado, así que un valor copiado de una columna a otra no se puede abrir. GCM además
// detecta cualquier cambio en el texto cifrado.
//
// SECRETS_KEY: 32 bytes al azar, en base64 o en hex. Generarla con
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Guardarla también FUERA del VPS y no junto con los backups de la base: si se pierde, hay que volver
// a conectar Mercado Libre (los datos de la tienda no se pierden).
//
// Formato guardado: "v1.<iv>.<tag>.<cifrado>" (base64url). La versión deja cambiar el formato después.
const crypto = require("crypto");

const VERSION = "v1";

class SecretBoxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SecretBoxError";
    this.code = code; // NO_KEY | BAD_SLOT | BAD_FORMAT | CANT_OPEN
  }
}

// La clave de SECRETS_KEY como Buffer de 32 bytes, o null si falta o no tiene el largo justo.
function loadKey(env = process.env) {
  const raw = String(env.SECRETS_KEY || "").trim();
  if (!raw) return null;
  let buf = null;
  if (/^[0-9a-f]{64}$/i.test(raw)) buf = Buffer.from(raw, "hex");
  else if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) buf = Buffer.from(raw, "base64");
  else if (/^[A-Za-z0-9_-]{43}$/.test(raw)) buf = Buffer.from(raw, "base64url");
  return buf && buf.length === 32 ? buf : null;
}

function isConfigured(env = process.env) {
  return loadKey(env) !== null;
}

function checkSlot(slot) {
  if (typeof slot !== "string" || !/^[a-z0-9_.:-]{1,64}$/i.test(slot)) {
    throw new SecretBoxError("BAD_SLOT", "Casillero inválido");
  }
}

function aad(slot) {
  return Buffer.from(`${VERSION}:${slot}`, "utf8");
}

// Cifra un texto para el casillero dado. Lanza SecretBoxError si falta la clave (es un error de
// configuración del servidor: mejor fallar que guardar algo en claro).
function seal(slot, plaintext, { key = loadKey() } = {}) {
  checkSlot(slot);
  if (!key) throw new SecretBoxError("NO_KEY", "Falta SECRETS_KEY en backend/.env (32 bytes en base64 o hex)");
  if (typeof plaintext !== "string") throw new SecretBoxError("BAD_FORMAT", "Solo se cifran textos");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(slot));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

// Descifra lo que guardó seal() en ese mismo casillero. Lanza SecretBoxError si falta la clave, si el
// formato no es el esperado, o si no se puede abrir (clave distinta, otro casillero o dato alterado:
// a propósito no se distingue cuál de los tres fue).
function open(slot, sealed, { key = loadKey() } = {}) {
  checkSlot(slot);
  if (!key) throw new SecretBoxError("NO_KEY", "Falta SECRETS_KEY en backend/.env (32 bytes en base64 o hex)");
  const parts = typeof sealed === "string" ? sealed.split(".") : [];
  if (parts.length !== 4 || parts[0] !== VERSION || parts.slice(1).some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) {
    throw new SecretBoxError("BAD_FORMAT", "El dato guardado no tiene el formato esperado");
  }
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const body = Buffer.from(parts[3], "base64url");
  if (iv.length !== 12 || tag.length !== 16) {
    throw new SecretBoxError("BAD_FORMAT", "El dato guardado no tiene el formato esperado");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad(slot));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretBoxError("CANT_OPEN", "No se pudo descifrar el dato (otra clave, otro casillero o dato alterado)");
  }
}

module.exports = { seal, open, isConfigured, loadKey, SecretBoxError };

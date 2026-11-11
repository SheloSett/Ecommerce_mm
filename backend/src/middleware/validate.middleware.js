// Middleware de validación de inputs
// Valida formato y longitud antes de llegar a la lógica de negocio.
// No reemplaza las validaciones de Prisma ni bcrypt, las complementa.
const { normalizeDocument } = require("../utils/customerDocument");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[\d\s+\-()]+$/;

// Un email al que la tienda le va a escribir tiene que ser UNA sola dirección. EMAIL_REGEX deja
// pasar "a,b@x.com" o "a:a:a:...x@y.zz" (una sola @), y nodemailer lee las comas como varios
// destinatarios y la sintaxis de grupos ("a:") como tal: desde el formulario público de
// devoluciones salía un email a 40 direcciones, y una cadena larga de "a:" trababa el servidor
// varios segundos. Se rechazan los separadores de lista y la sintaxis de nombres/grupos.
const EMAIL_LIST_CHARS = /[,;:<>"()[\]\\]/;
function isSingleEmail(email) {
  if (typeof email !== "string") return false;
  const e = email.trim();
  return e.length <= 254 && EMAIL_REGEX.test(e) && !EMAIL_LIST_CHARS.test(e);
}

// ── Login admin ──────────────────────────────────────────────────────────────
function validateLogin(req, res, next) {
  const { email, password } = req.body;

  if (!email || typeof email !== "string" || email.length > 254) {
    return res.status(400).json({ error: "Email inválido" });
  }
  if (!EMAIL_REGEX.test(email.trim())) {
    return res.status(400).json({ error: "Formato de email inválido" });
  }
  if (!password || typeof password !== "string" || password.length > 128) {
    return res.status(400).json({ error: "Contraseña inválida" });
  }

  next();
}

// ── Registro de cliente ───────────────────────────────────────────────────────
function validateRegister(req, res, next) {
  const { name, email, password, phone } = req.body;

  if (!name || typeof name !== "string" || name.trim().length < 2 || name.length > 100) {
    return res.status(400).json({ error: "El nombre debe tener entre 2 y 100 caracteres" });
  }
  if (!email || typeof email !== "string" || email.length > 254) {
    return res.status(400).json({ error: "Email inválido" });
  }
  // Antes: EMAIL_REGEX.test(email.trim()) — a esta dirección le llegan todos los emails de la cuenta
  if (!isSingleEmail(email)) {
    return res.status(400).json({ error: "Formato de email inválido" });
  }
  if (!password || typeof password !== "string" || password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: "La contraseña debe tener entre 6 y 128 caracteres" });
  }
  if (phone && (typeof phone !== "string" || phone.length > 20 || !PHONE_REGEX.test(phone))) {
    return res.status(400).json({ error: "Teléfono inválido (solo dígitos, espacios, +, -, paréntesis)" });
  }

  next();
}

// ── Login de cliente ─────────────────────────────────────────────────────────
// Mismas reglas que el login de admin
const validateCustomerLogin = validateLogin;

// ── Creación de orden ─────────────────────────────────────────────────────────
function validateOrder(req, res, next) {
  const { customerName, customerEmail, customerPhone, customerNote, items, customerDocType, customerDocNumber } = req.body;

  if (!customerName || typeof customerName !== "string" || customerName.trim().length < 2 || customerName.length > 100) {
    return res.status(400).json({ error: "Nombre del cliente inválido" });
  }
  // Antes: !EMAIL_REGEX.test(customerEmail.trim()) — ver isSingleEmail
  if (!customerEmail || !isSingleEmail(customerEmail)) {
    return res.status(400).json({ error: "Email del cliente inválido" });
  }
  // Teléfono y nota: solo largo máximo (antes sin límite). El formato del teléfono no se exige: los
  // clientes escriben "11 1234-5678 / 11 9876-5432" y rebotarles la compra sale más caro; lo que
  // importa es que no viaje HTML, y eso ya lo resuelve el escape de los emails y las impresiones.
  if (customerPhone != null && (typeof customerPhone !== "string" || customerPhone.length > 40)) {
    return res.status(400).json({ error: "Teléfono inválido (máximo 40 caracteres)" });
  }
  if (customerNote != null && (typeof customerNote !== "string" || customerNote.length > 1000)) {
    return res.status(400).json({ error: "La nota del pedido puede tener hasta 1000 caracteres" });
  }
  // Documento (DNI, CUIT o CUIL): opcional para el servidor, pero si viene tiene que ser válido.
  const doc = normalizeDocument(customerDocType, customerDocNumber);
  if (!doc.ok) {
    return res.status(400).json({ error: doc.error });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "La orden debe tener al menos un producto" });
  }
  for (const item of items) {
    const qty = Number(item.quantity);
    if (!item.productId) {
      return res.status(400).json({ error: "Falta el ID de producto en uno de los ítems" });
    }
    if (!qty || qty < 1 || qty > 9999 || !Number.isInteger(qty)) {
      return res.status(400).json({ error: "Cantidad de producto inválida (entre 1 y 9999)" });
    }
  }

  next();
}

// ── Solicitud de arrepentimiento (formulario público) ─────────────────────────
// Antes solo se pedía que vinieran nombre, email y motivo: el email podía ser una lista y no había
// largos máximos, así que el formulario servía para mandar emails de la tienda a cualquiera.
function validateReturnRequest(req, res, next) {
  const { customerName, customerEmail, customerPhone, reason } = req.body;

  if (!customerName || typeof customerName !== "string" || customerName.trim().length < 2 || customerName.length > 100) {
    return res.status(400).json({ error: "El nombre debe tener entre 2 y 100 caracteres." });
  }
  if (!customerEmail || !isSingleEmail(customerEmail)) {
    return res.status(400).json({ error: "Ingresá un email válido." });
  }
  if (customerPhone != null && customerPhone !== "" && (typeof customerPhone !== "string" || customerPhone.length > 40)) {
    return res.status(400).json({ error: "Teléfono inválido (máximo 40 caracteres)." });
  }
  if (!reason || typeof reason !== "string" || reason.trim().length < 10 || reason.length > 2000) {
    return res.status(400).json({ error: "El mensaje debe tener entre 10 y 2000 caracteres." });
  }

  next();
}

module.exports = { validateLogin, validateRegister, validateCustomerLogin, validateOrder, validateReturnRequest, isSingleEmail };

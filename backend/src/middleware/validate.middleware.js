// Middleware de validación de inputs
// Valida formato y longitud antes de llegar a la lógica de negocio.
// No reemplaza las validaciones de Prisma ni bcrypt, las complementa.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[\d\s+\-()]+$/;

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
  if (!EMAIL_REGEX.test(email.trim())) {
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
  const { customerName, customerEmail, items } = req.body;

  if (!customerName || typeof customerName !== "string" || customerName.trim().length < 2 || customerName.length > 100) {
    return res.status(400).json({ error: "Nombre del cliente inválido" });
  }
  if (!customerEmail || typeof customerEmail !== "string" || !EMAIL_REGEX.test(customerEmail.trim())) {
    return res.status(400).json({ error: "Email del cliente inválido" });
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

module.exports = { validateLogin, validateRegister, validateCustomerLogin, validateOrder };

const jwt = require("jsonwebtoken");

// Verifica que el token JWT sea válido
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

// Verifica que el usuario sea ADMIN
function adminMiddleware(req, res, next) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "Acceso denegado: se requiere rol ADMIN" });
  }
  next();
}

// Verifica que el usuario sea CUSTOMER (cliente autenticado)
function customerMiddleware(req, res, next) {
  if (req.user?.role !== "CUSTOMER") {
    return res.status(403).json({ error: "Acceso denegado: se requiere rol CUSTOMER" });
  }
  next();
}

module.exports = { authMiddleware, adminMiddleware, customerMiddleware };

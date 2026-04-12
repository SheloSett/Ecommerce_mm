const jwt = require("jsonwebtoken");

// Verifica que el token JWT sea válido
// Acepta el token vía header "Authorization: Bearer <token>" o via ?token= en query string.
// El fallback a query param es necesario para SSE: el browser no permite headers custom en EventSource.
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  // Intentar header primero; si no hay, intentar query param (solo para SSE)
  let token;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else if (req.query.token) {
    token = req.query.token;
  } else {
    return res.status(401).json({ error: "Token no proporcionado" });
  }

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

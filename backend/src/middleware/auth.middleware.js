const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

// ─── Sesión vigente (A5 de la auditoría, 30/10/2026) ──────────────────────────
// El token (JWT, dura 7 días) dice quién es y trae "tv", el contador de sesión de la cuenta
// (User/Customer.tokenVersion). En cada pedido se compara con la base. Antes alcanzaba con que la firma
// fuera válida: borrar a un admin, rechazar a un cliente o cambiarle la contraseña a una cuenta robada no
// cortaba el acceso hasta que el token vencía. Ahora la contraseña cambiada sube el contador y los tokens
// viejos dejan de servir al instante. Los tokens de antes de este cambio no traen "tv": cuentan como 0,
// que es con lo que arranca la columna, así que nadie quedó deslogueado al desplegar.
//
// Devuelve lo que va en req.user, o null si la sesión ya no vale.
async function currentSession(decoded) {
  const tv = decoded?.tv ?? 0;
  if (decoded?.role === "CUSTOMER" && decoded.id) {
    const customer = await prisma.customer.findUnique({
      where:  { id: decoded.id },
      select: { tokenVersion: true, status: true, type: true, email: true },
    });
    // REJECTED: el login ya no lo deja entrar, así que una sesión abierta tampoco.
    if (!customer || customer.status === "REJECTED" || (customer.tokenVersion ?? 0) !== tv) return null;
    return { ...decoded, type: customer.type, email: customer.email, status: customer.status };
  }
  if ((decoded?.role === "ADMIN" || decoded?.role === "SUPERADMIN") && decoded.id) {
    const user = await prisma.user.findUnique({
      where:  { id: decoded.id },
      select: { tokenVersion: true, role: true, permissions: true },
    });
    if (!user || (user.tokenVersion ?? 0) !== tv) return null;
    // Rol y permisos de la BASE, no los del token: un cambio de permisos rige al instante (antes,
    // recién cuando el admin volvía a iniciar sesión).
    return { ...decoded, role: user.role, permissions: user.permissions };
  }
  return null;
}

// Verifica que el token JWT sea válido y que la sesión siga vigente (ver currentSession).
// Acepta el token vía header "Authorization: Bearer <token>" o via ?token= en query string.
// El fallback a query param es necesario para SSE: el browser no permite headers custom en EventSource.
// Antes: function authMiddleware(req, res, next) { ...jwt.verify...; req.user = decoded; next(); }
async function authMiddleware(req, res, next) {
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

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }

  let session;
  try {
    session = await currentSession(decoded);
  } catch (err) {
    console.error("authMiddleware: no se pudo verificar la sesión:", err.message);
    return res.status(503).json({ error: "No pudimos verificar tu sesión. Probá de nuevo en un momento." });
  }
  if (!session) {
    return res.status(401).json({ error: "Tu sesión ya no es válida. Iniciá sesión de nuevo." });
  }
  req.user = session;
  next();
}

// Verifica que el usuario sea ADMIN o SUPERADMIN
function adminMiddleware(req, res, next) {
  if (req.user?.role !== "ADMIN" && req.user?.role !== "SUPERADMIN") {
    return res.status(403).json({ error: "Acceso denegado: se requiere rol ADMIN" });
  }
  next();
}

// Verifica que el usuario sea SUPERADMIN (solo el dueño)
function superAdminMiddleware(req, res, next) {
  if (req.user?.role !== "SUPERADMIN") {
    return res.status(403).json({ error: "Acceso denegado: se requiere rol SUPERADMIN" });
  }
  next();
}

// Factory: verifica que el usuario tenga un permiso específico.
// SUPERADMIN siempre pasa. ADMIN necesita tener la key en su array de permisos.
function requirePermission(key) {
  return (req, res, next) => {
    if (req.user?.role === "SUPERADMIN") return next();
    if (!req.user?.permissions?.includes(key)) {
      return res.status(403).json({ error: `Acceso denegado: se requiere permiso '${key}'` });
    }
    next();
  };
}

// ─── Permisos del panel en el backend (A2 de la auditoría, 30/10/2026) ────────
// Antes cualquier ADMIN podía usar todas las rutas del panel: los permisos (Productos, Órdenes, Caja…)
// solo escondían pantallas en el navegador, y con el token se le podía pedir cualquier cosa a la API.
// Ahora cada ruta del panel pide los permisos de las pantallas que la usan; alcanza con tener uno (la
// lista de clientes, por ejemplo, la usan Clientes, Cupones, Emails y Órdenes). El SUPERADMIN pasa siempre.
//
// Bloquea (403). Si a un empleado le falta algo que usa, se puede pasar a MODO AVISO mientras se revisa:
// ENFORCE_ADMIN_PERMISSIONS=false en backend/.env y reiniciar el backend. En ese modo deja pasar y anota en
// el log "[permisos] modo aviso: ..." lo que habría bloqueado.
function hasPermission(user, key) {
  return user?.role === "SUPERADMIN" || !!user?.permissions?.includes(key);
}

const warnedPermissions = new Set(); // "admin|ruta" ya anotados en modo aviso (una línea por combinación)
function denyPermission(req, res, next, keys) {
  const wanted = keys.map((k) => `'${k}'`).join(" o ");
  if (process.env.ENFORCE_ADMIN_PERMISSIONS !== "false") {
    return res.status(403).json({ error: `Acceso denegado: se requiere permiso ${wanted}` });
  }
  const route = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;
  const seen = `${req.user?.id}|${route}`;
  if (!warnedPermissions.has(seen)) {
    warnedPermissions.add(seen);
    console.warn(`[permisos] modo aviso: ${req.user?.email ?? req.user?.id} usó ${route} sin permiso ${wanted} (se dejó pasar)`);
  }
  next();
}

// Factory: pasa si el usuario tiene AL MENOS UNO de los permisos.
function requireAnyPermission(...keys) {
  return function anyPermissionGuard(req, res, next) {
    if (keys.some((k) => hasPermission(req.user, k))) return next();
    denyPermission(req, res, next, keys);
  };
}

// Verifica que el usuario sea CUSTOMER (cliente autenticado)
function customerMiddleware(req, res, next) {
  if (req.user?.role !== "CUSTOMER") {
    return res.status(403).json({ error: "Acceso denegado: se requiere rol CUSTOMER" });
  }
  next();
}

// Cliente de la sesión si el header Authorization trae un token válido y VIGENTE de CUSTOMER; null en
// cualquier otro caso (sin token, vencido, de admin, cuenta borrada o rechazada, contraseña cambiada).
// Para las rutas públicas que funcionan con o sin sesión (el checkout, el estado del pago): ahí no va
// authMiddleware porque un invitado no tiene token.
// Antes: customerIdFromToken(req), sincrónica, que solo miraba la firma y devolvía el id.
async function customerFromToken(req) {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  let decoded;
  try {
    decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
  } catch {
    return null;
  }
  if (decoded.role !== "CUSTOMER" || !decoded.id) return null;
  const customer = await prisma.customer.findUnique({
    where:  { id: decoded.id },
    select: { id: true, type: true, status: true, email: true, tokenVersion: true },
  });
  if (!customer || customer.status === "REJECTED" || (customer.tokenVersion ?? 0) !== (decoded.tv ?? 0)) return null;
  return customer;
}

module.exports = {
  authMiddleware, adminMiddleware, superAdminMiddleware, requirePermission, customerMiddleware,
  customerFromToken, currentSession, hasPermission, requireAnyPermission, denyPermission,
};

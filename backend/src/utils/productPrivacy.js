const jwt = require("jsonwebtoken");

// Qué campos de un producto (y de sus variantes) puede ver quien hace la request.
//
// Por qué existe: las rutas públicas de productos devolvían el registro entero de la base, así que
// cualquiera que abriera /api/products/<slug> en el navegador veía el COSTO y los precios
// MAYORISTAS de todo el catálogo, sin iniciar sesión. Que la pantalla no los muestre no alcanza:
// hay que sacarlos de la respuesta.
//
// Tampoco sirve mirar el ?visibleFor=MAYORISTA del query string: lo manda el navegador y
// cualquiera lo puede escribir a mano. Lo que decide es el token, firmado por el servidor.

// Solo el admin: costo y ubicación en depósito / proveedor.
const ADMIN_ONLY_FIELDS = ["cost", "module", "shelf", "supplierId", "supplier", "stockBreak", "hotSellerThreshold"];
// Solo el admin y el mayorista aprobado.
const WHOLESALE_FIELDS = ["wholesalePrice", "wholesaleSalePrice", "wholesalePriceTiers"];

const ANONYMOUS = Object.freeze({ isAdmin: false, isMayorista: false });

// Devuelve { isAdmin, isMayorista } a partir del header Authorization.
// Token ausente, inválido o vencido → anónimo (las rutas públicas NO responden 401 por esto).
//
// Para el cliente se consulta la base en vez de confiar en `type` del token: el token dura 7 días
// y guarda el tipo del momento del login. Si el admin le quita la cuenta mayorista a alguien (o lo
// rechaza), con el token viejo seguiría viendo los precios mayoristas hasta que venza.
async function resolvePriceViewer(req, prisma) {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return ANONYMOUS;

  let decoded;
  try {
    decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
  } catch {
    return ANONYMOUS;
  }

  if (decoded.role === "ADMIN" || decoded.role === "SUPERADMIN") {
    return { isAdmin: true, isMayorista: true };
  }
  if (decoded.role === "CUSTOMER" && decoded.id) {
    const customer = await prisma.customer.findUnique({
      where:  { id: decoded.id },
      select: { type: true, status: true },
    });
    const isMayorista = customer?.type === "MAYORISTA" && customer?.status === "APPROVED";
    return { isAdmin: false, isMayorista };
  }
  return ANONYMOUS;
}

function omit(obj, fields) {
  const out = { ...obj };
  for (const f of fields) delete out[f];
  return out;
}

// Saca del producto (y de sus variantes, si vienen) lo que este viewer no puede ver.
// El admin recibe el producto tal cual.
function sanitizeProductForViewer(product, viewer = ANONYMOUS) {
  if (!product || viewer.isAdmin) return product;
  const hidden = viewer.isMayorista ? ADMIN_ONLY_FIELDS : [...ADMIN_ONLY_FIELDS, ...WHOLESALE_FIELDS];
  const out = omit(product, hidden);
  if (Array.isArray(out.variants)) {
    out.variants = out.variants.map((v) => (v && typeof v === "object" ? omit(v, hidden) : v));
  }
  return out;
}

module.exports = {
  resolvePriceViewer,
  sanitizeProductForViewer,
  ADMIN_ONLY_FIELDS,
  WHOLESALE_FIELDS,
  ANONYMOUS,
};

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
// Cliente único de la base (lib/prisma.js) y avisos de errores de producción (log + email al admin)
const prisma = require("./lib/prisma");
const { reportError } = require("./services/errorAlerts.service");

const authRoutes = require("./routes/auth.routes");
const productRoutes = require("./routes/product.routes");
const categoryRoutes = require("./routes/category.routes");
const orderRoutes = require("./routes/order.routes");
const paymentRoutes = require("./routes/payment.routes");
const customerRoutes = require("./routes/customer.routes");
const mayoristaRequestRoutes = require("./routes/mayoristaRequest.routes");
const cartRoutes = require("./routes/cart.routes");
const notificationRoutes = require("./routes/notification.routes");
const gastoRoutes    = require("./routes/gasto.routes");
const variantRoutes  = require("./routes/variant.routes");
const couponRoutes   = require("./routes/coupon.routes");
const offerRoutes    = require("./routes/offer.routes");
const slideRoutes    = require("./routes/slide.routes");
const purchaseRoutes = require("./routes/purchase.routes");
const settingsRoutes = require("./routes/settings.routes");
const returnRoutes     = require("./routes/return.routes");
const wishlistRoutes   = require("./routes/wishlist.routes");
const adminUsersRoutes = require("./routes/adminUsers.routes");
const shippingRoutes   = require("./routes/shipping.routes");
const adminTestRoutes  = require("./routes/admin-test.routes");
const supplierRoutes   = require("./routes/supplier.routes");
const aiRoutes         = require("./routes/ai.routes");
const seoRoutes        = require("./routes/seo.routes");
const analyticsRoutes  = require("./routes/analytics.routes");
const eventsRoutes     = require("./routes/events.routes");
const emailRoutes      = require("./routes/email.routes");

const app = express();
const PORT = process.env.PORT || 4000;

// Trust proxy: Render (y cualquier reverse proxy serio) agrega X-Forwarded-For con la IP
// real del cliente. Sin esto, express-rate-limit ve la IP del proxy y rechaza las requests
// con ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
// Valor "1" = confiar en 1 proxy delante (Render). En dev (sin proxy) este setting es inocuo.
app.set("trust proxy", 1);

// Middlewares globales

// Helmet: headers HTTP de seguridad (oculta X-Powered-By, activa CSP, HSTS, etc.)
// crossOriginResourcePolicy: cross-origin es necesario para que /uploads sirva imágenes al frontend
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// Rate limiter general: protege rutas sensibles (órdenes, pagos, clientes, admin)
// Las rutas GET públicas (productos, categorías, slides, settings) están EXCLUIDAS porque:
// - Son de solo lectura, sin riesgo de abuso real
// - En desarrollo, admin y cliente comparten IP (localhost) y agotaban el límite rápido
// - En prod, un CDN/cache debería cubrir estas rutas de todas formas
// Las rutas de auth tienen su propio limiter mucho más estricto (8 req/15 min).
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Intentá de nuevo en 15 minutos." },
  skip: (req) => {
    // Saltar el limiter para GETs públicos de solo lectura.
    // IMPORTANTE: el middleware está montado en "/api", por lo que req.path ya NO incluye
    // el prefijo "/api" — es solo "/products", "/categories", etc. Antes la lista tenía
    // "/api/products" etc., lo que hacía que el skip nunca funcionara (startsWith fallaba).
    const publicGetPaths = [
      "/products",
      "/categories",
      "/slides",
      "/settings",
      "/offers",     // /offers/active lo pide el Home en cada carga

      "/health",
      "/sitemap.xml",
      "/feed.xml",
    ];
    // Antes: return req.method === "GET" && publicGetPaths.some((p) => req.path.startsWith(p));
    //
    // EXCEPCIÓN A LA EXENCIÓN: /products?sortPrice=... no es una lectura barata. Para ordenar por
    // precio hay que traer los productos sin paginar (el precio mostrado se resuelve recién en el
    // handler, ver getProducts), así que cada request cuesta cientos de filas con sus variantes en
    // vez de 20. Estando exenta del limiter, cualquiera podía repetirla en bucle desde afuera y
    // tumbar el servidor sin necesidad de credenciales. El resto de los GET públicos sigue exento.
    if (req.method !== "GET") return false;
    const isPublicGet = publicGetPaths.some((p) => req.path.startsWith(p));
    if (!isPublicGet) return false;
    const expensiveSort = req.path.startsWith("/products") && !!req.query.sortPrice;
    return !expensiveSort;
  },
});

// CORS: antes era un único origin fijo (process.env.FRONTEND_URL), lo que bloqueaba el acceso
// por "www" cuando FRONTEND_URL estaba sin www (y viceversa) → "blocked by CORS policy".
// Ahora construimos una LISTA de orígenes permitidos que incluye automáticamente la variante
// con/sin "www" de cada URL de FRONTEND_URL (que puede ser una sola o varias separadas por coma),
// más localhost para desarrollo. Así entrar por igwtstore.com.ar o www.igwtstore.com.ar funciona igual.
const allowedOrigins = (() => {
  const raw = process.env.FRONTEND_URL || "http://localhost:3000";
  const set = new Set(["http://localhost:3000", "http://localhost:5173"]);
  for (const url of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    set.add(url);
    try {
      const u = new URL(url);
      // Variante opuesta de www: si tiene www la agrega sin www, y al revés.
      const host = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
      set.add(`${u.protocol}//${host}`);
    } catch { /* URL inválida → se ignora */ }
  }
  return [...set];
})();
console.log("[CORS] Orígenes permitidos:", allowedOrigins.join(", "));

app.use(cors({
  // origin: process.env.FRONTEND_URL || "http://localhost:3000",  ← reemplazado por la lista de arriba
  origin: (origin, callback) => {
    // Sin origin = same-origin, curl, apps móviles, healthchecks → permitir
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  credentials: true,
}));
app.use("/api", generalLimiter);

// El webhook de MercadoPago necesita el body en raw, por eso va antes del json parser
app.use("/api/payments/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Normalización de emails a minúsculas (después de parsear el body, antes de las rutas).
// Evita el problema de cuentas que no podían loguearse por haberse creado con mayúsculas
// ("Juan@Gmail.com" vs "juan@gmail.com"). Ver normalizeEmail.middleware.js.
const { normalizeEmails } = require("./middleware/normalizeEmail.middleware");
app.use(normalizeEmails);

// Servir imágenes estáticas
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Rutas
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/mayorista-requests", mayoristaRequestRoutes);
app.use("/api/carts", cartRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/gastos",    gastoRoutes);
app.use("/api/coupons",   couponRoutes);
app.use("/api/offers",    offerRoutes);
app.use("/api/slides",    slideRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/settings",  settingsRoutes);
app.use("/api/returns",   returnRoutes);
app.use("/api/variants",  variantRoutes);
app.use("/api/wishlist",     wishlistRoutes);
app.use("/api/admin-users", adminUsersRoutes);
app.use("/api/shipping",   shippingRoutes);
app.use("/api/admin-test", adminTestRoutes);
app.use("/api/suppliers",  supplierRoutes);
app.use("/api/ai",         aiRoutes);
app.use("/api/analytics",  analyticsRoutes);
app.use("/api/events",     eventsRoutes);
app.use("/api/emails",     emailRoutes);
app.use("/api",            seoRoutes);

// Health check. Antes respondía "ok" sin mirar nada: con la base caída seguía diciendo ok. Ahora hace
// una consulta mínima y, si la base no contesta, responde 503. Lo usan el healthcheck del compose y
// cualquier monitor externo (UptimeRobot, Better Stack) que se apunte a /api/health.
app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    reportError("salud", "La base de datos no responde", err.message);
    res.status(503).json({ status: "error", db: "sin respuesta", timestamp: new Date().toISOString() });
  }
});

// Errores de multer (subida de archivos). Sin este bloque caen en el handler genérico y salen
// como 500 "File too large", que en el panel de admin no le dice nada a quien está subiendo.
app.use((err, req, res, next) => {
  if (err?.name === "MulterError") {
    const messages = {
      LIMIT_FILE_SIZE: "El archivo es demasiado grande (máximo 5 MB por imagen y 100 MB por video).",
      LIMIT_FILE_COUNT: "Se superó la cantidad máxima de archivos.",
      LIMIT_UNEXPECTED_FILE: "Se enviaron más archivos de los permitidos (máx. 10 fotos y 5 videos).",
    };
    return res.status(400).json({ error: messages[err.code] || `Error al subir el archivo: ${err.message}` });
  }
  next(err);
});

// Manejo global de errores. Los 5xx se reportan (log + email al admin, ver errorAlerts.service.js) y
// al cliente le llega un mensaje genérico: antes se le devolvía err.message, que puede traer detalles
// internos (consultas de Prisma, rutas de archivos).
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    reportError("servidor", `${req.method} ${req.originalUrl}: ${err.message}`, err.stack);
    // Antes: res.status(err.status || 500).json({ error: err.message || "Error interno del servidor" });
    return res.status(status).json({ error: "Error interno del servidor" });
  }
  console.error("Error:", err.message);
  res.status(status).json({ error: err.message || "Error en el pedido" });
});

// Errores que se escapan de todo: una promesa rechazada sin catch o una excepción fuera de una
// request. Antes no había handler: en Node 22 una promesa sin catch tira el proceso y Docker lo
// reiniciaba sin que nadie se enterara. La promesa se reporta y el servidor sigue; la excepción se
// reporta y el proceso sale (su estado ya no es confiable) para que Docker lo levante limpio.
process.on("unhandledRejection", (reason) => {
  reportError("promesa sin catch", reason?.message || String(reason), reason?.stack);
});
process.on("uncaughtException", (err) => {
  reportError("excepción no atrapada", err.message, err.stack);
  setTimeout(() => process.exit(1), 3000); // tiempo para que salga el email
});

// 404 para rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});

// Asegurar la extensión "unaccent" de Postgres al arrancar (búsqueda insensible a tildes).
// El código de búsqueda (searchProductIds en product.controller) depende de esta extensión y,
// si no existe, cae silenciosamente al fallback SENSIBLE a tildes — como no hay ninguna
// migración que la cree, una base nueva (o un restore) perdía la búsqueda sin tildes sin
// que nadie lo note. CREATE EXTENSION IF NOT EXISTS es idempotente e inofensivo si ya existe.
// Si el usuario de DB no tiene permisos, solo se loguea la advertencia y la app sigue normal.
// Antes: un PrismaClient propio (prismaBoot) solo para esto, que después se desconectaba. Ahora es el
// cliente único de lib/prisma.js, así que NO se desconecta (se cortaría la base para todo el backend).
prisma
  .$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS unaccent')
  .then(() => console.log("✅ Extensión unaccent de Postgres verificada (búsqueda sin tildes activa)"))
  .catch((e) => console.warn("⚠️ No se pudo crear/verificar la extensión unaccent (la búsqueda será sensible a tildes):", e.message));

// Iniciar cron jobs de campañas de email (restock mayoristas + recomendaciones minoristas)
const { startCronJobs } = require("./services/cron.service");
startCronJobs();

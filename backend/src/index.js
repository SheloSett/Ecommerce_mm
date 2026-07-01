require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

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
      "/health",
    ];
    return req.method === "GET" && publicGetPaths.some((p) => req.path.startsWith(p));
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

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Manejo global de errores
app.use((err, req, res, next) => {
  console.error("Error:", err.message);
  res.status(err.status || 500).json({
    error: err.message || "Error interno del servidor",
  });
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
const { PrismaClient } = require("@prisma/client");
const prismaBoot = new PrismaClient();
prismaBoot
  .$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS unaccent')
  .then(() => console.log("✅ Extensión unaccent de Postgres verificada (búsqueda sin tildes activa)"))
  .catch((e) => console.warn("⚠️ No se pudo crear/verificar la extensión unaccent (la búsqueda será sensible a tildes):", e.message))
  .finally(() => prismaBoot.$disconnect().catch(() => {}));

// Iniciar cron jobs de campañas de email (restock mayoristas + recomendaciones minoristas)
const { startCronJobs } = require("./services/cron.service");
startCronJobs();

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
const returnRoutes   = require("./routes/return.routes");
const wishlistRoutes = require("./routes/wishlist.routes");

const app = express();
const PORT = process.env.PORT || 4000;

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

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
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
app.use("/api/wishlist",  wishlistRoutes);

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

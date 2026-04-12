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
const couponRoutes   = require("./routes/coupon.routes");
const slideRoutes    = require("./routes/slide.routes");
const purchaseRoutes = require("./routes/purchase.routes");
const settingsRoutes = require("./routes/settings.routes");

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares globales

// Helmet: headers HTTP de seguridad (oculta X-Powered-By, activa CSP, HSTS, etc.)
// crossOriginResourcePolicy: cross-origin es necesario para que /uploads sirva imágenes al frontend
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// Rate limiter general: protege contra scraping masivo y abusos de la API
// 200 req/15 min es suficiente ahora que las notificaciones usan SSE (1 conexión persistente)
// en lugar de polling cada 30s (que sumaba ~30 req/15 min por sí solo).
// Las rutas de auth (login/registro) tienen su propio limiter mucho más estricto (8 req/15 min).
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Intentá de nuevo en 15 minutos." },
});
app.use("/api", generalLimiter);

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));

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

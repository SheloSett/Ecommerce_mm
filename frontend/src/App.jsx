import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { CartProvider } from "./context/CartContext";
import { AuthProvider } from "./context/AuthContext";
import { CustomerAuthProvider } from "./context/CustomerAuthContext";
import { NotificationProvider } from "./context/NotificationContext";
import { SiteConfigProvider, useSiteConfig } from "./context/SiteConfigContext";
import { WishlistProvider } from "./context/WishlistContext";
import { BadgeProvider } from "./context/BadgeContext";

// Páginas públicas
import Home from "./pages/Home";
import Catalog from "./pages/Catalog";
import ProductDetail from "./pages/ProductDetail";
const Checkout = lazy(() => import("./pages/Checkout"));
const PaymentResult = lazy(() => import("./pages/PaymentResult"));
const Register = lazy(() => import("./pages/Register"));
const CustomerLogin = lazy(() => import("./pages/CustomerLogin"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const UnsubscribeRestock = lazy(() => import("./pages/UnsubscribeRestock"));
const UnsubscribeMarketing = lazy(() => import("./pages/UnsubscribeMarketing"));
const EditProfile = lazy(() => import("./pages/EditProfile"));
const OrderHistory = lazy(() => import("./pages/OrderHistory"));
const OrderDetail = lazy(() => import("./pages/OrderDetail"));
const QuotationHistory = lazy(() => import("./pages/QuotationHistory"));
const PayQuotation = lazy(() => import("./pages/PayQuotation"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const NotFound = lazy(() => import("./pages/NotFound"));
const AboutUs = lazy(() => import("./pages/AboutUs"));
const HowToBuy = lazy(() => import("./pages/HowToBuy"));
const ReturnRequest = lazy(() => import("./pages/ReturnRequest"));
const Wishlist = lazy(() => import("./pages/Wishlist"));
const Cart = lazy(() => import("./pages/Cart"));

// Panel de administración
const AdminLogin = lazy(() => import("./pages/admin/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminProducts = lazy(() => import("./pages/admin/AdminProducts"));
const AdminOrders = lazy(() => import("./pages/admin/AdminOrders"));
const AdminCategories = lazy(() => import("./pages/admin/AdminCategories"));
const AdminCustomers = lazy(() => import("./pages/admin/AdminCustomers"));
const AdminMetrics = lazy(() => import("./pages/admin/AdminMetrics"));
const AdminAnalytics = lazy(() => import("./pages/admin/AdminAnalytics"));
const AdminProductCreate = lazy(() => import("./pages/admin/AdminProductCreate"));
const AdminCaja = lazy(() => import("./pages/admin/AdminCaja"));
const AdminFlyer = lazy(() => import("./pages/admin/AdminFlyer"));
const AdminCoupons = lazy(() => import("./pages/admin/AdminCoupons"));
const AdminOffers = lazy(() => import("./pages/admin/AdminOffers"));
const AdminMercadoLibre = lazy(() => import("./pages/admin/AdminMercadoLibre"));
const AdminMlCallback = lazy(() => import("./pages/admin/AdminMlCallback"));
const AdminPurchases = lazy(() => import("./pages/admin/AdminPurchases"));
const AdminSuppliers = lazy(() => import("./pages/admin/AdminSuppliers"));
// AdminCarousel: movido a CarouselSectionContent embebido en AdminSettings — página standalone descartada
// import AdminCarousel from "./pages/admin/AdminCarousel";
// AdminAnnouncementBanner: movido a CarouselSectionContent embebido en AdminSettings — página standalone descartada
// import AdminAnnouncementBanner from "./pages/admin/AdminAnnouncementBanner";
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));
const AdminReturns = lazy(() => import("./pages/admin/AdminReturns"));
const AdminEmails = lazy(() => import("./pages/admin/AdminEmails"));
// AdminUsers: movido a UsersSectionContent embebido en AdminSettings — página standalone descartada
// import AdminUsers from "./pages/admin/AdminUsers";
const AdminOrderDetail = lazy(() => import("./pages/admin/AdminOrderDetail"));
const AdminPurchaseOrder = lazy(() => import("./pages/admin/AdminPurchaseOrder"));
const AdminPurchaseOrderBulk = lazy(() => import("./pages/admin/AdminPurchaseOrderBulk"));
import ProtectedRoute from "./components/ProtectedRoute";
import RequirePermission from "./components/RequirePermission";
import WhatsAppButton from "./components/WhatsAppButton";
import ScrollToTop from "./components/ScrollToTop";
import MaintenancePage from "./pages/MaintenancePage";
import MaintenanceBanner from "./components/MaintenanceBanner";
import PresenceTracker from "./components/PresenceTracker";
import MetaPixel from "./components/MetaPixel";

// Wrapper que aplica el modo mantenimiento y la clase .storefront (para temas CSS)
// a todas las páginas públicas. Las rutas /admin/* no se ven afectadas.
// Antes: renderizaba <MaintenancePage /> en el mismo URL (el cliente podía ver /catalogo pero con la pantalla de mantenimiento)
// Ahora: redirige a /mantenimiento — todas las URLs quedan bloqueadas y la URL es explícita
function PublicRoute({ children }) {
  const { maintenance, loading } = useSiteConfig();
  // Esperar a que el contexto cargue antes de decidir qué mostrar.
  // Sin esto, maintenance=false (estado inicial) y se renderiza el contenido
  // un instante antes de que llegue la respuesta del backend.
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
    </div>
  );
  if (maintenance) return <Navigate to="/mantenimiento" replace />;
  return (
    <div className="storefront storefront-root">
      <MaintenanceBanner />
      {/* Señal de presencia para el panel "En vivo" de Analíticas (solo tienda pública) */}
      <PresenceTracker />
      {/* Pixel de Meta (Facebook / Instagram), si está configurado en Admin → Configuración */}
      <MetaPixel />
      {children}
    </div>
  );
}

// Lo que se ve mientras baja una pantalla en carga diferida: el mismo spinner que PublicRoute.
export function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
    </div>
  );
}

export default function App() {
  return (
    <HelmetProvider>
    <SiteConfigProvider>
    <AuthProvider>
      <CustomerAuthProvider>
      <NotificationProvider>
      <WishlistProvider>
      <CartProvider>
        <ScrollToTop />
        <WhatsAppButton />
        {/* Suspense: mientras baja el archivo de una pantalla en carga diferida (ver los lazy de arriba) */}
        <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Ruta de mantenimiento — fuera de PublicRoute para evitar redirect infinito */}
          <Route path="/mantenimiento" element={<MaintenancePage />} />

          {/* ── Tienda pública (envuelta en PublicRoute para mantenimiento) ── */}
          <Route path="/" element={<PublicRoute><Home /></PublicRoute>} />
          <Route path="/catalogo" element={<PublicRoute><Catalog /></PublicRoute>} />
          <Route path="/producto/:id" element={<PublicRoute><ProductDetail /></PublicRoute>} />
          <Route path="/carrito" element={<PublicRoute><Cart /></PublicRoute>} />
          <Route path="/checkout" element={<PublicRoute><Checkout /></PublicRoute>} />
          <Route path="/pago/exitoso" element={<PublicRoute><PaymentResult type="success" /></PublicRoute>} />
          <Route path="/pago/fallido" element={<PublicRoute><PaymentResult type="failure" /></PublicRoute>} />
          <Route path="/pago/pendiente" element={<PublicRoute><PaymentResult type="pending" /></PublicRoute>} />
          <Route path="/registro" element={<PublicRoute><Register /></PublicRoute>} />
          <Route path="/login" element={<PublicRoute><CustomerLogin /></PublicRoute>} />
          <Route path="/olvide-mi-contrasena" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
          <Route path="/reset-password/:token" element={<PublicRoute><ResetPassword /></PublicRoute>} />
          <Route path="/unsubscribe/restock" element={<UnsubscribeRestock />} />
          {/* Baja de las promociones por email (link del pie de los avisos y emails masivos) */}
          <Route path="/desuscribirse" element={<UnsubscribeMarketing />} />
          <Route path="/perfil" element={<PublicRoute><EditProfile /></PublicRoute>} />
          <Route path="/pedidos" element={<PublicRoute><OrderHistory /></PublicRoute>} />
          <Route path="/pedidos/:id" element={<PublicRoute><OrderDetail /></PublicRoute>} />
          <Route path="/cotizaciones" element={<PublicRoute><QuotationHistory /></PublicRoute>} />
          <Route path="/pagar-cotizacion/:id" element={<PublicRoute><PayQuotation /></PublicRoute>} />
          <Route path="/privacidad" element={<PublicRoute><Privacy /></PublicRoute>} />
          <Route path="/terminos" element={<PublicRoute><Terms /></PublicRoute>} />
          <Route path="/sobre-nosotros" element={<PublicRoute><AboutUs /></PublicRoute>} />
          <Route path="/como-comprar" element={<PublicRoute><HowToBuy /></PublicRoute>} />
          <Route path="/arrepentimiento" element={<PublicRoute><ReturnRequest /></PublicRoute>} />
          <Route path="/favoritos"      element={<PublicRoute><Wishlist /></PublicRoute>} />

          {/* ── Admin ── */}
          <Route path="/admin/login" element={<AdminLogin />} />
          {/* BadgeProvider envuelve solo las rutas admin para que los badges sean compartidos entre páginas */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/productos"
            element={
              <ProtectedRoute>
                <RequirePermission permission="productos"><AdminProducts /></RequirePermission>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/ordenes"
            element={
              <ProtectedRoute>
                <RequirePermission permission="ordenes"><AdminOrders /></RequirePermission>
              </ProtectedRoute>
            }
          />
          {/* OC combinada de varias órdenes (?ids=1,2,3). Va ANTES de "/admin/ordenes/:id" —
              igual React Router prioriza el segmento estático "oc-multiple" sobre el dinámico :id. */}
          <Route
            path="/admin/ordenes/oc-multiple"
            element={
              <ProtectedRoute>
                <RequirePermission permission="ordenes"><AdminPurchaseOrderBulk /></RequirePermission>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/ordenes/:id"
            element={
              <ProtectedRoute>
                <RequirePermission permission="ordenes"><AdminOrderDetail /></RequirePermission>
              </ProtectedRoute>
            }
          />
          {/* Orden de compra a proveedores: selección de productos del pedido para imprimir */}
          <Route
            path="/admin/ordenes/:id/compra"
            element={
              <ProtectedRoute>
                <RequirePermission permission="ordenes"><AdminPurchaseOrder /></RequirePermission>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/categorias"
            element={
              <ProtectedRoute>
                <RequirePermission permission="categorias"><AdminCategories /></RequirePermission>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/clientes"
            element={
              <ProtectedRoute>
                <RequirePermission permission="clientes"><AdminCustomers /></RequirePermission>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/metricas"
            element={
              <ProtectedRoute>
                <RequirePermission permission="metricas"><AdminMetrics /></RequirePermission>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/analiticas"
            element={
              <ProtectedRoute>
                <RequirePermission permission="analiticas"><AdminAnalytics /></RequirePermission>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/productos/nuevo"
            element={
              <ProtectedRoute>
                <RequirePermission permission="productos"><AdminProductCreate /></RequirePermission>
              </ProtectedRoute>
            }
          />

          {/* Campañas de oferta con vigencia — sub-vista de Productos */}
          {/* Mercado Libre: publicaciones y vínculos (permiso productos) y la vuelta de la conexión
              (la usa solo el dueño: el servidor exige superadministrador para canjear el código). */}
          <Route
            path="/admin/productos/mercadolibre"
            element={
              <ProtectedRoute>
                <RequirePermission permission="productos"><AdminMercadoLibre /></RequirePermission>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/mercadolibre/conectar"
            element={
              <ProtectedRoute>
                <AdminMlCallback />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/productos/ofertas"
            element={
              <ProtectedRoute>
                <RequirePermission permission="productos"><AdminOffers /></RequirePermission>
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/productos/flyer"
            element={
              <ProtectedRoute>
                <RequirePermission permission="flyer"><AdminFlyer /></RequirePermission>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/caja"
            element={
              <ProtectedRoute>
                <RequirePermission permission="caja"><AdminCaja /></RequirePermission>
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/compras"
            element={
              <ProtectedRoute>
                <RequirePermission permission="compras"><AdminPurchases /></RequirePermission>
              </ProtectedRoute>
            }
          />

          {/* ABM de proveedores — sub-vista de Compras (dropdown del sidebar) */}
          <Route
            path="/admin/compras/proveedores"
            element={
              <ProtectedRoute>
                <RequirePermission permission="compras"><AdminSuppliers /></RequirePermission>
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/cupones"
            element={
              <ProtectedRoute>
                <RequirePermission permission="cupones"><AdminCoupons /></RequirePermission>
              </ProtectedRoute>
            }
          />

          {/* /admin/carrusel — descartada: funcionalidad movida a CarouselSectionContent en /admin/configuracion */}
          {/* <Route
            path="/admin/carrusel"
            element={
              <ProtectedRoute>
                <RequirePermission permission="carrusel"><AdminCarousel /></RequirePermission>
              </ProtectedRoute>
            }
          /> */}
          {/* /admin/carrusel/banner — descartada: banner movido a CarouselSectionContent en /admin/configuracion */}
          {/* <Route
            path="/admin/carrusel/banner"
            element={
              <ProtectedRoute>
                <RequirePermission permission="carrusel"><AdminAnnouncementBanner /></RequirePermission>
              </ProtectedRoute>
            }
          /> */}

          <Route
            path="/admin/configuracion"
            element={
              <ProtectedRoute>
                <RequirePermission permission="configuracion"><AdminSettings /></RequirePermission>
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/devoluciones"
            element={
              <ProtectedRoute>
                <RequirePermission permission="devoluciones"><AdminReturns /></RequirePermission>
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/emails"
            element={
              <ProtectedRoute>
                <RequirePermission permission="emails"><AdminEmails /></RequirePermission>
              </ProtectedRoute>
            }
          />

          {/* /admin/usuarios — descartada: funcionalidad movida a UsersSectionContent en /admin/configuracion */}
          {/* <Route
            path="/admin/usuarios"
            element={
              <ProtectedRoute>
                <AdminUsers />
              </ProtectedRoute>
            }
          /> */}

          {/* Ruta no encontrada */}
          {/* Antes: <Route path="*" element={<Navigate to="/" replace />} /> — un link roto parecía el inicio */}
          <Route path="*" element={<PublicRoute><NotFound /></PublicRoute>} />
        </Routes>
        </Suspense>
      </CartProvider>
      </WishlistProvider>
      </NotificationProvider>
      </CustomerAuthProvider>
    </AuthProvider>
    </SiteConfigProvider>
    </HelmetProvider>
  );
}

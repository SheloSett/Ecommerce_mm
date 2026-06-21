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
import Checkout from "./pages/Checkout";
import PaymentResult from "./pages/PaymentResult";
import Register from "./pages/Register";
import CustomerLogin from "./pages/CustomerLogin";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import UnsubscribeRestock from "./pages/UnsubscribeRestock";
import EditProfile from "./pages/EditProfile";
import OrderHistory from "./pages/OrderHistory";
import OrderDetail from "./pages/OrderDetail";
import QuotationHistory from "./pages/QuotationHistory";
import PayQuotation from "./pages/PayQuotation";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import AboutUs from "./pages/AboutUs";
import HowToBuy from "./pages/HowToBuy";
import ReturnRequest from "./pages/ReturnRequest";
import Wishlist from "./pages/Wishlist";
import Cart from "./pages/Cart";

// Panel de administración
import AdminLogin from "./pages/admin/AdminLogin";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminProducts from "./pages/admin/AdminProducts";
import AdminOrders from "./pages/admin/AdminOrders";
import AdminCategories from "./pages/admin/AdminCategories";
import AdminCustomers from "./pages/admin/AdminCustomers";
import AdminMetrics from "./pages/admin/AdminMetrics";
import AdminProductCreate from "./pages/admin/AdminProductCreate";
import AdminCaja from "./pages/admin/AdminCaja";
import AdminFlyer from "./pages/admin/AdminFlyer";
import AdminCoupons from "./pages/admin/AdminCoupons";
import AdminPurchases from "./pages/admin/AdminPurchases";
import AdminSuppliers from "./pages/admin/AdminSuppliers";
// AdminCarousel: movido a CarouselSectionContent embebido en AdminSettings — página standalone descartada
// import AdminCarousel from "./pages/admin/AdminCarousel";
// AdminAnnouncementBanner: movido a CarouselSectionContent embebido en AdminSettings — página standalone descartada
// import AdminAnnouncementBanner from "./pages/admin/AdminAnnouncementBanner";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminReturns from "./pages/admin/AdminReturns";
// AdminUsers: movido a UsersSectionContent embebido en AdminSettings — página standalone descartada
// import AdminUsers from "./pages/admin/AdminUsers";
import AdminOrderDetail from "./pages/admin/AdminOrderDetail";
import AdminPurchaseOrder from "./pages/admin/AdminPurchaseOrder";
import ProtectedRoute from "./components/ProtectedRoute";
import RequirePermission from "./components/RequirePermission";
import WhatsAppButton from "./components/WhatsAppButton";
import ScrollToTop from "./components/ScrollToTop";
import MaintenancePage from "./pages/MaintenancePage";
import MaintenanceBanner from "./components/MaintenanceBanner";

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
    <div className="storefront">
      <MaintenanceBanner />
      {children}
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
            path="/admin/productos/nuevo"
            element={
              <ProtectedRoute>
                <RequirePermission permission="productos"><AdminProductCreate /></RequirePermission>
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </CartProvider>
      </WishlistProvider>
      </NotificationProvider>
      </CustomerAuthProvider>
    </AuthProvider>
    </SiteConfigProvider>
    </HelmetProvider>
  );
}

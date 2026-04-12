import { Routes, Route, Navigate } from "react-router-dom";
import { CartProvider } from "./context/CartContext";
import { AuthProvider } from "./context/AuthContext";
import { CustomerAuthProvider } from "./context/CustomerAuthContext";
import { NotificationProvider } from "./context/NotificationContext";
import { SiteConfigProvider, useSiteConfig } from "./context/SiteConfigContext";

// Páginas públicas
import Home from "./pages/Home";
import Catalog from "./pages/Catalog";
import ProductDetail from "./pages/ProductDetail";
import Checkout from "./pages/Checkout";
import PaymentResult from "./pages/PaymentResult";
import Register from "./pages/Register";
import CustomerLogin from "./pages/CustomerLogin";
import EditProfile from "./pages/EditProfile";
import OrderHistory from "./pages/OrderHistory";
import QuotationHistory from "./pages/QuotationHistory";
import PayQuotation from "./pages/PayQuotation";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";

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
import AdminCarousel from "./pages/admin/AdminCarousel";
import AdminSettings from "./pages/admin/AdminSettings";
import ProtectedRoute from "./components/ProtectedRoute";
import WhatsAppButton from "./components/WhatsAppButton";
import MaintenancePage from "./pages/MaintenancePage";

// Wrapper que aplica el modo mantenimiento y la clase .storefront (para temas CSS)
// a todas las paginas publicas. Las rutas /admin/* no se ven afectadas.
function PublicRoute({ children }) {
  const { maintenance } = useSiteConfig();
  if (maintenance) return <MaintenancePage />;
  return <div className="storefront">{children}</div>;
}

export default function App() {
  return (
    <SiteConfigProvider>
    <AuthProvider>
      <CustomerAuthProvider>
      <NotificationProvider>
      <CartProvider>
        <WhatsAppButton />
        <Routes>
          {/* ── Tienda pública (envuelta en PublicRoute para mantenimiento) ── */}
          <Route path="/" element={<PublicRoute><Home /></PublicRoute>} />
          <Route path="/catalogo" element={<PublicRoute><Catalog /></PublicRoute>} />
          <Route path="/producto/:id" element={<PublicRoute><ProductDetail /></PublicRoute>} />
          <Route path="/checkout" element={<PublicRoute><Checkout /></PublicRoute>} />
          <Route path="/pago/exitoso" element={<PublicRoute><PaymentResult type="success" /></PublicRoute>} />
          <Route path="/pago/fallido" element={<PublicRoute><PaymentResult type="failure" /></PublicRoute>} />
          <Route path="/pago/pendiente" element={<PublicRoute><PaymentResult type="pending" /></PublicRoute>} />
          <Route path="/registro" element={<PublicRoute><Register /></PublicRoute>} />
          <Route path="/login" element={<PublicRoute><CustomerLogin /></PublicRoute>} />
          <Route path="/perfil" element={<PublicRoute><EditProfile /></PublicRoute>} />
          <Route path="/pedidos" element={<PublicRoute><OrderHistory /></PublicRoute>} />
          <Route path="/cotizaciones" element={<PublicRoute><QuotationHistory /></PublicRoute>} />
          <Route path="/pagar-cotizacion/:id" element={<PublicRoute><PayQuotation /></PublicRoute>} />
          <Route path="/privacidad" element={<PublicRoute><Privacy /></PublicRoute>} />
          <Route path="/terminos" element={<PublicRoute><Terms /></PublicRoute>} />

          {/* ── Admin ── */}
          <Route path="/admin/login" element={<AdminLogin />} />
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
                <AdminProducts />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/ordenes"
            element={
              <ProtectedRoute>
                <AdminOrders />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/categorias"
            element={
              <ProtectedRoute>
                <AdminCategories />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/clientes"
            element={
              <ProtectedRoute>
                <AdminCustomers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/metricas"
            element={
              <ProtectedRoute>
                <AdminMetrics />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/productos/nuevo"
            element={
              <ProtectedRoute>
                <AdminProductCreate />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/productos/flyer"
            element={
              <ProtectedRoute>
                <AdminFlyer />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/caja"
            element={
              <ProtectedRoute>
                <AdminCaja />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/compras"
            element={
              <ProtectedRoute>
                <AdminPurchases />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/cupones"
            element={
              <ProtectedRoute>
                <AdminCoupons />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/carrusel"
            element={
              <ProtectedRoute>
                <AdminCarousel />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/configuracion"
            element={
              <ProtectedRoute>
                <AdminSettings />
              </ProtectedRoute>
            }
          />

          {/* Ruta no encontrada */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </CartProvider>
      </NotificationProvider>
      </CustomerAuthProvider>
    </AuthProvider>
    </SiteConfigProvider>
  );
}

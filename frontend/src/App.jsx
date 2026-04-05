import { Routes, Route, Navigate } from "react-router-dom";
import { CartProvider } from "./context/CartContext";
import { AuthProvider } from "./context/AuthContext";
import { CustomerAuthProvider } from "./context/CustomerAuthContext";
import { NotificationProvider } from "./context/NotificationContext";

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
import ProtectedRoute from "./components/ProtectedRoute";

export default function App() {
  return (
    <AuthProvider>
      <CustomerAuthProvider>
      <NotificationProvider>
      <CartProvider>
        <Routes>
          {/* ── Tienda pública ── */}
          <Route path="/" element={<Home />} />
          <Route path="/catalogo" element={<Catalog />} />
          <Route path="/producto/:id" element={<ProductDetail />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/pago/exitoso" element={<PaymentResult type="success" />} />
          <Route path="/pago/fallido" element={<PaymentResult type="failure" />} />
          <Route path="/pago/pendiente" element={<PaymentResult type="pending" />} />
          <Route path="/registro" element={<Register />} />
          <Route path="/login" element={<CustomerLogin />} />
          <Route path="/perfil" element={<EditProfile />} />
          <Route path="/pedidos" element={<OrderHistory />} />
          <Route path="/cotizaciones" element={<QuotationHistory />} />
          <Route path="/pagar-cotizacion/:id" element={<PayQuotation />} />

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
            path="/admin/caja"
            element={
              <ProtectedRoute>
                <AdminCaja />
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
  );
}

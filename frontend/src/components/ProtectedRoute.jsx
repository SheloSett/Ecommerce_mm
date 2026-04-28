import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { BadgeProvider } from "../context/BadgeContext";

// Redirige al login si el usuario no está autenticado.
// Envuelve con BadgeProvider para que el contador de badges sea compartido entre todas las páginas admin.
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }

  return <BadgeProvider>{children}</BadgeProvider>;
}

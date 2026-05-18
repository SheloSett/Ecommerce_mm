import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Protege rutas de admin que requieren un permiso específico.
// SUPERADMIN siempre pasa. ADMIN necesita tener la key en su array de permisos.
export default function RequirePermission({ permission, children }) {
  const { user, isSuperAdmin } = useAuth();

  if (isSuperAdmin) return children;
  if (user?.permissions?.includes(permission)) return children;

  return <Navigate to="/admin" replace />;
}

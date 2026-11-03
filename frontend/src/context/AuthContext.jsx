import { createContext, useContext, useState, useEffect } from "react";
import { authApi, setOnAdminUnauthorized } from "../services/api";
import { storageGet, storageSet, storageRemove, storageGetJSON, isPlainObject } from "../utils/storage";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Registrar callback en el interceptor de axios para que los 401 hagan setUser(null)
  // sin window.location.href (que causaba loops de recarga de página)
  useEffect(() => {
    setOnAdminUnauthorized(() => setUser(null));
    return () => setOnAdminUnauthorized(null);
  }, []);

  // Al montar, verificar si hay sesión guardada
  useEffect(() => {
    const token = storageGet("admin_token");
    // Un dato guardado roto no tira (antes JSON.parse directo): se vuelve a entrar y listo
    const savedUser = storageGetJSON("admin_user", isPlainObject);

    if (token && savedUser) {
      setUser(savedUser);
      // Verificar que el token todavía sea válido
      authApi
        .me()
        .then((res) => setUser(res.data))
        .catch((err) => {
          // Solo limpiar sesión en 401 (token inválido/expirado).
          // Errores como 429 (rate limit), 5xx (backend caído) o ECONNABORTED (timeout 12s)
          // no deben desloguear al admin — el token sigue siendo válido.
          const status = err?.response?.status;
          const isTimeout = err?.code === "ECONNABORTED" || err?.message?.includes("timeout");
          if (status === 401) {
            storageRemove("admin_token");
            storageRemove("admin_user");
            setUser(null);
          } else {
            // Timeout o error transitorio: mantener sesión con datos del localStorage
            if (isTimeout) console.warn("Auth check timeout — manteniendo sesión local");
            setUser(storageGetJSON("admin_user", isPlainObject));
          }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const res = await authApi.login({ email, password });
    const { token, user: userData } = res.data;
    storageSet("admin_token", token);
    storageSet("admin_user", JSON.stringify(userData));
    setUser(userData);
    return userData;
  };

  const logout = () => {
    storageRemove("admin_token");
    storageRemove("admin_user");
    setUser(null);
  };

  const updateProfile = async (data) => {
    const res = await authApi.updateProfile(data);
    const updated = res.data;
    storageSet("admin_user", JSON.stringify(updated));
    setUser(updated);
    return updated;
  };

  const isSuperAdmin = user?.role === "SUPERADMIN";

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateProfile, isSuperAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}

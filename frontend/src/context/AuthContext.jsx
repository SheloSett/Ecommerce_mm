import { createContext, useContext, useState, useEffect } from "react";
import { authApi } from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Al montar, verificar si hay sesión guardada
  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    const savedUser = localStorage.getItem("admin_user");

    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
      // Verificar que el token todavía sea válido
      authApi
        .me()
        .then((res) => setUser(res.data))
        .catch((err) => {
          // Solo limpiar sesión en 401 (token inválido/expirado).
          // Errores como 429 (rate limit) o 5xx (backend caído) no deben desloguear al admin
          // — el token sigue siendo válido, simplemente el servidor no pudo responder.
          const status = err?.response?.status;
          if (status === 401) {
            localStorage.removeItem("admin_token");
            localStorage.removeItem("admin_user");
            setUser(null);
          } else {
            // Mantener el usuario logueado con los datos guardados en localStorage
            // para que no pierda la sesión por un error transitorio del servidor
            const savedUser = localStorage.getItem("admin_user");
            if (savedUser) setUser(JSON.parse(savedUser));
            else setUser(null);
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
    localStorage.setItem("admin_token", token);
    localStorage.setItem("admin_user", JSON.stringify(userData));
    setUser(userData);
    return userData;
  };

  const logout = () => {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}

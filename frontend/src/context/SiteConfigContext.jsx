import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { settingsApi } from "../services/api";

const SiteConfigContext = createContext({
  theme: "clasico",
  setTheme: () => {},
  maintenance: false,
  loading: true,
  refetch: () => {},
});

export function SiteConfigProvider({ children }) {
  // Maintenance se lee del backend (global, controlado por admin)
  const [maintenance, setMaintenance] = useState(false);
  const [loading, setLoading] = useState(true);

  // Tema se lee de localStorage (preferencia individual de cada usuario)
  // Solo se aceptan "clasico" y "oscuro" — si hay un valor inválido se resetea y se limpia el storage
  const VALID_THEMES = ["clasico", "oscuro"];
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem("site-theme");
    if (!VALID_THEMES.includes(saved)) {
      localStorage.setItem("site-theme", "clasico");
      return "clasico";
    }
    return saved;
  });

  const setTheme = (newTheme) => {
    setThemeState(newTheme);
    localStorage.setItem("site-theme", newTheme);
  };

  const fetchConfig = useCallback(() => {
    settingsApi
      .get()
      .then((res) => {
        setMaintenance(res.data.maintenance === "true");
        // Ya no leemos theme del backend — viene de localStorage
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Aplica el atributo data-theme en <html> para que los CSS overrides funcionen
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <SiteConfigContext.Provider
      value={{
        theme,
        setTheme,
        maintenance,
        loading,
        refetch: fetchConfig,
      }}
    >
      {children}
    </SiteConfigContext.Provider>
  );
}

export const useSiteConfig = () => useContext(SiteConfigContext);

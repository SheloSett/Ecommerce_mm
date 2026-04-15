import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { settingsApi } from "../services/api";

const SiteConfigContext = createContext({
  theme: "clasico",
  setTheme: () => {},
  maintenance: false,
  scheduledAt: null,   // Date | null — fecha/hora programada para el mantenimiento
  loading: true,
  refetch: () => {},
});

export function SiteConfigProvider({ children }) {
  // Maintenance se lee del backend (global, controlado por admin)
  const [maintenanceRaw, setMaintenanceRaw] = useState(false); // valor real del backend
  // scheduledAt: Date | null — fecha programada leída del backend
  const [scheduledAt, setScheduledAt] = useState(null);
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
        setMaintenanceRaw(res.data.maintenance === "true");
        // Parsear la fecha programada (vacío o inválido → null)
        const raw = res.data.maintenanceScheduledAt;
        if (raw) {
          const d = new Date(raw);
          setScheduledAt(isNaN(d.getTime()) ? null : d);
        } else {
          setScheduledAt(null);
        }
        // Ya no leemos theme del backend — viene de localStorage
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Auto-activar mantenimiento cuando llega la hora programada:
  // Si maintenanceRaw es false pero scheduledAt ya pasó, tratamos como maintenance=true.
  // Se revisa cada segundo para que el cambio sea inmediato.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Guard: evita llamadas múltiples al backend si el efecto se dispara más de una vez
  const autoSaveRef = useRef(false);

  // Cuando la hora programada llega, persistir en el backend UNA SOLA VEZ.
  // Se usa useRef para no disparar más de una llamada aunque el componente re-renderice.
  // Antes: este efecto podía llamar al backend varias veces por segundo causando race conditions
  // que bloqueaban el admin panel.
  useEffect(() => {
    const scheduleExpired = !maintenanceRaw && scheduledAt !== null && now >= scheduledAt.getTime();
    if (!scheduleExpired || autoSaveRef.current) return;
    autoSaveRef.current = true;
    settingsApi
      .update({ maintenance: "true", maintenanceScheduledAt: "" })
      .then(() => {
        setMaintenanceRaw(true);
        setScheduledAt(null);
      })
      .catch(() => {
        // Si falla, resetear el guard para que reintente en el próximo tick
        autoSaveRef.current = false;
      });
  // now cambia cada segundo — recalculamos si la hora ya pasó
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, maintenanceRaw, scheduledAt]);

  // maintenance: true si el admin lo activó manualmente O si la hora programada ya pasó
  const maintenance = maintenanceRaw || (scheduledAt !== null && now >= scheduledAt.getTime());

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
        scheduledAt,
        loading,
        refetch: fetchConfig,
      }}
    >
      {children}
    </SiteConfigContext.Provider>
  );
}

export const useSiteConfig = () => useContext(SiteConfigContext);

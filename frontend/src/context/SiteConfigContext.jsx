import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { settingsApi } from "../services/api";

const SiteConfigContext = createContext({
  theme: "clasico",
  setTheme: () => {},
  maintenance: false,
  scheduledAt: null,
  announcement: null,  // { text, linkText, url, bgColor } | null
  mayoristaMinimoCompra: 0,
  // Footer de contacto (editables desde admin > Configuración > Contenido)
  footerEmail: "info@lsmarket.com.ar",
  footerPhone: "1150395166",
  footerAddress: "Av La Plata 744 Timbre 3",
  // Páginas de contenido (null = mostrar layout predeterminado)
  aboutUsContent: null,
  howToBuyContent: null,
  privacyContent: null,
  termsContent: null,
  loading: true,
  refetch: () => {},
});

export function SiteConfigProvider({ children }) {
  // Maintenance se lee del backend (global, controlado por admin)
  const [maintenanceRaw, setMaintenanceRaw] = useState(false); // valor real del backend
  // scheduledAt: Date | null — fecha programada leída del backend
  const [scheduledAt, setScheduledAt] = useState(null);
  const [announcement, setAnnouncement] = useState(null);
  const [mayoristaMinimoCompra, setMayoristaMinimo] = useState(0);
  // Footer de contacto — editables desde el admin
  const [footerEmail, setFooterEmail]     = useState("info@lsmarket.com.ar");
  const [footerPhone, setFooterPhone]     = useState("1150395166");
  const [footerAddress, setFooterAddress] = useState("Av La Plata 744 Timbre 3");
  // Páginas de contenido enriquecido — null significa usar el layout predeterminado (viejo enfoque RTE)
  const [aboutUsContent, setAboutUsContent]     = useState(null);
  const [howToBuyContent, setHowToBuyContent]   = useState(null);
  const [privacyContent, setPrivacyContent]     = useState(null);
  const [termsContent, setTermsContent]         = useState(null);
  // Contenido estructurado por sección — null = usar hardcoded defaults en la página
  const [aboutUsHero, setAboutUsHero]         = useState(null);
  const [aboutUsHistoria, setAboutUsHistoria] = useState(null);
  const [aboutUsValores, setAboutUsValores]   = useState(null);
  const [howToBuySteps, setHowToBuySteps]     = useState(null);
  const [howToBuyPayments, setHowToBuyPayments] = useState(null);
  const [howToBuyFaqs, setHowToBuyFaqs]       = useState(null);
  const [privacySections, setPrivacySections] = useState(null);
  const [termsSections, setTermsSections]     = useState(null);
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
    // Si el backend no responde en 4s, desbloqueamos la UI igual (sin modo mantenimiento)
    const timeout = setTimeout(() => setLoading(false), 4000);
    settingsApi
      .get()
      .then((res) => {
        clearTimeout(timeout);
        setMaintenanceRaw(res.data.maintenance === "true");
        // Parsear la fecha programada (vacío o inválido → null)
        const raw = res.data.maintenanceScheduledAt;
        if (raw) {
          const d = new Date(raw);
          setScheduledAt(isNaN(d.getTime()) ? null : d);
        } else {
          setScheduledAt(null);
        }
        // Leer banners de anuncio (nuevo formato: JSON array en announcementBanners)
        // Fallback al formato legacy de un solo banner para compatibilidad
        if (res.data.announcementBanners) {
          try {
            const banners = JSON.parse(res.data.announcementBanners);
            setAnnouncement(Array.isArray(banners) ? banners.filter((b) => b.active && b.text) : null);
          } catch { setAnnouncement(null); }
        } else if (res.data.announcementActive === "true" && res.data.announcementText) {
          setAnnouncement([{
            id: "legacy",
            active: true,
            text: res.data.announcementText,
            linkText: res.data.announcementLinkText || "",
            url: res.data.announcementUrl || "",
            bgColor: res.data.announcementBgColor || "blue",
            textColor: res.data.announcementTextColor || "white",
            scrollDir: res.data.announcementScrollDir || "ltr",
            visibleFor: "AMBOS",
          }]);
        } else {
          setAnnouncement(null);
        }
        setMayoristaMinimo(parseFloat(res.data.mayoristaMinimoCompra) || 0);
        // Leer datos de contacto del footer
        setFooterEmail(res.data.footerEmail || "info@lsmarket.com.ar");
        setFooterPhone(res.data.footerPhone || "1150395166");
        setFooterAddress(res.data.footerAddress || "Av La Plata 744 Timbre 3");
        // Leer contenido de páginas — null cuando está vacío (para mostrar el layout predeterminado)
        setAboutUsContent(res.data.aboutUsContent || null);
        setHowToBuyContent(res.data.howToBuyContent || null);
        setPrivacyContent(res.data.privacyContent || null);
        setTermsContent(res.data.termsContent || null);
        // Contenido estructurado — parsear JSON, null si está vacío o inválido
        const parseJSON = (str) => { try { return str ? JSON.parse(str) : null; } catch { return null; } };
        setAboutUsHero(parseJSON(res.data.aboutUsHero));
        setAboutUsHistoria(parseJSON(res.data.aboutUsHistoria));
        setAboutUsValores(parseJSON(res.data.aboutUsValores));
        setHowToBuySteps(parseJSON(res.data.howToBuySteps));
        setHowToBuyPayments(parseJSON(res.data.howToBuyPayments));
        setHowToBuyFaqs(parseJSON(res.data.howToBuyFaqs));
        setPrivacySections(parseJSON(res.data.privacySections));
        setTermsSections(parseJSON(res.data.termsSections));
        // Ya no leemos theme del backend — viene de localStorage
      })
      .catch(console.error)
      .finally(() => { clearTimeout(timeout); setLoading(false); });
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

  // Re-fetching cuando la pestaña vuelve a tener foco — garantiza que los cambios guardados
  // en el admin (otra pestaña) se reflejen en la tienda sin necesidad de recargar manualmente.
  useEffect(() => {
    const handleFocus = () => fetchConfig();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [fetchConfig]);

  return (
    <SiteConfigContext.Provider
      value={{
        theme,
        setTheme,
        maintenance,
        scheduledAt,
        announcement,
        mayoristaMinimoCompra,
        footerEmail,
        footerPhone,
        footerAddress,
        aboutUsContent,
        howToBuyContent,
        privacyContent,
        termsContent,
        aboutUsHero,
        aboutUsHistoria,
        aboutUsValores,
        howToBuySteps,
        howToBuyPayments,
        howToBuyFaqs,
        privacySections,
        termsSections,
        loading,
        refetch: fetchConfig,
      }}
    >
      {children}
    </SiteConfigContext.Provider>
  );
}

export const useSiteConfig = () => useContext(SiteConfigContext);

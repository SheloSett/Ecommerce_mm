import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { settingsApi } from "../services/api";

// Última configuración recibida, guardada en el navegador: la tienda se dibuja con esa apenas abre y se
// actualiza cuando llega la nueva (antes mostraba un spinner hasta que respondía /api/settings, hasta 4 s).
// Si la nueva trae mantenimiento, PublicRoute redirige igual en cuanto llega.
const CONFIG_CACHE_KEY = "site-config-cache";
function readCachedConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_CACHE_KEY)) || null; } catch { return null; }
}

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
  // Meta Pixel (Facebook / Instagram): "" = sin Pixel. Ver components/MetaPixel.jsx.
  metaPixelId: "",
  metaTrackWholesale: false,
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
  // Meta Pixel — id del Pixel y si los eventos de compra incluyen a los mayoristas
  const [metaPixelId, setMetaPixelId]             = useState("");
  const [metaTrackWholesale, setMetaTrackWholesale] = useState(false);
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

  const setTheme = useCallback((newTheme) => {
    setThemeState(newTheme);
    localStorage.setItem("site-theme", newTheme);
  }, []);

  // Pasa la configuración del backend (res.data de /api/settings) al estado.
  const applyConfig = useCallback((data) => {
    setMaintenanceRaw(data.maintenance === "true");
    // Parsear la fecha programada (vacío o inválido → null)
    const raw = data.maintenanceScheduledAt;
    if (raw) {
      const d = new Date(raw);
      setScheduledAt(isNaN(d.getTime()) ? null : d);
    } else {
      setScheduledAt(null);
    }
    // Leer banners de anuncio (nuevo formato: JSON array en announcementBanners)
    // Fallback al formato legacy de un solo banner para compatibilidad
    if (data.announcementBanners) {
      try {
        const banners = JSON.parse(data.announcementBanners);
        setAnnouncement(Array.isArray(banners) ? banners.filter((b) => b.active && b.text) : null);
      } catch { setAnnouncement(null); }
    } else if (data.announcementActive === "true" && data.announcementText) {
      setAnnouncement([{
        id: "legacy",
        active: true,
        text: data.announcementText,
        linkText: data.announcementLinkText || "",
        url: data.announcementUrl || "",
        bgColor: data.announcementBgColor || "blue",
        textColor: data.announcementTextColor || "white",
        scrollDir: data.announcementScrollDir || "ltr",
        visibleFor: "AMBOS",
      }]);
    } else {
      setAnnouncement(null);
    }
    setMayoristaMinimo(parseFloat(data.mayoristaMinimoCompra) || 0);
    // Leer datos de contacto del footer
    setFooterEmail(data.footerEmail || "info@lsmarket.com.ar");
    setFooterPhone(data.footerPhone || "1150395166");
    setFooterAddress(data.footerAddress || "Av La Plata 744 Timbre 3");
    // Leer contenido de páginas — null cuando está vacío (para mostrar el layout predeterminado)
    setAboutUsContent(data.aboutUsContent || null);
    setHowToBuyContent(data.howToBuyContent || null);
    setPrivacyContent(data.privacyContent || null);
    setTermsContent(data.termsContent || null);
    // Contenido estructurado — parsear JSON, null si está vacío o inválido
    const parseJSON = (str) => { try { return str ? JSON.parse(str) : null; } catch { return null; } };
    setAboutUsHero(parseJSON(data.aboutUsHero));
    setAboutUsHistoria(parseJSON(data.aboutUsHistoria));
    setAboutUsValores(parseJSON(data.aboutUsValores));
    setHowToBuySteps(parseJSON(data.howToBuySteps));
    setHowToBuyPayments(parseJSON(data.howToBuyPayments));
    setHowToBuyFaqs(parseJSON(data.howToBuyFaqs));
    setPrivacySections(parseJSON(data.privacySections));
    setTermsSections(parseJSON(data.termsSections));
    // Meta Pixel
    setMetaPixelId((data.metaPixelId || "").trim());
    setMetaTrackWholesale(data.metaTrackWholesale === "true");
    // Ya no leemos theme del backend — viene de localStorage
  }, []);

  const fetchConfig = useCallback(() => {
    // Si el backend no responde en 4s, desbloqueamos la UI igual (sin modo mantenimiento)
    const timeout = setTimeout(() => setLoading(false), 4000);
    settingsApi
      .get()
      .then((res) => {
        clearTimeout(timeout);
        applyConfig(res.data);
        try { localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(res.data)); } catch { /* sin espacio: no importa */ }
      })
      .catch(console.error)
      .finally(() => { clearTimeout(timeout); setLoading(false); });
  }, [applyConfig]);

  useEffect(() => {
    const cached = readCachedConfig();
    if (cached) {
      // El mantenimiento NO sale de la copia: si alguien entró durante un mantenimiento y vuelve cuando
      // ya terminó, lo mandaría a /mantenimiento y perdería el link al que iba. Lo decide la respuesta nueva.
      applyConfig({ ...cached, maintenance: "false", maintenanceScheduledAt: "" });
      setLoading(false);
    }
    fetchConfig();
  }, [applyConfig, fetchConfig]);

  // Auto-activar mantenimiento cuando llega la hora programada:
  // Si maintenanceRaw es false pero scheduledAt ya pasó, tratamos como maintenance=true.
  // Antes: un setInterval de 1 s, haya o no algo programado, que cambiaba el estado cada segundo y
  // re-dibujaba toda la tienda (barra, pie, carrito, checkout). Ahora un solo temporizador que despierta
  // a la hora programada, y solo si hay una.
  const [now, setNow] = useState(() => Date.now());
  const scheduleDue = scheduledAt !== null && now >= scheduledAt.getTime();
  useEffect(() => {
    if (!scheduledAt || maintenanceRaw || scheduleDue) return;
    // setTimeout acepta hasta ~24,8 días: si falta más, se vuelve a armar cuando vence este
    const ms = Math.max(0, Math.min(scheduledAt.getTime() - Date.now(), 2 ** 31 - 1));
    const timer = setTimeout(() => setNow(Date.now()), ms);
    return () => clearTimeout(timer);
  }, [scheduledAt, maintenanceRaw, scheduleDue, now]);

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
        // Si falla (un visitante no puede guardar la configuración: solo un admin), se libera el guard.
        // Ya no se reintenta cada segundo; la tienda se muestra en mantenimiento igual (ver abajo).
        autoSaveRef.current = false;
      });
  // now cambia cuando vence el temporizador de arriba — recalculamos si la hora ya pasó
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, maintenanceRaw, scheduledAt]);

  // maintenance: true si el admin lo activó manualmente O si la hora programada ya pasó
  const maintenance = maintenanceRaw || scheduleDue;

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

  // Mismo objeto mientras no cambie nada: antes era uno nuevo en cada render y los ~16 componentes que
  // usan useSiteConfig se volvían a dibujar con cualquier cambio del Provider.
  const value = useMemo(() => ({
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
    metaPixelId,
    metaTrackWholesale,
    loading,
    refetch: fetchConfig,
  }), [
    theme, setTheme, maintenance, scheduledAt, announcement, mayoristaMinimoCompra, footerEmail, footerPhone,
    footerAddress, aboutUsContent, howToBuyContent, privacyContent, termsContent, aboutUsHero, aboutUsHistoria,
    aboutUsValores, howToBuySteps, howToBuyPayments, howToBuyFaqs, privacySections, termsSections, metaPixelId,
    metaTrackWholesale, loading, fetchConfig,
  ]);

  return (
    <SiteConfigContext.Provider value={value}>
      {children}
    </SiteConfigContext.Provider>
  );
}

export const useSiteConfig = () => useContext(SiteConfigContext);

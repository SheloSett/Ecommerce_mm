import { useState, useEffect, useRef } from "react";
// useNavigate: se usaba para navegar a Carrusel/Usuarios desde el sidebar — ahora se embeben inline
// import { useNavigate } from "react-router-dom";
import AdminLayout from "../../components/AdminLayout";
import { settingsApi, productsApi, emailTestApi, customersApi } from "../../services/api";
import { useSiteConfig } from "../../context/SiteConfigContext";
import { useAuth } from "../../context/AuthContext";
import CarouselSectionContent from "../../components/admin/CarouselSectionContent";
import UsersSectionContent from "../../components/admin/UsersSectionContent";
import AboutUsSectionContent from "../../components/admin/AboutUsSectionContent";
import HowToBuySectionContent from "../../components/admin/HowToBuySectionContent";
import PrivacySectionContent from "../../components/admin/PrivacySectionContent";
import TermsSectionContent from "../../components/admin/TermsSectionContent";
// RichTextEditor: se usaba para el viejo enfoque RTE de edición de páginas — reemplazado por secciones estructuradas
// import RichTextEditor from "../../components/RichTextEditor";
import toast from "react-hot-toast";

const SECTIONS = [
  { id: "mantenimiento",  label: "Modo mantenimiento",  icon: "🔧" },
  { id: "mayoristas",     label: "Reglas mayoristas",   icon: "🏭" },
  { id: "emails",         label: "Campañas de email",   icon: "📧" },
  // Sección "Banner de anuncio" movida a AdminCarousel.jsx donde tiene más sentido contextualmente
  // { id: "announcement",   label: "Banner de anuncio",   icon: "📢" },
  { id: "carrusel",       label: "Carrusel",            icon: "🖼️" },
  { id: "usuarios",       label: "Usuarios",            icon: "👤", superAdminOnly: true },
  // Grupo "Contenido" — páginas y footer editables desde el admin
  { id: "_group_contenido",    label: "Contenido",       isGroup: true },
  { id: "contenido_footer",    label: "Footer",          icon: "📍", isSubItem: true },
  { id: "contenido_sobre",     label: "Sobre nosotros",  icon: "🏢", isSubItem: true },
  { id: "contenido_como",      label: "Cómo comprar",    icon: "🛒", isSubItem: true },
  { id: "contenido_privacidad",label: "Privacidad",      icon: "🔒", isSubItem: true },
  { id: "contenido_terminos",  label: "Términos",        icon: "📄", isSubItem: true },
];

// Convierte un Date a string compatible con <input type="datetime-local"> (YYYY-MM-DDTHH:MM)
function toDatetimeLocal(date) {
  if (!date) return "";
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminSettings() {
  const { refetch } = useSiteConfig();
  const { isSuperAdmin } = useAuth();
  // navigate: se usaba para redirigir al clickear Carrusel/Usuarios — ahora se embeben inline
  // const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState("mantenimiento");

  const visibleSections = SECTIONS.filter((s) => !s.superAdminOnly || isSuperAdmin);
  const [maintenance, setMaintenance] = useState(false);
  // scheduledInput: string en formato datetime-local ("YYYY-MM-DDTHH:MM") para el input
  const [scheduledInput, setScheduledInput] = useState("");
  // scheduledSaved: ISO string guardado en el backend (vacío = sin programar)
  const [scheduledSaved, setScheduledSaved] = useState("");
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);

  // Banner de anuncio
  const [annActive, setAnnActive]       = useState(false);
  const [annText, setAnnText]           = useState("");
  const [annLinkText, setAnnLinkText]   = useState("");
  const [annUrl, setAnnUrl]             = useState("");
  const [annBgColor, setAnnBgColor]     = useState("blue");
  const [savingAnn, setSavingAnn]       = useState(false);

  // Compra mínima mayorista
  const [mayoristaMinimoInput, setMayoristaMinimo] = useState("0");
  const [savingMinimo, setSavingMinimo]             = useState(false);

  // Campañas de email
  const [emailFrequency, setEmailFrequency]           = useState("7");
  const [emailHour, setEmailHour]                     = useState("9");
  const [emailProductCount, setEmailProductCount]     = useState("4");
  const [emailFeatured, setEmailFeatured]             = useState([]); // [{id, name, images}]
  const [emailSearch, setEmailSearch]                 = useState("");
  const [emailSearchResults, setEmailSearchResults]   = useState([]);
  const [searchingProducts, setSearchingProducts]     = useState(false);
  const [savingEmails, setSavingEmails]               = useState(false);
  const searchTimeoutRef = useRef(null);

  // Testing manual de campañas de email — disparar emails sin esperar el cron
  const [testEmailTarget, setTestEmailTarget] = useState("");
  const [sendingTestRestock, setSendingTestRestock] = useState(false);
  const [sendingTestRecomm, setSendingTestRecomm] = useState(false);
  // Autocomplete: lista de sugerencias y cliente exacto seleccionado
  const [testEmailSuggestions, setTestEmailSuggestions] = useState([]);
  const [testEmailSelectedCustomer, setTestEmailSelectedCustomer] = useState(null); // { type: "MAYORISTA" | "MINORISTA" }
  const testEmailSearchTimeoutRef = useRef(null);

  // Contenido — Footer (info de contacto editable desde el admin)
  const [footerEmail, setFooterEmail]     = useState("info@lsmarket.com.ar");
  const [footerPhone, setFooterPhone]     = useState("1150395166");
  const [footerAddress, setFooterAddress] = useState("Av La Plata 744 Timbre 3");
  const [savingFooter, setSavingFooter]   = useState(false);

  // Contenido — Páginas (HTML enriquecido guardado en DB)
  const [aboutUsContent, setAboutUsContent]       = useState("");
  const [howToBuyContent, setHowToBuyContent]     = useState("");
  const [privacyContent, setPrivacyContent]       = useState("");
  const [termsContent, setTermsContent]           = useState("");
  const [savingContent, setSavingContent]         = useState(false);

  useEffect(() => {
    settingsApi
      .get()
      .then((res) => {
        const maintenanceOn = res.data.maintenance === "true";
        const raw = res.data.maintenanceScheduledAt || "";
        const scheduledDate = raw ? new Date(raw) : null;
        const scheduleExpired = scheduledDate && scheduledDate <= new Date();

        // Si la hora programada ya pasó y el mantenimiento aún no está activado en el backend,
        // lo activamos automáticamente y limpiamos el schedule para que el toggle quede consistente.
        if (!maintenanceOn && scheduleExpired) {
          settingsApi.update({ maintenance: "true", maintenanceScheduledAt: "" })
            .then(() => {
              setMaintenance(true);
              setScheduledSaved("");
              setScheduledInput("");
              refetch();
            })
            .catch(console.error);
        } else {
          setMaintenance(maintenanceOn);
          setScheduledSaved(raw);
          setScheduledInput(raw && !scheduleExpired ? toDatetimeLocal(scheduledDate) : "");
        }

        // Cargar compra mínima mayorista
        setMayoristaMinimo(res.data.mayoristaMinimoCompra || "0");

        // Cargar configuración de campañas de email
        setEmailFrequency(res.data.emailMinoristaFrequencyDays || "7");
        setEmailHour(res.data.emailMinoristaHour || "9");
        setEmailProductCount(res.data.emailMinoristaProductCount || "4");
        try {
          // Se guarda como [{id, name, images}] para poder mostrarlos sin otra llamada a la API
          const saved = JSON.parse(res.data.emailMinoristaFeaturedProducts || "[]");
          if (Array.isArray(saved) && saved.length > 0 && typeof saved[0] === "object") {
            setEmailFeatured(saved);
          }
        } catch {}

        // Cargar datos del banner de anuncio
        setAnnActive(res.data.announcementActive === "true");
        setAnnText(res.data.announcementText || "");
        setAnnLinkText(res.data.announcementLinkText || "");
        setAnnUrl(res.data.announcementUrl || "");
        setAnnBgColor(res.data.announcementBgColor || "blue");

        // Cargar datos del footer y páginas de contenido
        setFooterEmail(res.data.footerEmail || "info@lsmarket.com.ar");
        setFooterPhone(res.data.footerPhone || "1150395166");
        setFooterAddress(res.data.footerAddress || "Av La Plata 744 Timbre 3");
        setAboutUsContent(res.data.aboutUsContent || "");
        setHowToBuyContent(res.data.howToBuyContent || "");
        setPrivacyContent(res.data.privacyContent || "");
        setTermsContent(res.data.termsContent || "");
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refetch]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.update({
        maintenance: maintenance ? "true" : "false",
      });
      refetch();
      toast.success("Configuración guardada");
    } catch (err) {
      toast.error("Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  // Guardar la fecha programada
  const handleSaveSchedule = async () => {
    if (!scheduledInput) {
      toast.error("Seleccioná una fecha y hora");
      return;
    }
    const date = new Date(scheduledInput);
    if (isNaN(date.getTime()) || date <= new Date()) {
      toast.error("La fecha debe ser en el futuro");
      return;
    }
    setSavingSchedule(true);
    try {
      await settingsApi.update({ maintenanceScheduledAt: date.toISOString() });
      setScheduledSaved(date.toISOString());
      refetch();
      toast.success("Mantenimiento programado");
    } catch {
      toast.error("Error al programar");
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleSaveAnnouncement = async () => {
    if (annActive && !annText.trim()) {
      toast.error("Escribí un texto para el banner");
      return;
    }
    if (annLinkText && annText && !annText.includes(annLinkText)) {
      toast.error(`La palabra "${annLinkText}" no aparece en el texto del banner`);
      return;
    }
    setSavingAnn(true);
    try {
      await settingsApi.update({
        announcementActive: annActive ? "true" : "false",
        announcementText: annText.trim(),
        announcementLinkText: annLinkText.trim(),
        announcementUrl: annUrl.trim(),
        announcementBgColor: annBgColor,
      });
      refetch();
      toast.success("Banner guardado");
    } catch {
      toast.error("Error al guardar el banner");
    } finally {
      setSavingAnn(false);
    }
  };

  // Cancelar la programación
  const handleCancelSchedule = async () => {
    setSavingSchedule(true);
    try {
      await settingsApi.update({ maintenanceScheduledAt: "" });
      setScheduledSaved("");
      setScheduledInput("");
      refetch();
      toast.success("Programación cancelada");
    } catch {
      toast.error("Error al cancelar");
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleSaveMinimo = async () => {
    const valor = parseFloat(mayoristaMinimoInput);
    if (isNaN(valor) || valor < 0) {
      toast.error("Ingresá un monto válido (0 = sin mínimo)");
      return;
    }
    setSavingMinimo(true);
    try {
      await settingsApi.update({ mayoristaMinimoCompra: String(valor) });
      refetch();
      toast.success(valor === 0 ? "Mínimo mayorista desactivado" : `Mínimo mayorista guardado: $${valor.toLocaleString("es-AR")}`);
    } catch {
      toast.error("Error al guardar");
    } finally {
      setSavingMinimo(false);
    }
  };

  // Buscar clientes para autocompletar (debounced — usa el endpoint /customers?search=)
  const handleTestEmailSearch = (value) => {
    setTestEmailTarget(value);
    setTestEmailSelectedCustomer(null); // si edita el input, deselecciona el cliente actual
    clearTimeout(testEmailSearchTimeoutRef.current);
    if (!value.trim() || value.trim().length < 2) {
      setTestEmailSuggestions([]);
      return;
    }
    testEmailSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await customersApi.getAll({ search: value.trim() });
        // El endpoint puede devolver { customers: [...] } o un array directo según implementación
        const list = Array.isArray(res.data) ? res.data : (res.data.customers || []);
        setTestEmailSuggestions(list.slice(0, 6));
      } catch { setTestEmailSuggestions([]); }
    }, 250);
  };

  // Al elegir una sugerencia: setear el email Y guardar el tipo del cliente
  const handlePickTestEmailSuggestion = (customer) => {
    setTestEmailTarget(customer.email);
    setTestEmailSelectedCustomer(customer);
    setTestEmailSuggestions([]);
  };

  // Disparar manualmente el email de restock (mayoristas) — para testing
  const handleSendTestRestock = async () => {
    if (!testEmailTarget.trim()) { toast.error("Ingresá un email"); return; }
    setSendingTestRestock(true);
    try {
      const res = await emailTestApi.sendRestock(testEmailTarget.trim());
      toast.success(`Email enviado a ${res.data.sentTo}`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al enviar");
    } finally { setSendingTestRestock(false); }
  };

  // Disparar manualmente el email de recomendaciones (minoristas) — para testing
  const handleSendTestRecomm = async () => {
    if (!testEmailTarget.trim()) { toast.error("Ingresá un email"); return; }
    setSendingTestRecomm(true);
    try {
      const res = await emailTestApi.sendRecommendation(testEmailTarget.trim());
      toast.success(`Email enviado a ${res.data.sentTo} (${res.data.productsCount} productos)`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al enviar");
    } finally { setSendingTestRecomm(false); }
  };

  // Buscar productos para la sección de campañas de email (debounced)
  const handleEmailProductSearch = (value) => {
    setEmailSearch(value);
    clearTimeout(searchTimeoutRef.current);
    if (!value.trim()) { setEmailSearchResults([]); return; }
    searchTimeoutRef.current = setTimeout(async () => {
      setSearchingProducts(true);
      try {
        const res = await productsApi.getAllAdmin({ search: value, limit: 8 });
        const list = Array.isArray(res.data) ? res.data : (res.data?.products || []);
        setEmailSearchResults(list.filter((p) => p.active && !emailFeatured.some((f) => f.id === p.id)));
      } catch {}
      finally { setSearchingProducts(false); }
    }, 350);
  };

  const handleAddFeatured = (product) => {
    setEmailFeatured((prev) => [...prev, product]);
    setEmailSearchResults([]);
    setEmailSearch("");
  };

  const handleRemoveFeatured = (id) => {
    setEmailFeatured((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSaveEmails = async () => {
    const freq = parseInt(emailFrequency);
    const count = parseInt(emailProductCount);
    if (isNaN(freq) || freq < 1) return toast.error("La frecuencia debe ser al menos 1 día");
    if (isNaN(count) || count < 1 || count > 12) return toast.error("La cantidad debe ser entre 1 y 12");
    setSavingEmails(true);
    try {
      await settingsApi.update({
        emailMinoristaFrequencyDays: String(freq),
        emailMinoristaHour: String(emailHour),
        emailMinoristaProductCount: String(count),
        // Guardar id+name+images para poder mostrarlos al cargar sin hacer otra llamada
        emailMinoristaFeaturedProducts: JSON.stringify(
          emailFeatured.map((p) => ({ id: p.id, name: p.name, images: p.images ?? [] }))
        ),
      });
      toast.success("Campaña de email guardada");
    } catch {
      toast.error("Error al guardar");
    } finally {
      setSavingEmails(false);
    }
  };

  const handleSaveFooter = async () => {
    if (!footerEmail.trim()) return toast.error("El email no puede estar vacío");
    setSavingFooter(true);
    try {
      await settingsApi.update({
        footerEmail: footerEmail.trim(),
        footerPhone: footerPhone.trim(),
        footerAddress: footerAddress.trim(),
      });
      refetch();
      toast.success("Contacto del footer guardado");
    } catch {
      toast.error("Error al guardar");
    } finally {
      setSavingFooter(false);
    }
  };

  const handleSavePageContent = async (key, value) => {
    setSavingContent(true);
    try {
      await settingsApi.update({ [key]: value });
      refetch();
      toast.success("Página guardada");
    } catch {
      toast.error("Error al guardar");
    } finally {
      setSavingContent(false);
    }
  };

  if (loading) {
    return (
      <AdminLayout title="Configuración">
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Configuración">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col gap-6 sm:flex-row">

          {/* ── Sidebar de secciones ── */}
          <aside className="w-full sm:w-52 flex-shrink-0">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Secciones
                </p>
              </div>
              <nav className="p-2 space-y-0.5">
                {visibleSections.map((s) => {
                  // Secciones de grupo: actúan como encabezados visuales, no como botones
                  if (s.isGroup) {
                    return (
                      <div key={s.id}>
                        <div className="border-t border-slate-200 my-2" />
                        <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold px-3 py-1">
                          {s.label}
                        </p>
                      </div>
                    );
                  }
                  return (
                    <button
                      key={s.id}
                      onClick={() => setActiveSection(s.id)}
                      className={`w-full flex items-center gap-2.5 px-3 rounded-xl text-sm font-medium text-left transition-colors ${
                        activeSection === s.id
                          ? "bg-blue-50 text-blue-700"
                          : "text-slate-600 hover:bg-slate-50"
                      } ${s.isSubItem ? "pl-6 py-2 text-xs" : "py-2.5"}`}
                    >
                      <span>{s.icon}</span>
                      <span className="flex-1">{s.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>

          {/* ── Contenido de la sección activa ── */}
          <div className="flex-1 space-y-5">

            {activeSection === "mantenimiento" && (
              <>
                {/* Card principal */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="font-bold text-slate-800 text-base">Modo mantenimiento</h2>
                      <p className="text-sm text-slate-500 mt-1 max-w-sm">
                        Al activar, los clientes verán una página de "En mantenimiento".
                        El panel de admin sigue funcionando normalmente.
                      </p>
                    </div>
                    {/* Toggle */}
                    <button
                      type="button"
                      onClick={() => setMaintenance((m) => !m)}
                      className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors duration-200 ${
                        maintenance ? "bg-red-500" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${
                          maintenance ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Estado actual */}
                  <div className={`mt-5 rounded-xl px-4 py-3 text-sm flex items-center gap-2 ${
                    maintenance
                      ? "bg-red-50 border border-red-200 text-red-700"
                      : "bg-emerald-50 border border-emerald-200 text-emerald-700"
                  }`}>
                    <span>{maintenance ? "🔴" : "🟢"}</span>
                    {maintenance
                      ? "La tienda está actualmente en mantenimiento."
                      : "La tienda está activa y visible para los clientes."}
                  </div>
                </div>

                {/* Botón guardar toggle */}
                <div className="flex justify-end">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? "Guardando…" : "Guardar cambios"}
                  </button>
                </div>

                {/* Card de programación — solo visible cuando el mantenimiento está desactivado */}
                {!maintenance && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                    <div>
                      <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                        <span>🗓️</span> Programar mantenimiento
                      </h3>
                      <p className="text-sm text-slate-500 mt-1">
                        Elegí una fecha y hora para que el sitio entre en mantenimiento automáticamente.
                        Los clientes verán un banner con la cuenta regresiva hasta ese momento.
                      </p>
                    </div>

                    {/* Fecha programada actualmente guardada */}
                    {scheduledSaved && (
                      <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
                        <div className="flex items-center gap-2 text-amber-800">
                          <span>⏳</span>
                          <span>
                            Programado para el{" "}
                            <strong>
                              {new Date(scheduledSaved).toLocaleString("es-AR", {
                                weekday: "long", day: "numeric", month: "long",
                                hour: "2-digit", minute: "2-digit",
                              })}
                            </strong>
                          </span>
                        </div>
                        <button
                          onClick={handleCancelSchedule}
                          disabled={savingSchedule}
                          className="text-xs font-semibold text-red-600 hover:text-red-700 underline underline-offset-2 disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}

                    {/* Input de fecha/hora + botón programar */}
                    <div className="flex gap-3 items-end">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          Fecha y hora
                        </label>
                        <input
                          type="datetime-local"
                          value={scheduledInput}
                          onChange={(e) => setScheduledInput(e.target.value)}
                          // El mínimo es "ahora" para evitar programar en el pasado
                          min={toDatetimeLocal(new Date())}
                          className="input text-sm"
                        />
                      </div>
                      <button
                        onClick={handleSaveSchedule}
                        disabled={savingSchedule || !scheduledInput}
                        className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl disabled:opacity-50 transition-colors text-sm whitespace-nowrap"
                      >
                        {savingSchedule ? "Guardando…" : scheduledSaved ? "Actualizar" : "Programar"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {activeSection === "mayoristas" && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
                <div>
                  <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
                    <span>🏭</span> Reglas de compra mayorista
                  </h2>
                  <p className="text-sm text-slate-500 mt-1 max-w-sm">
                    Configurá el monto mínimo que deben alcanzar los pedidos de clientes mayoristas.
                    Si el carrito no llega a este valor, el cliente no puede confirmar la cotización.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    Monto mínimo de compra <span className="text-slate-400 font-normal">(en ARS)</span>
                  </label>
                  <div className="flex gap-3 items-center">
                    <div className="relative flex-1 max-w-xs">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium text-sm">$</span>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        value={mayoristaMinimoInput}
                        onChange={(e) => setMayoristaMinimo(e.target.value)}
                        className="input pl-7 text-sm"
                        placeholder="0"
                      />
                    </div>
                    <button
                      onClick={handleSaveMinimo}
                      disabled={savingMinimo}
                      className="px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm whitespace-nowrap"
                    >
                      {savingMinimo ? "Guardando…" : "Guardar"}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">
                    Ponelo en <strong>0</strong> para no aplicar ningún mínimo.
                  </p>
                </div>

                {/* Estado actual */}
                <div className={`rounded-xl px-4 py-3 text-sm flex items-center gap-2 ${
                  parseFloat(mayoristaMinimoInput) > 0
                    ? "bg-blue-50 border border-blue-200 text-blue-700"
                    : "bg-slate-50 border border-slate-200 text-slate-500"
                }`}>
                  <span>{parseFloat(mayoristaMinimoInput) > 0 ? "🔒" : "🔓"}</span>
                  {parseFloat(mayoristaMinimoInput) > 0
                    ? `Los mayoristas deben superar $${parseFloat(mayoristaMinimoInput).toLocaleString("es-AR")} para poder cotizar.`
                    : "Sin mínimo — los mayoristas pueden cotizar cualquier monto."}
                </div>
              </div>
            )}

            {activeSection === "emails" && (
              <div className="space-y-5">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
                  <div>
                    <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
                      <span>📧</span> Campañas de email — Minoristas
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                      Configurá los emails de recomendación semanal que reciben los clientes minoristas.
                    </p>
                  </div>

                  {/* Frecuencia y hora */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1">
                        Frecuencia <span className="text-slate-400 font-normal">(días)</span>
                      </label>
                      <input
                        type="number" min="1" max="90"
                        value={emailFrequency}
                        onChange={(e) => setEmailFrequency(e.target.value)}
                        className="input text-sm w-full"
                        placeholder="7"
                      />
                      <p className="text-xs text-slate-400 mt-1">Cada cuántos días se envía el email</p>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1">
                        Hora de envío <span className="text-slate-400 font-normal">(Argentina)</span>
                      </label>
                      <select
                        value={emailHour}
                        onChange={(e) => setEmailHour(e.target.value)}
                        className="input text-sm w-full"
                      >
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={String(i)}>
                            {String(i).padStart(2, "0")}:00 hs
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1">
                        Cantidad de productos
                      </label>
                      <input
                        type="number" min="1" max="12"
                        value={emailProductCount}
                        onChange={(e) => setEmailProductCount(e.target.value)}
                        className="input text-sm w-full"
                        placeholder="4"
                      />
                      <p className="text-xs text-slate-400 mt-1">Productos que aparecen en el email</p>
                    </div>
                  </div>

                  {/* Productos destacados */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">
                      Productos destacados <span className="text-slate-400 font-normal">(opcionales)</span>
                    </label>
                    <p className="text-xs text-slate-500 mb-3">
                      Estos productos aparecen primero en el email de todos los minoristas, completando con productos relacionados a su última compra.
                    </p>

                    {/* Buscador */}
                    <div className="relative mb-3">
                      <input
                        type="text"
                        value={emailSearch}
                        onChange={(e) => handleEmailProductSearch(e.target.value)}
                        placeholder="Buscar producto por nombre..."
                        className="input text-sm w-full pr-8"
                      />
                      {searchingProducts && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                      {emailSearchResults.length > 0 && (
                        <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                          {emailSearchResults.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => handleAddFeatured(p)}
                              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 text-left text-sm"
                            >
                              {p.images?.[0] && (
                                <img src={p.images[0].startsWith("http") ? p.images[0] : `${import.meta.env.VITE_API_URL?.replace("/api", "") || "http://localhost:4000"}${p.images[0]}`}
                                  alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                              )}
                              <span className="flex-1 text-slate-700 truncate">{p.name}</span>
                              <span className="text-xs text-blue-600 font-semibold">Agregar</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Lista de seleccionados */}
                    {emailFeatured.length === 0 ? (
                      <p className="text-sm text-slate-400 italic">
                        Sin productos destacados — se usarán los de la categoría del cliente.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {emailFeatured.map((p) => (
                          <div key={p.id} className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                            {p.images?.[0] && (
                              <img src={p.images[0].startsWith("http") ? p.images[0] : `${import.meta.env.VITE_API_URL?.replace("/api", "") || "http://localhost:4000"}${p.images[0]}`}
                                alt="" className="w-9 h-9 rounded object-cover flex-shrink-0" />
                            )}
                            <span className="flex-1 text-sm text-slate-700 truncate">{p.name}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveFeatured(p.id)}
                              className="text-red-400 hover:text-red-600 text-xs font-semibold px-2 py-1 rounded hover:bg-red-50 transition-colors"
                            >
                              Quitar
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end pt-2 border-t border-slate-100">
                    <button
                      onClick={handleSaveEmails}
                      disabled={savingEmails}
                      className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
                    >
                      {savingEmails ? "Guardando…" : "Guardar campaña"}
                    </button>
                  </div>
                </div>

                {/* Info mayoristas */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                  <h3 className="font-bold text-slate-800 text-base flex items-center gap-2 mb-2">
                    <span>🏭</span> Recordatorios a mayoristas
                  </h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    Los clientes mayoristas reciben emails automáticos cuando llevan tiempo sin comprar.
                    El ritmo es fijo: <strong>día 20 → +5 días → +7 días → cada 14 días</strong>.
                    Cada cliente puede darse de baja desde el link en el email, y puede reactivarlo desde su perfil.
                  </p>
                </div>

                {/* Panel de testing — disparar emails manualmente sin esperar el cron */}
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 space-y-4">
                  <div>
                    <h3 className="font-bold text-amber-900 text-base flex items-center gap-2 mb-1">
                      <span>🧪</span> Probar campañas de email
                    </h3>
                    <p className="text-sm text-amber-800/80 leading-relaxed">
                      Buscá el cliente por email o nombre y dispará el email correspondiente a su tipo.
                      El cliente <strong>debe tener al menos un pedido aprobado</strong>. Esto bypassa los checks de tiempo del cron.
                    </p>
                  </div>
                  {/* Input con autocomplete */}
                  <div className="relative max-w-md">
                    <label className="block text-xs font-semibold text-amber-900 mb-1">Cliente destino</label>
                    <input
                      type="text"
                      value={testEmailTarget}
                      onChange={(e) => handleTestEmailSearch(e.target.value)}
                      placeholder="Email o nombre del cliente..."
                      className="input w-full"
                      autoComplete="off"
                    />
                    {/* Sugerencias */}
                    {testEmailSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-10 max-h-64 overflow-y-auto">
                        {testEmailSuggestions.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => handlePickTestEmailSuggestion(c)}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-slate-800 text-sm truncate">{c.name}</p>
                              <p className="text-xs text-slate-500 truncate">{c.email}</p>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${c.type === "MAYORISTA" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                              {c.type}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Cliente seleccionado: muestra el tipo y solo el botón apropiado */}
                  {testEmailSelectedCustomer && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-amber-900">Cliente seleccionado:</span>
                      <span className="font-semibold text-slate-800">{testEmailSelectedCustomer.name}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${testEmailSelectedCustomer.type === "MAYORISTA" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                        {testEmailSelectedCustomer.type}
                      </span>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {/* Si hay un cliente seleccionado, mostramos solo el botón apropiado a su tipo.
                        Si no, mostramos los dos (el admin puede enviar manualmente con un email tipeado). */}
                    {(!testEmailSelectedCustomer || testEmailSelectedCustomer.type === "MAYORISTA") && (
                      <button
                        onClick={handleSendTestRestock}
                        disabled={sendingTestRestock || !testEmailTarget.trim()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
                      >
                        {sendingTestRestock ? "Enviando…" : "🏭 Enviar restock (mayorista)"}
                      </button>
                    )}
                    {(!testEmailSelectedCustomer || testEmailSelectedCustomer.type === "MINORISTA") && (
                      <button
                        onClick={handleSendTestRecomm}
                        disabled={sendingTestRecomm || !testEmailTarget.trim()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
                      >
                        {sendingTestRecomm ? "Enviando…" : "🛍 Enviar recomendaciones (minorista)"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeSection === "carrusel" && (
              <CarouselSectionContent />
            )}

            {activeSection === "usuarios" && (
              <UsersSectionContent />
            )}

            {/* ── Contenido > Footer ── */}
            {activeSection === "contenido_footer" && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
                <div>
                  <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
                    <span>📍</span> Información de contacto del footer
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Estos datos aparecen en el footer de la tienda, en la columna "Contacto".
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email de contacto</label>
                    <input
                      type="email"
                      value={footerEmail}
                      onChange={(e) => setFooterEmail(e.target.value)}
                      className="input w-full"
                      placeholder="tu@email.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Teléfono</label>
                    <input
                      type="text"
                      value={footerPhone}
                      onChange={(e) => setFooterPhone(e.target.value)}
                      className="input w-full"
                      placeholder="+54 11 XXXX-XXXX"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Dirección</label>
                    <input
                      type="text"
                      value={footerAddress}
                      onChange={(e) => setFooterAddress(e.target.value)}
                      className="input w-full"
                      placeholder="Calle, número, ciudad"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2 border-t border-slate-100">
                  <button
                    onClick={handleSaveFooter}
                    disabled={savingFooter}
                    className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
                  >
                    {savingFooter ? "Guardando…" : "Guardar contacto"}
                  </button>
                </div>
              </div>
            )}

            {/* ── Contenido > Sobre nosotros ── */}
            {/* Viejo enfoque RTE comentado — reemplazado por secciones estructuradas en AboutUsSectionContent */}
            {/*
            {activeSection === "contenido_sobre" && (
              <div>
                <RichTextEditor value={aboutUsContent} onChange={setAboutUsContent} />
                <button onClick={() => handleSavePageContent("aboutUsContent", aboutUsContent)}>Guardar</button>
              </div>
            )}
            */}
            {activeSection === "contenido_sobre" && <AboutUsSectionContent />}

            {/* ── Contenido > Cómo comprar ── */}
            {/* Viejo enfoque RTE comentado — reemplazado por secciones estructuradas en HowToBuySectionContent */}
            {/*
            {activeSection === "contenido_como" && (
              <div>
                <RichTextEditor value={howToBuyContent} onChange={setHowToBuyContent} />
                <button onClick={() => handleSavePageContent("howToBuyContent", howToBuyContent)}>Guardar</button>
              </div>
            )}
            */}
            {activeSection === "contenido_como" && <HowToBuySectionContent />}

            {/* ── Contenido > Política de privacidad ── */}
            {/* Viejo enfoque RTE comentado — reemplazado por secciones estructuradas en PrivacySectionContent */}
            {/*
            {activeSection === "contenido_privacidad" && (
              <div>
                <RichTextEditor value={privacyContent} onChange={setPrivacyContent} />
                <button onClick={() => handleSavePageContent("privacyContent", privacyContent)}>Guardar</button>
              </div>
            )}
            */}
            {activeSection === "contenido_privacidad" && <PrivacySectionContent />}

            {/* ── Contenido > Términos y condiciones ── */}
            {/* Viejo enfoque RTE comentado — reemplazado por secciones estructuradas en TermsSectionContent */}
            {/*
            {activeSection === "contenido_terminos" && (
              <div>
                <RichTextEditor value={termsContent} onChange={setTermsContent} />
                <button onClick={() => handleSavePageContent("termsContent", termsContent)}>Guardar</button>
              </div>
            )}
            */}
            {activeSection === "contenido_terminos" && <TermsSectionContent />}

            {activeSection === "announcement" && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-bold text-slate-800 text-base">Banner de anuncio</h2>
                    <p className="text-sm text-slate-500 mt-1 max-w-sm">
                      Barra fina que aparece debajo del navbar en todas las páginas de la tienda.
                    </p>
                  </div>
                  {/* Toggle activo/inactivo */}
                  <button
                    type="button"
                    onClick={() => setAnnActive((v) => !v)}
                    className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors duration-200 ${
                      annActive ? "bg-blue-500" : "bg-slate-300"
                    }`}
                  >
                    <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${annActive ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>

                {/* Texto del banner */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Texto del banner <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={annText}
                    onChange={(e) => setAnnText(e.target.value)}
                    placeholder='Ej: "Envío gratis en compras mayores a $50.000 — ver más"'
                    className="input w-full"
                  />
                </div>

                {/* Palabra con hipervínculo */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Palabra/frase con link
                      <span className="ml-1 text-xs font-normal text-slate-400">— opcional</span>
                    </label>
                    <input
                      type="text"
                      value={annLinkText}
                      onChange={(e) => setAnnLinkText(e.target.value)}
                      placeholder='Ej: "ver más"'
                      className="input w-full"
                    />
                    <p className="text-xs text-slate-400 mt-1">Debe aparecer exactamente igual en el texto.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      URL del link
                      <span className="ml-1 text-xs font-normal text-slate-400">— opcional</span>
                    </label>
                    <input
                      type="text"
                      value={annUrl}
                      onChange={(e) => setAnnUrl(e.target.value)}
                      placeholder='Ej: "/envios" o "https://..."'
                      className="input w-full"
                    />
                  </div>
                </div>

                {/* Color de fondo */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Color</label>
                  <div className="flex gap-2">
                    {[
                      { key: "blue",  label: "Azul",    cls: "bg-blue-600" },
                      { key: "green", label: "Verde",   cls: "bg-emerald-600" },
                      { key: "amber", label: "Amarillo",cls: "bg-amber-400" },
                      { key: "red",   label: "Rojo",    cls: "bg-red-600" },
                      { key: "slate", label: "Oscuro",  cls: "bg-slate-800" },
                    ].map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setAnnBgColor(c.key)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-medium transition-all ${
                          annBgColor === c.key ? "border-blue-500 ring-2 ring-blue-200" : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <span className={`w-4 h-4 rounded-full ${c.cls}`} />
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Preview */}
                {annText && (() => {
                  const previewColors = {
                    blue:  "bg-blue-600 text-white",
                    green: "bg-emerald-600 text-white",
                    amber: "bg-amber-400 text-amber-900",
                    red:   "bg-red-600 text-white",
                    slate: "bg-slate-800 text-slate-100",
                  };
                  const linkColors = {
                    blue: "text-blue-100 underline", green: "text-emerald-100 underline",
                    amber: "text-amber-800 underline font-bold", red: "text-red-100 underline",
                    slate: "text-slate-300 underline",
                  };
                  const cls = previewColors[annBgColor] || previewColors.blue;
                  const lCls = linkColors[annBgColor] || linkColors.blue;

                  const renderPreview = () => {
                    if (!annLinkText || !annText.includes(annLinkText)) return annText;
                    const idx = annText.indexOf(annLinkText);
                    return (
                      <>
                        {annText.slice(0, idx)}
                        <span className={lCls}>{annLinkText}</span>
                        {annText.slice(idx + annLinkText.length)}
                      </>
                    );
                  };

                  return (
                    <div>
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Vista previa</p>
                      <div className={`${cls} text-sm py-2 px-4 rounded-xl text-center`}>
                        {renderPreview()}
                      </div>
                    </div>
                  );
                })()}

                <div className="flex justify-end">
                  <button
                    onClick={handleSaveAnnouncement}
                    disabled={savingAnn}
                    className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {savingAnn ? "Guardando…" : "Guardar banner"}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

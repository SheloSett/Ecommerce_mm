import { useState, useEffect, useRef } from "react";
import { slidesApi, settingsApi, getImageUrl } from "../../services/api";
import { useSiteConfig } from "../../context/SiteConfigContext";
import toast from "react-hot-toast";

// ── Constantes para el banner de anuncio ───────────────────────────────────────
const BG_OPTIONS = [
  { key: "blue",   label: "Azul",     cls: "bg-blue-600" },
  { key: "green",  label: "Verde",    cls: "bg-emerald-600" },
  { key: "amber",  label: "Amarillo", cls: "bg-amber-400" },
  { key: "red",    label: "Rojo",     cls: "bg-red-600" },
  { key: "slate",  label: "Oscuro",   cls: "bg-slate-800" },
  { key: "black",  label: "Negro",    cls: "bg-black" },
  { key: "purple", label: "Violeta",  cls: "bg-purple-600" },
];
const TEXT_OPTIONS = [
  { key: "white",  label: "Blanco",   cls: "bg-white border border-slate-200" },
  { key: "black",  label: "Negro",    cls: "bg-black" },
  { key: "yellow", label: "Amarillo", cls: "bg-yellow-300" },
  { key: "amber",  label: "Ámbar",    cls: "bg-amber-900" },
  { key: "slate",  label: "Gris",     cls: "bg-slate-400" },
];
const SCROLL_OPTIONS = [
  { key: "none", label: "Estático",            icon: "⏹" },
  { key: "ltr",  label: "Izquierda → Derecha", icon: "→" },
  { key: "rtl",  label: "Derecha → Izquierda", icon: "←" },
];
const VISIBILITY_OPTIONS = [
  { key: "AMBOS",     label: "Todos",      icon: "👥" },
  { key: "MINORISTA", label: "Minoristas", icon: "🛍" },
  { key: "MAYORISTA", label: "Mayoristas", icon: "🏭" },
];
const BG_CSS   = { blue: "bg-blue-600", green: "bg-emerald-600", amber: "bg-amber-400", red: "bg-red-600", slate: "bg-slate-800", black: "bg-black", purple: "bg-purple-600" };
const TEXT_CSS = { white: "text-white", black: "text-black", yellow: "text-yellow-300", amber: "text-amber-900", slate: "text-slate-200" };

const EMPTY_SLIDE = { title: "", subtitle: "", url: "", active: true };
const newBanner = () => ({
  id: Date.now().toString(),
  active: true, text: "", linkText: "", url: "",
  bgColor: "blue", textColor: "white", scrollDir: "rtl", visibleFor: "AMBOS",
});

// ── Sub-componente: card de un banner individual ───────────────────────────────
function BannerCard({ banner, onChange, onDelete, index }) {
  const update = (field, value) => onChange({ ...banner, [field]: value });
  const renderPreview = () => {
    if (!banner.linkText || !banner.text.includes(banner.linkText)) return banner.text;
    const idx = banner.text.indexOf(banner.linkText);
    return (
      <>
        {banner.text.slice(0, idx)}
        <span className="underline font-semibold">{banner.linkText}</span>
        {banner.text.slice(idx + banner.linkText.length)}
      </>
    );
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Banner {index + 1}</span>
          <button type="button" onClick={() => update("active", !banner.active)}
            className={`relative inline-flex h-6 w-10 flex-shrink-0 items-center rounded-full transition-colors ${banner.active ? "bg-blue-500" : "bg-slate-300"}`}>
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform ${banner.active ? "translate-x-5" : "translate-x-1"}`} />
          </button>
          <span className="text-xs text-slate-500">{banner.active ? "Activo" : "Inactivo"}</span>
        </div>
        <button type="button" onClick={onDelete} className="text-red-400 hover:text-red-600 text-sm font-medium transition-colors">Eliminar</button>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Visible para</label>
        <div className="flex gap-2">
          {VISIBILITY_OPTIONS.map((o) => (
            <button key={o.key} type="button" onClick={() => update("visibleFor", o.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 text-sm font-medium transition-all ${banner.visibleFor === o.key ? "border-blue-500 ring-2 ring-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 hover:border-slate-300"}`}>
              <span>{o.icon}</span>{o.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Texto <span className="text-red-500">*</span></label>
        <input type="text" value={banner.text} onChange={(e) => update("text", e.target.value)}
          placeholder='Ej: "Envío gratis en compras mayores a $50.000 — ver más"' className="input w-full" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Palabra con link <span className="text-slate-400">— opcional</span></label>
          <input type="text" value={banner.linkText} onChange={(e) => update("linkText", e.target.value)} placeholder='Ej: "ver más"' className="input w-full" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">URL del link <span className="text-slate-400">— opcional</span></label>
          <input type="text" value={banner.url} onChange={(e) => update("url", e.target.value)} placeholder='Ej: "/envios"' className="input w-full" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-2">Color de fondo</label>
        <div className="flex flex-wrap gap-2">
          {BG_OPTIONS.map((c) => (
            <button key={c.key} type="button" onClick={() => update("bgColor", c.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border-2 text-xs font-medium transition-all ${banner.bgColor === c.key ? "border-blue-500 ring-2 ring-blue-200" : "border-slate-200 hover:border-slate-300"}`}>
              <span className={`w-3 h-3 rounded-full ${c.cls}`} />{c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-2">Color de letra</label>
        <div className="flex flex-wrap gap-2">
          {TEXT_OPTIONS.map((c) => (
            <button key={c.key} type="button" onClick={() => update("textColor", c.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border-2 text-xs font-medium transition-all ${banner.textColor === c.key ? "border-blue-500 ring-2 ring-blue-200" : "border-slate-200 hover:border-slate-300"}`}>
              <span className={`w-3 h-3 rounded-full ${c.cls}`} />{c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-2">Movimiento</label>
        <div className="flex gap-2">
          {SCROLL_OPTIONS.map((o) => (
            <button key={o.key} type="button" onClick={() => update("scrollDir", o.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border-2 text-xs font-medium transition-all ${banner.scrollDir === o.key ? "border-blue-500 ring-2 ring-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 hover:border-slate-300"}`}>
              <span>{o.icon}</span>{o.label}
            </button>
          ))}
        </div>
      </div>

      {banner.text && (
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Vista previa</p>
          <div className={`${BG_CSS[banner.bgColor] || "bg-blue-600"} ${TEXT_CSS[banner.textColor] || "text-white"} text-sm py-2 px-4 rounded-xl text-center overflow-hidden`}>
            {renderPreview()}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Componente principal exportado (sin AdminLayout) ──────────────────────────
export default function CarouselSectionContent() {
  const { refetch } = useSiteConfig();

  // ── Estado de slides ────────────────────────────────────────────────────────
  const [slides, setSlides]           = useState([]);
  const [loadingSlides, setLoadingSlides] = useState(true);
  const [showModal, setShowModal]     = useState(false);
  const [editing, setEditing]         = useState(null);
  const [form, setForm]               = useState(EMPTY_SLIDE);
  const [saving, setSaving]           = useState(false);
  const [imageFiles, setImageFiles]   = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const fileInputRef = useRef(null);

  // ── Estado de banners de anuncio ────────────────────────────────────────────
  const [banners, setBanners]         = useState([]);
  const [loadingBanners, setLoadingBanners] = useState(true);
  const [savingBanners, setSavingBanners]   = useState(false);

  // ── Tab activo dentro de la sección ────────────────────────────────────────
  const [tab, setTab] = useState("slides");

  useEffect(() => {
    loadSlides();
    settingsApi.get().then((res) => {
      if (res.data.announcementBanners) {
        try {
          const parsed = JSON.parse(res.data.announcementBanners);
          setBanners(Array.isArray(parsed) ? parsed : []);
        } catch { setBanners([]); }
      } else if (res.data.announcementText) {
        setBanners([{
          id: "legacy", active: res.data.announcementActive === "true",
          text: res.data.announcementText || "", linkText: res.data.announcementLinkText || "",
          url: res.data.announcementUrl || "", bgColor: res.data.announcementBgColor || "blue",
          textColor: res.data.announcementTextColor || "white",
          scrollDir: res.data.announcementScrollDir || "rtl", visibleFor: "AMBOS",
        }]);
      } else {
        setBanners([]);
      }
    }).catch(console.error).finally(() => setLoadingBanners(false));
  }, []);

  // ── Slides: funciones ────────────────────────────────────────────────────────
  async function loadSlides() {
    setLoadingSlides(true);
    try {
      const res = await slidesApi.getAll({ all: "true" });
      setSlides(res.data);
    } catch { toast.error("Error al cargar slides"); }
    finally { setLoadingSlides(false); }
  }

  function openCreate() {
    setEditing(null); setForm(EMPTY_SLIDE);
    setImageFiles([]); setImagePreviews([]);
    setShowModal(true);
  }

  function openEdit(slide) {
    setEditing(slide);
    setForm({ title: slide.title || "", subtitle: slide.subtitle || "", url: slide.url || "", active: slide.active });
    setImageFiles([]); setImagePreviews([]);
    setShowModal(true);
  }

  function handleFileChange(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    if (editing) {
      setImageFiles([files[0]]);
      setImagePreviews([URL.createObjectURL(files[0])]);
    } else {
      setImageFiles((prev) => [...prev, ...files]);
      setImagePreviews((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))]);
    }
    e.target.value = "";
  }

  function removePreview(idx) {
    setImageFiles((prev) => prev.filter((_, i) => i !== idx));
    setImagePreviews((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (editing) {
      setSaving(true);
      try {
        const fd = new FormData();
        if (imageFiles[0]) fd.append("image", imageFiles[0]);
        fd.append("title", form.title); fd.append("subtitle", form.subtitle);
        fd.append("url", form.url); fd.append("active", form.active ? "true" : "false");
        await slidesApi.update(editing.id, fd);
        toast.success("Slide actualizado");
        setShowModal(false); loadSlides();
      } catch (err) { toast.error(err.response?.data?.error || "Error al guardar"); }
      finally { setSaving(false); }
    } else {
      if (imageFiles.length === 0) { toast.error("Seleccioná al menos una imagen"); return; }
      setSaving(true);
      let created = 0;
      try {
        for (let i = 0; i < imageFiles.length; i++) {
          const fd = new FormData();
          fd.append("image", imageFiles[i]); fd.append("title", form.title);
          fd.append("subtitle", form.subtitle); fd.append("url", form.url);
          fd.append("active", form.active ? "true" : "false");
          fd.append("order", slides.length + i);
          await slidesApi.create(fd); created++;
        }
        toast.success(`${created} slide${created !== 1 ? "s" : ""} creado${created !== 1 ? "s" : ""}`);
        setShowModal(false); loadSlides();
      } catch (err) { toast.error(err.response?.data?.error || "Error al guardar"); }
      finally { setSaving(false); }
    }
  }

  async function handleDelete(slide) {
    if (!window.confirm("¿Eliminar este slide?")) return;
    try {
      await slidesApi.remove(slide.id);
      setSlides((prev) => prev.filter((s) => s.id !== slide.id));
      toast.success("Slide eliminado");
    } catch { toast.error("Error al eliminar"); }
  }

  async function handleToggleActive(slide) {
    try {
      const fd = new FormData();
      fd.append("active", !slide.active ? "true" : "false");
      await slidesApi.update(slide.id, fd);
      setSlides((prev) => prev.map((s) => s.id === slide.id ? { ...s, active: !s.active } : s));
    } catch { toast.error("Error al actualizar"); }
  }

  async function handleMove(slide, direction) {
    const sorted = [...slides].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((s) => s.id === slide.id);
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;
    const other = sorted[targetIdx];
    try {
      const fdA = new FormData(); fdA.append("order", other.order);
      const fdB = new FormData(); fdB.append("order", slide.order);
      await Promise.all([slidesApi.update(slide.id, fdA), slidesApi.update(other.id, fdB)]);
      setSlides((prev) => prev.map((s) => {
        if (s.id === slide.id) return { ...s, order: other.order };
        if (s.id === other.id) return { ...s, order: slide.order };
        return s;
      }));
    } catch { toast.error("Error al reordenar"); }
  }

  // ── Banners: funciones ───────────────────────────────────────────────────────
  async function handleSaveBanners() {
    for (const b of banners) {
      if (b.active && !b.text.trim()) { toast.error(`Banner ${banners.indexOf(b) + 1}: escribí un texto`); return; }
      if (b.linkText && b.text && !b.text.includes(b.linkText)) {
        toast.error(`Banner ${banners.indexOf(b) + 1}: "${b.linkText}" no aparece en el texto`); return;
      }
    }
    setSavingBanners(true);
    try {
      await settingsApi.update({ announcementBanners: JSON.stringify(banners) });
      refetch();
      toast.success("Banners guardados");
    } catch { toast.error("Error al guardar"); }
    finally { setSavingBanners(false); }
  }

  const sorted = [...slides].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-5">

      {/* ── Tabs: Slides / Banners ─────────────────────────────────────── */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {[
          { id: "slides",  label: "🖼️ Slides" },
          { id: "banners", label: "📢 Banners de anuncio" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === t.id ? "bg-white shadow text-slate-800" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab Slides ─────────────────────────────────────────────────── */}
      {tab === "slides" && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-slate-500 text-sm">
              {slides.length} slide{slides.length !== 1 ? "s" : ""} · se muestran en el carrusel del inicio
            </p>
            <button onClick={openCreate} className="btn-primary">+ Nuevo slide</button>
          </div>

          {loadingSlides ? (
            <div className="text-center py-12 text-slate-400">Cargando...</div>
          ) : sorted.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center text-slate-400">
              <p className="text-4xl mb-3">🖼️</p>
              <p className="font-medium">No hay slides creados</p>
              <p className="text-sm mt-1">Creá el primero con el botón de arriba</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sorted.map((slide, idx) => (
                <div key={slide.id} className={`bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-4 ${!slide.active ? "opacity-60" : ""}`}>
                  <div className="w-32 h-20 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0">
                    <img src={getImageUrl(`/uploads/${slide.image}`)} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 truncate">
                      {slide.title || <span className="text-slate-400 italic">Sin título</span>}
                    </p>
                    {slide.subtitle && <p className="text-sm text-slate-500 truncate">{slide.subtitle}</p>}
                    {slide.url && <p className="text-xs text-blue-500 truncate mt-0.5">{slide.url}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => handleMove(slide, "up")} disabled={idx === 0}
                        className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                      </button>
                      <button onClick={() => handleMove(slide, "down")} disabled={idx === sorted.length - 1}
                        className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                    </div>
                    <button onClick={() => handleToggleActive(slide)}
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full transition-colors ${slide.active ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                      {slide.active ? "Visible" : "Oculto"}
                    </button>
                    <button onClick={() => openEdit(slide)} className="p-2 text-slate-400 hover:text-blue-600 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z" /></svg>
                    </button>
                    <button onClick={() => handleDelete(slide)} className="p-2 text-slate-400 hover:text-red-600 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Tab Banners ────────────────────────────────────────────────── */}
      {tab === "banners" && (
        <>
          <p className="text-sm text-slate-500">
            Los banners aparecen debajo del navbar, apilados uno sobre otro. Podés crear uno por tipo de cliente.
          </p>

          {loadingBanners ? (
            <div className="text-center py-12 text-slate-400">Cargando...</div>
          ) : (
            <>
              {banners.length === 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center text-slate-400 text-sm">
                  No hay banners. Creá uno con el botón de abajo.
                </div>
              )}
              <div className="space-y-4">
                {banners.map((b, i) => (
                  <BannerCard
                    key={b.id} banner={b} index={i}
                    onChange={(updated) => setBanners((prev) => prev.map((x) => x.id === b.id ? updated : x))}
                    onDelete={() => setBanners((prev) => prev.filter((x) => x.id !== b.id))}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between pt-2">
                <button type="button" onClick={() => setBanners((prev) => [...prev, newBanner()])}
                  className="px-4 py-2 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600 text-sm font-medium transition-colors">
                  + Agregar banner
                </button>
                <button onClick={handleSaveBanners} disabled={savingBanners}
                  className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {savingBanners ? "Guardando…" : "Guardar banners"}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Modal crear/editar slide ───────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">{editing ? "Editar slide" : "Nuevo slide"}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {editing ? "Imagen" : "Imágenes"}
                  {!editing && <span className="text-slate-400 font-normal ml-1">— podés seleccionar varias</span>}
                  {!editing && <span className="text-red-500 ml-1">*</span>}
                </label>
                {editing && (
                  <div className="mb-3 w-full h-40 rounded-xl overflow-hidden bg-slate-100">
                    <img src={imagePreviews[0] || getImageUrl(`/uploads/${editing.image}`)} alt="" className="w-full h-full object-cover" />
                  </div>
                )}
                {!editing && imagePreviews.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {imagePreviews.map((src, idx) => (
                      <div key={idx} className="relative group aspect-video rounded-lg overflow-hidden bg-slate-100">
                        <img src={src} alt="" className="w-full h-full object-cover" />
                        <button type="button" onClick={() => removePreview(idx)}
                          className="absolute top-1 right-1 bg-black/60 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                      </div>
                    ))}
                  </div>
                )}
                <div onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 rounded-xl p-5 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                  <svg className="w-8 h-8 mx-auto text-slate-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-slate-500 text-sm font-medium">
                    {editing ? "Click para cambiar la imagen"
                      : imagePreviews.length > 0 ? `${imagePreviews.length} imagen${imagePreviews.length !== 1 ? "es" : ""} · click para agregar más`
                      : "Click para seleccionar imágenes"}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">JPG, PNG, WEBP · recomendado 1920×600px</p>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" multiple={!editing} onChange={handleFileChange} className="hidden" />
              </div>

              {!editing && imagePreviews.length > 1 && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                  El título, subtítulo y URL se aplicarán a todos los slides. Podés editarlos individualmente después.
                </p>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Título <span className="text-slate-400 font-normal">— opcional</span></label>
                <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="ej: Nuevos productos de verano" className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Subtítulo <span className="text-slate-400 font-normal">— opcional</span></label>
                <input type="text" value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} placeholder="ej: Hasta 30% de descuento" className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">URL al hacer click <span className="text-slate-400 font-normal">— opcional</span></label>
                <input type="text" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="ej: /catalogo" className="input" />
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="slide-active-modal" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="w-4 h-4 accent-blue-600" />
                <label htmlFor="slide-active-modal" className="text-sm font-medium text-slate-700">Visible en el carrusel</label>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1" disabled={saving}>Cancelar</button>
                <button type="submit" className="btn-primary flex-1" disabled={saving}>
                  {saving ? "Guardando..." : editing ? "Guardar cambios" : imageFiles.length > 1 ? `Crear ${imageFiles.length} slides` : "Crear slide"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

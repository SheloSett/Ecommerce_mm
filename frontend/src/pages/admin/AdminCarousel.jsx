import { useState, useEffect, useRef } from "react";
import AdminLayout from "../../components/AdminLayout";
import { slidesApi, settingsApi, getImageUrl } from "../../services/api";
import { useSiteConfig } from "../../context/SiteConfigContext";
import toast from "react-hot-toast";

const EMPTY_FORM = { title: "", subtitle: "", url: "", active: true };

export default function AdminCarousel() {
  const { refetch } = useSiteConfig();
  const [slides, setSlides]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [imageFiles, setImageFiles]       = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const fileInputRef = useRef(null);

  // Banner de anuncio
  const [annActive,    setAnnActive]    = useState(false);
  const [annText,      setAnnText]      = useState("");
  const [annLinkText,  setAnnLinkText]  = useState("");
  const [annUrl,       setAnnUrl]       = useState("");
  const [annBgColor,   setAnnBgColor]   = useState("blue");
  const [annTextColor, setAnnTextColor] = useState("white");
  const [savingAnn,    setSavingAnn]    = useState(false);

  useEffect(() => {
    loadSlides();
    settingsApi.get().then((res) => {
      setAnnActive(res.data.announcementActive === "true");
      setAnnText(res.data.announcementText || "");
      setAnnLinkText(res.data.announcementLinkText || "");
      setAnnUrl(res.data.announcementUrl || "");
      setAnnBgColor(res.data.announcementBgColor || "blue");
      setAnnTextColor(res.data.announcementTextColor || "white");
    }).catch(console.error);
  }, []);

  async function handleSaveAnnouncement() {
    if (annActive && !annText.trim()) { toast.error("Escribí un texto para el banner"); return; }
    if (annLinkText && annText && !annText.includes(annLinkText)) {
      toast.error(`"${annLinkText}" no aparece en el texto del banner`); return;
    }
    setSavingAnn(true);
    try {
      await settingsApi.update({
        announcementActive:   annActive ? "true" : "false",
        announcementText:     annText.trim(),
        announcementLinkText: annLinkText.trim(),
        announcementUrl:      annUrl.trim(),
        announcementBgColor:  annBgColor,
        announcementTextColor: annTextColor,
      });
      refetch();
      toast.success("Banner guardado");
    } catch { toast.error("Error al guardar el banner"); }
    finally { setSavingAnn(false); }
  }

  async function loadSlides() {
    setLoading(true);
    try {
      const res = await slidesApi.getAll({ all: "true" });
      setSlides(res.data);
    } catch {
      toast.error("Error al cargar slides");
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setImageFiles([]);
    setImagePreviews([]);
    setShowModal(true);
  }

  function openEdit(slide) {
    setEditing(slide);
    setForm({
      title:    slide.title    || "",
      subtitle: slide.subtitle || "",
      url:      slide.url      || "",
      active:   slide.active,
    });
    setImageFiles([]);
    setImagePreviews([]);
    setShowModal(true);
  }

  function handleFileChange(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    if (editing) {
      // Al editar: solo se usa el primer archivo seleccionado
      setImageFiles([files[0]]);
      setImagePreviews([URL.createObjectURL(files[0])]);
    } else {
      // Al crear: acumular los archivos — no reemplazar los que ya estaban
      setImageFiles((prev) => [...prev, ...files]);
      setImagePreviews((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))]);
    }
    // Limpiar input para que pueda seleccionarse el mismo archivo otra vez
    e.target.value = "";
  }

  function removePreview(idx) {
    setImageFiles((prev) => prev.filter((_, i) => i !== idx));
    setImagePreviews((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (editing) {
      // ── Editar un slide existente ──────────────────────────────────────
      setSaving(true);
      try {
        const fd = new FormData();
        if (imageFiles[0]) fd.append("image", imageFiles[0]);
        fd.append("title",    form.title);
        fd.append("subtitle", form.subtitle);
        fd.append("url",      form.url);
        fd.append("active",   form.active ? "true" : "false");
        await slidesApi.update(editing.id, fd);
        toast.success("Slide actualizado");
        setShowModal(false);
        loadSlides();
      } catch (err) {
        toast.error(err.response?.data?.error || "Error al guardar");
      } finally {
        setSaving(false);
      }
    } else {
      // ── Crear uno o varios slides nuevos ──────────────────────────────
      if (imageFiles.length === 0) {
        toast.error("Seleccioná al menos una imagen");
        return;
      }
      setSaving(true);
      let created = 0;
      try {
        for (let i = 0; i < imageFiles.length; i++) {
          const fd = new FormData();
          fd.append("image",    imageFiles[i]);
          fd.append("title",    form.title);
          fd.append("subtitle", form.subtitle);
          fd.append("url",      form.url);
          fd.append("active",   form.active ? "true" : "false");
          fd.append("order",    slides.length + i);
          await slidesApi.create(fd);
          created++;
        }
        toast.success(`${created} slide${created !== 1 ? "s" : ""} creado${created !== 1 ? "s" : ""}`);
        setShowModal(false);
        loadSlides();
      } catch (err) {
        toast.error(err.response?.data?.error || "Error al guardar");
      } finally {
        setSaving(false);
      }
    }
  }

  async function handleDelete(slide) {
    if (!window.confirm(`¿Eliminar este slide?`)) return;
    try {
      await slidesApi.remove(slide.id);
      setSlides((prev) => prev.filter((s) => s.id !== slide.id));
      toast.success("Slide eliminado");
    } catch {
      toast.error("Error al eliminar");
    }
  }

  async function handleToggleActive(slide) {
    try {
      const fd = new FormData();
      fd.append("active", !slide.active ? "true" : "false");
      await slidesApi.update(slide.id, fd);
      setSlides((prev) => prev.map((s) => s.id === slide.id ? { ...s, active: !s.active } : s));
    } catch {
      toast.error("Error al actualizar");
    }
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
    } catch {
      toast.error("Error al reordenar");
    }
  }

  const sorted = [...slides].sort((a, b) => a.order - b.order);

  return (
    <AdminLayout title="Carrusel del inicio">
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-sm">
            {slides.length} slide{slides.length !== 1 ? "s" : ""} · se muestran en el carrusel del inicio
          </p>
          <button onClick={openCreate} className="btn-primary">
            + Nuevo slide
          </button>
        </div>

        {/* Lista de slides */}
        {loading ? (
          <div className="text-center py-16 text-slate-400">Cargando...</div>
        ) : sorted.length === 0 ? (
          <div className="card p-12 text-center text-slate-400">
            <p className="text-4xl mb-3">🖼️</p>
            <p className="font-medium">No hay slides creados</p>
            <p className="text-sm mt-1">Creá el primero con el botón de arriba</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map((slide, idx) => (
              <div
                key={slide.id}
                className={`card p-4 flex items-center gap-4 ${!slide.active ? "opacity-60" : ""}`}
              >
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
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed" title="Subir">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                    </button>
                    <button onClick={() => handleMove(slide, "down")} disabled={idx === sorted.length - 1}
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed" title="Bajar">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  </div>

                  <button onClick={() => handleToggleActive(slide)}
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full transition-colors ${slide.active ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                    {slide.active ? "Visible" : "Oculto"}
                  </button>

                  <button onClick={() => openEdit(slide)} className="p-2 text-slate-400 hover:text-blue-600 transition-colors" title="Editar">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z" /></svg>
                  </button>

                  <button onClick={() => handleDelete(slide)} className="p-2 text-slate-400 hover:text-red-600 transition-colors" title="Eliminar">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Banner de anuncio movido a su propia página: /admin/carrusel/banner (AdminAnnouncementBanner.jsx)
          accesible desde el sub-ítem "📢 Banner de anuncio" bajo Carrusel en el sidebar */}

      {/* ── Modal crear/editar ───────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">
                {editing ? "Editar slide" : "Nuevo slide"}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">

              {/* ── Zona de imágenes ──────────────────────────────────────── */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {editing ? "Imagen" : "Imágenes"}{" "}
                  {!editing && <span className="text-slate-400 font-normal">— podés seleccionar varias a la vez</span>}
                  {!editing && <span className="text-red-500 ml-1">*</span>}
                </label>

                {/* Al editar: preview de imagen actual + nuevo archivo si eligió */}
                {editing && (
                  <div className="mb-3 w-full h-40 rounded-xl overflow-hidden bg-slate-100">
                    <img
                      src={imagePreviews[0] || getImageUrl(`/uploads/${editing.image}`)}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                {/* Al crear: grid de thumbnails con botón para quitar */}
                {!editing && imagePreviews.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {imagePreviews.map((src, idx) => (
                      <div key={idx} className="relative group aspect-video rounded-lg overflow-hidden bg-slate-100">
                        <img src={src} alt="" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removePreview(idx)}
                          className="absolute top-1 right-1 bg-black/60 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Drop zone */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 rounded-xl p-5 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                >
                  <svg className="w-8 h-8 mx-auto text-slate-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-slate-500 text-sm font-medium">
                    {editing
                      ? "Click para cambiar la imagen"
                      : imagePreviews.length > 0
                        ? `${imagePreviews.length} imagen${imagePreviews.length !== 1 ? "es" : ""} seleccionada${imagePreviews.length !== 1 ? "s" : ""} · click para agregar más`
                        : "Click para seleccionar imágenes"}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">JPG, PNG, WEBP · recomendado 1920×600px</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple={!editing}
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              {/* ── Campos de texto ─────────────────────────────────────────── */}
              {!editing && imagePreviews.length > 1 && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                  El título, subtítulo y URL se aplicarán a todos los slides que estás creando. Podés editarlos individualmente después.
                </p>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Título <span className="text-slate-400 font-normal">— opcional</span>
                </label>
                <input type="text" value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="ej: Nuevos productos de verano" className="input" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Subtítulo <span className="text-slate-400 font-normal">— opcional</span>
                </label>
                <input type="text" value={form.subtitle}
                  onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                  placeholder="ej: Hasta 30% de descuento" className="input" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  URL al hacer click <span className="text-slate-400 font-normal">— opcional</span>
                </label>
                <input type="text" value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="ej: /catalogo o https://..." className="input" />
                <p className="text-xs text-slate-400 mt-1">
                  Podés usar rutas internas como <code className="bg-slate-100 px-1 rounded">/catalogo</code> o URLs externas completas.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <input type="checkbox" id="slide-active" checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="w-4 h-4 accent-blue-600" />
                <label htmlFor="slide-active" className="text-sm font-medium text-slate-700">
                  Visible en el carrusel
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1" disabled={saving}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary flex-1" disabled={saving}>
                  {saving
                    ? "Guardando..."
                    : editing
                      ? "Guardar cambios"
                      : imageFiles.length > 1
                        ? `Crear ${imageFiles.length} slides`
                        : "Crear slide"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

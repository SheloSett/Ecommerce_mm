import { useState, useEffect } from "react";
import AdminLayout from "../../components/AdminLayout";
import { settingsApi } from "../../services/api";
import { useSiteConfig } from "../../context/SiteConfigContext";
import toast from "react-hot-toast";

const BG_OPTIONS = [
  { key: "blue",   label: "Azul",    cls: "bg-blue-600" },
  { key: "green",  label: "Verde",   cls: "bg-emerald-600" },
  { key: "amber",  label: "Amarillo",cls: "bg-amber-400" },
  { key: "red",    label: "Rojo",    cls: "bg-red-600" },
  { key: "slate",  label: "Oscuro",  cls: "bg-slate-800" },
  { key: "black",  label: "Negro",   cls: "bg-black" },
  { key: "purple", label: "Violeta", cls: "bg-purple-600" },
];

const TEXT_OPTIONS = [
  { key: "white",  label: "Blanco",  cls: "bg-white border border-slate-200" },
  { key: "black",  label: "Negro",   cls: "bg-black" },
  { key: "yellow", label: "Amarillo",cls: "bg-yellow-300" },
  { key: "amber",  label: "Ámbar",   cls: "bg-amber-900" },
  { key: "slate",  label: "Gris",    cls: "bg-slate-400" },
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

const newBanner = () => ({
  id: Date.now().toString(),
  active: true,
  text: "",
  linkText: "",
  url: "",
  bgColor: "blue",
  textColor: "white",
  scrollDir: "rtl",
  visibleFor: "AMBOS",
});

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
    <div className="card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Banner {index + 1}</span>
          <button type="button" onClick={() => update("active", !banner.active)}
            className={`relative inline-flex h-6 w-10 flex-shrink-0 items-center rounded-full transition-colors ${banner.active ? "bg-blue-500" : "bg-slate-300"}`}>
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform ${banner.active ? "translate-x-5" : "translate-x-1"}`} />
          </button>
          <span className="text-xs text-slate-500">{banner.active ? "Activo" : "Inactivo"}</span>
        </div>
        <button type="button" onClick={onDelete}
          className="text-red-400 hover:text-red-600 text-sm font-medium transition-colors">
          Eliminar
        </button>
      </div>

      {/* Visibilidad */}
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

      {/* Texto */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Texto del banner <span className="text-red-500">*</span>
        </label>
        <input type="text" value={banner.text} onChange={(e) => update("text", e.target.value)}
          placeholder='Ej: "Envío gratis en compras mayores a $50.000 — ver más"'
          className="input w-full" />
      </div>

      {/* Link */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Palabra/frase con link <span className="text-slate-400 font-normal">— opcional</span>
          </label>
          <input type="text" value={banner.linkText} onChange={(e) => update("linkText", e.target.value)}
            placeholder='Ej: "ver más"' className="input w-full" />
          <p className="text-xs text-slate-400 mt-0.5">Debe aparecer exactamente en el texto.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            URL del link <span className="text-slate-400 font-normal">— opcional</span>
          </label>
          <input type="text" value={banner.url} onChange={(e) => update("url", e.target.value)}
            placeholder='Ej: "/envios" o "https://..."' className="input w-full" />
        </div>
      </div>

      {/* Color de fondo */}
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

      {/* Color de letra */}
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

      {/* Movimiento */}
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-2">Movimiento del texto</label>
        <div className="flex gap-2">
          {SCROLL_OPTIONS.map((o) => (
            <button key={o.key} type="button" onClick={() => update("scrollDir", o.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border-2 text-xs font-medium transition-all ${banner.scrollDir === o.key ? "border-blue-500 ring-2 ring-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 hover:border-slate-300"}`}>
              <span>{o.icon}</span>{o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Vista previa */}
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

export default function AdminAnnouncementBanner() {
  const { refetch } = useSiteConfig();
  const [banners, setBanners] = useState([]);
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    settingsApi.get().then((res) => {
      if (res.data.announcementBanners) {
        try {
          const parsed = JSON.parse(res.data.announcementBanners);
          setBanners(Array.isArray(parsed) ? parsed : []);
        } catch { setBanners([]); }
      } else if (res.data.announcementText) {
        // Migrar el banner legacy al nuevo formato
        setBanners([{
          id: "legacy",
          active: res.data.announcementActive === "true",
          text: res.data.announcementText || "",
          linkText: res.data.announcementLinkText || "",
          url: res.data.announcementUrl || "",
          bgColor: res.data.announcementBgColor || "blue",
          textColor: res.data.announcementTextColor || "white",
          scrollDir: res.data.announcementScrollDir || "rtl",
          visibleFor: "AMBOS",
        }]);
      } else {
        setBanners([]);
      }
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    for (const b of banners) {
      if (b.active && !b.text.trim()) {
        toast.error(`Banner ${banners.indexOf(b) + 1}: escribí un texto`); return;
      }
      if (b.linkText && b.text && !b.text.includes(b.linkText)) {
        toast.error(`Banner ${banners.indexOf(b) + 1}: "${b.linkText}" no aparece en el texto`); return;
      }
    }
    setSaving(true);
    try {
      await settingsApi.update({ announcementBanners: JSON.stringify(banners) });
      refetch();
      toast.success("Banners guardados");
    } catch { toast.error("Error al guardar"); }
    finally { setSaving(false); }
  };

  const updateBanner = (id, updated) =>
    setBanners((prev) => prev.map((b) => (b.id === id ? updated : b)));

  const deleteBanner = (id) =>
    setBanners((prev) => prev.filter((b) => b.id !== id));

  if (loading) return (
    <AdminLayout title="Banner de anuncio">
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    </AdminLayout>
  );

  return (
    <AdminLayout title="Banner de anuncio">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Info */}
        <p className="text-sm text-slate-500">
          Los banners aparecen debajo del navbar, apilados uno sobre otro. Podés crear uno por tipo de cliente.
        </p>

        {/* Lista de banners */}
        {banners.length === 0 && (
          <div className="card p-8 text-center text-slate-400 text-sm">
            No hay banners. Creá uno con el botón de abajo.
          </div>
        )}

        {banners.map((b, i) => (
          <BannerCard
            key={b.id}
            banner={b}
            index={i}
            onChange={(updated) => updateBanner(b.id, updated)}
            onDelete={() => deleteBanner(b.id)}
          />
        ))}

        {/* Acciones */}
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setBanners((prev) => [...prev, newBanner()])}
            className="px-4 py-2 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600 text-sm font-medium transition-colors">
            + Agregar banner
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? "Guardando…" : "Guardar banners"}
          </button>
        </div>

      </div>
    </AdminLayout>
  );
}

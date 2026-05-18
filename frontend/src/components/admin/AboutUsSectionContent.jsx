import { useState, useEffect } from "react";
import { settingsApi } from "../../services/api";
import { useSiteConfig } from "../../context/SiteConfigContext";
import toast from "react-hot-toast";

const DEFAULT_HERO = {
  badge: "Conocenos",
  title: "Tu tienda de",
  titleHighlight: "tecnología de confianza",
  text: "Somos IGWT Store, una tienda especializada en tecnología y accesorios electrónicos ubicada en Buenos Aires. Desde el primer día, nuestro objetivo fue simple: ofrecerte los mejores productos al mejor precio, con atención de verdad.",
};

const DEFAULT_HISTORIA = {
  subtitle: "Nuestra historia",
  title: "Empezamos de a poco, crecimos con vos",
  paragraphs: [
    "IGWT Store nació de la pasión por la tecnología y la frustración de ver cómo era difícil conseguir buenos productos sin pagar fortunas o sin saber si lo que te llegaba era original.",
    "Arrancamos vendiendo en pequeña escala, aprendiendo de cada cliente, de cada pedido. Hoy somos una tienda con catálogo propio, clientes mayoristas de todo el país y un equipo comprometido con la calidad.",
    "Cada producto que ofrecemos lo elegimos porque creemos en él. Si no lo usaríamos nosotros, no lo vendemos.",
  ],
  card: {
    name: "IGWT Store",
    location: "Buenos Aires, Argentina",
    categories: ["Auriculares y audio", "Cargadores y cables", "Periféricos y accesorios", "Electrónica en general"],
    address: "Av La Plata 744, CABA",
    email: "info@igwtstore.com.ar",
  },
};

const DEFAULT_VALORES = [
  { icon: "⚡", title: "Tecnología accesible", desc: "Creemos que todos merecen acceso a la mejor tecnología sin pagar de más. Por eso trabajamos con los mejores proveedores para ofrecerte precios justos." },
  { icon: "🤝", title: "Atención real", desc: "No somos un bot ni un formulario. Somos personas reales que responden tus preguntas, resuelven tus dudas y se aseguran de que tu pedido llegue perfecto." },
  { icon: "🛡️", title: "Garantía en todo", desc: "Todos nuestros productos tienen garantía. Si algo no funciona bien, lo resolvemos. Así de simple." },
  { icon: "📦", title: "Entrega coordinada", desc: "Coordinamos cada entrega para que llegue en las mejores condiciones, sin apuros ni sorpresas." },
];

function SaveButton({ onClick, saving, label = "Guardar" }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
    >
      {saving ? "Guardando…" : label}
    </button>
  );
}

export default function AboutUsSectionContent() {
  const { refetch } = useSiteConfig();
  const [loading, setLoading] = useState(true);

  const [hero, setHero]               = useState(DEFAULT_HERO);
  const [savingHero, setSavingHero]   = useState(false);

  const [historia, setHistoria]             = useState(DEFAULT_HISTORIA);
  const [savingHistoria, setSavingHistoria] = useState(false);

  const [valores, setValores]             = useState(DEFAULT_VALORES);
  const [savingValores, setSavingValores] = useState(false);

  useEffect(() => {
    settingsApi.get().then((res) => {
      try { if (res.data.aboutUsHero)     setHero(JSON.parse(res.data.aboutUsHero)); }     catch {}
      try { if (res.data.aboutUsHistoria) setHistoria(JSON.parse(res.data.aboutUsHistoria)); } catch {}
      try { if (res.data.aboutUsValores)  setValores(JSON.parse(res.data.aboutUsValores)); }  catch {}
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const handleSaveHero = async () => {
    setSavingHero(true);
    try { await settingsApi.update({ aboutUsHero: JSON.stringify(hero) }); refetch(); toast.success("Sección guardada"); }
    catch { toast.error("Error al guardar"); }
    finally { setSavingHero(false); }
  };

  const handleSaveHistoria = async () => {
    setSavingHistoria(true);
    try { await settingsApi.update({ aboutUsHistoria: JSON.stringify(historia) }); refetch(); toast.success("Sección guardada"); }
    catch { toast.error("Error al guardar"); }
    finally { setSavingHistoria(false); }
  };

  const handleSaveValores = async () => {
    setSavingValores(true);
    try { await settingsApi.update({ aboutUsValores: JSON.stringify(valores) }); refetch(); toast.success("Valores guardados"); }
    catch { toast.error("Error al guardar"); }
    finally { setSavingValores(false); }
  };

  const updateValor = (i, field, value) => {
    const next = [...valores];
    next[i] = { ...next[i], [field]: value };
    setValores(next);
  };

  const moveValor = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= valores.length) return;
    const next = [...valores];
    [next[i], next[j]] = [next[j], next[i]];
    setValores(next);
  };

  if (loading) return (
    <div className="flex justify-center py-10">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
    </div>
  );

  return (
    <div className="space-y-5">

      {/* ── Sección 1: Hero / Conocenos ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div>
          <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
            <span>🔖</span> Sección "Conocenos" (banner principal)
          </h2>
          <p className="text-sm text-slate-500 mt-1">El encabezado grande que aparece al entrar a la página.</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Etiqueta del badge</label>
            <input className="input w-full text-sm" value={hero.badge}
              onChange={(e) => setHero(h => ({ ...h, badge: e.target.value }))}
              placeholder="Conocenos" />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Título — línea 1</label>
              <input className="input w-full text-sm" value={hero.title}
                onChange={(e) => setHero(h => ({ ...h, title: e.target.value }))}
                placeholder="Tu tienda de" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Título — línea 2 (degradé azul)</label>
              <input className="input w-full text-sm" value={hero.titleHighlight}
                onChange={(e) => setHero(h => ({ ...h, titleHighlight: e.target.value }))}
                placeholder="tecnología de confianza" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Párrafo descriptivo</label>
            <textarea className="input w-full text-sm h-24 resize-none" value={hero.text}
              onChange={(e) => setHero(h => ({ ...h, text: e.target.value }))}
              placeholder="Somos IGWT Store..." />
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <SaveButton onClick={handleSaveHero} saving={savingHero} />
        </div>
      </div>

      {/* ── Sección 2: Historia + Tarjeta ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div>
          <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
            <span>📖</span> Sección "Nuestra historia"
          </h2>
        </div>

        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Subtítulo</label>
              <input className="input w-full text-sm" value={historia.subtitle}
                onChange={(e) => setHistoria(h => ({ ...h, subtitle: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Título</label>
              <input className="input w-full text-sm" value={historia.title}
                onChange={(e) => setHistoria(h => ({ ...h, title: e.target.value }))} />
            </div>
          </div>

          {historia.paragraphs.map((p, i) => (
            <div key={i}>
              <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Párrafo {i + 1}</label>
              <textarea className="input w-full text-sm h-20 resize-none" value={p}
                onChange={(e) => {
                  const next = [...historia.paragraphs];
                  next[i] = e.target.value;
                  setHistoria(h => ({ ...h, paragraphs: next }));
                }} />
            </div>
          ))}

          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Tarjeta lateral</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Nombre</label>
                <input className="input w-full text-sm" value={historia.card.name}
                  onChange={(e) => setHistoria(h => ({ ...h, card: { ...h.card, name: e.target.value } }))} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Ubicación</label>
                <input className="input w-full text-sm" value={historia.card.location}
                  onChange={(e) => setHistoria(h => ({ ...h, card: { ...h.card, location: e.target.value } }))} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Dirección (pie de tarjeta)</label>
                <input className="input w-full text-sm" value={historia.card.address}
                  onChange={(e) => setHistoria(h => ({ ...h, card: { ...h.card, address: e.target.value } }))} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Email (pie de tarjeta)</label>
                <input className="input w-full text-sm" value={historia.card.email}
                  onChange={(e) => setHistoria(h => ({ ...h, card: { ...h.card, email: e.target.value } }))} />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-xs text-slate-500 mb-1">Categorías de la tarjeta (una por línea)</label>
              <textarea className="input w-full text-sm h-20 resize-none"
                value={historia.card.categories.join("\n")}
                onChange={(e) => setHistoria(h => ({
                  ...h,
                  card: { ...h.card, categories: e.target.value.split("\n").filter(c => c.trim()) }
                }))} />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <SaveButton onClick={handleSaveHistoria} saving={savingHistoria} />
        </div>
      </div>

      {/* ── Sección 3: Nuestros valores (CRUD) ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div>
          <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
            <span>⭐</span> Sección "Nuestros valores"
          </h2>
          <p className="text-sm text-slate-500 mt-1">Podés agregar, editar o eliminar tarjetas.</p>
        </div>

        <div className="space-y-3">
          {valores.map((v, i) => (
            <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <input className="input w-14 text-center text-xl flex-shrink-0" value={v.icon}
                  onChange={(e) => updateValor(i, "icon", e.target.value)}
                  placeholder="⚡" />
                <input className="input flex-1 text-sm font-semibold" value={v.title}
                  onChange={(e) => updateValor(i, "title", e.target.value)}
                  placeholder="Título del valor" />
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <button type="button" onClick={() => moveValor(i, -1)} disabled={i === 0}
                    className="text-slate-400 hover:text-slate-600 disabled:opacity-20 disabled:cursor-not-allowed leading-none px-1 text-xs"
                    title="Subir">▲</button>
                  <button type="button" onClick={() => moveValor(i, 1)} disabled={i === valores.length - 1}
                    className="text-slate-400 hover:text-slate-600 disabled:opacity-20 disabled:cursor-not-allowed leading-none px-1 text-xs"
                    title="Bajar">▼</button>
                </div>
                <button type="button"
                  onClick={() => setValores(valores.filter((_, j) => j !== i))}
                  className="text-red-400 hover:text-red-600 font-bold text-xl px-1 flex-shrink-0 leading-none"
                  title="Eliminar">✕</button>
              </div>
              <textarea className="input w-full text-sm h-16 resize-none" value={v.desc}
                onChange={(e) => updateValor(i, "desc", e.target.value)}
                placeholder="Descripción del valor" />
            </div>
          ))}
          <button type="button"
            onClick={() => setValores([...valores, { icon: "✨", title: "", desc: "" }])}
            className="w-full py-2.5 border-2 border-dashed border-slate-300 rounded-xl text-sm text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-colors">
            + Agregar valor
          </button>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <SaveButton onClick={handleSaveValores} saving={savingValores} label="Guardar valores" />
        </div>
      </div>

    </div>
  );
}

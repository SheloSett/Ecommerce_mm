import { useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import SiteMeta from "../components/SiteMeta";
import { useSiteConfig } from "../context/SiteConfigContext";

// Iconos de valores — antes eran emojis, ahora Material Symbols para consistencia
// const VALUES = [{ icon: "⚡", ... }, { icon: "🤝", ... }, ...]
const VALUES = [
  {
    icon: "devices",
    title: "Tecnología accesible",
    desc: "Creemos que todos merecen acceso a la mejor tecnología sin pagar de más. Por eso trabajamos con los mejores proveedores para ofrecerte precios justos.",
  },
  {
    icon: "handshake",
    title: "Atención real",
    desc: "No somos un bot ni un formulario. Somos personas reales que responden tus preguntas, resuelven tus dudas y se aseguran de que tu pedido llegue perfecto.",
  },
  {
    icon: "verified_user",
    title: "Garantía en todo",
    desc: "Todos nuestros productos tienen garantía. Si algo no funciona bien, lo resolvemos. Así de simple.",
  },
  {
    icon: "local_shipping",
    title: "Entrega coordinada",
    desc: "Coordinamos cada entrega para que llegue en las mejores condiciones, sin apuros ni sorpresas.",
  },
];

const STATS = [
  { number: "500+", label: "Clientes satisfechos" },
  { number: "1.200+", label: "Productos vendidos" },
  { number: "3", label: "Años en el mercado" },
  { number: "98%", label: "Recomendarían IGWT" },
];

const HERO_DEFAULT = {
  badge: "Conocenos",
  title: "Tu tienda de",
  titleHighlight: "tecnología de confianza",
  text: "Somos IGWT Store, una tienda especializada en tecnología y accesorios electrónicos ubicada en Buenos Aires. Desde el primer día, nuestro objetivo fue simple: ofrecerte los mejores productos al mejor precio, con atención de verdad.",
};

const HISTORIA_DEFAULT = {
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

export default function AboutUs() {
  // aboutUsContent: viejo enfoque RTE — comentado porque fue reemplazado por secciones estructuradas
  // const { aboutUsContent } = useSiteConfig();
  // if (aboutUsContent) { return <RTE render>; }

  const { aboutUsHero, aboutUsHistoria, aboutUsValores } = useSiteConfig();
  const [showAllValores, setShowAllValores] = useState(false);

  const hero     = aboutUsHero     || HERO_DEFAULT;
  const historia = aboutUsHistoria || HISTORIA_DEFAULT;
  // Si el admin configuró valores con emoji, se usan tal cual; si son los defaults, usamos Material Symbols
  const valores  = aboutUsValores  || VALUES;

  const MAX_VISIBLE_VALORES = 6;
  const visibleValores = showAllValores ? valores : valores.slice(0, MAX_VISIBLE_VALORES);
  const hasMoreValores  = valores.length > MAX_VISIBLE_VALORES;

  return (
    // Antes: bg-white — actualizado a token del sistema de diseño
    // <div className="min-h-screen flex flex-col bg-white">
    <div className="ds-page min-h-screen flex flex-col bg-[#f8f9ff]">
      <SiteMeta title="Sobre nosotros — IGWT Store" description="Conocé quiénes somos, qué vendemos y por qué miles de clientes confían en IGWT Store para sus compras de tecnología." />
      <Navbar />

      {/* ── HERO — antes: bg-slate-900 con acentos azules — actualizado a #0b1c30 con acentos verdes ── */}
      {/* <section className="relative overflow-hidden bg-slate-900 text-white"> */}
      <section className="relative overflow-hidden bg-[#0b1c30] text-white">
        <div className="absolute inset-0 pointer-events-none select-none">
          {/* Antes: bg-blue-600/20 / bg-indigo-500/10 — actualizado a verde del sistema */}
          {/* <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-blue-600/20 blur-3xl" /> */}
          {/* <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full bg-indigo-500/10 blur-3xl" /> */}
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-[#00873a]/20 blur-3xl" />
          <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full bg-[#006b2c]/10 blur-3xl" />
          <div className="absolute inset-0 opacity-[0.04]"
            style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "32px 32px" }}
          />
        </div>

        <div className="relative max-w-5xl mx-auto px-6 py-24 md:py-32">
          {/* Antes: bg-blue-500/10 border-blue-500/20 text-blue-300 — actualizado a verde */}
          {/* <div className="inline-flex ... bg-blue-500/10 border border-blue-500/20 text-blue-300 ..."> */}
          <div className="inline-flex items-center gap-2 bg-[#00873a]/10 border border-[#00873a]/20 text-[#62df7d] text-xs font-semibold px-4 py-1.5 rounded-full mb-6 tracking-wider uppercase">
            {/* Antes: w-1.5 h-1.5 bg-blue-400 animate-pulse */}
            <span className="w-1.5 h-1.5 rounded-full bg-[#62df7d] animate-pulse" />
            {hero.badge}
          </div>
          <h1 className="text-4xl md:text-6xl font-black leading-tight mb-6" style={{ fontFamily: "Outfit" }}>
            {hero.title} <br />
            {/* Antes: from-blue-400 to-cyan-300 — actualizado a verde del sistema */}
            {/* <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300"> */}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#62df7d] to-[#00873a]">
              {hero.titleHighlight}
            </span>
          </h1>
          {/* Antes: text-slate-300 */}
          <p className="text-white/60 text-lg md:text-xl max-w-2xl leading-relaxed">
            {hero.text}
          </p>
        </div>
      </section>

      {/* ── STATS — comentado por pedido del usuario (sección eliminada visualmente) ──
      <section className="bg-blue-600 text-white">
        <div className="max-w-5xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {STATS.map((s) => (
            <div key={s.label}>
              <div className="text-3xl md:text-4xl font-black">{s.number}</div>
              <div className="text-blue-200 text-sm mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>
      ── */}

      {/* ── HISTORIA ── */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            {/* Antes: text-blue-600 */}
            <span className="text-[#006b2c] font-bold text-sm uppercase tracking-widest">{historia.subtitle}</span>
            {/* Antes: text-slate-900 */}
            <h2 className="text-3xl md:text-4xl font-black text-[#0b1c30] mt-3 mb-6 leading-tight" style={{ fontFamily: "Outfit" }}>
              {historia.title}
            </h2>
            {/* Antes: text-slate-600 */}
            <div className="space-y-4 text-[#565e74] leading-relaxed">
              {historia.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </div>

          {/* Card decorativa — antes: bg-slate-900 con acentos azules */}
          {/* <div className="bg-slate-900 rounded-2xl ..."> */}
          <div className="relative">
            <div className="bg-[#0b1c30] rounded-2xl p-8 text-white relative overflow-hidden">
              {/* Antes: bg-blue-600/30 */}
              <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-[#00873a]/30 blur-2xl" />
              {/* Antes: emoji ⚡ text-5xl — reemplazado por Material Symbol */}
              {/* <div className="text-5xl mb-4">⚡</div> */}
              <span
                className="material-symbols-outlined text-[48px] text-[#62df7d] mb-4 block"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >bolt</span>
              <h3 className="text-2xl font-black mb-2" style={{ fontFamily: "Outfit" }}>{historia.card.name}</h3>
              {/* Antes: text-slate-400 */}
              <p className="text-white/40 text-sm mb-6">{historia.card.location}</p>
              <div className="space-y-3">
                {historia.card.categories.map((cat) => (
                  <div key={cat} className="flex items-center gap-3">
                    {/* Antes: bg-blue-400 */}
                    <div className="w-2 h-2 rounded-full bg-[#62df7d] flex-shrink-0" />
                    {/* Antes: text-slate-300 */}
                    <span className="text-white/70 text-sm">{cat}</span>
                  </div>
                ))}
              </div>
              {/* Antes: border-slate-700 */}
              <div className="mt-6 pt-6 border-t border-white/10">
                {/* Antes: emoji 📍 / 📧 text-slate-500 */}
                {/* <p className="text-xs text-slate-500">📍 {historia.card.address}</p> */}
                {/* <p className="text-xs text-slate-500 mt-1">📧 {historia.card.email}</p> */}
                <p className="text-xs text-white/30 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">location_on</span>
                  {historia.card.address}
                </p>
                <p className="text-xs text-white/30 flex items-center gap-1.5 mt-1">
                  <span className="material-symbols-outlined text-[14px]">mail</span>
                  {historia.card.email}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── VALORES — antes: bg-slate-50 con emojis ── */}
      {/* <section className="bg-slate-50 py-20"> */}
      <section className="bg-[#eff4ff] py-20">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-12">
            {/* Antes: text-blue-600 */}
            <span className="text-[#006b2c] font-bold text-sm uppercase tracking-widest">Lo que nos define</span>
            {/* Antes: text-slate-900 */}
            <h2 className="text-3xl md:text-4xl font-black text-[#0b1c30] mt-3" style={{ fontFamily: "Outfit" }}>
              Nuestros valores
            </h2>
          </div>
          <div className="flex flex-wrap justify-center gap-6">
            {visibleValores.map((v, i) => (
              // Antes: bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md
              <div key={i} className="w-full sm:w-[calc(50%-12px)] lg:w-[calc(33.333%-16px)] bg-white rounded-xl border border-[#bdcaba]/30 shadow-[0px_4px_20px_rgba(15,23,42,0.05)] hover:shadow-[0px_8px_30px_rgba(15,23,42,0.08)] transition-shadow p-6">
                {/* Antes: emoji text-3xl — ahora Material Symbol si es un nombre de icono, emoji si viene del admin */}
                {/* <div className="text-3xl mb-4">{v.icon}</div> */}
                <div className="mb-4">
                  {v.icon && v.icon.includes(" ") === false && /^[a-z_]+$/.test(v.icon) ? (
                    <span
                      className="material-symbols-outlined text-[36px] text-[#00873a]"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >{v.icon}</span>
                  ) : (
                    <div className="text-3xl">{v.icon}</div>
                  )}
                </div>
                {/* Antes: text-slate-900 / text-slate-500 */}
                <h3 className="font-bold text-[#0b1c30] mb-2">{v.title}</h3>
                <p className="text-[#565e74] text-sm leading-relaxed">{v.desc}</p>
              </div>
            ))}
          </div>

          {hasMoreValores && (
            <div className="flex justify-center mt-8">
              <button
                onClick={() => setShowAllValores(v => !v)}
                // Antes: text-slate-400 hover:text-blue-500
                className="flex flex-col items-center gap-1.5 text-[#565e74]/50 hover:text-[#006b2c] transition-colors group"
                aria-label={showAllValores ? "Ver menos" : "Ver más valores"}
              >
                {/* Antes: bg-slate-300 group-hover:bg-blue-400 */}
                <div className="w-20 h-0.5 bg-[#bdcaba] group-hover:bg-[#00873a] transition-colors rounded-full" />
                <svg
                  className={`w-5 h-5 transition-transform duration-300 ${showAllValores ? "rotate-180" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── CTA — antes: text-slate-900, bg-blue-600 / bg-slate-100 ── */}
      <section className="max-w-5xl mx-auto px-6 py-20 text-center">
        {/* Antes: text-slate-900 */}
        <h2 className="text-3xl md:text-4xl font-black text-[#0b1c30] mb-4" style={{ fontFamily: "Outfit" }}>
          ¿Listo para comprar?
        </h2>
        {/* Antes: text-slate-500 */}
        <p className="text-[#565e74] mb-8 max-w-md mx-auto">
          Explorá nuestro catálogo y encontrá los productos que necesitás. Si tenés dudas, estamos para ayudarte.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          {/* Antes: bg-blue-600 hover:bg-blue-700 */}
          {/* <Link to="/catalogo" className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-blue-700 ..."> */}
          <Link
            to="/catalogo"
            className="flex items-center gap-2 bg-[#00873a] text-white px-8 py-3 rounded-[10px] font-bold hover:brightness-110 transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">storefront</span>
            Ver catálogo
          </Link>
          {/* Antes: bg-slate-100 text-slate-800 hover:bg-slate-200 */}
          {/* <Link to="/como-comprar" className="bg-slate-100 text-slate-800 px-8 py-3 rounded-xl font-bold hover:bg-slate-200 ..."> */}
          <Link
            to="/como-comprar"
            className="flex items-center gap-2 bg-[#eff4ff] text-[#0b1c30] border border-[#bdcaba]/50 px-8 py-3 rounded-[10px] font-bold hover:bg-[#dce9ff] transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">help_outline</span>
            ¿Cómo comprar?
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}

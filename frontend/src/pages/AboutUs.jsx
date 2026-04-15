import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import SiteMeta from "../components/SiteMeta";

const VALUES = [
  {
    icon: "⚡",
    title: "Tecnología accesible",
    desc: "Creemos que todos merecen acceso a la mejor tecnología sin pagar de más. Por eso trabajamos con los mejores proveedores para ofrecerte precios justos.",
  },
  {
    icon: "🤝",
    title: "Atención real",
    desc: "No somos un bot ni un formulario. Somos personas reales que responden tus preguntas, resuelven tus dudas y se aseguran de que tu pedido llegue perfecto.",
  },
  {
    icon: "🛡️",
    title: "Garantía en todo",
    desc: "Todos nuestros productos tienen garantía. Si algo no funciona bien, lo resolvemos. Así de simple.",
  },
  {
    icon: "📦",
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

export default function AboutUs() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <SiteMeta title="Sobre nosotros — IGWT Store" description="Conocé quiénes somos, qué vendemos y por qué miles de clientes confían en IGWT Store para sus compras de tecnología." />
      <Navbar />

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-slate-900 text-white">
        {/* Fondo decorativo */}
        <div className="absolute inset-0 pointer-events-none select-none">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-blue-600/20 blur-3xl" />
          <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full bg-indigo-500/10 blur-3xl" />
          {/* Grid punteado */}
          <div className="absolute inset-0 opacity-[0.04]"
            style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "32px 32px" }}
          />
        </div>

        <div className="relative max-w-5xl mx-auto px-6 py-24 md:py-32">
          <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-semibold px-4 py-1.5 rounded-full mb-6 tracking-wider uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Conocenos
          </div>
          <h1 className="text-4xl md:text-6xl font-black leading-tight mb-6">
            Tu tienda de <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">
              tecnología de confianza
            </span>
          </h1>
          <p className="text-slate-300 text-lg md:text-xl max-w-2xl leading-relaxed">
            Somos IGWT Store, una tienda especializada en tecnología y accesorios electrónicos
            ubicada en Buenos Aires. Desde el primer día, nuestro objetivo fue simple:
            ofrecerte los mejores productos al mejor precio, con atención de verdad.
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
            <span className="text-blue-600 font-bold text-sm uppercase tracking-widest">Nuestra historia</span>
            <h2 className="text-3xl md:text-4xl font-black text-slate-900 mt-3 mb-6 leading-tight">
              Empezamos de a poco, <br /> crecimos con vos
            </h2>
            <div className="space-y-4 text-slate-600 leading-relaxed">
              <p>
                IGWT Store nació de la pasión por la tecnología y la frustración de ver cómo
                era difícil conseguir buenos productos sin pagar fortunas o sin saber si lo que
                te llegaba era original.
              </p>
              <p>
                Arrancamos vendiendo en pequeña escala, aprendiendo de cada cliente, de cada
                pedido. Hoy somos una tienda con catálogo propio, clientes mayoristas de todo
                el país y un equipo comprometido con la calidad.
              </p>
              <p>
                Cada producto que ofrecemos lo elegimos porque creemos en él. Si no lo
                usaríamos nosotros, no lo vendemos.
              </p>
            </div>
          </div>

          {/* Card decorativa */}
          <div className="relative">
            <div className="bg-slate-900 rounded-2xl p-8 text-white relative overflow-hidden">
              <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-blue-600/30 blur-2xl" />
              <div className="text-5xl mb-4">⚡</div>
              <h3 className="text-2xl font-black mb-2">IGWT Store</h3>
              <p className="text-slate-400 text-sm mb-6">Buenos Aires, Argentina</p>
              <div className="space-y-3">
                {["Auriculares y audio", "Cargadores y cables", "Periféricos y accesorios", "Electrónica en general"].map((cat) => (
                  <div key={cat} className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                    <span className="text-slate-300 text-sm">{cat}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-6 border-t border-slate-700">
                <p className="text-xs text-slate-500">📍 Av La Plata 744, CABA</p>
                <p className="text-xs text-slate-500 mt-1">📧 info@igwtstore.com.ar</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── VALORES ── */}
      <section className="bg-slate-50 py-20">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-12">
            <span className="text-blue-600 font-bold text-sm uppercase tracking-widest">Lo que nos define</span>
            <h2 className="text-3xl md:text-4xl font-black text-slate-900 mt-3">Nuestros valores</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {VALUES.map((v) => (
              <div key={v.title} className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="text-3xl mb-4">{v.icon}</div>
                <h3 className="font-bold text-slate-900 mb-2">{v.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="max-w-5xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-4">
          ¿Listo para comprar?
        </h2>
        <p className="text-slate-500 mb-8 max-w-md mx-auto">
          Explorá nuestro catálogo y encontrá los productos que necesitás. Si tenés dudas, estamos para ayudarte.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Link
            to="/catalogo"
            className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors"
          >
            Ver catálogo
          </Link>
          <Link
            to="/como-comprar"
            className="bg-slate-100 text-slate-800 px-8 py-3 rounded-xl font-bold hover:bg-slate-200 transition-colors"
          >
            ¿Cómo comprar?
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}

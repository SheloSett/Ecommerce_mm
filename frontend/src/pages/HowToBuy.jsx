import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import SiteMeta from "../components/SiteMeta";

const STEPS = [
  {
    number: "01",
    icon: "👤",
    title: "Registrate o ingresá",
    desc: "Para comprar en IGWT necesitás una cuenta. Si ya tenés, iniciá sesión. Si no, el registro es rápido y gratuito.",
    tip: "El admin aprueba las cuentas nuevas. Si necesitás acceso urgente, contactanos.",
    tipLink: "/registro",
    tipLinkLabel: "Crear cuenta →",
    color: "from-violet-500 to-violet-600",
    bg: "bg-violet-50",
    border: "border-violet-100",
  },
  {
    number: "02",
    icon: "🔍",
    title: "Explorá el catálogo",
    desc: "Navegá por nuestro catálogo de productos. Podés filtrar por categoría, buscar por nombre o explorar las ofertas y destacados.",
    tip: "Usá los filtros de categoría para encontrar más rápido lo que buscás.",
    tipLink: "/catalogo",
    tipLinkLabel: "Ir al catálogo →",
    color: "from-blue-500 to-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-100",
  },
  {
    number: "03",
    icon: "🛒",
    title: "Agregá al carrito",
    desc: "Encontraste lo que querías? Hacé clic en 'Agregar al carrito'. Podés seguir comprando o ir directo al checkout.",
    tip: "Si sos mayorista, registrate para ver los precios especiales.",
    // tipLink: "/registro",
    // tipLinkLabel: "Registrarme →",
    color: "from-indigo-500 to-indigo-600",
    bg: "bg-indigo-50",
    border: "border-indigo-100",
  },
  {
    number: "04",
    icon: "📋",
    title: "Completá el checkout",
    desc: "Ingresá tus datos de contacto, elegí el método de pago y revisá tu pedido antes de confirmar.",
    tip: "Si tenés un cupón de descuento, podés aplicarlo en esta etapa.",
    // tipLink: "/checkout",
    // tipLinkLabel: "Ir al checkout →",
    color: "from-cyan-500 to-cyan-600",
    bg: "bg-cyan-50",
    border: "border-cyan-100",
  },
  {
    number: "05",
    icon: "💳",
    title: "Realizá el pago",
    desc: "Aceptamos MercadoPago, transferencia bancaria y efectivo (en mostrador). Elegí la opción que más te convenga.",
    tip: "Si pagás por transferencia, envianos el comprobante por WhatsApp para agilizar la confirmación.",
    tipLink: "https://wa.me/541150395166",
    tipLinkLabel: "Abrir WhatsApp →",
    tipExternal: true,
    color: "from-emerald-500 to-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-100",
  },
  {
    number: "06",
    icon: "📦",
    title: "Coordinamos la entrega",
    desc: "Una vez confirmado el pago, coordinamos el envío o retiro. Te notificamos en cada etapa del pedido.",
    tip: "Podés ver el estado de tu pedido en cualquier momento desde 'Mis pedidos'.",
    // tipLink: "/pedidos",
    // tipLinkLabel: "Mis pedidos →",
    color: "from-orange-500 to-orange-600",
    bg: "bg-orange-50",
    border: "border-orange-100",
  },
];

const PAYMENT_METHODS = [
  { icon: "💳", name: "MercadoPago", desc: "Tarjeta de crédito, débito o saldo MP" },
  { icon: "🏦", name: "Transferencia bancaria", desc: "CVU / CBU · Alias: Shelosett20" },
  { icon: "💵", name: "Efectivo en mostrador", desc: "Av La Plata 744 Timbre 3, CABA" },
  { icon: "📋", name: "Cotización", desc: "Para pedidos mayoristas a medida" },
];

const FAQS = [
  {
    q: "¿Cuánto tarda en llegar mi pedido?",
    a: "Coordinamos la entrega una vez confirmado el pago. Los tiempos varían según la zona y el método de envío, pero siempre te avisamos antes.",
  },
  {
    q: "¿Puedo retirar en persona?",
    a: "Sí. Estamos en Av La Plata 744 Timbre 3, CABA. Coordinamos el horario de retiro por WhatsApp.",
  },
  {
    q: "¿Los productos tienen garantía?",
    a: "Todos nuestros productos tienen garantía. Si tenés algún problema, contactanos y lo resolvemos.",
  },
  {
    q: "¿Cómo accedo a precios mayoristas?",
    a: "Registrate y solicitá el acceso mayorista desde tu perfil. El equipo revisa tu solicitud y te habilita los precios especiales.",
  },
  {
    q: "¿Puedo cancelar mi pedido?",
    a: "Si el pedido aún no fue enviado, podés cancelarlo contactándonos. Para cotizaciones, podés cancelarlas directamente desde la app.",
  },
];

export default function HowToBuy() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <SiteMeta title="Cómo comprar — IGWT Store" description="Guía paso a paso para comprar en IGWT Store. Desde explorar el catálogo hasta recibir tu pedido." />
      <Navbar />

      {/* ── HERO ── */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 text-white relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-0 w-80 h-80 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="absolute bottom-0 left-1/4 w-60 h-60 rounded-full bg-cyan-400/10 blur-3xl" />
        </div>
        <div className="relative max-w-4xl mx-auto px-6 py-20 text-center">
          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 text-blue-300 text-xs font-semibold px-4 py-1.5 rounded-full mb-6 tracking-wider uppercase">
            Guía de compra
          </div>
          <h1 className="text-4xl md:text-5xl font-black mb-5 leading-tight">
            Comprar en IGWT <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">
              es muy simple
            </span>
          </h1>
          <p className="text-slate-300 text-lg max-w-xl mx-auto">
            En 6 pasos tenés tu producto en camino. Sin complicaciones, sin sorpresas.
          </p>
        </div>
      </section>

      {/* ── STEPS ── */}
      <section className="max-w-4xl mx-auto px-6 py-20">
        <div className="relative htb-steps">
          {/* Línea vertical conectora — solo desktop */}
          <div className="hidden md:block absolute left-9 top-10 bottom-10 w-0.5 bg-gradient-to-b from-blue-200 via-indigo-200 to-orange-200" />

          <div className="space-y-6">
            {STEPS.map((step, idx) => (
              <div key={step.number} className="relative flex gap-6 items-start group">
                {/* Número / ícono */}
                <div className={`relative z-10 flex-shrink-0 w-[72px] h-[72px] rounded-2xl bg-gradient-to-br ${step.color} flex flex-col items-center justify-center shadow-lg`}>
                  <span className="text-white/60 text-[10px] font-black leading-none">{step.number}</span>
                  <span className="text-2xl leading-none mt-0.5">{step.icon}</span>
                </div>

                {/* Contenido */}
                <div className={`flex-1 ${step.bg} ${step.border} border rounded-2xl p-5 group-hover:shadow-md transition-shadow`}>
                  <h3 className="font-black text-slate-900 text-lg mb-1">{step.title}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed mb-3">{step.desc}</p>
                  <div className="flex items-start gap-2 bg-white/70 rounded-xl px-3 py-2">
                    <span className="text-sm mt-0.5 flex-shrink-0">💡</span>
                    <div className="flex-1">
                      <p className="text-slate-500 text-xs leading-relaxed">{step.tip}</p>
                      {step.tipLink && (
                        step.tipExternal ? (
                          <a
                            href={step.tipLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block mt-1.5 text-xs font-semibold text-blue-600 hover:underline"
                          >
                            {step.tipLinkLabel}
                          </a>
                        ) : (
                          <Link
                            to={step.tipLink}
                            className="inline-block mt-1.5 text-xs font-semibold text-blue-600 hover:underline"
                          >
                            {step.tipLinkLabel}
                          </Link>
                        )
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── MÉTODOS DE PAGO ── */}
      <section className="bg-slate-50 py-16">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-black text-slate-900">Métodos de pago</h2>
            <p className="text-slate-500 mt-2">Elegí el que más te convenga</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PAYMENT_METHODS.map((m) => (
              <div key={m.name} className="bg-white rounded-2xl border border-slate-200 p-5 text-center hover:border-blue-200 hover:shadow-sm transition-all">
                <div className="text-3xl mb-3">{m.icon}</div>
                <h3 className="font-bold text-slate-800 text-sm mb-1">{m.name}</h3>
                <p className="text-slate-400 text-xs">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQs ── */}
      <section className="max-w-3xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-2xl md:text-3xl font-black text-slate-900">Preguntas frecuentes</h2>
        </div>
        <div className="space-y-4">
          {FAQS.map((faq) => (
            <details key={faq.q} className="group bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden">
              <summary className="flex items-center justify-between px-5 py-4 font-semibold text-slate-800 cursor-pointer list-none hover:bg-slate-100 transition-colors">
                <span>{faq.q}</span>
                <svg className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180 flex-shrink-0 ml-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="px-5 pb-4 text-slate-600 text-sm leading-relaxed border-t border-slate-200 pt-3">
                {faq.a}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section className="bg-blue-600 text-white py-16">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-2xl md:text-3xl font-black mb-3">¿Listo para empezar?</h2>
          <p className="text-blue-100 mb-8">
            Todo lo que necesitás está en nuestro catálogo. Y si tenés dudas, estamos siempre disponibles.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link to="/catalogo" className="bg-white text-blue-700 px-8 py-3 rounded-xl font-bold hover:bg-blue-50 transition-colors">
              Ver catálogo
            </Link>
            <Link to="/registro" className="bg-blue-700 text-white px-8 py-3 rounded-xl font-bold hover:bg-blue-800 transition-colors border border-blue-500">
              Crear cuenta
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

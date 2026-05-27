import { useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import SiteMeta from "../components/SiteMeta";
import { useSiteConfig } from "../context/SiteConfigContext";

// Antes: emojis en los pasos — se mantienen para compatibilidad con datos del admin
// Colores del sistema sustituyen los rainbow (violet/blue/indigo/cyan/emerald/orange)
const STEPS = [
  {
    number: "01",
    icon: "person",         // Antes: "👤"
    title: "Registrate o ingresá",
    desc: "Para comprar en IGWT necesitás una cuenta. Si ya tenés, iniciá sesión. Si no, el registro es rápido y gratuito.",
    tip: "El admin aprueba las cuentas nuevas. Si necesitás acceso urgente, contactanos.",
    tipLink: "/registro",
    tipLinkLabel: "Crear cuenta →",
  },
  {
    number: "02",
    icon: "search",         // Antes: "🔍"
    title: "Explorá el catálogo",
    desc: "Navegá por nuestro catálogo de productos. Podés filtrar por categoría, buscar por nombre o explorar las ofertas y destacados.",
    tip: "Usá los filtros de categoría para encontrar más rápido lo que buscás.",
    tipLink: "/catalogo",
    tipLinkLabel: "Ir al catálogo →",
  },
  {
    number: "03",
    icon: "shopping_cart",  // Antes: "🛒"
    title: "Agregá al carrito",
    desc: "Encontraste lo que querías? Hacé clic en 'Agregar al carrito'. Podés seguir comprando o ir directo al checkout.",
    tip: "Si sos mayorista, registrate para ver los precios especiales.",
    // tipLink: "/registro",
    // tipLinkLabel: "Registrarme →",
  },
  {
    number: "04",
    icon: "receipt_long",   // Antes: "📋"
    title: "Completá el checkout",
    desc: "Ingresá tus datos de contacto, elegí el método de pago y revisá tu pedido antes de confirmar.",
    tip: "Si tenés un cupón de descuento, podés aplicarlo en esta etapa.",
    // tipLink: "/checkout",
    // tipLinkLabel: "Ir al checkout →",
  },
  {
    number: "05",
    icon: "credit_card",    // Antes: "💳"
    title: "Realizá el pago",
    desc: "Aceptamos MercadoPago, transferencia bancaria y efectivo (en mostrador). Elegí la opción que más te convenga.",
    tip: "Si pagás por transferencia, envianos el comprobante por WhatsApp para agilizar la confirmación.",
    tipLink: "https://wa.me/541150395166",
    tipLinkLabel: "Abrir WhatsApp →",
    tipExternal: true,
  },
  {
    number: "06",
    icon: "local_shipping", // Antes: "📦"
    title: "Coordinamos la entrega",
    desc: "Una vez confirmado el pago, coordinamos el envío o retiro. Te notificamos en cada etapa del pedido.",
    tip: "Podés ver el estado de tu pedido en cualquier momento desde 'Mis pedidos'.",
    // tipLink: "/pedidos",
    // tipLinkLabel: "Mis pedidos →",
  },
];

// Antes: STEP_COLORS con rainbow (violet/blue/indigo/cyan/emerald/orange)
// Ahora alternamos entre dos variantes del sistema de diseño
// const STEP_COLORS = [
//   { color: "from-violet-500 to-violet-600", bg: "bg-violet-50", border: "border-violet-100" },
//   ...
// ];

const PAYMENT_METHODS = [
  { icon: "credit_card",       name: "MercadoPago",           desc: "Tarjeta de crédito, débito o saldo MP" },     // Antes: "💳"
  { icon: "account_balance",   name: "Transferencia bancaria", desc: "CVU / CBU / Alias" },                        // Antes: "🏦"
  { icon: "payments",          name: "Efectivo en mostrador",  desc: "Av La Plata 744 Timbre 3, CABA" },           // Antes: "💵"
  { icon: "request_quote",     name: "Cotización",             desc: "Para pedidos mayoristas a medida" },          // Antes: "📋"
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
  const [openFaq, setOpenFaq] = useState(null);

  // howToBuyContent: viejo enfoque RTE — comentado porque fue reemplazado por secciones estructuradas
  // const { howToBuyContent } = useSiteConfig();
  // if (howToBuyContent) { return <RTE render>; }

  const { howToBuySteps, howToBuyPayments, howToBuyFaqs } = useSiteConfig();

  const steps    = howToBuySteps    || STEPS;
  const payments = howToBuyPayments || PAYMENT_METHODS;
  const faqs     = howToBuyFaqs     || FAQS;

  return (
    // Antes: bg-white — actualizado a token del sistema de diseño
    // <div className="min-h-screen flex flex-col bg-white">
    <div className="ds-page min-h-screen flex flex-col bg-[#f8f9ff]">
      <SiteMeta title="Cómo comprar — IGWT Store" description="Guía paso a paso para comprar en IGWT Store. Desde explorar el catálogo hasta recibir tu pedido." />
      <Navbar />

      {/* ── HERO — antes: bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 con acentos blue/cyan ── */}
      {/* <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 text-white ..."> */}
      <section className="bg-[#0b1c30] text-white relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          {/* Antes: bg-blue-500/10 / bg-cyan-400/10 — actualizado a verde del sistema */}
          {/* <div className="absolute top-0 right-0 w-80 h-80 rounded-full bg-blue-500/10 blur-3xl" /> */}
          {/* <div className="absolute bottom-0 left-1/4 w-60 h-60 rounded-full bg-cyan-400/10 blur-3xl" /> */}
          <div className="absolute top-0 right-0 w-80 h-80 rounded-full bg-[#00873a]/15 blur-3xl" />
          <div className="absolute bottom-0 left-1/4 w-60 h-60 rounded-full bg-[#62df7d]/10 blur-3xl" />
        </div>
        <div className="relative max-w-4xl mx-auto px-6 py-20 text-center">
          {/* Antes: bg-white/5 border border-white/10 text-blue-300 */}
          {/* <div className="inline-flex ... bg-white/5 border border-white/10 text-blue-300 ..."> */}
          <div className="inline-flex items-center gap-2 bg-[#00873a]/10 border border-[#00873a]/20 text-[#62df7d] text-xs font-semibold px-4 py-1.5 rounded-full mb-6 tracking-wider uppercase">
            Guía de compra
          </div>
          <h1 className="text-4xl md:text-5xl font-black mb-5 leading-tight" style={{ fontFamily: "Outfit" }}>
            Comprar en IGWT <br />
            {/* Antes: from-blue-400 to-cyan-300 — actualizado a verde del sistema */}
            {/* <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300"> */}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#62df7d] to-[#00873a]">
              es muy simple
            </span>
          </h1>
          {/* Antes: text-slate-300 */}
          <p className="text-white/60 text-lg max-w-xl mx-auto">
            En 6 pasos tenés tu producto en camino. Sin complicaciones, sin sorpresas.
          </p>
        </div>
      </section>

      {/* ── STEPS — antes: colores rainbow por paso ── */}
      <section className="max-w-4xl mx-auto px-6 py-20">
        <div className="relative htb-steps">
          {/* Línea vertical conectora — solo desktop — antes: gradient multicolor */}
          {/* <div className="hidden md:block absolute left-9 top-10 bottom-10 w-0.5 bg-gradient-to-b from-blue-200 via-indigo-200 to-orange-200" /> */}
          <div className="hidden md:block absolute left-9 top-10 bottom-10 w-0.5 bg-gradient-to-b from-[#00873a]/40 via-[#006b2c]/20 to-[#00873a]/10" />

          <div className="space-y-6">
            {steps.map((step, idx) => {
              // Antes: color del paso desde STEP_COLORS[idx % STEP_COLORS.length]
              // const c = STEP_COLORS[idx % STEP_COLORS.length];
              // Alternamos entre dos estilos para dar variedad visual sin rainbow
              const isEven = idx % 2 === 0;
              return (
                <div key={idx} className="relative flex gap-6 items-start group">
                  {/* Número / ícono — antes: bg-gradient-to-br ${c.color} con emoji */}
                  {/* <div className={`... bg-gradient-to-br ${c.color} ...`}> */}
                  <div className={`relative z-10 flex-shrink-0 w-[72px] h-[72px] rounded-2xl flex flex-col items-center justify-center shadow-lg ${
                    isEven ? "bg-[#0b1c30]" : "bg-[#00873a]"
                  }`}>
                    <span className="text-white/40 text-[10px] font-black leading-none">{String(idx + 1).padStart(2, "0")}</span>
                    {/* Antes: emoji en step.icon — ahora Material Symbol si es nombre de icono, emoji si viene del admin */}
                    {step.icon && /^[a-z_]+$/.test(step.icon) ? (
                      <span
                        className="material-symbols-outlined text-[24px] text-[#62df7d] leading-none mt-0.5"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >{step.icon}</span>
                    ) : (
                      <span className="text-2xl leading-none mt-0.5">{step.icon}</span>
                    )}
                  </div>

                  {/* Contenido — antes: ${c.bg} ${c.border} con colores rainbow */}
                  {/* <div className={`flex-1 ${c.bg} ${c.border} border rounded-2xl ...`}> */}
                  <div className="flex-1 bg-white border border-[#bdcaba]/30 rounded-xl p-5 shadow-[0px_4px_20px_rgba(15,23,42,0.05)] group-hover:shadow-[0px_8px_30px_rgba(15,23,42,0.08)] transition-shadow">
                    {/* Antes: text-slate-900 / text-slate-600 */}
                    <h3 className="font-black text-[#0b1c30] text-lg mb-1" style={{ fontFamily: "Outfit" }}>{step.title}</h3>
                    <p className="text-[#565e74] text-sm leading-relaxed mb-3">{step.desc}</p>
                    {step.tip && (
                      // Antes: bg-white/70 con emoji 💡
                      <div className="flex items-start gap-2 bg-[#eff4ff] rounded-xl px-3 py-2">
                        {/* Antes: emoji 💡 */}
                        {/* <span className="text-sm mt-0.5 flex-shrink-0">💡</span> */}
                        <span className="material-symbols-outlined text-[#006b2c] text-[16px] mt-0.5 flex-shrink-0"
                          style={{ fontVariationSettings: "'FILL' 1" }}>tips_and_updates</span>
                        <div className="flex-1">
                          {/* Antes: text-slate-500 */}
                          <p className="text-[#565e74] text-xs leading-relaxed">{step.tip}</p>
                          {step.tipLink && (
                            step.tipExternal ? (
                              <a href={step.tipLink} target="_blank" rel="noopener noreferrer"
                                // Antes: text-blue-600
                                className="inline-block mt-1.5 text-xs font-semibold text-[#006b2c] hover:underline">
                                {step.tipLinkLabel}
                              </a>
                            ) : (
                              <Link to={step.tipLink}
                                // Antes: text-blue-600
                                className="inline-block mt-1.5 text-xs font-semibold text-[#006b2c] hover:underline">
                                {step.tipLinkLabel}
                              </Link>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── MÉTODOS DE PAGO — antes: bg-slate-50 con emojis ── */}
      {/* <section className="bg-slate-50 py-16"> */}
      <section className="bg-[#eff4ff] py-16">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-10">
            {/* Antes: text-slate-900 / text-slate-500 */}
            <h2 className="text-2xl md:text-3xl font-black text-[#0b1c30]" style={{ fontFamily: "Outfit" }}>
              Métodos de pago
            </h2>
            <p className="text-[#565e74] mt-2">Elegí el que más te convenga</p>
          </div>
          <div className="flex flex-wrap justify-center gap-4">
            {payments.map((m, i) => (
              // Antes: bg-white rounded-2xl border border-slate-200 hover:border-blue-200
              <div key={i} className="w-full sm:w-[calc(50%-8px)] lg:w-[calc(25%-12px)] min-w-[160px] bg-white rounded-xl border border-[#bdcaba]/30 shadow-[0px_4px_20px_rgba(15,23,42,0.05)] p-5 text-center hover:border-[#006b2c]/40 hover:shadow-[0px_8px_30px_rgba(15,23,42,0.08)] transition-all">
                <div className="flex items-center justify-center mb-3">
                  {m.image ? (
                    <img src={m.image} alt={m.name} className="w-12 h-12 object-contain rounded-xl" />
                  ) : m.icon && /^[a-z_]+$/.test(m.icon) ? (
                    // Material Symbol
                    <span
                      className="material-symbols-outlined text-[36px] text-[#00873a]"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >{m.icon}</span>
                  ) : (
                    // Emoji del admin
                    // Antes: <span className="text-3xl">{m.icon}</span>
                    <span className="text-3xl">{m.icon}</span>
                  )}
                </div>
                {/* Antes: text-slate-800 / text-slate-400 */}
                <h3 className="font-bold text-[#0b1c30] text-sm mb-1">{m.name}</h3>
                <p className="text-[#565e74] text-xs">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQs — antes: bg-slate-800 / border-slate-700 / text-slate-100 ── */}
      <section className="max-w-3xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          {/* Antes: text-slate-900 */}
          <h2 className="text-2xl md:text-3xl font-black text-[#0b1c30]" style={{ fontFamily: "Outfit" }}>
            Preguntas frecuentes
          </h2>
        </div>
        <div className="space-y-3">
          {faqs.map((faq, i) => {
            const isOpen = openFaq === i;
            return (
              // Antes: rounded-2xl border border-slate-700 bg-slate-800
              <div key={faq.q} className="rounded-xl overflow-hidden border border-[#bdcaba]/30 bg-white shadow-[0px_4px_20px_rgba(15,23,42,0.05)]">
                <button
                  onClick={() => setOpenFaq(isOpen ? null : i)}
                  // Antes: text-slate-100 hover:bg-slate-700
                  className="w-full flex items-center justify-between px-5 py-4 font-semibold text-[#0b1c30] text-left cursor-pointer transition-all duration-150 hover:bg-[#eff4ff] active:scale-[0.99] select-none"
                >
                  <span className="text-sm">{faq.q}</span>
                  {/* Antes: text-slate-400 SVG — reemplazado por Material Symbol */}
                  {/* <svg className={`w-4 h-4 text-slate-400 ...`}>...</svg> */}
                  <span className={`material-symbols-outlined text-[20px] text-[#565e74] flex-shrink-0 ml-3 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}>
                    expand_more
                  </span>
                </button>
                <div
                  className="overflow-hidden transition-all duration-300 ease-in-out"
                  style={{ maxHeight: isOpen ? "500px" : "0px" }}
                >
                  {/* Antes: text-slate-300 border-slate-700 */}
                  <div className="px-5 pb-4 pt-3 text-sm text-[#565e74] leading-relaxed border-t border-[#bdcaba]/20">
                    {faq.a}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── CTA FINAL — antes: bg-blue-600 text-white ── */}
      {/* <section className="bg-blue-600 text-white py-16"> */}
      <section className="bg-[#0b1c30] text-white py-16 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-72 h-72 rounded-full bg-[#00873a]/10 blur-3xl pointer-events-none" />
        <div className="relative max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-2xl md:text-3xl font-black mb-3" style={{ fontFamily: "Outfit" }}>¿Listo para empezar?</h2>
          {/* Antes: text-blue-100 */}
          <p className="text-white/60 mb-8">
            Todo lo que necesitás está en nuestro catálogo. Y si tenés dudas, estamos siempre disponibles.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            {/* Antes: bg-white text-blue-700 hover:bg-blue-50 */}
            {/* <Link to="/catalogo" className="bg-white text-blue-700 ..."> */}
            <Link
              to="/catalogo"
              className="flex items-center gap-2 bg-[#00873a] text-white px-8 py-3 rounded-[10px] font-bold hover:brightness-110 transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">storefront</span>
              Ver catálogo
            </Link>
            {/* Antes: bg-blue-700 text-white hover:bg-blue-800 border border-blue-500 */}
            {/* <Link to="/registro" className="bg-blue-700 text-white ... border border-blue-500"> */}
            <Link
              to="/registro"
              className="flex items-center gap-2 bg-white/10 text-white border border-white/20 px-8 py-3 rounded-[10px] font-bold hover:bg-white/20 transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">person_add</span>
              Crear cuenta
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

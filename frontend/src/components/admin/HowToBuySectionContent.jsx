import { useState, useEffect } from "react";
import { settingsApi } from "../../services/api";
import { useSiteConfig } from "../../context/SiteConfigContext";
import toast from "react-hot-toast";

const DEFAULT_STEPS = [
  { icon: "👤", title: "Registrate o ingresá", desc: "Para comprar en IGWT necesitás una cuenta. Si ya tenés, iniciá sesión. Si no, el registro es rápido y gratuito.", tip: "El admin aprueba las cuentas nuevas. Si necesitás acceso urgente, contactanos.", tipLink: "/registro", tipLinkLabel: "Crear cuenta →" },
  { icon: "🔍", title: "Explorá el catálogo", desc: "Navegá por nuestro catálogo de productos. Podés filtrar por categoría, buscar por nombre o explorar las ofertas y destacados.", tip: "Usá los filtros de categoría para encontrar más rápido lo que buscás.", tipLink: "/catalogo", tipLinkLabel: "Ir al catálogo →" },
  { icon: "🛒", title: "Agregá al carrito", desc: "Encontraste lo que querías? Hacé clic en 'Agregar al carrito'. Podés seguir comprando o ir directo al checkout.", tip: "Si sos mayorista, registrate para ver los precios especiales." },
  { icon: "📋", title: "Completá el checkout", desc: "Ingresá tus datos de contacto, elegí el método de pago y revisá tu pedido antes de confirmar.", tip: "Si tenés un cupón de descuento, podés aplicarlo en esta etapa." },
  { icon: "💳", title: "Realizá el pago", desc: "Aceptamos MercadoPago, transferencia bancaria y efectivo (en mostrador). Elegí la opción que más te convenga.", tip: "Si pagás por transferencia, envianos el comprobante por WhatsApp para agilizar la confirmación.", tipLink: "https://wa.me/541150395166", tipLinkLabel: "Abrir WhatsApp →", tipExternal: true },
  { icon: "📦", title: "Coordinamos la entrega", desc: "Una vez confirmado el pago, coordinamos el envío o retiro. Te notificamos en cada etapa del pedido.", tip: "Podés ver el estado de tu pedido en cualquier momento desde 'Mis pedidos'." },
];

const DEFAULT_PAYMENTS = [
  { icon: "💳", name: "MercadoPago", desc: "Tarjeta de crédito, débito o saldo MP" },
  { icon: "🏦", name: "Transferencia bancaria", desc: "CVU / CBU / Alias" },
  { icon: "💵", name: "Efectivo en mostrador", desc: "Av La Plata 744 Timbre 3, CABA" },
  { icon: "📋", name: "Cotización", desc: "Para pedidos mayoristas a medida" },
];

const DEFAULT_FAQS = [
  { q: "¿Cuánto tarda en llegar mi pedido?", a: "Coordinamos la entrega una vez confirmado el pago. Los tiempos varían según la zona y el método de envío, pero siempre te avisamos antes." },
  { q: "¿Puedo retirar en persona?", a: "Sí. Estamos en Av La Plata 744 Timbre 3, CABA. Coordinamos el horario de retiro por WhatsApp." },
  { q: "¿Los productos tienen garantía?", a: "Todos nuestros productos tienen garantía. Si tenés algún problema, contactanos y lo resolvemos." },
  { q: "¿Cómo accedo a precios mayoristas?", a: "Registrate y solicitá el acceso mayorista desde tu perfil. El equipo revisa tu solicitud y te habilita los precios especiales." },
  { q: "¿Puedo cancelar mi pedido?", a: "Si el pedido aún no fue enviado, podés cancelarlo contactándonos. Para cotizaciones, podés cancelarlas directamente desde la app." },
];

function SaveButton({ onClick, saving, label = "Guardar" }) {
  return (
    <button onClick={onClick} disabled={saving}
      className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm">
      {saving ? "Guardando…" : label}
    </button>
  );
}

export default function HowToBuySectionContent() {
  const { refetch } = useSiteConfig();
  const [loading, setLoading] = useState(true);

  const [steps, setSteps]             = useState(DEFAULT_STEPS);
  const [savingSteps, setSavingSteps] = useState(false);

  const [payments, setPayments]             = useState(DEFAULT_PAYMENTS);
  const [savingPayments, setSavingPayments] = useState(false);

  const [faqs, setFaqs]             = useState(DEFAULT_FAQS);
  const [savingFaqs, setSavingFaqs] = useState(false);

  useEffect(() => {
    settingsApi.get().then((res) => {
      try { if (res.data.howToBuySteps)    setSteps(JSON.parse(res.data.howToBuySteps)); }    catch {}
      try { if (res.data.howToBuyPayments) setPayments(JSON.parse(res.data.howToBuyPayments)); } catch {}
      try { if (res.data.howToBuyFaqs)     setFaqs(JSON.parse(res.data.howToBuyFaqs)); }     catch {}
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const handleSaveSteps = async () => {
    setSavingSteps(true);
    try { await settingsApi.update({ howToBuySteps: JSON.stringify(steps) }); refetch(); toast.success("Pasos guardados"); }
    catch { toast.error("Error al guardar"); }
    finally { setSavingSteps(false); }
  };

  const handleSavePayments = async () => {
    setSavingPayments(true);
    try { await settingsApi.update({ howToBuyPayments: JSON.stringify(payments) }); refetch(); toast.success("Métodos de pago guardados"); }
    catch { toast.error("Error al guardar"); }
    finally { setSavingPayments(false); }
  };

  const handleSaveFaqs = async () => {
    setSavingFaqs(true);
    try { await settingsApi.update({ howToBuyFaqs: JSON.stringify(faqs) }); refetch(); toast.success("Preguntas frecuentes guardadas"); }
    catch { toast.error("Error al guardar"); }
    finally { setSavingFaqs(false); }
  };

  const updateStep = (i, field, value) => {
    const next = [...steps];
    next[i] = { ...next[i], [field]: value };
    setSteps(next);
  };

  const moveStep = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next);
  };

  const updatePayment = (i, field, value) => {
    const next = [...payments];
    next[i] = { ...next[i], [field]: value };
    setPayments(next);
  };

  const movePayment = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= payments.length) return;
    const next = [...payments];
    [next[i], next[j]] = [next[j], next[i]];
    setPayments(next);
  };

  const updateFaq = (i, field, value) => {
    const next = [...faqs];
    next[i] = { ...next[i], [field]: value };
    setFaqs(next);
  };

  const moveFaq = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= faqs.length) return;
    const next = [...faqs];
    [next[i], next[j]] = [next[j], next[i]];
    setFaqs(next);
  };

  if (loading) return (
    <div className="flex justify-center py-10">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
    </div>
  );

  return (
    <div className="space-y-5">

      {/* ── Pasos ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div>
          <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
            <span>🪜</span> Pasos del proceso de compra
          </h2>
          <p className="text-sm text-slate-500 mt-1">El color de cada paso se asigna automáticamente por posición.</p>
        </div>

        <div className="space-y-3">
          {steps.map((step, i) => (
            <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-slate-400 w-6 text-center flex-shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <input className="input w-14 text-center text-xl flex-shrink-0" value={step.icon}
                  onChange={(e) => updateStep(i, "icon", e.target.value)} placeholder="👤" />
                <input className="input flex-1 text-sm font-semibold" value={step.title}
                  onChange={(e) => updateStep(i, "title", e.target.value)} placeholder="Título del paso" />
                {/* Botones de reordenamiento — cambian la posición del paso y el número se actualiza automáticamente */}
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0}
                    className="text-slate-400 hover:text-slate-600 disabled:opacity-20 disabled:cursor-not-allowed leading-none px-1 text-xs"
                    title="Subir paso">▲</button>
                  <button type="button" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}
                    className="text-slate-400 hover:text-slate-600 disabled:opacity-20 disabled:cursor-not-allowed leading-none px-1 text-xs"
                    title="Bajar paso">▼</button>
                </div>
                <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                  className="text-red-400 hover:text-red-600 font-bold text-xl px-1 flex-shrink-0 leading-none" title="Eliminar">✕</button>
              </div>
              <textarea className="input w-full text-sm h-16 resize-none" value={step.desc}
                onChange={(e) => updateStep(i, "desc", e.target.value)} placeholder="Descripción del paso" />
              <input className="input w-full text-sm" value={step.tip || ""}
                onChange={(e) => updateStep(i, "tip", e.target.value)} placeholder="💡 Tip (opcional)" />
              <div className="flex gap-2">
                <input className="input flex-1 text-sm" value={step.tipLink || ""}
                  onChange={(e) => updateStep(i, "tipLink", e.target.value)} placeholder="Link del tip (ej: /registro)" />
                <input className="input flex-1 text-sm" value={step.tipLinkLabel || ""}
                  onChange={(e) => updateStep(i, "tipLinkLabel", e.target.value)} placeholder="Texto del link (ej: Crear cuenta →)" />
              </div>
            </div>
          ))}
          <button type="button"
            onClick={() => setSteps([...steps, { icon: "✨", title: "", desc: "", tip: "" }])}
            className="w-full py-2.5 border-2 border-dashed border-slate-300 rounded-xl text-sm text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-colors">
            + Agregar paso
          </button>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <SaveButton onClick={handleSaveSteps} saving={savingSteps} label="Guardar pasos" />
        </div>
      </div>

      {/* ── Métodos de pago ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div>
          <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
            <span>💳</span> Métodos de pago
          </h2>
          <p className="text-sm text-slate-500 mt-1">Solo informativo — no afecta los métodos reales de cobro.</p>
        </div>

        <div className="space-y-3">
          {payments.map((p, i) => (
            <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">

                {/* Ícono: imagen subida O emoji — clic para cambiar imagen */}
                <div className="relative flex-shrink-0 group">
                  <input
                    type="file" accept="image/*"
                    className="hidden"
                    id={`pay-img-${i}`}
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => updatePayment(i, "image", ev.target.result);
                      reader.readAsDataURL(file);
                    }}
                  />
                  <label htmlFor={`pay-img-${i}`}
                    className="w-12 h-12 flex items-center justify-center rounded-xl border border-slate-300 cursor-pointer hover:border-blue-400 transition-colors bg-white overflow-hidden"
                    title="Clic para subir imagen">
                    {p.image
                      ? <img src={p.image} alt="" className="w-full h-full object-contain" />
                      : <span className="text-2xl">{p.icon || "💳"}</span>
                    }
                  </label>
                  {/* Botón para quitar imagen y volver al emoji */}
                  {p.image && (
                    <button type="button"
                      onClick={() => updatePayment(i, "image", "")}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] leading-none flex items-center justify-center hover:bg-red-600"
                      title="Quitar imagen">✕</button>
                  )}
                </div>

                {/* Emoji (solo visible si no hay imagen) */}
                {!p.image && (
                  <input className="input w-12 text-center text-xl flex-shrink-0" value={p.icon}
                    onChange={(e) => updatePayment(i, "icon", e.target.value)} placeholder="💳" />
                )}

                <input className="input flex-1 text-sm font-semibold" value={p.name}
                  onChange={(e) => updatePayment(i, "name", e.target.value)} placeholder="Nombre" />
                <input className="input flex-1 text-sm" value={p.desc}
                  onChange={(e) => updatePayment(i, "desc", e.target.value)} placeholder="Descripción" />
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <button type="button" onClick={() => movePayment(i, -1)} disabled={i === 0}
                    className="text-slate-400 hover:text-slate-600 disabled:opacity-20 disabled:cursor-not-allowed leading-none px-1 text-xs" title="Subir">▲</button>
                  <button type="button" onClick={() => movePayment(i, 1)} disabled={i === payments.length - 1}
                    className="text-slate-400 hover:text-slate-600 disabled:opacity-20 disabled:cursor-not-allowed leading-none px-1 text-xs" title="Bajar">▼</button>
                </div>
                <button type="button" onClick={() => setPayments(payments.filter((_, j) => j !== i))}
                  className="text-red-400 hover:text-red-600 font-bold text-xl px-1 flex-shrink-0 leading-none" title="Eliminar">✕</button>
              </div>
              {!p.image && (
                <p className="text-xs text-slate-400 pl-1">Clic en el cuadro del ícono para subir una imagen (reemplaza el emoji).</p>
              )}
            </div>
          ))}
          <button type="button"
            onClick={() => setPayments([...payments, { icon: "💰", name: "", desc: "" }])}
            className="w-full py-2.5 border-2 border-dashed border-slate-300 rounded-xl text-sm text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-colors">
            + Agregar método
          </button>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <SaveButton onClick={handleSavePayments} saving={savingPayments} />
        </div>
      </div>

      {/* ── Preguntas frecuentes ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div>
          <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
            <span>❓</span> Preguntas frecuentes
          </h2>
          <p className="text-sm text-slate-500 mt-1">Podés agregar, editar o eliminar preguntas.</p>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <input className="input flex-1 text-sm font-semibold" value={faq.q}
                  onChange={(e) => updateFaq(i, "q", e.target.value)} placeholder="Pregunta" />
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <button type="button" onClick={() => moveFaq(i, -1)} disabled={i === 0}
                    className="text-slate-400 hover:text-slate-600 disabled:opacity-20 disabled:cursor-not-allowed leading-none px-1 text-xs" title="Subir">▲</button>
                  <button type="button" onClick={() => moveFaq(i, 1)} disabled={i === faqs.length - 1}
                    className="text-slate-400 hover:text-slate-600 disabled:opacity-20 disabled:cursor-not-allowed leading-none px-1 text-xs" title="Bajar">▼</button>
                </div>
                <button type="button" onClick={() => setFaqs(faqs.filter((_, j) => j !== i))}
                  className="text-red-400 hover:text-red-600 font-bold text-xl px-1 flex-shrink-0 leading-none" title="Eliminar">✕</button>
              </div>
              <textarea className="input w-full text-sm h-16 resize-none" value={faq.a}
                onChange={(e) => updateFaq(i, "a", e.target.value)} placeholder="Respuesta" />
            </div>
          ))}
          <button type="button"
            onClick={() => setFaqs([...faqs, { q: "", a: "" }])}
            className="w-full py-2.5 border-2 border-dashed border-slate-300 rounded-xl text-sm text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-colors">
            + Agregar pregunta
          </button>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <SaveButton onClick={handleSaveFaqs} saving={savingFaqs} label="Guardar FAQs" />
        </div>
      </div>

    </div>
  );
}

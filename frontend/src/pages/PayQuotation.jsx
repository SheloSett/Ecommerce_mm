import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { ordersApi, paymentsApi, getImageUrl } from "../services/api";
// ordersApi.applyCoupon se usa para aplicar cupones a cotizaciones aprobadas
import Navbar from "../components/Navbar";
import toast from "react-hot-toast";
import { formatPrice as formatPriceWithCurrency } from "../utils/formatPrice";
import { getOrderTotals } from "../utils/orderTotals";

function formatPrice(price) {
  return formatPriceWithCurrency(price, "ARS");
}

function IconMP() {
  return (
    <svg viewBox="0 0 48 48" className="w-7 h-7" fill="none">
      <circle cx="24" cy="24" r="24" fill="#009EE3" />
      <text x="24" y="30" textAnchor="middle" fill="white" fontSize="16" fontWeight="bold">MP</text>
    </svg>
  );
}

function IconCash() {
  // Antes: SVG inline stroke — reemplazado por Material Symbol
  // return (<svg className="w-7 h-7 text-green-600" ...><path strokeLinecap="round" .../></svg>);
  return (
    <span
      className="material-symbols-outlined text-[28px] text-[#00873a]"
      style={{ fontVariationSettings: "'FILL' 1" }}
    >payments</span>
  );
}

function IconTransfer() {
  // Antes: SVG inline stroke — reemplazado por Material Symbol
  // return (<svg className="w-7 h-7 text-indigo-600" ...><path strokeLinecap="round" .../></svg>);
  return (
    <span
      className="material-symbols-outlined text-[28px] text-[#316bf3]"
      style={{ fontVariationSettings: "'FILL' 1" }}
    >account_balance</span>
  );
}

const PAYMENT_METHODS = [
  { id: "MERCADOPAGO",   label: "MercadoPago",   icon: <IconMP />,       desc: "Pagá online con tarjeta o dinero en cuenta" },
  { id: "EFECTIVO",      label: "Efectivo",       icon: <IconCash />,     desc: "El vendedor coordinará la entrega y cobro" },
  { id: "TRANSFERENCIA", label: "Transferencia",  icon: <IconTransfer />, desc: "Te enviamos los datos bancarios por email" },
  // A_CONVENIR: única opción cuando la cotización tiene ítems en dólares. No es un método de pago
  // más — es la ausencia de uno: se confirma el pedido y la tienda arregla el cobro por fuera.
  { id: "A_CONVENIR",    label: "A convenir con la tienda", icon: <IconCash />, desc: "Coordinamos el pago con vos: al haber precios en dólares no se puede cobrar online" },
];

export default function PayQuotation() {
  const { id } = useParams();
  const { customer, loadingCustomer } = useCustomerAuth();
  const navigate = useNavigate();

  const [quote, setQuote]                 = useState(null);
  const [loading, setLoading]             = useState(true);
  const [paymentMethod, setPaymentMethod] = useState("MERCADOPAGO");
  const [paying, setPaying]               = useState(false);
  // success: null = en progreso, "MANUAL" = efectivo/transferencia, "MP_REDIRECT" = redirigiendo
  const [success, setSuccess]             = useState(null);
  // Cupón de descuento — MOVIDO al formulario de envío de cotización (Checkout.jsx)
  // const [couponCode, setCouponCode]     = useState("");
  // const [couponResult, setCouponResult] = useState(null);
  // const [couponLoading, setCouponLoading] = useState(false);

  useEffect(() => {
    if (loadingCustomer) return;
    if (!customer) { navigate("/login"); return; }
    if (customer.type !== "MAYORISTA") { navigate("/"); return; }
  }, [customer, loadingCustomer, navigate]);

  useEffect(() => {
    if (loadingCustomer || !customer) return;
    ordersApi.getMyQuoteById(id)
      .then((res) => setQuote(res.data))
      .catch(() => { toast.error("Cotización no encontrada"); navigate("/cotizaciones"); })
      .finally(() => setLoading(false));
  }, [id, customer?.id, loadingCustomer]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalAPagar = quote?.total ?? 0;
  // Una cotización puede incluir ítems en USD (sin conversión automática) — se avisa junto al
  // total para que quede claro que ese monto no representa el total real si hay ítems en dólares.
  const quoteHasUsd = (quote?.items || []).some((i) => i.currency === "USD");

  // Montos por moneda (ver utils/orderTotals.js): con dólares en la cotización, quote.total es
  // SOLO la parte en pesos, así que mostrarlo solo a él como "Total a pagar" es engañoso.
  const T = quote ? getOrderTotals(quote) : null;

  // Cotización con dólares → NO se puede pagar online: no hay un monto único que cobrar (el sistema
  // no convierte monedas). El pago se coordina con la tienda, igual que un pedido A_CONVENIR.
  // Antes la página ofrecía MercadoPago igual: el backend lo rechazaba (mpPaymentBlockedReason),
  // pero el cliente solo veía "Error al procesar el pago. Intentá de nuevo.", sin saber por qué.
  const metodosDisponibles = quoteHasUsd
    ? PAYMENT_METHODS.filter((m) => m.id === "A_CONVENIR")
    : PAYMENT_METHODS.filter((m) => m.id !== "A_CONVENIR");

  // El estado arranca en MERCADOPAGO (el default de la mayoria de las cotizaciones). Si la que se
  // cargo tiene dolares, se corrige a A_CONVENIR: sin esto el boton quedaba en "Pagar con
  // MercadoPago" aunque esa opcion ya no este en la lista.
  useEffect(() => {
    if (quoteHasUsd) setPaymentMethod("A_CONVENIR");
  }, [quoteHasUsd]);

  // handleApplyCoupon — MOVIDO: el cupón se aplica al crear la cotización en Checkout.jsx
  // const handleApplyCoupon = async () => { ... };

  const handlePay = async () => {
    if (!quote) return;
    setPaying(true);
    try {
      if (paymentMethod === "MERCADOPAGO") {
        const res = await paymentsApi.createCotizacionPreference(quote.id);
        const url = import.meta.env.DEV ? res.data.sandboxInitPoint : res.data.initPoint;
        window.location.href = url;
      } else {
        await ordersApi.confirmCotizacionPayment(quote.id, paymentMethod);
        setSuccess(paymentMethod);
      }
    } catch (err) {
      // Antes: toast.error("Error al procesar el pago. Intentá de nuevo.") sin mirar la respuesta.
      // El backend explica el motivo (por ejemplo, cotizacion en dolares que no se puede cobrar
      // online); mostrarlo evita que el cliente reintente a ciegas.
      toast.error(err?.response?.data?.error || "Error al procesar el pago. Intentá de nuevo.");
    } finally {
      setPaying(false);
    }
  };

  if (loading || loadingCustomer) {
    return (
      <>
        <Navbar />
        {/* Antes: bg-slate-50 */}
        <div className="ds-page min-h-screen bg-[#f8f9ff] flex items-center justify-center">
          {/* Antes: border-green-500 */}
          <div className="w-8 h-8 border-4 border-[#00873a] border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  if (!quote) return null;

  if (success) {
    return (
      <>
        <Navbar />
        {/* Antes: bg-slate-50 */}
        <div className="ds-page min-h-screen bg-[#f8f9ff] flex items-center justify-center px-4">
          {/* Antes: bg-white rounded-2xl shadow-sm border border-slate-200 */}
          <div className="bg-white rounded-xl border border-[#bdcaba]/30 shadow-[0px_4px_20px_rgba(15,23,42,0.05)] max-w-md w-full p-8 text-center space-y-4">
            {/* Antes: emoji ✅ */}
            {/* <div className="text-5xl">✅</div> */}
            <span
              className="material-symbols-outlined text-[64px] text-[#00873a] block"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >check_circle</span>
            {/* Antes: text-slate-800 */}
            <h2 className="text-xl font-bold text-[#0b1c30]">¡Listo!</h2>
            {/* Antes: text-slate-600 */}
            {success === "TRANSFERENCIA" ? (
              <p className="text-[#565e74] text-sm">
                Te enviaremos los datos bancarios a <strong className="text-[#0b1c30]">{quote.customerEmail}</strong> para que puedas realizar la transferencia.
                Una vez confirmado el pago, tu pedido quedará aprobado.
              </p>
            ) : success === "A_CONVENIR" ? (
              /* Rama nueva: antes caia en el "else" y decia "coordinar el pago en efectivo",
                 cuando justamente lo que no esta definido todavia es como se paga. */
              <p className="text-[#565e74] text-sm">
                Tu pedido quedó confirmado. Como incluye precios en dólares, el vendedor se contactará
                con vos para acordar el monto final y la forma de pago.
              </p>
            ) : (
              <p className="text-[#565e74] text-sm">
                El vendedor se contactará con vos para coordinar el pago en efectivo y la entrega.
              </p>
            )}
            {/* Antes: text-slate-400. El monto tambien salia solo en pesos (quote.total). */}
            <p className="text-xs text-[#565e74]/50">
              Cotización #{quote.id} — {formatPrice(T.ars.total)}
              {quoteHasUsd && ` + ${formatPriceWithCurrency(T.usd.total, "USD")}`}
            </p>
            {/* Antes: bg-green-600 hover:bg-green-700 */}
            <button
              onClick={() => navigate("/cotizaciones")}
              className="mt-2 w-full px-4 py-2.5 bg-[#00873a] text-white font-semibold rounded-xl hover:brightness-110 transition-all"
            >
              Ver mis cotizaciones
            </button>
          </div>
        </div>
      </>
    );
  }

  const items = quote.items || [];

  return (
    <>
      <Navbar />
      {/* Antes: bg-slate-50 */}
      <div className="ds-page min-h-screen bg-[#f8f9ff] py-10">
        <div className="max-w-2xl mx-auto px-4 space-y-6">

          {/* Encabezado */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/cotizaciones")}
              // Antes: hover:bg-slate-200 text-slate-500
              className="p-2 rounded-lg hover:bg-[#eff4ff] text-[#565e74] transition-colors"
            >
              {/* Antes: SVG inline arrow — reemplazado por Material Symbol */}
              {/* <svg className="w-5 h-5" fill="none" stroke="currentColor" ...><path .../></svg> */}
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            </button>
            <div>
              {/* Antes: text-slate-800 */}
              <h1 className="text-2xl font-bold text-[#0b1c30]" style={{ fontFamily: "Outfit" }}>
                Pagar cotización #{quote.id}
              </h1>
              {/* Antes: text-slate-500 */}
              <p className="text-sm text-[#565e74]">Elegí cómo querés abonar tu pedido</p>
            </div>
          </div>

          {/* Resumen de items — antes: rounded-2xl shadow-sm border border-slate-200 */}
          <div className="bg-white rounded-xl border border-[#bdcaba]/30 shadow-[0px_4px_20px_rgba(15,23,42,0.05)] overflow-hidden">
            {/* Antes: border-slate-100 */}
            <div className="px-5 py-4 border-b border-[#bdcaba]/20">
              {/* Antes: text-slate-700 */}
              <h2 className="font-semibold text-[#0b1c30]">Resumen del pedido</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              {items.length === 0 ? (
                <p className="text-sm text-[#565e74]/50 text-center py-4">Sin items</p>
              ) : items.map((item, idx) => (
                <div key={item.id || idx} className="flex items-center gap-3">
                  {/* Antes: bg-slate-100 */}
                  <div className="w-12 h-12 rounded-lg bg-[#eff4ff] overflow-hidden flex-shrink-0">
                    {item.image ? (
                      <img src={getImageUrl(item.image)} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      // Antes: emoji 📦
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="material-symbols-outlined text-[#bdcaba] text-[22px]">package_2</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Antes: text-slate-800 / text-slate-400 */}
                    <p className="text-sm font-medium text-[#0b1c30] truncate">{item.name}</p>
                    <p className="text-xs text-[#565e74]">{formatPriceWithCurrency(item.price, item.currency)} × {item.quantity}</p>
                  </div>
                  {/* Antes: text-slate-700 */}
                  <p className="text-sm font-semibold text-[#0b1c30] flex-shrink-0">
                    {formatPriceWithCurrency(item.price * item.quantity, item.currency)}
                  </p>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="px-5 py-4 border-t border-[#bdcaba]/20">
              {/* El descuento del cupón ya está incluido en quote.total si se aplicó al crear la cotización */}
              {/* Antes se mostraba un unico "Total a pagar" con quote.total, que es SOLO la parte
                  en pesos: en una cotizacion mixta el cliente veia "$23.000" cuando ademas debia
                  USD 14.000. Ahora cada moneda va en su renglon, igual que en el resto del sitio. */}
              <div className="flex justify-between items-start">
                {/* Antes: text-slate-700 / text-slate-800 */}
                <span className="font-semibold text-[#0b1c30]">{quoteHasUsd ? "Total (por moneda)" : "Total a pagar"}</span>
                <span className="text-xl font-bold text-[#0b1c30] text-right leading-tight">
                  {(!quoteHasUsd || T.ars.total > 0) && <div>{formatPrice(T.ars.total)}</div>}
                  {quoteHasUsd && <div>{formatPriceWithCurrency(T.usd.total, "USD")}</div>}
                </span>
              </div>
              {quoteHasUsd && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                  {/* Antes este cartel decia que el monto "puede no reflejar el total real" y aun asi
                      se ofrecia pagar online. Ahora los montos estan bien y lo que se explica es por
                      que el pago se coordina en vez de cobrarse por MercadoPago. */}
                  ⚠️ Esta cotización tiene precios en dólares. No se puede abonar online porque no hay
                  un único monto a cobrar: al confirmar, la tienda se contacta con vos para coordinar el pago.
                </p>
              )}
            </div>

            {/* Cupón de descuento — REMOVIDO: ahora se ingresa al enviar la cotización (Checkout.jsx) */}
            {/* {couponResult ? (<div>Descuento aplicado</div>) : (
              <div className="flex gap-2">
                <input placeholder="Código de cupón" />
                <button onClick={handleApplyCoupon}>Aplicar</button>
              </div>
            )} */}
          </div>

          {/* Nota del admin si existe */}
          {quote.adminNotes && (
            // Antes: bg-blue-50 border border-blue-100 text-blue-700
            <div className="bg-[#eff4ff] border border-[#bdcaba]/30 rounded-xl px-4 py-3 text-sm text-[#0b1c30] flex items-start gap-2">
              {/* Antes: emoji 💬 */}
              {/* 💬 <strong>Nota del vendedor:</strong> */}
              <span className="material-symbols-outlined text-[#316bf3] text-[18px] mt-0.5 flex-shrink-0">chat_bubble</span>
              <p><strong>Nota del vendedor:</strong> {quote.adminNotes}</p>
            </div>
          )}

          {/* Selector de método de pago — antes: rounded-2xl shadow-sm border border-slate-200 */}
          <div className="bg-white rounded-xl border border-[#bdcaba]/30 shadow-[0px_4px_20px_rgba(15,23,42,0.05)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#bdcaba]/20">
              {/* Antes: text-slate-700 */}
              <h2 className="font-semibold text-[#0b1c30]">Método de pago</h2>
            </div>
            <div className="p-4 space-y-3">
              {/* Antes: PAYMENT_METHODS.map(...) — mostraba MercadoPago siempre, incluso en
                  cotizaciones con dólares que el backend rechaza. */}
              {metodosDisponibles.map((method) => (
                <label
                  key={method.id}
                  // Antes: border-green-500 bg-green-50 / border-slate-200 hover:border-slate-300
                  className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-colors ${
                    paymentMethod === method.id
                      ? "border-[#00873a] bg-[#eff4ff]"
                      : "border-[#bdcaba]/40 hover:border-[#bdcaba]"
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={method.id}
                    checked={paymentMethod === method.id}
                    onChange={() => setPaymentMethod(method.id)}
                    className="sr-only"
                  />
                  <div className="flex-shrink-0">{method.icon}</div>
                  <div className="flex-1 min-w-0">
                    {/* Antes: text-slate-800 / text-slate-500 */}
                    <p className="font-semibold text-[#0b1c30] text-sm">{method.label}</p>
                    <p className="text-xs text-[#565e74]">{method.desc}</p>
                  </div>
                  {/* Radio — antes: border-green-500 bg-green-500 / border-slate-300 */}
                  <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    paymentMethod === method.id ? "border-[#00873a] bg-[#00873a]" : "border-[#bdcaba]"
                  }`}>
                    {paymentMethod === method.id && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Botón de pago — antes: bg-green-600 hover:bg-green-700 */}
          <button
            onClick={handlePay}
            disabled={paying}
            className="w-full py-3.5 bg-[#00873a] text-white font-bold text-base rounded-xl hover:brightness-110 transition-all disabled:opacity-60 shadow-sm flex items-center justify-center gap-2"
          >
            {paying ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Procesando...
              </>
            ) : paymentMethod === "MERCADOPAGO" ? (
              <>
                {/* Antes: emoji 💳 */}
                <span className="material-symbols-outlined text-[20px]">credit_card</span>
                Pagar {formatPrice(totalAPagar)} con MercadoPago
              </>
            ) : paymentMethod === "A_CONVENIR" ? (
              /* Sin monto en el boton: justamente lo que se confirma es que el importe se arregla
                 con la tienda. Poner una cifra en pesos seria volver al problema original. */
              <>
                <span className="material-symbols-outlined text-[20px]">handshake</span>
                Confirmar pedido — pago a convenir
              </>
            ) : (
              <>
                {/* Antes: emoji ✅ */}
                <span className="material-symbols-outlined text-[20px]">check_circle</span>
                Confirmar pedido — {formatPrice(totalAPagar)}
              </>
            )}
          </button>

        </div>
      </div>
    </>
  );
}

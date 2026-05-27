import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { ordersApi, paymentsApi, getImageUrl } from "../services/api";
// ordersApi.applyCoupon se usa para aplicar cupones a cotizaciones aprobadas
import Navbar from "../components/Navbar";
import toast from "react-hot-toast";

function formatPrice(price) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);
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
    } catch {
      toast.error("Error al procesar el pago. Intentá de nuevo.");
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
            ) : (
              <p className="text-[#565e74] text-sm">
                El vendedor se contactará con vos para coordinar el pago en efectivo y la entrega.
              </p>
            )}
            {/* Antes: text-slate-400 */}
            <p className="text-xs text-[#565e74]/50">Cotización #{quote.id} — {formatPrice(quote.total)}</p>
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
                    <p className="text-xs text-[#565e74]">{formatPrice(item.price)} × {item.quantity}</p>
                  </div>
                  {/* Antes: text-slate-700 */}
                  <p className="text-sm font-semibold text-[#0b1c30] flex-shrink-0">
                    {formatPrice(item.price * item.quantity)}
                  </p>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="px-5 py-4 border-t border-[#bdcaba]/20">
              {/* El descuento del cupón ya está incluido en quote.total si se aplicó al crear la cotización */}
              <div className="flex justify-between items-center">
                {/* Antes: text-slate-700 / text-slate-800 */}
                <span className="font-semibold text-[#0b1c30]">Total a pagar</span>
                <span className="text-xl font-bold text-[#0b1c30]">{formatPrice(totalAPagar)}</span>
              </div>
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
              {PAYMENT_METHODS.map((method) => (
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

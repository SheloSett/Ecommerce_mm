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
  return (
    <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}
function IconTransfer() {
  return (
    <svg className="w-7 h-7 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
    </svg>
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

  const [quote, setQuote]           = useState(null);
  const [loading, setLoading]       = useState(true);
  const [paymentMethod, setPaymentMethod] = useState("MERCADOPAGO");
  const [paying, setPaying]         = useState(false);
  // success: null = en progreso, "MANUAL" = efectivo/transferencia, "MP_REDIRECT" = redirigiendo
  const [success, setSuccess]       = useState(null);
  // Cupón de descuento — MOVIDO al formulario de envío de cotización (Checkout.jsx)
  // El cupón ahora se aplica al crear la cotización, no al pagarla.
  // const [couponCode, setCouponCode]       = useState("");
  // const [couponResult, setCouponResult]   = useState(null);
  // const [couponLoading, setCouponLoading] = useState(false);

  // Redirigir si no es MAYORISTA o no está logueado
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

  // totalAPagar usa directamente quote.total (ya incluye el descuento si se aplicó un cupón al crear la cotización)
  const totalAPagar = quote?.total ?? 0;

  // handleApplyCoupon — MOVIDO: el cupón se aplica al crear la cotización en Checkout.jsx
  // const handleApplyCoupon = async () => { ... };

  const handlePay = async () => {
    if (!quote) return;
    setPaying(true);
    try {
      if (paymentMethod === "MERCADOPAGO") {
        const res = await paymentsApi.createCotizacionPreference(quote.id);
        const url = import.meta.env.DEV
          ? res.data.sandboxInitPoint
          : res.data.initPoint;
        window.location.href = url;
        // No seteamos success aquí — el usuario es redirigido a MP
      } else {
        // Efectivo o Transferencia: notificar al backend para que envíe los emails
        // (datos bancarios al cliente si es transferencia, notificación al admin)
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
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  if (!quote) return null;

  // Pantalla de éxito para pagos manuales
  if (success) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 max-w-md w-full p-8 text-center space-y-4">
            <div className="text-5xl">✅</div>
            <h2 className="text-xl font-bold text-slate-800">¡Listo!</h2>
            {success === "TRANSFERENCIA" ? (
              <p className="text-slate-600 text-sm">
                Te enviaremos los datos bancarios a <strong>{quote.customerEmail}</strong> para que puedas realizar la transferencia.
                Una vez confirmado el pago, tu pedido quedará aprobado.
              </p>
            ) : (
              <p className="text-slate-600 text-sm">
                El vendedor se contactará con vos para coordinar el pago en efectivo y la entrega.
              </p>
            )}
            <p className="text-xs text-slate-400">Cotización #{quote.id} — {formatPrice(quote.total)}</p>
            <button
              onClick={() => navigate("/cotizaciones")}
              className="mt-2 w-full px-4 py-2.5 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition-colors"
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
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="max-w-2xl mx-auto px-4 space-y-6">

          {/* Encabezado */}
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/cotizaciones")} className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Pagar cotización #{quote.id}</h1>
              <p className="text-sm text-slate-500">Elegí cómo querés abonar tu pedido</p>
            </div>
          </div>

          {/* Resumen de items */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-700">Resumen del pedido</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              {items.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">Sin items</p>
              ) : items.map((item, idx) => (
                <div key={item.id || idx} className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0">
                    {item.image
                      ? <img src={getImageUrl(item.image)} alt={item.name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-slate-300 text-xl">📦</div>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{item.name}</p>
                    <p className="text-xs text-slate-400">{formatPrice(item.price)} × {item.quantity}</p>
                  </div>
                  <p className="text-sm font-semibold text-slate-700 flex-shrink-0">
                    {formatPrice(item.price * item.quantity)}
                  </p>
                </div>
              ))}
            </div>
            {/* Total */}
            <div className="px-5 py-4 border-t border-slate-100 space-y-1">
              {/* El descuento del cupón ya está incluido en quote.total si se aplicó al crear la cotización */}
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-700">Total a pagar</span>
                <span className="text-xl font-bold text-slate-800">{formatPrice(totalAPagar)}</span>
              </div>
            </div>

            {/* Cupón de descuento — REMOVIDO: ahora se ingresa al enviar la cotización (Checkout.jsx) */}
            {/* {couponResult ? (
                <div ...>Descuento aplicado</div>
              ) : (
                <div className="flex gap-2">
                  <input ... placeholder="Código de cupón" />
                  <button onClick={handleApplyCoupon}>Aplicar</button>
                </div>
              )} */}
          </div>

          {/* Nota del admin si existe */}
          {quote.adminNotes && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-700">
              💬 <strong>Nota del vendedor:</strong> {quote.adminNotes}
            </div>
          )}

          {/* Selector de método de pago */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-700">Método de pago</h2>
            </div>
            <div className="p-4 space-y-3">
              {PAYMENT_METHODS.map((method) => (
                <label
                  key={method.id}
                  className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-colors ${
                    paymentMethod === method.id
                      ? "border-green-500 bg-green-50"
                      : "border-slate-200 hover:border-slate-300"
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
                    <p className="font-semibold text-slate-800 text-sm">{method.label}</p>
                    <p className="text-xs text-slate-500">{method.desc}</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    paymentMethod === method.id ? "border-green-500 bg-green-500" : "border-slate-300"
                  }`}>
                    {paymentMethod === method.id && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Botón de pago */}
          <button
            onClick={handlePay}
            disabled={paying}
            className="w-full py-3.5 bg-green-600 text-white font-bold text-base rounded-2xl hover:bg-green-700 transition-colors disabled:opacity-60 shadow-sm"
          >
            {paying
              ? "Procesando..."
              : paymentMethod === "MERCADOPAGO"
                ? `💳 Pagar ${formatPrice(totalAPagar)} con MercadoPago`
                : `✅ Confirmar pedido — ${formatPrice(totalAPagar)}`
            }
          </button>

        </div>
      </div>
    </>
  );
}

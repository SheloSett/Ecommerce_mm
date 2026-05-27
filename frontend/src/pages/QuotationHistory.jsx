import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useNotifications } from "../context/NotificationContext";
import { ordersApi, getImageUrl } from "../services/api";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import toast from "react-hot-toast";

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatPrice(price) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);
}

// Devuelve label, clase de badge y si la card debe tener borde verde
function getQuoteDisplay(status) {
  const map = {
    PENDING: {
      label: "Pendiente",
      badgeCls: "bg-yellow-100 text-yellow-800 font-bold",
      cardBorder: false,
    },
    QUOTE_APPROVED: {
      label: "¡Aprobada! Pendiente de pago",
      badgeCls: "bg-[#7ffc97] text-[#002109] font-bold",
      cardBorder: true,
    },
    APPROVED: {
      label: "Pagada",
      badgeCls: "bg-green-100 text-green-700 font-bold",
      cardBorder: false,
    },
    REJECTED: {
      label: "Rechazada",
      badgeCls: "bg-[#ffdad6] text-[#93000a] font-bold",
      cardBorder: false,
    },
    CANCELLED: {
      label: "Cancelada",
      badgeCls: "border border-[#bdcaba] text-[#565e74] font-bold",
      cardBorder: false,
    },
  };
  return map[status] || { label: status, badgeCls: "bg-slate-100 text-slate-500", cardBorder: false };
}

export default function QuotationHistory() {
  const { customer, loadingCustomer } = useCustomerAuth();
  const { markAllRead, fetchNotifications } = useNotifications();
  const navigate = useNavigate();

  const [quotes, setQuotes]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  // Modal de cancelación
  const [cancelModal, setCancelModal] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling]   = useState(false);

  useEffect(() => {
    if (loadingCustomer) return;
    if (!customer) { navigate("/login"); return; }
    if (customer.type !== "MAYORISTA") { navigate("/"); return; }
  }, [customer, loadingCustomer, navigate]);

  const loadQuotes = () => {
    if (loadingCustomer || !customer || customer.type !== "MAYORISTA") return;
    ordersApi
      .getMyCotizaciones()
      .then((res) => setQuotes(res.data))
      .catch(() => toast.error("No se pudo cargar las cotizaciones"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadQuotes();
  }, [customer?.id, loadingCustomer]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    markAllRead();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = (id) => setExpandedId((prev) => (prev === id ? null : id));

  const handleCancel = async () => {
    if (!cancelModal) return;
    setCancelling(true);
    try {
      await ordersApi.cancelCotizacion(cancelModal, cancelReason);
      toast.success("Cotización cancelada");
      setCancelModal(null);
      setCancelReason("");
      loadQuotes();
      fetchNotifications();
    } catch {
      toast.error("Error al cancelar");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="ds-page min-h-screen bg-[#f8f9ff]">
        <main className="max-w-[1280px] mx-auto px-6 py-16">

          {/* Encabezado */}
          <div className="flex flex-col gap-2 mb-8">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 text-[#006b2c] font-semibold hover:underline underline-offset-4 w-fit"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
              <span className="text-sm">Volver a mi cuenta</span>
            </button>
            <h1 className="text-[48px] font-bold leading-[56px] tracking-tight text-[#0b1c30]">
              Mis pedidos
            </h1>
            <p className="text-[18px] text-[#565e74] leading-7">
              Solicitudes enviadas al vendedor
            </p>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-[#bdcaba] mb-8 overflow-x-auto whitespace-nowrap">
            <Link
              to="/pedidos"
              className="px-6 py-4 text-sm font-semibold text-[#565e74] hover:text-[#0b1c30] tracking-wide transition-colors"
            >
              PEDIDOS
            </Link>
            <span className="px-6 py-4 text-sm font-bold text-[#006b2c] border-b-2 border-[#62df7d] -mb-[2px] tracking-wide">
              COTIZACIONES
            </span>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-4 border-[#00873a] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Empty */}
          {!loading && quotes.length === 0 && (
            <div className="text-center py-20">
              <span className="material-symbols-outlined text-6xl text-[#bdcaba] mb-4 block">
                request_quote
              </span>
              <p className="text-[#565e74] text-lg mb-4">Aún no enviaste ninguna cotización</p>
              <button
                onClick={() => navigate("/catalogo")}
                className="px-6 py-2.5 bg-[#00873a] text-white font-semibold rounded-[10px] hover:opacity-90 transition-all"
              >
                Ver productos
              </button>
            </div>
          )}

          {/* Lista de cotizaciones */}
          <div className="grid grid-cols-1 gap-6">
            {quotes.map((quote) => {
              const isExpanded = expandedId === quote.id;
              const items      = quote.items || [];
              const isActive   =
                quote.status !== "CANCELLED" &&
                quote.status !== "REJECTED" &&
                quote.status !== "APPROVED";
              const { label: statusLabel, badgeCls, cardBorder } = getQuoteDisplay(quote.status);
              const isCancelledOrRejected =
                quote.status === "CANCELLED" || quote.status === "REJECTED";

              return (
                <div
                  key={quote.id}
                  className={`bg-white rounded-xl shadow-sm transition-shadow duration-200
                    ${cardBorder
                      ? "border-2 border-[#00873a] shadow-md"
                      : "border border-[#bdcaba]/30 hover:shadow-md"}
                    ${isCancelledOrRejected ? "opacity-80" : ""}`}
                >
                  <div className="p-6">
                    {/* Header: ID + badge | toggle items */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xl font-semibold text-[#0b1c30]">
                          Cotización #{quote.id}
                        </span>
                        <span
                          className={`px-3 py-1 rounded-full text-xs tracking-wider uppercase ${badgeCls}`}
                        >
                          {statusLabel}
                        </span>
                      </div>
                      <button
                        onClick={() => toggleExpand(quote.id)}
                        className="flex items-center gap-2 px-4 py-2 border border-[#bdcaba] text-[#0b1c30] rounded-lg text-sm font-semibold hover:bg-[#dce9ff]/30 transition-colors self-start md:self-center"
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          {isExpanded ? "expand_less" : "expand_more"}
                        </span>
                        {isExpanded
                          ? "Ocultar"
                          : `Ver ${items.length} item${items.length !== 1 ? "s" : ""}`}
                      </button>
                    </div>

                    {/* Fecha + total */}
                    <div className="mb-6">
                      <p className="text-sm text-[#565e74] mb-1">{formatDate(quote.createdAt)}</p>
                      <p className="text-2xl font-bold text-[#0b1c30]">
                        {quote.status === "APPROVED" ? "Total: " : "Total estimado: "}
                        <span className={cardBorder ? "text-[#006b2c]" : ""}>
                          {formatPrice(quote.total)}
                        </span>
                      </p>
                    </div>

                    {/* Nota del admin */}
                    {quote.adminNotes && (() => {
                      const isStockAlert = quote.adminNotes.includes("stock");
                      return (
                        <div
                          className={`flex items-start gap-2 p-4 rounded-lg mb-4 text-sm leading-relaxed ${
                            isStockAlert
                              ? "bg-orange-50 border border-orange-200 text-orange-700"
                              : "bg-blue-50 text-blue-700"
                          }`}
                        >
                          <span className="material-symbols-outlined text-[18px] flex-shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>
                            {isStockAlert ? "warning" : "info"}
                          </span>
                          <span>
                            <strong>
                              {isStockAlert ? "Aviso de stock:" : "Nota del vendedor:"}
                            </strong>{" "}
                            {quote.adminNotes}
                          </span>
                        </div>
                      );
                    })()}

                    {/* Info box — cotización pendiente */}
                    {quote.status === "PENDING" && (
                      <div className="flex items-start gap-3 bg-[#eff4ff] p-4 rounded-lg mb-4">
                        <span
                          className="material-symbols-outlined text-[#00873a] flex-shrink-0"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          info
                        </span>
                        <p className="text-sm text-[#3e4a3d] leading-relaxed">
                          Tu cotización está siendo revisada. Te notificaremos cuando el vendedor
                          realice cambios o la apruebe.
                        </p>
                      </div>
                    )}

                    {/* Motivo de cancelación */}
                    {quote.status === "CANCELLED" && quote.cancelReason && (
                      <div className="bg-slate-50 border border-[#bdcaba] rounded-lg px-4 py-3 mb-4">
                        <p className="text-xs text-[#565e74]">
                          <span className="font-semibold">Motivo:</span> {quote.cancelReason}
                        </p>
                      </div>
                    )}

                    {/* Acciones */}
                    {isActive && (
                      <div className="flex flex-col sm:flex-row gap-3 mt-2">
                        {/* Pagar orden — solo si aprobada con items y total > 0 */}
                        {quote.status === "QUOTE_APPROVED" &&
                          items.length > 0 &&
                          quote.total > 0 && (
                            <button
                              onClick={() => navigate(`/pagar-cotizacion/${quote.id}`)}
                              className="flex items-center justify-center gap-3 px-8 py-3 bg-[#00873a] text-white font-bold rounded-lg hover:brightness-110 transition-all shadow-lg shadow-[#00873a]/20"
                            >
                              <span
                                className="material-symbols-outlined text-[20px]"
                                style={{ fontVariationSettings: "'FILL' 1" }}
                              >
                                payments
                              </span>
                              Pagar orden
                            </button>
                          )}

                        {/* Cancelar */}
                        <button
                          onClick={() => {
                            setCancelModal(quote.id);
                            setCancelReason("");
                          }}
                          className="px-6 py-3 border-2 border-red-500 text-red-600 font-semibold rounded-lg hover:bg-red-50 transition-all"
                        >
                          Cancelar cotización
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Items (expandibles) */}
                  {isExpanded && (
                    <div className="border-t border-[#bdcaba]/30 px-6 py-5 bg-[#f8f9ff] space-y-3">
                      {items.length === 0 ? (
                        <p className="text-sm text-[#565e74] text-center py-4">Sin items</p>
                      ) : (
                        items.map((item, idx) => (
                          <div key={item.id || idx} className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-lg bg-[#dce9ff] overflow-hidden flex-shrink-0">
                              {item.image ? (
                                <img
                                  src={getImageUrl(item.image)}
                                  alt={item.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-xl">
                                  📦
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-[#0b1c30] truncate">
                                {item.name}
                              </p>
                              <p className="text-xs text-[#565e74]">
                                {formatPrice(item.price)} × {item.quantity}
                              </p>
                            </div>
                            <p className="text-sm font-semibold text-[#0b1c30] flex-shrink-0">
                              {formatPrice(item.price * item.quantity)}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </main>
      </div>
      <Footer />

      {/* Modal de cancelación */}
      {cancelModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-[#0b1c30] text-lg">Cancelar cotización</h3>
            <p className="text-sm text-[#565e74]">
              ¿Estás seguro que querés cancelar esta cotización? Esta acción no se puede deshacer.
            </p>
            <div>
              <label className="block text-sm font-medium text-[#0b1c30] mb-1">
                Motivo (opcional)
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Ej: Ya no necesito los productos, encontré otra opción..."
                className="w-full border border-[#bdcaba] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                rows={3}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setCancelModal(null)}
                className="flex-1 px-4 py-2 border border-[#bdcaba] rounded-xl text-sm font-semibold text-[#0b1c30] hover:bg-[#f8f9ff]"
              >
                Volver
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 disabled:opacity-60"
              >
                {cancelling ? "Cancelando..." : "Sí, cancelar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

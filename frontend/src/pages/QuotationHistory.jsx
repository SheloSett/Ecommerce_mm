import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useNotifications } from "../context/NotificationContext";
import { ordersApi, getImageUrl } from "../services/api";
import Navbar from "../components/Navbar";
import toast from "react-hot-toast";

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("es-AR", {
    day: "2-digit", month: "long", year: "numeric",
  });
}
function formatPrice(price) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);
}

function StatusBadge({ status }) {
  const map = {
    PENDING:        { label: "Pendiente",               className: "bg-yellow-100 text-yellow-700" },
    QUOTE_APPROVED: { label: "¡Aprobada! Pendiente de pago", className: "bg-teal-100 text-teal-700 font-semibold" },
    APPROVED:       { label: "Pagada",                  className: "bg-green-100 text-green-700"   },
    REJECTED:       { label: "Rechazada",               className: "bg-red-100 text-red-700"       },
    CANCELLED:      { label: "Cancelada",               className: "bg-slate-100 text-slate-500"   },
  };
  const { label, className } = map[status] || { label: status, className: "bg-slate-100 text-slate-500" };
  return <span className={`text-xs px-2 py-0.5 rounded-full ${className}`}>{label}</span>;
}

export default function QuotationHistory() {
  const { customer, loadingCustomer } = useCustomerAuth();
  const { markAllRead, fetchNotifications } = useNotifications();
  const navigate = useNavigate();

  const [quotes, setQuotes]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  // Modal de cancelación
  const [cancelModal, setCancelModal] = useState(null); // orderId
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling]   = useState(false);

  useEffect(() => {
    if (loadingCustomer) return;
    if (!customer) { navigate("/login"); return; }
    if (customer.type !== "MAYORISTA") { navigate("/"); return; }
  }, [customer, loadingCustomer, navigate]);

  const loadQuotes = () => {
    if (loadingCustomer || !customer || customer.type !== "MAYORISTA") return;
    ordersApi.getMyCotizaciones()
      .then((res) => setQuotes(res.data))
      .catch(() => toast.error("No se pudo cargar las cotizaciones"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadQuotes();
  }, [customer?.id, loadingCustomer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al abrir la página, marcar notificaciones como leídas
  useEffect(() => {
    markAllRead();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = (id) => setExpandedId((prev) => (prev === id ? null : id));

  // Cancelar cotización
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
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="max-w-3xl mx-auto px-4">

          {/* Encabezado */}
          <div className="flex items-center gap-3 mb-8">
            <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Mis cotizaciones</h1>
              <p className="text-sm text-slate-500">Solicitudes enviadas al vendedor</p>
            </div>
          </div>

          {loading && (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && quotes.length === 0 && (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">📋</div>
              <p className="text-slate-500 text-lg">Aún no enviaste ninguna cotización</p>
              <button onClick={() => navigate("/catalogo")} className="mt-4 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                Ver productos
              </button>
            </div>
          )}

          <div className="space-y-4">
            {quotes.map((quote) => {
              const isExpanded = expandedId === quote.id;
              const items      = quote.items || []; // clientSnapshot items
              // isActive: mostrar botones de acción si la cotización no está finalizada
              const isActive   = quote.status !== "CANCELLED" && quote.status !== "REJECTED" && quote.status !== "APPROVED";

              return (
                <div key={quote.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">

                  {/* Cabecera */}
                  <div className="p-5 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-700">Cotización #{quote.id}</span>
                        <StatusBadge status={quote.status} />
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{formatDate(quote.createdAt)}</p>
                      <p className="text-base font-bold text-slate-800 mt-1">
                        {quote.status === "APPROVED" ? "Total: " : "Total estimado: "}{formatPrice(quote.total)}
                      </p>
                      {/* Nota del admin: si menciona "stock" es una alerta, sino nota normal */}
                      {quote.adminNotes && (() => {
                        const isStockAlert = quote.adminNotes.includes("stock");
                        return (
                          <div className={`mt-2 text-xs rounded-lg px-3 py-2 ${isStockAlert ? "text-orange-700 bg-orange-50 border border-orange-200" : "text-blue-700 bg-blue-50"}`}>
                            {isStockAlert ? "⚠️" : "💬"} <strong>{isStockAlert ? "Aviso de stock:" : "Nota del vendedor:"}</strong> {quote.adminNotes}
                          </div>
                        );
                      })()}
                    </div>
                    <button
                      onClick={() => toggleExpand(quote.id)}
                      className="px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex-shrink-0"
                    >
                      {isExpanded ? "Ocultar" : `Ver ${items.length} item${items.length !== 1 ? "s" : ""}`}
                    </button>
                  </div>

                  {/* Items (snapshot) */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 px-5 py-4 space-y-3">
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
                  )}

                  {/* Acciones según estado */}
                  {isActive && (
                    <div className="border-t border-slate-100 px-5 py-4 flex gap-3 flex-wrap">

                      {/* Pagar orden — solo si el admin aprobó la cotización y hay items con total > 0 */}
                      {quote.status === "QUOTE_APPROVED" && items.length > 0 && quote.total > 0 && (
                        <button
                          onClick={() => navigate(`/pagar-cotizacion/${quote.id}`)}
                          className="flex-1 px-4 py-2.5 bg-green-600 text-white font-bold text-sm rounded-xl hover:bg-green-700 transition-colors text-center"
                        >
                          💳 Pagar orden
                        </button>
                      )}

                      {/* Cancelar cotización */}
                      <button
                        onClick={() => { setCancelModal(quote.id); setCancelReason(""); }}
                        className="px-4 py-2.5 border border-red-200 text-red-600 font-semibold text-sm rounded-xl hover:bg-red-50 transition-colors"
                      >
                        Cancelar cotización
                      </button>

                    </div>
                  )}

                  {/* Info según estado */}
                  {quote.status === "PENDING" && (
                    <div className="px-5 pb-4">
                      <p className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
                        📬 Tu cotización está siendo revisada. Te notificaremos cuando el vendedor realice cambios o la apruebe.
                      </p>
                    </div>
                  )}
                  {quote.status === "CANCELLED" && quote.cancelReason && (
                    <div className="px-5 pb-4">
                      <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                        Motivo de cancelación: {quote.cancelReason}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

        </div>
      </div>

      {/* Modal cancelación */}
      {cancelModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-slate-800 text-lg">Cancelar cotización</h3>
            <p className="text-sm text-slate-500">
              ¿Estás seguro que querés cancelar esta cotización? Esta acción no se puede deshacer.
            </p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Motivo (opcional)
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Ej: Ya no necesito los productos, encontré otra opción..."
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                rows={3}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setCancelModal(null)}
                className="flex-1 px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50"
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

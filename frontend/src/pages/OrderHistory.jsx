import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useCart } from "../context/CartContext";
import { ordersApi, getImageUrl } from "../services/api";
import Navbar from "../components/Navbar";
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

export default function OrderHistory() {
  const { customer, loadingCustomer } = useCustomerAuth();
  const { repeatOrder, loading: cartLoading } = useCart();
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [repeatingId, setRepeatingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  // Redirigir solo cuando la sesión terminó de cargar desde localStorage
  useEffect(() => {
    if (loadingCustomer) return; // esperar a que termine de restaurar la sesión
    if (!customer) navigate("/login");
  }, [customer, loadingCustomer, navigate]);

  useEffect(() => {
    if (loadingCustomer || !customer) return;
    ordersApi.getMy()
      .then((res) => setOrders(res.data))
      .catch(() => toast.error("No se pudo cargar el historial"))
      .finally(() => setLoading(false));
  }, [customer]);

  const handleRepeat = async (order) => {
    // Si ningún producto del pedido sigue disponible, avisar y no redirigir
    const hasAvailable = order.items.some((i) => i.product?.active);
    if (!hasAvailable) {
      toast.error("Ninguno de los productos de este pedido está disponible actualmente.");
      return;
    }
    setRepeatingId(order.id);
    try {
      await repeatOrder(order.items);
      toast.success("Pedido cargado en el carrito");
      navigate("/checkout", { state: { openCart: true } });
    } catch {
      toast.error("Error al cargar el pedido");
    } finally {
      setRepeatingId(null);
    }
  };

  const toggleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="max-w-3xl mx-auto px-4">
          {/* Encabezado */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"
              aria-label="Volver"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Mis pedidos</h1>
              <p className="text-sm text-slate-500">Pedidos aprobados / pagados</p>
            </div>
          </div>

          {/* Tabs: Pedidos / Cotizaciones (solo mayoristas) */}
          {customer?.type === "MAYORISTA" && (
            <div className="flex border-b border-slate-200 mb-6">
              <span className="px-4 py-2 text-sm font-semibold text-blue-600 border-b-2 border-blue-600">
                Pedidos
              </span>
              <Link
                to="/cotizaciones"
                className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors"
              >
                Cotizaciones
              </Link>
            </div>
          )}

          {/* Estado cargando */}
          {loading && (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Sin pedidos */}
          {!loading && orders.length === 0 && (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">📦</div>
              <p className="text-slate-500 text-lg">Aún no tenés pedidos aprobados</p>
              <button
                onClick={() => navigate("/catalogo")}
                className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Ir al catálogo
              </button>
            </div>
          )}

          {/* Lista de pedidos */}
          <div className="space-y-4">
            {orders.map((order) => {
              const isExpanded = expandedId === order.id;
              const isRepeating = repeatingId === order.id;

              return (
                <div key={order.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  {/* Cabecera del pedido */}
                  <div className="p-5 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-700">Pedido #{order.id}</span>
                        <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
                          Aprobado
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{formatDate(order.createdAt)}</p>
                      <p className="text-base font-bold text-slate-800 mt-1">{formatPrice(order.total)}</p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Ver detalles */}
                      <button
                        onClick={() => toggleExpand(order.id)}
                        className="px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        {isExpanded ? "Ocultar" : `Ver ${order.items.length} item${order.items.length !== 1 ? "s" : ""}`}
                      </button>

                      {/* Repetir pedido */}
                      <button
                        onClick={() => handleRepeat(order)}
                        disabled={isRepeating || cartLoading}
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                      >
                        {isRepeating ? (
                          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        )}
                        Repetir pedido
                      </button>
                    </div>
                  </div>

                  {/* Detalle expandible de items */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 px-5 py-4 space-y-3">
                      {order.items.map((item) => {
                        const img = item.product?.images?.[0];
                        const discontinued = !item.product?.active;

                        return (
                          <div key={item.id} className="flex items-center gap-3">
                            {/* Imagen */}
                            <div className="w-12 h-12 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0">
                              {img ? (
                                <img
                                  src={getImageUrl(img)}
                                  alt={item.product?.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-300 text-xl">
                                  📦
                                </div>
                              )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${discontinued ? "text-slate-400 line-through" : "text-slate-800"}`}>
                                {item.product?.name || "Producto eliminado"}
                              </p>
                              {discontinued && (
                                <span className="text-xs text-red-400">Producto no disponible</span>
                              )}
                              <p className="text-xs text-slate-400">
                                {formatPrice(item.price)} × {item.quantity}
                              </p>
                            </div>

                            {/* Subtotal */}
                            <p className="text-sm font-semibold text-slate-700 flex-shrink-0">
                              {formatPrice(item.price * item.quantity)}
                            </p>
                          </div>
                        );
                      })}

                      {/* Nota si hay productos discontinuados */}
                      {order.items.some((i) => !i.product?.active) && (
                        <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-2">
                          ⚠️ Algunos productos ya no están disponibles y no se agregarán al repetir el pedido.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useNotifications } from "../context/NotificationContext";
import { ordersApi, productsApi, getImageUrl } from "../services/api";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import toast from "react-hot-toast";
import { formatPrice as formatPriceWithCurrency } from "../utils/formatPrice";

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatPrice(price) {
  return formatPriceWithCurrency(price, "ARS");
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
    // PAYMENT_REVIEW faltaba en este mapa. Es el estado en el que queda la cotización apenas el
    // cliente confirma cómo va a pagar, así que lo ve seguido — y como el fallback de abajo usa
    // `label: status`, le aparecía el nombre crudo del enum ("PAYMENT_REVIEW") como si fuera texto.
    PAYMENT_REVIEW: {
      label: "Pago en revisión",
      badgeCls: "bg-blue-100 text-blue-700 font-bold",
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

  // ── Modificar una cotización ──────────────────────────────────────────────
  // editing = { quoteId, wasApproved, items: [...] }. Los ítems son una copia editable de los que
  // ve el cliente; al guardar se manda la lista completa y el backend recalcula precios y stock.
  const [editing, setEditing]   = useState(null);
  const [savingEdit, setSaving] = useState(false);
  const [addSearch, setAddSearch]   = useState("");
  const [addResults, setAddResults] = useState([]);
  const [searchingAdd, setSearching] = useState(false);

  const EDITABLE = ["PENDING", "QUOTE_APPROVED"];

  const startEdit = (quote) => {
    setExpandedId(quote.id);
    setEditing({
      quoteId: quote.id,
      wasApproved: quote.status === "QUOTE_APPROVED",
      items: (quote.items || []).map((i, idx) => ({
        key:       `old-${i.id ?? idx}`,
        id:        i.id,
        productId: i.productId,
        name:      i.name,
        image:     i.image,
        price:     i.price,
        listPrice: i.listPrice ?? null,
        currency:  i.currency,
        quantity:  i.quantity,
        isNew:     false,
      })),
    });
    setAddSearch("");
    setAddResults([]);
  };

  const cancelEdit = () => { setEditing(null); setAddSearch(""); setAddResults([]); };

  const changeQty = (key, delta) => setEditing((e) => ({
    ...e,
    items: e.items.map((i) => (i.key === key ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i)),
  }));

  const removeLine = (key) => setEditing((e) => ({ ...e, items: e.items.filter((i) => i.key !== key) }));

  // Precio orientativo de un producto del catálogo según el tipo de cliente. El precio final lo
  // calcula el backend al guardar (y el vendedor lo puede ajustar al revisar la cotización).
  const precioOrientativo = (p) => (customer?.type === "MAYORISTA"
    ? (p.wholesaleSalePrice ?? p.wholesalePrice ?? p.salePrice ?? p.price)
    : (p.salePrice ?? p.price));

  const searchToAdd = async (q) => {
    setAddSearch(q);
    if (q.trim().length < 2) { setAddResults([]); return; }
    setSearching(true);
    try {
      const res = await productsApi.getAll({ search: q.trim(), limit: 6, active: true, visibleFor: customer?.type || "MINORISTA" });
      setAddResults(res.data.products || res.data || []);
    } catch { setAddResults([]); } finally { setSearching(false); }
  };

  const addProduct = (p) => {
    setEditing((e) => {
      if (e.items.some((i) => i.productId === p.id)) {
        toast.error("Ese producto ya está en la cotización: cambiale la cantidad");
        return e;
      }
      return {
        ...e,
        items: [...e.items, {
          key:       `new-${p.id}`,
          productId: p.id,
          name:      p.name,
          image:     p.images?.[0] || null,
          price:     precioOrientativo(p),
          currency:  p.currency || "ARS",
          quantity:  1,
          isNew:     true,
        }],
      };
    });
    setAddSearch("");
    setAddResults([]);
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (editing.items.length === 0) {
      toast.error("La cotización tiene que quedar con al menos un producto");
      return;
    }
    const ok = window.confirm(
      editing.wasApproved
        ? "Al guardar los cambios, la cotización vuelve a revisión: la tienda confirma precios y stock y te avisa cuando quede aprobada de nuevo.\n\nHasta entonces no vas a poder pagarla.\n\n¿Guardamos los cambios?"
        : "Al guardar, la tienda vuelve a revisar tu cotización con los cambios.\n\n¿Guardamos los cambios?"
    );
    if (!ok) return;

    setSaving(true);
    try {
      await ordersApi.updateMyQuoteItems(
        editing.quoteId,
        editing.items.map((i) => (i.isNew ? { productId: i.productId, quantity: i.quantity } : { id: i.id, quantity: i.quantity }))
      );
      toast.success("Listo: tu cotización volvió a revisión");
      cancelEdit();
      loadQuotes();
      fetchNotifications();
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo modificar la cotización");
    } finally {
      setSaving(false);
    }
  };

  // Modal de cancelación
  const [cancelModal, setCancelModal] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling]   = useState(false);

  useEffect(() => {
    if (loadingCustomer) return;
    if (!customer) { navigate("/login"); return; }
    // Antes: if (customer.type !== "MAYORISTA") { navigate("/"); return; }
    // Comentado: las cotizaciones eran solo de mayoristas, pero ahora el vendedor le puede armar una
    // a cualquier cliente desde el panel. El backend ya devuelve solo las del cliente logueado.
  }, [customer, loadingCustomer, navigate]);

  const loadQuotes = () => {
    if (loadingCustomer || !customer) return;
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
              // Una cotización puede tener ítems en ARS y USD mezclados (sin conversión automática) —
              // si hay alguno en USD, el total único en pesos sería incorrecto: se separa por moneda.
              const hasUsd     = items.some((i) => i.currency === "USD");
              const totalArs   = items.filter((i) => (i.currency || "ARS") !== "USD").reduce((s, i) => s + i.price * i.quantity, 0);
              const totalUsd   = items.filter((i) => i.currency === "USD").reduce((s, i) => s + i.price * i.quantity, 0);
              const isActive   =
                quote.status !== "CANCELLED" &&
                quote.status !== "REJECTED" &&
                quote.status !== "APPROVED";
              const { label: statusLabel, badgeCls, cardBorder } = getQuoteDisplay(quote.status);
              const isEditing  = editing?.quoteId === quote.id;
              const puedeEditar = EDITABLE.includes(quote.status);
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
                      {hasUsd ? (
                        <div className={cardBorder ? "text-[#006b2c]" : "text-[#0b1c30]"}>
                          <p className="text-xs font-semibold uppercase tracking-wide text-[#565e74] mb-1">
                            {quote.status === "APPROVED" ? "Total" : "Total estimado"} (por moneda)
                          </p>
                          {totalArs > 0 && (
                            <p className="text-lg font-bold">{formatPrice(totalArs)}</p>
                          )}
                          <p className="text-lg font-bold">{formatPriceWithCurrency(totalUsd, "USD")}</p>
                        </div>
                      ) : (
                        <p className="text-2xl font-bold text-[#0b1c30]">
                          {quote.status === "APPROVED" ? "Total: " : "Total estimado: "}
                          <span className={cardBorder ? "text-[#006b2c]" : ""}>
                            {formatPrice(quote.total)}
                          </span>
                        </p>
                      )}
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

                    {/* Acciones (se ocultan mientras se está modificando la cotización) */}
                    {isActive && !isEditing && (
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

                        {/* Modificar: cambiar cantidades, sacar o agregar productos. Al guardar, la
                            cotización vuelve a revisión de la tienda. */}
                        {puedeEditar && (
                          <button
                            onClick={() => startEdit(quote)}
                            className="flex items-center justify-center gap-2 px-6 py-3 border-2 border-[#00873a] text-[#006b2c] font-semibold rounded-lg hover:bg-[#00873a]/5 transition-all"
                          >
                            <span className="material-symbols-outlined text-[20px]">edit</span>
                            Modificar
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

                  {/* ── Modificando la cotización ── */}
                  {isEditing && (
                    <div className="border-t border-[#bdcaba]/30 px-6 py-5 bg-[#f8f9ff] space-y-4">
                      <div className="flex items-start gap-2 bg-[#eff4ff] rounded-lg p-3">
                        <span className="material-symbols-outlined text-[#00873a] text-[20px] flex-shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>info</span>
                        <p className="text-sm text-[#3e4a3d] leading-relaxed">
                          Cambiá las cantidades, sacá lo que no quieras o agregá más productos. Al guardar, la tienda
                          revisa la cotización con los cambios y te avisa cuando esté aprobada.
                        </p>
                      </div>

                      {/* Líneas */}
                      {editing.items.map((it) => (
                        <div key={it.key} className="bg-white rounded-lg p-3 border border-[#bdcaba]/40">
                          {/* Renglón 1: foto + nombre + sacar */}
                          <div className="flex items-start gap-3">
                            <div className="w-12 h-12 rounded-lg bg-[#dce9ff] overflow-hidden flex-shrink-0">
                              {it.image
                                ? <img src={getImageUrl(it.image)} alt={it.name} className="w-full h-full object-cover" />
                                : <div className="w-full h-full flex items-center justify-center text-xl">📦</div>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-[#0b1c30] leading-snug line-clamp-2">{it.name}</p>
                              <p className="text-xs text-[#565e74] mt-0.5">
                                {it.listPrice > it.price && (
                                  <span className="line-through mr-1 opacity-60">{formatPriceWithCurrency(it.listPrice, it.currency)}</span>
                                )}
                                {formatPriceWithCurrency(it.price, it.currency)} c/u
                                {it.isNew && <span className="ml-1 text-[#00873a] font-semibold">· precio a confirmar</span>}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeLine(it.key)}
                              aria-label={`Sacar ${it.name}`}
                              className="w-9 h-9 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 transition-colors flex-shrink-0 -mt-1 -mr-1"
                            >
                              <span className="material-symbols-outlined text-[20px]">delete</span>
                            </button>
                          </div>
                          {/* Renglón 2: cantidad + subtotal de la línea */}
                          <div className="flex items-center justify-between gap-3 mt-2 pl-[60px]">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => changeQty(it.key, -1)}
                                disabled={it.quantity <= 1}
                                aria-label="Quitar una unidad"
                                className="w-9 h-9 rounded-lg border border-[#bdcaba] text-[#0b1c30] text-lg font-bold disabled:opacity-40 hover:bg-[#dce9ff]/40 transition-colors"
                              >−</button>
                              <span className="w-9 text-center text-sm font-semibold text-[#0b1c30]">{it.quantity}</span>
                              <button
                                type="button"
                                onClick={() => changeQty(it.key, 1)}
                                aria-label="Agregar una unidad"
                                className="w-9 h-9 rounded-lg border border-[#bdcaba] text-[#0b1c30] text-lg font-bold hover:bg-[#dce9ff]/40 transition-colors"
                              >+</button>
                            </div>
                            <p className="text-sm font-semibold text-[#0b1c30]">
                              {formatPriceWithCurrency(it.price * it.quantity, it.currency)}
                            </p>
                          </div>
                        </div>
                      ))}

                      {editing.items.length === 0 && (
                        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                          Sacaste todos los productos. Agregá alguno, o cancelá la cotización desde el botón de arriba.
                        </p>
                      )}

                      {/* Agregar un producto */}
                      <div className="relative">
                        <input
                          value={addSearch}
                          onChange={(e) => searchToAdd(e.target.value)}
                          placeholder="Agregar un producto: escribí su nombre..."
                          className="w-full px-4 py-2.5 rounded-lg border border-[#bdcaba] text-sm focus:outline-none focus:ring-2 focus:ring-[#00873a]/40"
                        />
                        {(searchingAdd || addResults.length > 0) && addSearch.trim().length >= 2 && (
                          <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#bdcaba] rounded-lg shadow-lg max-h-64 overflow-y-auto">
                            {searchingAdd && <p className="px-4 py-3 text-sm text-[#565e74]">Buscando...</p>}
                            {!searchingAdd && addResults.length === 0 && (
                              <p className="px-4 py-3 text-sm text-[#565e74]">No encontramos productos con ese nombre</p>
                            )}
                            {addResults.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => addProduct(p)}
                                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-[#dce9ff]/40 transition-colors text-left"
                              >
                                <div className="w-10 h-10 rounded-lg bg-[#dce9ff] overflow-hidden flex-shrink-0">
                                  {p.images?.[0]
                                    ? <img src={getImageUrl(p.images[0])} alt="" className="w-full h-full object-cover" />
                                    : <div className="w-full h-full flex items-center justify-center">📦</div>}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-[#0b1c30] truncate">{p.name}</p>
                                  <p className="text-xs text-[#565e74]">{formatPriceWithCurrency(precioOrientativo(p), p.currency)}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Guardar / cancelar */}
                      <div className="flex flex-col sm:flex-row gap-3 pt-1">
                        <button
                          type="button"
                          onClick={saveEdit}
                          disabled={savingEdit || editing.items.length === 0}
                          className="flex-1 px-6 py-3 bg-[#00873a] text-white font-bold rounded-lg hover:brightness-110 transition-all disabled:opacity-50"
                        >
                          {savingEdit ? "Guardando..." : "Guardar cambios"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={savingEdit}
                          className="px-6 py-3 border border-[#bdcaba] text-[#0b1c30] font-semibold rounded-lg hover:bg-white transition-all"
                        >
                          Volver sin cambios
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Items (expandibles) */}
                  {isExpanded && !isEditing && (
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
                              {/* Variante elegida por el cliente — no mostrar si la asignó el admin */}
                              {item.variantLabel && !item.variantByAdmin && (
                                <div className="flex flex-wrap gap-1 mt-0.5">
                                  {item.variantLabel.split(" / ").map((v, vi) => (
                                    <span key={vi} className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#dbe1ff] text-[#00174b]">
                                      {v}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <p className="text-xs text-[#565e74]">
                                {/* listPrice: precio antes del descuento que le hizo la tienda a este
                                    producto. Se muestra tachado al lado del precio final. */}
                                {item.listPrice > item.price && (
                                  <span className="line-through mr-1 opacity-60">{formatPriceWithCurrency(item.listPrice, item.currency)}</span>
                                )}
                                <span className={item.listPrice > item.price ? "text-[#006b2c] font-semibold" : ""}>
                                  {formatPriceWithCurrency(item.price, item.currency)}
                                </span> × {item.quantity}
                              </p>
                            </div>
                            <p className="text-sm font-semibold text-[#0b1c30] flex-shrink-0">
                              {formatPriceWithCurrency(item.price * item.quantity, item.currency)}
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

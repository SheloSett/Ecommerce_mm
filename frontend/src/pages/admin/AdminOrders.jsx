import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import AdminLayout from "../../components/AdminLayout";
import { ordersApi, productsApi, getImageUrl } from "../../services/api";
import toast from "react-hot-toast";

const STATUS_CONFIG = {
  PENDING:        { label: "Pendiente",           color: "bg-yellow-100 text-yellow-800", icon: "⏳" },
  QUOTE_APPROVED: { label: "Aprobada (sin pagar)", color: "bg-teal-100 text-teal-800",    icon: "💳" },
  APPROVED:       { label: "Abonada",             color: "bg-green-100 text-green-800",   icon: "✅" },
  REJECTED:       { label: "Rechazada",           color: "bg-red-100 text-red-800",       icon: "❌" },
  CANCELLED:      { label: "Cancelada",           color: "bg-slate-100 text-slate-600",   icon: "🚫" },
};

export default function AdminOrders() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab") || "";
  const isCotizaciones = tab === "cotizaciones";

  const [orders, setOrders] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState(null);
  // IDs de órdenes seleccionadas para borrado masivo
  const [checkedIds, setCheckedIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Estado para edición inline de items en cotizaciones
  const [editingQty, setEditingQty]     = useState({}); // { [itemId]: string }
  const [editingPrice, setEditingPrice] = useState({}); // { [itemId]: string }
  const [savingItem, setSavingItem]     = useState(null);
  // dirtyOrders: set de orderId que tuvieron cambios sin publicar al cliente
  const [dirtyOrders, setDirtyOrders] = useState(new Set());
  const [publishing, setPublishing]   = useState(null); // orderId que se está publicando
  const [noteModal, setNoteModal]     = useState(null); // { orderId, action: 'publish'|'approve' }
  const [noteText, setNoteText]       = useState("");
  // expandedOrders: set de orderId con el detalle abierto
  const [expandedOrders, setExpandedOrders] = useState(new Set());
  // Modal de confirmación para actualizar precio del producto en la BD
  const [priceUpdateConfirm, setPriceUpdateConfirm] = useState(null); // { productId, productName, newPrice }
  const [priceUpdateTarget, setPriceUpdateTarget] = useState("minorista"); // "minorista" | "mayorista" | "ambos"
  const [updatingProductPrice, setUpdatingProductPrice] = useState(false);

  // ── Modal Nueva Venta Manual ─────────────────────────────────────────────────
  const [manualModal, setManualModal] = useState(false);
  const [allProducts, setAllProducts] = useState([]);  // cache de productos para el selector
  const [manualForm, setManualForm] = useState({
    customerName: "", customerEmail: "", customerPhone: "",
    paymentMethod: "EFECTIVO", status: "APPROVED", notes: "",
    items: [{ productId: "", productName: "", price: "", quantity: 1 }],
  });
  const [productSearch, setProductSearch] = useState({}); // { [idx]: string }
  const [savingManual, setSavingManual] = useState(false);

  // Carga productos al abrir el modal (solo la primera vez)
  const openManualModal = async () => {
    setManualModal(true);
    if (allProducts.length === 0) {
      try {
        const res = await productsApi.getAllAdmin({ limit: 500, active: true });
        setAllProducts(res.data.products || res.data);
      } catch { /* silencioso */ }
    }
  };

  const addManualItem = () =>
    setManualForm((p) => ({ ...p, items: [...p.items, { productId: "", productName: "", price: "", quantity: 1 }] }));

  const removeManualItem = (idx) =>
    setManualForm((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));

  const setManualItem = (idx, field, value) =>
    setManualForm((p) => {
      const items = [...p.items];
      items[idx] = { ...items[idx], [field]: value };
      return { ...p, items };
    });

  const selectProduct = (idx, product) => {
    setManualItem(idx, "productId", product.id);
    setManualItem(idx, "productName", product.name);
    setManualItem(idx, "price", product.price);
    setProductSearch((p) => ({ ...p, [idx]: "" }));
  };

  const manualTotal = manualForm.items.reduce(
    (sum, it) => sum + (parseFloat(it.price) || 0) * (parseInt(it.quantity) || 0), 0
  );

  const handleSaveManual = async (e) => {
    e.preventDefault();
    if (manualForm.items.some((it) => !it.productId)) {
      toast.error("Seleccioná un producto en cada línea");
      return;
    }
    setSavingManual(true);
    try {
      await ordersApi.createManual({
        customerName:  manualForm.customerName,
        customerEmail: manualForm.customerEmail,
        customerPhone: manualForm.customerPhone || undefined,
        paymentMethod: manualForm.paymentMethod,
        status:        manualForm.status,
        notes:         manualForm.notes || undefined,
        items: manualForm.items.map((it) => ({
          productId: it.productId,
          quantity:  parseInt(it.quantity),
          price:     parseFloat(it.price),
        })),
      });
      toast.success("Venta registrada correctamente");
      setManualModal(false);
      setManualForm({
        customerName: "", customerEmail: "", customerPhone: "",
        paymentMethod: "EFECTIVO", status: "APPROVED", notes: "",
        items: [{ productId: "", productName: "", price: "", quantity: 1 }],
      });
      fetchOrders();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al guardar la venta");
    } finally {
      setSavingManual(false);
    }
  };

  const toggleExpanded = (orderId) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const fetchOrders = () => {
    setLoading(true);
    const params = { page, limit: 20 };
    if (isCotizaciones) {
      params.paymentMethod = "COTIZACION";
    } else {
      if (filterStatus) params.status = filterStatus;
    }

    ordersApi
      .getAll(params)
      .then((res) => {
        setOrders(res.data.orders);
        setPagination(res.data.pagination);
        setCheckedIds([]);
        setEditingQty({});
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchOrders();
  }, [page, filterStatus, isCotizaciones]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guardar cantidad y/o precio editado de un item (cotizaciones)
  const handleSaveQty = async (orderId, itemId) => {
    const qty = parseInt(editingQty[itemId]);
    if (!qty || qty < 1) { toast.error("La cantidad debe ser al menos 1"); return; }
    const priceVal = editingPrice[itemId] !== undefined ? parseFloat(editingPrice[itemId]) : undefined;
    if (priceVal !== undefined && (isNaN(priceVal) || priceVal <= 0)) {
      toast.error("El precio debe ser mayor a 0");
      return;
    }
    setSavingItem(itemId);
    try {
      const res = await ordersApi.updateItem(orderId, itemId, qty, priceVal);
      setOrders((prev) => prev.map((o) => o.id === orderId ? res.data : o));
      setEditingQty((prev) => { const n = { ...prev }; delete n[itemId]; return n; });
      setEditingPrice((prev) => { const n = { ...prev }; delete n[itemId]; return n; });
      // Marcar la orden como "tiene cambios sin publicar"
      setDirtyOrders((prev) => new Set(prev).add(orderId));

      // Si se cambió el precio, preguntar si también se quiere actualizar el producto global
      if (priceVal !== undefined) {
        const updatedOrder = res.data;
        const updatedItem = updatedOrder.items?.find((i) => i.id === itemId);
        if (updatedItem?.productId) {
          setPriceUpdateTarget("minorista"); // reset selección cada vez que abre el modal
          setPriceUpdateConfirm({
            productId:   updatedItem.productId,
            productName: updatedItem.product?.name || "el producto",
            newPrice:    priceVal,
          });
        }
      }
    } catch {
      toast.error("Error al actualizar");
    } finally {
      setSavingItem(null);
    }
  };

  // Actualizar el precio global del producto en la BD
  // priceUpdateTarget determina qué campo(s) actualizar: "minorista" | "mayorista" | "ambos"
  const handleUpdateProductPrice = async () => {
    if (!priceUpdateConfirm) return;
    setUpdatingProductPrice(true);
    try {
      const fd = new FormData();
      if (priceUpdateTarget === "minorista" || priceUpdateTarget === "ambos") {
        fd.append("price", priceUpdateConfirm.newPrice);
      }
      if (priceUpdateTarget === "mayorista" || priceUpdateTarget === "ambos") {
        fd.append("wholesalePrice", priceUpdateConfirm.newPrice);
      }
      await productsApi.update(priceUpdateConfirm.productId, fd);
      toast.success(`Precio de "${priceUpdateConfirm.productName}" actualizado`);
    } catch {
      toast.error("Error al actualizar el precio del producto");
    } finally {
      setUpdatingProductPrice(false);
      setPriceUpdateConfirm(null);
    }
  };

  // Eliminar un item de una cotización
  const handleDeleteItem = async (orderId, itemId, itemName) => {
    if (!confirm(`¿Eliminar "${itemName}" de la cotización?`)) return;
    setSavingItem(itemId);
    try {
      const res = await ordersApi.deleteItem(orderId, itemId);
      setOrders((prev) => prev.map((o) => o.id === orderId ? res.data : o));
      setDirtyOrders((prev) => new Set(prev).add(orderId));
    } catch {
      toast.error("Error al eliminar");
    } finally {
      setSavingItem(null);
    }
  };

  // Abrir modal de nota y luego publicar o aprobar
  const openNoteModal = (orderId, action) => {
    setNoteModal({ orderId, action });
    setNoteText("");
  };

  const handleConfirmAction = async () => {
    if (!noteModal) return;
    const { orderId, action } = noteModal;
    setPublishing(orderId);
    try {
      if (action === "publish") {
        await ordersApi.publishCotizacion(orderId, noteText);
        toast.success("Cambios publicados — el cliente fue notificado");
        setDirtyOrders((prev) => { const n = new Set(prev); n.delete(orderId); return n; });
      } else {
        await ordersApi.approveCotizacion(orderId, noteText);
        toast.success("Cotización aprobada — el cliente fue notificado");
      }
      fetchOrders();
    } catch {
      toast.error("Error al procesar la acción");
    } finally {
      setPublishing(null);
      setNoteModal(null);
      setNoteText("");
    }
  };

  // Checkbox individual
  const toggleCheck = (id) => {
    setCheckedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Checkbox "seleccionar todos" de la página actual
  const allChecked = orders.length > 0 && orders.every((o) => checkedIds.includes(o.id));
  const someChecked = checkedIds.length > 0 && !allChecked;

  const toggleAll = () => {
    if (allChecked) {
      setCheckedIds([]);
    } else {
      setCheckedIds(orders.map((o) => o.id));
    }
  };

  const handleStatusChange = async (orderId, newStatus) => {
    try {
      await ordersApi.updateStatus(orderId, newStatus);
      toast.success("Estado actualizado");
      fetchOrders();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder((prev) => ({ ...prev, status: newStatus }));
      }
    } catch (err) {
      toast.error("Error al actualizar el estado");
    }
  };

  const handleDelete = async (order) => {
    if (!confirm(`¿Eliminar la orden #${order.id} de ${order.customerName}? Esta acción no se puede deshacer.`)) return;
    try {
      await ordersApi.delete(order.id);
      toast.success(`Orden #${order.id} eliminada`);
      if (selectedOrder?.id === order.id) setSelectedOrder(null);
      fetchOrders();
    } catch (err) {
      toast.error("Error al eliminar la orden");
    }
  };

  // Borrado masivo: elimina todas las órdenes seleccionadas en paralelo
  const handleBulkDelete = async () => {
    if (!confirm(`¿Eliminar las ${checkedIds.length} órdenes seleccionadas? Esta acción no se puede deshacer.`)) return;
    setBulkDeleting(true);
    try {
      await Promise.all(checkedIds.map((id) => ordersApi.delete(id)));
      toast.success(`${checkedIds.length} órdenes eliminadas`);
      if (checkedIds.includes(selectedOrder?.id)) setSelectedOrder(null);
      fetchOrders();
    } catch (err) {
      toast.error("Error al eliminar algunas órdenes");
      fetchOrders();
    } finally {
      setBulkDeleting(false);
    }
  };

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);

  const formatDate = (dateStr) =>
    new Date(dateStr).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  // ── Vista de cotizaciones ────────────────────────────────────────────────────
  if (isCotizaciones) {
    return (
      <AdminLayout title="Cotizaciones">
        <div className="space-y-4">
          {loading && (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          )}

          {!loading && orders.length === 0 && (
            <div className="text-center py-16 text-slate-400">
              <p className="text-4xl mb-3">📋</p>
              <p className="text-lg">No hay cotizaciones pendientes</p>
            </div>
          )}

          {orders.map((order) => {
            const isExpanded = expandedOrders.has(order.id);
            return (
              <div key={order.id} className="card overflow-hidden">
                {/* ── Cabecera compacta (siempre visible) ── */}
                <div className="flex items-center gap-3 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-800">Cotización #{order.id}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_CONFIG[order.status]?.color}`}>
                        {STATUS_CONFIG[order.status]?.icon} {STATUS_CONFIG[order.status]?.label}
                      </span>
                      {dirtyOrders.has(order.id) && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-semibold">
                          ● Cambios sin publicar
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 mt-0.5 truncate">
                      {order.customerName} · {order.customerEmail}
                    </p>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-slate-400">Total estimado</p>
                    <p className="font-bold text-slate-900">{formatPrice(order.total)}</p>
                  </div>

                  <button
                    onClick={() => toggleExpanded(order.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors flex-shrink-0"
                  >
                    {isExpanded ? "Ocultar" : "Ver detalles"}
                    <svg
                      className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                {/* ── Detalle expandible ── */}
                {isExpanded && (
                  <div className="border-t border-slate-100 px-5 pb-5 pt-4 space-y-4">
                    {/* Info cliente */}
                    <div className="text-xs text-slate-400 flex gap-4 flex-wrap">
                      {order.customerPhone && <span>📞 {order.customerPhone}</span>}
                      <span>🕐 {formatDate(order.createdAt)}</span>
                    </div>

                    {/* Items editables */}
                    <div className="space-y-2">
                      {order.items?.map((item) => {
                        const img = item.product?.images?.[0];
                        const isEditing = editingQty[item.id] !== undefined;
                        const isSaving  = savingItem === item.id;

                        const isEditingPrice = editingPrice[item.id] !== undefined;
                        const displayPrice = isEditingPrice ? parseFloat(editingPrice[item.id]) || item.price : item.price;

                        return (
                          <div key={item.id} className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
                            {/* Imagen */}
                            <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-200 flex-shrink-0">
                              {img
                                ? <img src={getImageUrl(img)} alt="" className="w-full h-full object-cover" />
                                : <div className="w-full h-full flex items-center justify-center text-sm">📦</div>
                              }
                            </div>

                            {/* Nombre y precio estático */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate">{item.product?.name || "Producto"}</p>
                              <p className="text-xs text-slate-400">{formatPrice(displayPrice)} c/u</p>
                            </div>

                            {/* Control de cantidad */}
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button
                                onClick={() => setEditingQty((p) => ({ ...p, [item.id]: String((isEditing ? parseInt(p[item.id]) : item.quantity) - 1) }))}
                                disabled={isSaving || (isEditing ? parseInt(editingQty[item.id]) <= 1 : item.quantity <= 1)}
                                className="w-7 h-7 rounded-lg bg-slate-200 hover:bg-slate-300 font-bold text-slate-700 disabled:opacity-40 transition-colors"
                              >−</button>
                              <input
                                type="number"
                                min="1"
                                value={isEditing ? editingQty[item.id] : item.quantity}
                                onChange={(e) => setEditingQty((p) => ({ ...p, [item.id]: e.target.value }))}
                                className="w-12 text-center text-sm font-semibold border border-slate-300 rounded-lg py-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
                              />
                              <button
                                onClick={() => setEditingQty((p) => ({ ...p, [item.id]: String((isEditing ? parseInt(p[item.id]) : item.quantity) + 1) }))}
                                disabled={isSaving}
                                className="w-7 h-7 rounded-lg bg-slate-200 hover:bg-slate-300 font-bold text-slate-700 disabled:opacity-40 transition-colors"
                              >+</button>
                            </div>

                            {/* Input de precio unitario — siempre visible */}
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span className="text-xs text-slate-400">$</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={isEditingPrice ? editingPrice[item.id] : item.price}
                                onChange={(e) => {
                                  setEditingPrice((p) => ({ ...p, [item.id]: e.target.value }));
                                  // Inicializar cantidad si aún no está en edición
                                  if (editingQty[item.id] === undefined) {
                                    setEditingQty((p) => ({ ...p, [item.id]: String(item.quantity) }));
                                  }
                                }}
                                className="w-24 text-center text-sm border border-slate-300 rounded-lg py-1 px-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                title="Precio unitario para esta cotización"
                              />
                            </div>

                            {/* Subtotal */}
                            <span className="text-sm font-bold text-slate-800 w-20 text-right flex-shrink-0">
                              {formatPrice(displayPrice * (isEditing ? (parseInt(editingQty[item.id]) || 0) : item.quantity))}
                            </span>

                            {/* Guardar / Cancelar edición */}
                            {isEditing && (
                              <>
                                <button
                                  onClick={() => handleSaveQty(order.id, item.id)}
                                  disabled={isSaving}
                                  className="px-2.5 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-60 font-semibold"
                                >
                                  {isSaving ? "..." : "OK"}
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingQty((p) => { const n = { ...p }; delete n[item.id]; return n; });
                                    setEditingPrice((p) => { const n = { ...p }; delete n[item.id]; return n; });
                                  }}
                                  className="text-slate-400 hover:text-slate-600 text-xs"
                                >✕</button>
                              </>
                            )}

                            {/* Eliminar item */}
                            <button
                              onClick={() => handleDeleteItem(order.id, item.id, item.product?.name || "Producto")}
                              disabled={isSaving}
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                              title="Eliminar item"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Acciones */}
                    <div className="flex gap-2 flex-wrap items-center pt-2 border-t border-slate-100">
                      {/* Actualizar cotización — solo si hay cambios sin publicar */}
                      {dirtyOrders.has(order.id) && order.status !== "CANCELLED" && (
                        <button
                          onClick={() => openNoteModal(order.id, "publish")}
                          disabled={publishing === order.id}
                          className="px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
                        >
                          {publishing === order.id ? "Publicando..." : "📤 Actualizar cotización"}
                        </button>
                      )}

                      {/* Aprobar cotización — no mostrar si ya está aprobada o cancelada */}
                      {order.status !== "QUOTE_APPROVED" && order.status !== "APPROVED" && order.status !== "CANCELLED" && (
                        <button
                          onClick={() => openNoteModal(order.id, "approve")}
                          disabled={publishing === order.id}
                          className="px-4 py-1.5 rounded-lg text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 transition-colors"
                        >
                          ✅ Aprobar cotización
                        </button>
                      )}

                      {/* Eliminar */}
                      <button
                        onClick={() => handleDelete(order)}
                        className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100"
                      >
                        🗑 Eliminar cotización
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Modal de nota al publicar/aprobar */}
        {noteModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <h3 className="font-bold text-slate-800 text-lg">
                {noteModal.action === "approve" ? "✅ Aprobar cotización" : "📤 Publicar cambios al cliente"}
              </h3>
              <p className="text-sm text-slate-500">
                {noteModal.action === "approve"
                  ? "El cliente recibirá una notificación y podrá proceder con el pago."
                  : "El cliente recibirá una notificación con los cambios en su cotización."}
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Nota para el cliente (opcional)
                </label>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Ej: Ajustamos las cantidades según disponibilidad de stock..."
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                  rows={3}
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setNoteModal(null); setNoteText(""); }}
                  className="flex-1 px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmAction}
                  className={`flex-1 px-4 py-2 rounded-xl text-sm font-bold text-white ${
                    noteModal.action === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {noteModal.action === "approve" ? "Aprobar y notificar" : "Publicar y notificar"}
                </button>
              </div>
            </div>
          </div>
        )}
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Órdenes">
      <div className="space-y-6">
        {/* Filtros + botón nueva venta */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={openManualModal}
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors whitespace-nowrap"
          >
            + Nueva venta
          </button>
          <div className="w-px h-6 bg-slate-200 mx-1" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {[{ value: "", label: "Todas" }, ...Object.entries(STATUS_CONFIG).map(([v, c]) => ({ value: v, label: c.label }))].map(
            ({ value, label }) => (
              <button
                key={value}
                onClick={() => { setFilterStatus(value); setPage(1); }}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  filterStatus === value
                    ? "bg-blue-600 text-white"
                    : "bg-white border border-slate-200 text-slate-700 hover:border-blue-400"
                }`}
              >
                {label}
              </button>
            )
          )}
        </div>

        {/* Barra de acciones masivas (aparece solo si hay algo seleccionado) */}
        {checkedIds.length > 0 && (
          <div className="flex items-center gap-4 bg-red-50 border border-red-200 rounded-xl px-5 py-3">
            <span className="text-sm font-semibold text-red-700">
              {checkedIds.length} orden{checkedIds.length > 1 ? "es" : ""} seleccionada{checkedIds.length > 1 ? "s" : ""}
            </span>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="btn-danger text-sm py-1.5 px-4 ml-auto"
            >
              {bulkDeleting ? "Eliminando..." : `Eliminar ${checkedIds.length} seleccionadas`}
            </button>
            <button
              onClick={() => setCheckedIds([])}
              className="text-sm text-slate-500 hover:text-slate-800"
            >
              Cancelar
            </button>
          </div>
        )}

        {/* Tabla */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs uppercase tracking-wide border-b border-slate-200 bg-slate-50">
                  {/* Checkbox seleccionar todos */}
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => { if (el) el.indeterminate = someChecked; }}
                      onChange={toggleAll}
                      className="w-4 h-4 accent-blue-600 cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                      No hay órdenes con este filtro.
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => {
                    const status = STATUS_CONFIG[order.status];
                    const isChecked = checkedIds.includes(order.id);
                    return (
                      <tr
                        key={order.id}
                        className={`border-b border-slate-50 transition-colors ${isChecked ? "bg-red-50" : "hover:bg-slate-50"}`}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleCheck(order.id)}
                            className="w-4 h-4 accent-blue-600 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-slate-600">#{order.id}</td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-800">{order.customerName}</p>
                          <p className="text-xs text-slate-400">{order.customerEmail}</p>
                        </td>
                        <td className="px-4 py-3 font-semibold">{formatPrice(order.total)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${status.color}`}>
                            {status.icon} {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(order.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => setSelectedOrder(order)}
                              className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-semibold"
                            >
                              Ver detalle
                            </button>
                            <button
                              onClick={() => handleDelete(order)}
                              className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 text-xs font-semibold"
                            >
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Paginación */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex justify-center gap-2">
            {[...Array(pagination.totalPages)].map((_, i) => (
              <button
                key={i}
                onClick={() => setPage(i + 1)}
                className={`w-9 h-9 rounded-lg font-semibold text-sm ${
                  page === i + 1
                    ? "bg-blue-600 text-white"
                    : "bg-white border border-slate-200 text-slate-700 hover:border-blue-400"
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Modal detalle de orden */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-bold text-slate-800">Orden #{selectedOrder.id}</h2>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Cliente */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-1 text-sm">
                <p><span className="font-medium text-slate-600">Cliente:</span> {selectedOrder.customerName}</p>
                <p><span className="font-medium text-slate-600">Email:</span> {selectedOrder.customerEmail}</p>
                {selectedOrder.customerPhone && (
                  <p><span className="font-medium text-slate-600">Teléfono:</span> {selectedOrder.customerPhone}</p>
                )}
                <p><span className="font-medium text-slate-600">Fecha:</span> {formatDate(selectedOrder.createdAt)}</p>
                {selectedOrder.mpPaymentId && (
                  <p><span className="font-medium text-slate-600">ID Pago MP:</span> <span className="font-mono text-xs">{selectedOrder.mpPaymentId}</span></p>
                )}
              </div>

              {/* Productos */}
              <div>
                <h3 className="font-semibold text-slate-700 mb-3">Productos</h3>
                <div className="space-y-2">
                  {selectedOrder.items?.map((item) => {
                    const img = item.product?.images?.[0];
                    return (
                      <div key={item.id} className="flex items-center gap-3 bg-slate-50 rounded-lg p-3">
                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-200 flex-shrink-0">
                          {img ? (
                            <img src={getImageUrl(img)} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-sm">📦</div>
                          )}
                        </div>
                        <div className="flex-1 text-sm">
                          <p className="font-medium text-slate-800">{item.product?.name}</p>
                          <p className="text-slate-500">x{item.quantity} × {formatPrice(item.price)}</p>
                        </div>
                        <span className="font-bold text-slate-800 text-sm">
                          {formatPrice(item.price * item.quantity)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Cupón de descuento aplicado */}
                {selectedOrder.coupon && selectedOrder.couponDiscount > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-200 space-y-1">
                    <div className="flex justify-between text-sm text-slate-500">
                      <span>Subtotal</span>
                      <span>{formatPrice(selectedOrder.total + selectedOrder.couponDiscount)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-green-700 font-medium">
                      <span>
                        Cupón{" "}
                        <span className="font-mono text-xs tracking-widest bg-green-100 px-1.5 py-0.5 rounded">
                          {selectedOrder.coupon.code}
                        </span>
                      </span>
                      <span>−{formatPrice(selectedOrder.couponDiscount)}</span>
                    </div>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg text-slate-900 mt-4 pt-4 border-t border-slate-200">
                  <span>Total</span>
                  <span>{formatPrice(selectedOrder.total)}</span>
                </div>
              </div>

              {/* Cambiar estado */}
              <div>
                <h3 className="font-semibold text-slate-700 mb-3">Cambiar estado</h3>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(STATUS_CONFIG).map(([value, config]) => (
                    <button
                      key={value}
                      onClick={() => handleStatusChange(selectedOrder.id, value)}
                      className={`py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                        selectedOrder.status === value
                          ? config.color + " ring-2 ring-offset-1 ring-blue-400"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {config.icon} {config.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: ¿actualizar precio del producto en la BD? */}
      {priceUpdateConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">¿Actualizar precio del producto?</h3>
            <p className="text-sm text-slate-600">
              Cambiaste el precio de <strong>{priceUpdateConfirm.productName}</strong> a{" "}
              <strong>{new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(priceUpdateConfirm.newPrice)}</strong>{" "}
              en esta cotización.
            </p>
            <p className="text-sm text-slate-600">
              ¿Querés aplicar este precio también al producto publicado en la tienda?
            </p>
            {/* Selector: qué tipo de precio actualizar */}
            <div className="space-y-2">
              {[
                { value: "minorista", label: "Precio minorista" },
                { value: "mayorista", label: "Precio mayorista" },
                { value: "ambos",    label: "Ambos" },
              ].map((opt) => (
                <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="priceTarget"
                    value={opt.value}
                    checked={priceUpdateTarget === opt.value}
                    onChange={() => setPriceUpdateTarget(opt.value)}
                    className="accent-blue-600 w-4 h-4"
                  />
                  <span className="text-sm text-slate-700">{opt.label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setPriceUpdateConfirm(null)}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700"
              >
                No, solo esta cotización
              </button>
              <button
                onClick={handleUpdateProductPrice}
                disabled={updatingProductPrice}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
              >
                {updatingProductPrice ? "Actualizando..." : "Sí, actualizar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Nueva Venta Manual ══ */}
      {manualModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-bold text-slate-800 text-lg">Nueva venta manual</h2>
              <button onClick={() => setManualModal(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleSaveManual} className="px-6 py-5 space-y-5">
              {/* Datos del cliente */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Datos del cliente</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nombre *</label>
                    <input
                      required
                      value={manualForm.customerName}
                      onChange={(e) => setManualForm((p) => ({ ...p, customerName: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Juan García"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
                    <input
                      required
                      type="email"
                      value={manualForm.customerEmail}
                      onChange={(e) => setManualForm((p) => ({ ...p, customerEmail: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="juan@ejemplo.com"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
                    <input
                      value={manualForm.customerPhone}
                      onChange={(e) => setManualForm((p) => ({ ...p, customerPhone: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="1150395166"
                    />
                  </div>
                </div>
              </div>

              {/* Productos */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Productos</p>
                  <button type="button" onClick={addManualItem} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                    + Agregar línea
                  </button>
                </div>
                <div className="space-y-2">
                  {manualForm.items.map((item, idx) => {
                    const filtered = (allProducts || []).filter((p) =>
                      productSearch[idx]
                        ? p.name.toLowerCase().includes(productSearch[idx].toLowerCase()) ||
                          (p.sku && p.sku.toLowerCase().includes(productSearch[idx].toLowerCase()))
                        : false
                    ).slice(0, 6);

                    return (
                      <div key={idx} className="bg-slate-50 rounded-xl p-3 space-y-2">
                        {/* Buscador de producto */}
                        <div className="relative">
                          <input
                            value={item.productName || productSearch[idx] || ""}
                            onChange={(e) => {
                              setProductSearch((p) => ({ ...p, [idx]: e.target.value }));
                              setManualItem(idx, "productId", "");
                              setManualItem(idx, "productName", "");
                            }}
                            placeholder="Buscar producto por nombre o SKU..."
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          {filtered.length > 0 && !item.productId && (
                            <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg z-10 mt-1 max-h-48 overflow-y-auto">
                              {filtered.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => selectProduct(idx, p)}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex justify-between items-center"
                                >
                                  <span className="font-medium text-slate-700">{p.name}</span>
                                  <span className="text-slate-400 text-xs">{formatPrice(p.price)}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="block text-xs text-slate-500 mb-1">Precio unitario *</label>
                            <input
                              required
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.price}
                              onChange={(e) => setManualItem(idx, "price", e.target.value)}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="0.00"
                            />
                          </div>
                          <div className="w-24">
                            <label className="block text-xs text-slate-500 mb-1">Cantidad *</label>
                            <input
                              required
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => setManualItem(idx, "quantity", e.target.value)}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div className="flex items-end pb-0.5">
                            <button
                              type="button"
                              onClick={() => removeManualItem(idx)}
                              disabled={manualForm.items.length === 1}
                              className="px-3 py-2 text-slate-400 hover:text-red-500 disabled:opacity-30 transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                        {item.productId && item.price && item.quantity && (
                          <p className="text-xs text-slate-500 text-right">
                            Subtotal: {formatPrice(parseFloat(item.price) * parseInt(item.quantity))}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Método de pago y estado */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Método de pago</label>
                  <select
                    value={manualForm.paymentMethod}
                    onChange={(e) => setManualForm((p) => ({ ...p, paymentMethod: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="EFECTIVO">Efectivo</option>
                    <option value="TRANSFERENCIA">Transferencia</option>
                    <option value="MERCADOPAGO">MercadoPago</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Estado</label>
                  <select
                    value={manualForm.status}
                    onChange={(e) => setManualForm((p) => ({ ...p, status: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="APPROVED">Abonada ✅</option>
                    <option value="PENDING">Pendiente ⏳</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Notas internas</label>
                  <input
                    value={manualForm.notes}
                    onChange={(e) => setManualForm((p) => ({ ...p, notes: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Observaciones opcionales..."
                  />
                </div>
              </div>

              {/* Total y acciones */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <div className="text-sm font-bold text-slate-800">
                  Total: <span className="text-blue-600 text-base">{formatPrice(manualTotal)}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setManualModal(false)}
                    className="px-5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingManual}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                  >
                    {savingManual ? "Guardando..." : "Registrar venta"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

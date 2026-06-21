import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import AdminLayout from "../../components/AdminLayout";
import { ordersApi, productsApi, shippingApi, getImageUrl } from "../../services/api";
import toast from "react-hot-toast";

const STATUS_CONFIG = {
  PENDING:        { label: "Pendiente",            color: "bg-yellow-500 text-white",  icon: "⏳" },
  QUOTE_APPROVED: { label: "Aprobada (sin pagar)", color: "bg-teal-600 text-white",   icon: "💳" },
  APPROVED:       { label: "Abonada",              color: "bg-green-600 text-white",   icon: "✅" },
  REJECTED:       { label: "Rechazada",            color: "bg-red-600 text-white",     icon: "❌" },
  CANCELLED:      { label: "Cancelada",            color: "bg-slate-500 text-white",   icon: "🚫" },
};

const PAYMENT_LABEL = {
  EFECTIVO:      { label: "Efectivo",       icon: "💵" },
  TRANSFERENCIA: { label: "Transferencia",  icon: "🏦" },
  MERCADOPAGO:   { label: "MercadoPago",    icon: "💳" },
  COTIZACION:    { label: "Cotización",     icon: "📋" },
};

const CHANNEL_LABEL = {
  WEB:       { label: "Web",       icon: "🌐" },
  MOSTRADOR: { label: "Mostrador", icon: "🏪" },
  WHATSAPP:  { label: "WhatsApp",  icon: "💬" },
  INSTAGRAM: { label: "Instagram", icon: "📸" },
  TELEFONO:  { label: "Teléfono",  icon: "📞" },
  MANUAL:    { label: "Manual",    icon: "✏️" },
  OTRO:      { label: "Otro",      icon: "📋" },
};

const TYPE_LABEL = {
  MINORISTA: { label: "Minorista", color: "bg-blue-600 text-white" },
  MAYORISTA: { label: "Mayorista", color: "bg-purple-600 text-white" },
};

const SHIPPING_LABEL = {
  RETIRO:           { label: "Retiro en local",   icon: "🏪" },
  ENVIO:            { label: "Envío a domicilio",  icon: "🚚" },
  CORREO_ARGENTINO: { label: "Correo Argentino",   icon: "📮" },
};

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleString("es-AR", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatPrice(price) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-slate-500 font-medium min-w-[140px] flex-shrink-0">{label}</span>
      <span className="text-slate-800">{value}</span>
    </div>
  );
}

export default function AdminOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatingFields, setUpdatingFields] = useState(false);
  const [generatingShipping, setGeneratingShipping] = useState(false);
  const [trackingInput, setTrackingInput] = useState("");
  const [savingTracking, setSavingTracking] = useState(false);

  // Modo edición de pedido (Feature 90)
  const [editMode, setEditMode] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const [savingEdit, setSavingEdit] = useState(false);
  // Modal que pregunta si el cambio de costo también se aplica al producto (próximos pedidos).
  // Guarda el payload ya armado para enviarlo según la respuesta (Sí/No).
  const [costModal, setCostModal] = useState(null);
  const [productSearch, setProductSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef(null);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    setLoading(true);
    ordersApi.getById(id)
      .then((res) => setOrder(res.data))
      .catch(() => toast.error("No se pudo cargar el pedido"))
      .finally(() => setLoading(false));
  }, [id]);

  const handleStatusChange = async (newStatus) => {
    try {
      await ordersApi.updateStatus(order.id, newStatus);
      setOrder((prev) => ({ ...prev, status: newStatus }));
      toast.success("Estado actualizado");
    } catch {
      toast.error("Error al actualizar el estado");
    }
  };

  const handleUpdateFields = async (fields) => {
    setUpdatingFields(true);
    try {
      await ordersApi.updateFields(order.id, fields);
      setOrder((prev) => ({ ...prev, ...fields }));
      toast.success("Actualizado");
    } catch {
      toast.error("Error al actualizar");
    } finally {
      setUpdatingFields(false);
    }
  };

  const handleShippingChange = (newMethod) => {
    if (newMethod === order.shippingMethod) return;
    const oldLabel = SHIPPING_LABEL[order.shippingMethod]?.label || order.shippingMethod;
    const newLabel = SHIPPING_LABEL[newMethod]?.label || newMethod;
    if (!window.confirm(`¿Cambiar método de entrega?\n\n"${oldLabel}" → "${newLabel}"\n\nEsta acción modifica el pedido aunque ya esté entregado.`)) return;
    handleUpdateFields({ shippingMethod: newMethod });
  };

  const handleGenerateShipping = async () => {
    setGeneratingShipping(true);
    try {
      const res = await shippingApi.generate(order.id);
      toast.success("Envío generado en MiCorreo" + (res.data.trackingNumber ? ` · Tracking: ${res.data.trackingNumber}` : ""));
      setOrder((prev) => ({ ...prev, shippingImported: true, trackingNumber: res.data.trackingNumber || prev.trackingNumber }));
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al generar el envío");
    } finally {
      setGeneratingShipping(false);
    }
  };

  const handleSaveTracking = async () => {
    if (!trackingInput.trim()) return;
    setSavingTracking(true);
    try {
      await shippingApi.setTrackingManual(order.id, trackingInput.trim());
      toast.success("Tracking actualizado");
      setOrder((prev) => ({ ...prev, shippingImported: true, trackingNumber: trackingInput.trim() }));
      setTrackingInput("");
    } catch {
      toast.error("Error al guardar el tracking");
    } finally {
      setSavingTracking(false);
    }
  };

  const enterEditMode = () => {
    setEditItems((order.items || []).map((i) => ({
      itemId:       i.id,
      productId:    i.productId,
      name:         i.product?.name || "Producto",
      image:        i.product?.images?.[0] || null,
      quantity:     i.quantity,
      price:        i.price,
      // cost: costo efectivo actual (ítem → variante → producto) para mostrarlo como default editable
      cost:         i.cost ?? i.variant?.cost ?? i.product?.cost ?? "",
      variantId:    i.variantId || null,
      variantLabel: i.variantLabel || null,
    })));
    setProductSearch("");
    setSearchResults([]);
    setEditMode(true);
  };

  const cancelEditMode = () => {
    setEditMode(false);
    setEditItems([]);
    setProductSearch("");
    setSearchResults([]);
  };

  const updateEditQty = (idx, val) => {
    const qty = parseInt(val);
    if (isNaN(qty) || qty < 1) return;
    setEditItems((prev) => prev.map((it, i) => i === idx ? { ...it, quantity: qty } : it));
  };

  const updateEditPrice = (idx, val) => {
    setEditItems((prev) => prev.map((it, i) => i === idx ? { ...it, price: val } : it));
  };

  const updateEditCost = (idx, val) => {
    setEditItems((prev) => prev.map((it, i) => i === idx ? { ...it, cost: val } : it));
  };

  const removeEditItem = (idx) => {
    setEditItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleProductSearch = useCallback((q) => {
    setProductSearch(q);
    clearTimeout(searchTimer.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await productsApi.getAllAdmin({ search: q, limit: 8, active: "true" });
        setSearchResults(res.data.products || []);
      } catch { /* silent */ } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  const addEditProduct = (product) => {
    // Si ya está en la lista, solo incrementar cantidad
    const existingIdx = editItems.findIndex((i) => i.productId === product.id && !i.variantId);
    if (existingIdx >= 0) {
      setEditItems((prev) => prev.map((it, i) => i === existingIdx ? { ...it, quantity: it.quantity + 1 } : it));
    } else {
      const price = product.wholesalePrice ?? product.salePrice ?? product.price ?? 0;
      setEditItems((prev) => [...prev, {
        productId:    product.id,
        name:         product.name,
        image:        product.images?.[0] || null,
        quantity:     1,
        price:        price,
        cost:         product.cost ?? "",
        variantId:    null,
        variantLabel: null,
      }]);
    }
    setProductSearch("");
    setSearchResults([]);
  };

  // Detecta si el admin cambió el costo de algún item EXISTENTE respecto del costo que tenía.
  // (Los items nuevos no disparan el modal: su costo se guarda solo en la orden.)
  const didCostChange = () => {
    return editItems.some((it) => {
      if (!it.itemId) return false;
      const orig = (order.items || []).find((oi) => oi.id === it.itemId);
      if (!orig) return false;
      const originalCost = orig.cost ?? orig.variant?.cost ?? orig.product?.cost ?? null;
      const newNum  = it.cost === "" || it.cost === null || it.cost === undefined ? null : parseFloat(it.cost);
      const origNum = originalCost === "" || originalCost === null || originalCost === undefined ? null : parseFloat(originalCost);
      return newNum !== origNum;
    });
  };

  const handleSaveEdit = () => {
    if (editItems.length === 0) {
      toast.error("El pedido debe tener al menos un producto");
      return;
    }
    // Si cambió algún costo, preguntar si se aplica también al producto (próximos pedidos).
    if (didCostChange()) {
      setCostModal({ open: true });
    } else {
      doSaveEdit(false);
    }
  };

  // Ejecuta la modificación. applyCostToProduct = respuesta del modal (Sí/No).
  const doSaveEdit = async (applyCostToProduct) => {
    setCostModal(null);
    setSavingEdit(true);
    try {
      const payload = editItems.map((it) => ({
        ...(it.itemId ? { itemId: it.itemId } : {}),
        productId:    it.productId,
        quantity:     parseInt(it.quantity),
        price:        parseFloat(it.price),
        // cost: se envía siempre (vacío → el backend lo guarda como null y usa el costo del producto)
        cost:         it.cost === "" || it.cost === null || it.cost === undefined ? "" : it.cost,
        variantId:    it.variantId || undefined,
        variantLabel: it.variantLabel || undefined,
      }));
      const res = await ordersApi.modifyOrder(order.id, payload, applyCostToProduct);
      setOrder(res.data);
      setEditMode(false);
      setEditItems([]);
      toast.success("Pedido modificado");
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al modificar el pedido");
    } finally {
      setSavingEdit(false);
    }
  };

  const handlePrint = () => {
    if (!order) return;

    const status  = STATUS_CONFIG[order.status]          || STATUS_CONFIG.PENDING;
    const payment = PAYMENT_LABEL[order.paymentMethod]   || PAYMENT_LABEL.EFECTIVO;
    const type    = TYPE_LABEL[order.customerType]        || { label: order.customerType };
    const channel = CHANNEL_LABEL[order.salesChannel]    || { label: order.salesChannel, icon: "" };

    const subtotalSinDesc = (order.items || []).reduce((s, i) => s + i.price * i.quantity, 0);
    const hasDiscount = order.couponDiscount > 0;
    const hasIva      = order.wantsInvoice && order.ivaAmount > 0;

    const itemCards = (order.items || []).map((item) => {
      const imgSrc = item.product?.images?.[0] ? getImageUrl(item.product.images[0]) : null;
      const imgHtml = imgSrc
        ? `<img src="${imgSrc}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0;flex-shrink:0" />`
        : `<div style="width:40px;height:40px;background:#f1f5f9;border-radius:6px;border:1px solid #e2e8f0;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">📦</div>`;
      // Ubicación en depósito (módulo/estante): se resalta para que quien separa el pedido sepa dónde buscar.
      // Si la variante tiene su propia ubicación, predomina; si no, cae a la del producto (fallback por campo).
      const mod   = item.variant?.module ?? item.product?.module;
      const shelf = item.variant?.shelf  ?? item.product?.shelf;
      const locHtml = (mod || shelf)
        ? `<div style="display:inline-flex;align-items:center;gap:5px;margin-top:3px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;color:#92400e">📍 ${mod ? `Módulo ${mod}` : ""}${mod && shelf ? " · " : ""}${shelf ? `Estante ${shelf}` : ""}</div>`
        : "";
      return `
      <tr>
        <td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;vertical-align:middle">
          <div style="display:flex;align-items:center;gap:10px">
            ${imgHtml}
            <div>
              <div style="font-weight:600;font-size:12px;color:#1e293b">${item.product?.name || "Producto"}</div>
              ${item.variantLabel ? item.variantLabel.split(" | ").map(v => `<div style="font-size:10px;color:#64748b;margin-top:1px">${v}</div>`).join("") : ""}
              ${locHtml}
              <div style="font-size:11px;color:#94a3b8">${formatPrice(item.price)} c/u × ${item.quantity} unid.</div>
            </div>
          </div>
        </td>
        <td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:700;color:#1e293b;white-space:nowrap;vertical-align:middle">${formatPrice(item.price * item.quantity)}</td>
      </tr>`;
    }).join("");

    const totalRows = `
      <tr><td style="padding:4px 8px;font-size:12px;color:#64748b">Subtotal (${(order.items || []).reduce((s, i) => s + i.quantity, 0)} items)</td><td style="padding:4px 8px;text-align:right;font-size:12px;color:#64748b">${formatPrice(subtotalSinDesc)}</td></tr>
      ${hasDiscount ? `<tr><td style="padding:4px 8px;font-size:12px;color:#16a34a">🏷 Cupón${order.coupon?.code ? ` <strong>${order.coupon.code}</strong>` : ""}${order.coupon?.discountType === "PERCENTAGE" ? ` (${order.coupon.discountValue}% off)` : ""}</td><td style="padding:4px 8px;text-align:right;font-size:12px;color:#16a34a">− ${formatPrice(order.couponDiscount)}</td></tr>` : ""}
      ${hasIva ? `<tr><td style="padding:4px 8px;font-size:12px;color:#64748b">IVA</td><td style="padding:4px 8px;text-align:right;font-size:12px;color:#64748b">+ ${formatPrice(order.ivaAmount)}</td></tr>` : ""}
      <tr style="border-top:2px solid #1e293b"><td style="padding:8px 8px 0;font-size:15px;font-weight:900;color:#1e293b">TOTAL</td><td style="padding:8px 8px 0;text-align:right;font-size:15px;font-weight:900;color:#1e293b">${formatPrice(order.total)}</td></tr>`;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Orden #${order.id} — IGWT Store</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1e293b; background: #f1f5f9; }
    .page { max-width: 720px; margin: 0 auto; background: #fff; padding: 28px; }
    .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 14px; border-bottom: 2px solid #1e40af; margin-bottom: 16px; }
    .logo-name { font-size: 18px; font-weight: 900; color: #1e40af; }
    .order-badge { background: #1e40af; color: #fff; border-radius: 8px; padding: 5px 14px; font-size: 16px; font-weight: 900; }
    .order-date { font-size: 10px; color: #94a3b8; text-align: right; margin-top: 4px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
    .card-title { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: #94a3b8; font-weight: 800; margin-bottom: 8px; }
    .row { display: flex; gap: 6px; align-items: baseline; margin-bottom: 4px; }
    .row-label { font-size: 10px; color: #94a3b8; min-width: 72px; flex-shrink: 0; }
    .row-value { font-size: 12px; font-weight: 600; color: #1e293b; }
    .section-title { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: #94a3b8; font-weight: 800; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; }
    .totals-table { margin-left: auto; width: 260px; margin-top: 10px; border-top: 1px solid #e2e8f0; }
    .note-box { border-radius: 6px; padding: 7px 10px; margin-bottom: 10px; font-size: 11px; }
    .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; color: #cbd5e1; font-size: 9px; text-align: center; }
    @media print { body { background: #fff; } .page { padding: 16px; max-width: 100%; } .print-btn { display: none !important; } }
  </style>
</head>
<body>
<div class="print-btn" style="position:fixed;top:12px;right:12px;z-index:9999">
  <button onclick="window.print()" style="background:#1e40af;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer">🖨️ Imprimir</button>
</div>
<div class="page">
  <div class="header">
    <div><div class="logo-name">⚡ IGWT Store</div></div>
    <div>
      <div class="order-badge">Orden #${order.id}</div>
      <div class="order-date">${formatDate(order.createdAt)}</div>
    </div>
  </div>

  <div class="two-col">
    <div class="card">
      <div class="card-title">Cliente</div>
      <div class="row"><span class="row-label">Nombre</span><span class="row-value">${order.customerName}</span></div>
      <div class="row"><span class="row-label">Tipo</span><span class="row-value">${type.label}</span></div>
      ${order.customerEmail ? `<div class="row"><span class="row-label">Email</span><span class="row-value" style="font-weight:400;font-size:11px">${order.customerEmail}</span></div>` : ""}
      ${order.customerPhone ? `<div class="row"><span class="row-label">Teléfono</span><span class="row-value">${order.customerPhone}</span></div>` : ""}
    </div>
    <div class="card">
      <div class="card-title">Pedido</div>
      <div class="row"><span class="row-label">Estado</span><span class="row-value">${status.label}</span></div>
      <div class="row"><span class="row-label">Pago</span><span class="row-value">${payment.icon} ${payment.label}</span></div>
      <div class="row"><span class="row-label">Canal</span><span class="row-value">${channel.icon} ${channel.label}</span></div>
      ${order.wantsInvoice ? `<div class="row"><span class="row-label">Factura</span><span class="row-value" style="color:#2563eb">Solicitada — IVA incluido</span></div>` : ""}
    </div>
  </div>

  ${order.customerNote ? `<div class="note-box" style="background:#fffbeb;border:1px solid #fde68a;color:#92400e">💬 <strong>Nota del cliente:</strong> ${order.customerNote}</div>` : ""}
  ${order.adminNotes   ? `<div class="note-box" style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af">📋 <strong>Nota interna:</strong> ${order.adminNotes}</div>` : ""}

  <div class="section-title">Productos</div>
  <table><tbody>${itemCards}</tbody></table>

  <table class="totals-table"><tbody>${totalRows}</tbody></table>

  <div class="footer">Generado el ${new Date().toLocaleString("es-AR")} · IGWT Store</div>
</div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, "_blank", "width=820,height=760");
    win.onload = () => { win.focus(); URL.revokeObjectURL(url); };
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-32">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AdminLayout>
    );
  }

  if (!order) {
    return (
      <AdminLayout>
        <div className="text-center py-32 text-slate-400">
          <p className="text-lg">Pedido no encontrado</p>
          <button onClick={() => navigate("/admin/ordenes")} className="mt-4 text-blue-600 hover:underline text-sm">
            ← Volver a pedidos
          </button>
        </div>
      </AdminLayout>
    );
  }

  const discount = order.couponDiscount || 0;
  const iva = order.ivaAmount || 0;
  const subtotal = order.total + discount - iva;
  const isMayorista = order.customerType === "MAYORISTA";

  // Snapshot: puede ser array (formato viejo) u objeto { items, total, ivaAmount, couponDiscount } (formato nuevo)
  const rawSnap          = order.originalSnapshot;
  const isSnapObj        = rawSnap && !Array.isArray(rawSnap);
  const originalItems    = isSnapObj ? (rawSnap.items || []) : (rawSnap || []);
  const subtotalOriginal = originalItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const originalDiscount = isSnapObj ? (rawSnap.couponDiscount || 0) : discount;
  const ivaRate          = subtotal > 0 && iva > 0 ? iva / subtotal : 0;
  const originalIva      = isSnapObj ? (rawSnap.ivaAmount || 0) : Math.round(subtotalOriginal * ivaRate * 100) / 100;
  const originalTotal    = isSnapObj ? rawSnap.total : (subtotalOriginal + originalIva - originalDiscount);
  const statusInfo = STATUS_CONFIG[order.status] || STATUS_CONFIG.PENDING;
  const paymentInfo = PAYMENT_LABEL[order.paymentMethod] || PAYMENT_LABEL.EFECTIVO;
  const shippingInfo = SHIPPING_LABEL[order.shippingMethod] || SHIPPING_LABEL.RETIRO;
  const channelInfo = CHANNEL_LABEL[order.salesChannel] || CHANNEL_LABEL.WEB;
  const typeInfo = TYPE_LABEL[order.customerType] || TYPE_LABEL.MINORISTA;

  const fulfillmentStages = [
    { value: "PENDIENTE",      label: "Pendiente",      icon: "🕐", color: "bg-slate-100 text-slate-700" },
    { value: "EN_PREPARACION", label: "En preparación", icon: "🔧", color: "bg-yellow-100 text-yellow-800" },
    order.shippingMethod === "RETIRO"
      ? { value: "ENVIADO", label: "Pedido listo", icon: "🏪", color: "bg-orange-100 text-orange-800" }
      : order.shippingMethod === "CORREO_ARGENTINO"
      ? { value: "ENVIADO", label: "En camino",    icon: "📮", color: "bg-red-100 text-red-800" }
      : { value: "ENVIADO", label: "Enviado",      icon: "🚚", color: "bg-blue-100 text-blue-800" },
    { value: "ENTREGADO", label: "Entregado", icon: "✅", color: "bg-green-100 text-green-800" },
  ];
  const fulfillmentCurrent = order.fulfillmentStatus || "PENDIENTE";
  const fulfillmentCurrentIdx = fulfillmentStages.findIndex((s) => s.value === fulfillmentCurrent);

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/admin/ordenes")}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Pedido #{order.id}</h1>
              <p className="text-sm text-slate-500">{formatDate(order.createdAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {order.isModified && (
              <span className="px-2.5 py-1 bg-orange-100 text-orange-700 text-xs font-bold rounded-full border border-orange-200">
                ✏️ Pedido modificado
              </span>
            )}
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Imprimir
            </button>
            {/* Orden de compra a proveedores — vista de selección de productos a comprar */}
            <button
              onClick={() => navigate(`/admin/ordenes/${order.id}/compra`)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-xl transition-colors"
              title="Generar orden de compra a proveedores"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Orden de compra
            </button>
            {!editMode && (
              <button
                onClick={enterEditMode}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-xl transition-colors"
              >
                ✏️ Modificar pedido
              </button>
            )}
            <span className={`px-3 py-1.5 rounded-xl text-sm font-bold ${statusInfo.color}`}>
              {statusInfo.icon} {statusInfo.label}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Columna izquierda: info + items */}
          <div className="lg:col-span-2 space-y-6">

            {/* Datos del cliente */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <h2 className="font-bold text-slate-800 text-base">Datos del cliente</h2>
              <div className="space-y-2">
                <InfoRow label="Nombre" value={order.customerName} />
                <InfoRow label="Email" value={order.customerEmail} />
                <InfoRow label="Teléfono" value={order.customerPhone} />
                <InfoRow label="ID pago MP" value={order.mpPaymentId} />
              </div>
              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${typeInfo.color}`}>
                  {typeInfo.label}
                </span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                  {channelInfo.icon} {channelInfo.label}
                </span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                  {paymentInfo.icon} {paymentInfo.label}
                </span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-orange-100 text-orange-700">
                  {shippingInfo.icon} {shippingInfo.label}
                </span>
              </div>
            </div>

            {/* Notas */}
            {(order.customerNote || order.adminNotes) && (
              <div className="space-y-3">
                {order.customerNote && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                    <p className="text-xs font-bold text-amber-700 mb-1">💬 Nota del cliente</p>
                    <p className="text-sm text-amber-900">{order.customerNote}</p>
                  </div>
                )}
                {order.adminNotes && (
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                    <p className="text-xs font-bold text-blue-700 mb-1">🔒 Notas internas</p>
                    <p className="text-sm text-blue-900">{order.adminNotes}</p>
                  </div>
                )}
              </div>
            )}

            {/* Productos — modo edición o modo lectura */}
            {editMode ? (
              <div className="bg-white rounded-2xl border border-orange-300 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-slate-800 text-base">✏️ Modificando pedido</h2>
                  <button onClick={cancelEditMode} className="text-xs text-slate-500 hover:text-slate-700 underline">Cancelar</button>
                </div>

                {/* Items editables */}
                <div className="space-y-2">
                  {editItems.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                      <div className="w-10 h-10 rounded-lg overflow-hidden bg-white border border-slate-200 flex-shrink-0">
                        {item.image ? (
                          <img src={getImageUrl(item.image)} alt="" className="w-full h-full object-contain p-0.5" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-300">📦</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{item.name}</p>
                        {item.variantLabel && <p className="text-xs text-blue-500">{item.variantLabel}</p>}
                      </div>
                      {/* Precio de venta + costo (proveedor) + cantidad editables */}
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-400 w-12 text-right">Venta $</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.price}
                            onChange={(e) => updateEditPrice(idx, e.target.value)}
                            className="w-24 text-right border border-slate-300 rounded-lg px-2 py-1 text-sm"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-400 w-12 text-right">Costo $</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.cost}
                            onChange={(e) => updateEditCost(idx, e.target.value)}
                            placeholder="—"
                            title="Costo del proveedor para este pedido (se usa en la orden de compra)"
                            className="w-24 text-right border border-slate-300 rounded-lg px-2 py-1 text-sm"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-400 w-12 text-right">Cant. ×</span>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateEditQty(idx, e.target.value)}
                            className="w-24 text-right border border-slate-300 rounded-lg px-2 py-1 text-sm"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => removeEditItem(idx)}
                        className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        title="Eliminar"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {editItems.length === 0 && (
                    <p className="text-center text-sm text-slate-400 py-4">Sin productos — agregá al menos uno</p>
                  )}
                </div>

                {/* Buscador de productos para agregar */}
                <div className="relative">
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => handleProductSearch(e.target.value)}
                    placeholder="Buscar producto para agregar..."
                    className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  {searching && (
                    <div className="absolute right-3 top-2.5">
                      <span className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin inline-block" />
                    </div>
                  )}
                  {searchResults.length > 0 && (
                    <div className="absolute z-20 top-full left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg mt-1 overflow-hidden max-h-52 overflow-y-auto">
                      {searchResults.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => addEditProduct(p)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left text-sm transition-colors"
                        >
                          {p.images?.[0] ? (
                            <img src={getImageUrl(p.images[0])} alt="" className="w-8 h-8 object-contain rounded border border-slate-200 flex-shrink-0" />
                          ) : (
                            <div className="w-8 h-8 bg-slate-100 rounded flex-shrink-0 flex items-center justify-center text-slate-400">📦</div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-slate-800 truncate">{p.name}</p>
                            <p className="text-xs text-slate-400">{formatPrice(p.salePrice ?? p.price)}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Total estimado + botón guardar */}
                <div className="border-t border-slate-200 pt-3 flex items-center justify-between">
                  <div className="text-sm text-slate-500">
                    Total estimado:{" "}
                    <span className="font-bold text-slate-800">
                      {formatPrice(editItems.reduce((s, i) => s + parseFloat(i.price || 0) * parseInt(i.quantity || 0), 0))}
                    </span>
                  </div>
                  <button
                    onClick={handleSaveEdit}
                    disabled={savingEdit || editItems.length === 0}
                    className="flex items-center gap-2 px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-colors"
                  >
                    {savingEdit && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    Guardar modificación
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-bold text-slate-800 text-base">
                    {showOriginal ? "Pedido original" : "Productos"} ({showOriginal ? originalItems.length : (order.items || []).length})
                  </h2>
                  {order.isModified && originalItems.length > 0 && (
                    <button
                      onClick={() => setShowOriginal((v) => !v)}
                      className="text-xs text-orange-600 hover:text-orange-800 underline"
                    >
                      {showOriginal ? "Ver versión actual" : "Ver pedido original"}
                    </button>
                  )}
                </div>

                {/* Banner de pedido original */}
                {showOriginal && originalItems.length > 0 && (
                  <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-xl text-xs text-orange-700 font-medium">
                    📋 Versión original antes de la modificación
                  </div>
                )}

                <div className="space-y-3">
                  {(showOriginal ? originalItems : (order.items || [])).map((item, idx) => {
                    const img = showOriginal ? item.image : item.product?.images?.[0];
                    const name = showOriginal ? item.name : (item.product?.name || "Producto eliminado");
                    return (
                      <div key={showOriginal ? idx : item.id} className="flex items-center gap-4 p-3 bg-slate-50 rounded-xl">
                        <div className="w-14 h-14 rounded-xl overflow-hidden bg-white border border-slate-200 flex-shrink-0">
                          {img ? (
                            <img src={getImageUrl(img)} alt="" className="w-full h-full object-contain p-1" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xl text-slate-300">📦</div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 text-sm">{name}</p>
                          {!showOriginal && item.variantLabel && item.variantLabel.split(" | ").map((v, vi) => (
                            <p key={vi} className="text-xs text-blue-600 font-medium mt-0.5">{v}</p>
                          ))}
                          <p className="text-xs text-slate-400 mt-0.5">
                            {formatPrice(item.price)} × {item.quantity}
                          </p>
                        </div>
                        <p className="font-bold text-slate-800 text-sm flex-shrink-0">
                          {formatPrice(item.price * item.quantity)}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {/* Totales — vista original */}
                {showOriginal && (
                  <div className="mt-4 pt-4 border-t border-slate-200 space-y-2">
                    <div className="flex justify-between text-sm text-slate-500">
                      <span>Subtotal original</span>
                      <span>{formatPrice(subtotalOriginal)}</span>
                    </div>
                    {originalDiscount > 0 && (
                      <div className="flex justify-between text-sm text-green-700 font-medium">
                        <span>Cupón {order.coupon?.code && <span className="font-mono text-xs bg-green-100 px-1.5 py-0.5 rounded">{order.coupon.code}</span>}</span>
                        <span>−{formatPrice(originalDiscount)}</span>
                      </div>
                    )}
                    {isMayorista && originalIva > 0 && (
                      <div className="flex justify-between text-sm text-slate-500">
                        <span>IVA {!isSnapObj && <span className="text-xs text-slate-400">(estimado)</span>}</span>
                        <span>+{formatPrice(originalIva)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-lg text-slate-900 pt-2 border-t border-slate-200">
                      <span>Total original</span>
                      <span>{formatPrice(originalTotal)}</span>
                    </div>
                  </div>
                )}

                {/* Totales — vista actual */}
                {!showOriginal && (
                  <div className="mt-4 pt-4 border-t border-slate-200 space-y-2">
                    {(discount > 0 || iva > 0) && (
                      <div className="flex justify-between text-sm text-slate-500">
                        <span>Subtotal</span>
                        <span>{formatPrice(subtotal)}</span>
                      </div>
                    )}
                    {discount > 0 && (
                      <div className="flex justify-between text-sm text-green-700 font-medium">
                        <span>
                          Cupón{" "}
                          {order.coupon?.code && (
                            <span className="font-mono text-xs tracking-widest bg-green-100 px-1.5 py-0.5 rounded">
                              {order.coupon.code}
                            </span>
                          )}
                        </span>
                        <span>−{formatPrice(discount)}</span>
                      </div>
                    )}
                    {isMayorista && iva > 0 && (
                      <div className="flex justify-between text-sm text-slate-500">
                        <span>IVA</span>
                        <span>+{formatPrice(iva)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-lg text-slate-900 pt-2 border-t border-slate-200">
                      <span>Total</span>
                      <span>{formatPrice(order.total)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Columna derecha: controles de estado */}
          <div className="space-y-5">

            {/* Estado de pago */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h2 className="font-bold text-slate-800 text-sm mb-3">Estado de pago</h2>
              <div className="grid grid-cols-1 gap-2">
                {Object.entries(STATUS_CONFIG).map(([value, config]) => (
                  <button
                    key={value}
                    onClick={() => handleStatusChange(value)}
                    className={`py-2 px-3 rounded-xl text-sm font-semibold transition-colors text-left flex items-center gap-2 ${
                      order.status === value
                        ? config.color + " ring-2 ring-offset-1"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    <span>{config.icon}</span>
                    <span>{config.label}</span>
                    {order.status === value && <span className="ml-auto text-xs opacity-70">● Actual</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Método de pago */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h2 className="font-bold text-slate-800 text-sm mb-3">Método de pago</h2>
              <div className="grid grid-cols-1 gap-2">
                {Object.entries(PAYMENT_LABEL).map(([value, config]) => (
                  <button
                    key={value}
                    onClick={() => handleUpdateFields({ paymentMethod: value })}
                    disabled={updatingFields}
                    className={`py-2 px-3 rounded-xl text-sm font-semibold transition-colors text-left flex items-center gap-2 disabled:opacity-50 ${
                      order.paymentMethod === value
                        ? "bg-indigo-600 text-white ring-2 ring-offset-1 ring-indigo-400"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    <span>{config.icon}</span>
                    <span>{config.label}</span>
                    {order.paymentMethod === value && <span className="ml-auto text-xs opacity-70">● Actual</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Método de entrega — editable (con confirm para evitar cambios accidentales) */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h2 className="font-bold text-slate-800 text-sm mb-3">Método de entrega</h2>
              <div className="grid grid-cols-1 gap-2">
                {Object.entries(SHIPPING_LABEL).map(([value, config]) => (
                  <button
                    key={value}
                    onClick={() => handleShippingChange(value)}
                    disabled={updatingFields}
                    className={`py-2 px-3 rounded-xl text-sm font-semibold transition-colors text-left flex items-center gap-2 disabled:opacity-50 ${
                      order.shippingMethod === value
                        ? "bg-orange-500 text-white ring-2 ring-offset-1 ring-orange-400"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    <span>{config.icon}</span>
                    <span>{config.label}</span>
                    {order.shippingMethod === value && <span className="ml-auto text-xs opacity-70">● Actual</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Sección MiCorreo — solo si el método es Correo Argentino */}
            {order.shippingMethod === "CORREO_ARGENTINO" && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-5 space-y-3">
                <h2 className="font-bold text-slate-800 text-sm">📮 Correo Argentino</h2>

                {/* Dirección de envío */}
                {order.shippingAddress && (
                  <div className="text-sm text-slate-700 space-y-0.5">
                    <p className="font-medium text-slate-600">Dirección:</p>
                    <p>
                      {order.shippingAddress.streetName} {order.shippingAddress.streetNumber}
                      {order.shippingAddress.floor ? `, Piso ${order.shippingAddress.floor}` : ""}
                      {order.shippingAddress.apartment ? ` Dpto ${order.shippingAddress.apartment}` : ""}
                    </p>
                    <p className="text-slate-500">{order.shippingAddress.city} · CP {order.shippingAddress.postalCode}</p>
                  </div>
                )}

                {/* Tracking existente */}
                {order.trackingNumber && (
                  <div className="bg-white border border-red-200 rounded-lg px-3 py-2 text-sm">
                    <span className="text-slate-500">Tracking: </span>
                    <span className="font-mono font-bold text-slate-800">{order.trackingNumber}</span>
                  </div>
                )}

                {/* Generar envío */}
                {!order.shippingImported && (
                  <button
                    onClick={handleGenerateShipping}
                    disabled={generatingShipping}
                    className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl disabled:opacity-60 transition-colors"
                  >
                    {generatingShipping
                      ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : "📮"}
                    {generatingShipping ? "Generando..." : "Generar envío en MiCorreo"}
                  </button>
                )}

                {/* Tracking manual */}
                <div className="space-y-1.5">
                  <p className="text-xs text-slate-500">
                    {order.shippingImported ? "Actualizar tracking:" : "Ingresar tracking manual:"}
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={trackingInput}
                      onChange={(e) => setTrackingInput(e.target.value)}
                      placeholder="Número de seguimiento"
                      className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-mono bg-white"
                    />
                    <button
                      onClick={handleSaveTracking}
                      disabled={!trackingInput.trim() || savingTracking}
                      className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
                    >
                      {savingTracking ? "..." : "Guardar"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Estado de pedido (fulfillment) */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h2 className="font-bold text-slate-800 text-sm mb-3">Estado del pedido</h2>
              <div className="space-y-2">
                {fulfillmentStages.map((stage, idx) => {
                  const isActive = stage.value === fulfillmentCurrent;
                  const isPast = idx < fulfillmentCurrentIdx;
                  return (
                    <button
                      key={stage.value}
                      onClick={() => handleUpdateFields({ fulfillmentStatus: stage.value })}
                      disabled={updatingFields}
                      className={`w-full flex items-center gap-3 py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${
                        isActive
                          ? stage.color + " ring-2 ring-offset-1 ring-blue-400"
                          : isPast
                          ? "bg-slate-50 text-slate-400"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      <span>{stage.icon}</span>
                      <span className="flex-1 text-left">{stage.label}</span>
                      {isActive && <span className="text-xs opacity-70">● Actual</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal: ¿aplicar el nuevo costo también al producto (próximos pedidos)? */}
      {costModal?.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-800">Cambiaste el costo</h2>
            <p className="text-sm text-slate-600">
              ¿Querés actualizar también el <strong>costo del producto</strong> para los próximos pedidos?
            </p>
            <ul className="text-xs text-slate-500 list-disc pl-5 space-y-1">
              <li><strong>Sí:</strong> se actualiza el costo del producto. Lo usarán este pedido y los próximos; los pedidos anteriores quedan como estaban.</li>
              <li><strong>No:</strong> el nuevo costo se aplica solo a este pedido.</li>
            </ul>
            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => doSaveEdit(false)}
                disabled={savingEdit}
                className="px-4 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                No, solo este pedido
              </button>
              <button
                type="button"
                onClick={() => doSaveEdit(true)}
                disabled={savingEdit}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                Sí, actualizar el producto
              </button>
            </div>
            <button
              type="button"
              onClick={() => setCostModal(null)}
              disabled={savingEdit}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-600 pt-1"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

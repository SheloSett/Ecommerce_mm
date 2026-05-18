import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import * as XLSX from "xlsx";
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

const PAYMENT_LABEL = {
  EFECTIVO:      "Efectivo",
  TRANSFERENCIA: "Transferencia bancaria",
  MERCADOPAGO:   "MercadoPago",
  COTIZACION:    "Cotización",
};

const SHIPPING_LABEL = {
  RETIRO:           "Retiro en el local",
  ENVIO:            "Envío a domicilio",
  CORREO_ARGENTINO: "Correo Argentino",
};

const SHIPPING_ICON = {
  RETIRO:           "🏪",
  ENVIO:            "🚚",
  CORREO_ARGENTINO: "📮",
};

// Etapas para pedidos con envío a domicilio
const FULFILLMENT_STAGES_ENVIO = [
  { value: "PENDIENTE",      label: "Pendiente",      icon: "🕐" },
  { value: "EN_PREPARACION", label: "En preparación", icon: "🔧" },
  { value: "ENVIADO",        label: "Enviado",        icon: "🚚" },
  { value: "ENTREGADO",      label: "Entregado",      icon: "✅" },
];

// Etapas para pedidos con retiro en el local:
// "ENVIADO" en DB se muestra como "Pedido listo" — el paquete no se despacha, está listo para retirar
const FULFILLMENT_STAGES_RETIRO = [
  { value: "PENDIENTE",      label: "Pendiente",      icon: "🕐" },
  { value: "EN_PREPARACION", label: "En preparación", icon: "🔧" },
  { value: "ENVIADO",        label: "Pedido listo",   icon: "📦" },
  { value: "ENTREGADO",      label: "Entregado",      icon: "✅" },
];

function FulfillmentTracker({ status = "PENDIENTE", shippingMethod = "RETIRO" }) {
  // CORREO_ARGENTINO usa las mismas etapas que ENVIO (entrega a domicilio)
  const stages = (shippingMethod === "ENVIO" || shippingMethod === "CORREO_ARGENTINO")
    ? FULFILLMENT_STAGES_ENVIO
    : FULFILLMENT_STAGES_RETIRO;
  const currentIdx = stages.findIndex((s) => s.value === status);
  return (
    <div className="flex items-start mt-3 w-full">
      {stages.map((stage, idx) => {
        const isDone    = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        return (
          <div key={stage.value} className="flex-1 flex flex-col items-center relative">
            {idx > 0 && (
              <div className={`absolute top-3.5 right-1/2 w-full h-0.5 -translate-y-1/2 ${isDone || isCurrent ? "bg-green-300" : "bg-slate-200"}`} />
            )}
            <div className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center text-sm border-2 transition-colors ${
              isCurrent ? "border-blue-500 bg-blue-50 text-blue-600 font-bold" :
              isDone    ? "border-green-400 bg-green-50 text-green-600" :
                          "border-slate-200 bg-white text-slate-400"
            }`}>
              {isDone ? "✓" : stage.icon}
            </div>
            <span className={`text-[10px] mt-1 text-center leading-tight w-full px-1 ${
              isCurrent ? "text-blue-600 font-semibold" :
              isDone    ? "text-green-600" :
                          "text-slate-400"
            }`}>
              {stage.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Exportar pedido a Excel ──────────────────────────────────────────────────
function exportOrderExcel(order, customer) {
  const isMayorista = customer?.type === "MAYORISTA";
  const subtotal = order.total + (order.couponDiscount || 0) - (order.ivaAmount || 0);

  const headerRows = [
    ["Pedido #", order.id],
    ["Fecha", formatDate(order.createdAt)],
    ["Estado", order.status === "PENDING" ? "Pendiente de pago" : order.status === "PAYMENT_REVIEW" ? "Revisión de pago" : "Aprobado"],
    ["Cliente", order.customerName],
    ["Email", order.customerEmail],
    ...(order.customerPhone ? [["Teléfono", order.customerPhone]] : []),
    ["Método de pago", PAYMENT_LABEL[order.paymentMethod] || order.paymentMethod],
    ["Método de entrega", SHIPPING_LABEL[order.shippingMethod] || order.shippingMethod],
    ...(order.customerNote ? [["Nota del pedido", order.customerNote]] : []),
    [],
  ];

  // Variante omitida del Excel del cliente — solo aparece en el panel admin
  const itemHeader = ["Producto", "Precio unitario", "Cantidad", "Subtotal"];

  const itemRows = order.items.map((item) => [
    item.product?.name || "Producto eliminado",
    formatPrice(item.price),
    item.quantity,
    formatPrice(item.price * item.quantity),
  ]);

  const totalsRows = [
    [],
    ["", "", "", "Subtotal", formatPrice(subtotal)],
    ...(order.couponDiscount > 0
      ? [["", "", "", `Descuento (${order.coupon?.code || "cupón"})`, `−${formatPrice(order.couponDiscount)}`]]
      : []),
    ...(isMayorista && order.ivaAmount > 0
      ? [["", "", "", "IVA", formatPrice(order.ivaAmount)]]
      : []),
    ["", "", "", "TOTAL", formatPrice(order.total)],
  ];

  const wsData = [...headerRows, itemHeader, ...itemRows, ...totalsRows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws["!cols"] = [
    { wch: 38 },
    { wch: 16 },
    { wch: 10 },
    { wch: 16 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Pedido ${order.id}`);
  XLSX.writeFile(wb, `pedido-${order.id}.xlsx`);
}

// ── Exportar pedido a PDF (Blob → ventana de impresión) ──────────────────────
function exportOrderPDF(order, customer) {
  const isMayorista = customer?.type === "MAYORISTA";
  const hasDiscount = (order.couponDiscount || 0) > 0;
  const hasIva      = order.wantsInvoice && (order.ivaAmount || 0) > 0;
  const subtotalSinDesc = (order.items || []).reduce((s, i) => s + i.price * i.quantity, 0);

  const itemCards = (order.items || []).map((item) => {
    const imgSrc = item.product?.images?.[0] ? getImageUrl(item.product.images[0]) : null;
    const imgHtml = imgSrc
      ? `<img src="${imgSrc}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0;flex-shrink:0" />`
      : `<div style="width:40px;height:40px;background:#f1f5f9;border-radius:6px;border:1px solid #e2e8f0;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">📦</div>`;
    return `
    <tr>
      <td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;vertical-align:middle">
        <div style="display:flex;align-items:center;gap:10px">
          ${imgHtml}
          <div>
            <div style="font-weight:600;font-size:12px;color:#1e293b">${item.product?.name || "Producto eliminado"}</div>
            <div style="font-size:11px;color:#94a3b8">${formatPrice(item.price)} c/u × ${item.quantity} unid.</div>
          </div>
        </div>
      </td>
      <td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:700;color:#1e293b;white-space:nowrap;vertical-align:middle">${formatPrice(item.price * item.quantity)}</td>
    </tr>`;
  }).join("");

  const totalRows = [
    `<tr><td style="padding:4px 8px;font-size:12px;color:#64748b">Subtotal (${(order.items || []).reduce((s, i) => s + i.quantity, 0)} items)</td><td style="padding:4px 8px;text-align:right;font-size:12px;color:#64748b">${formatPrice(subtotalSinDesc)}</td></tr>`,
    hasDiscount ? `<tr><td style="padding:4px 8px;font-size:12px;color:#16a34a">🏷 Cupón${order.coupon?.code ? ` <strong>${order.coupon.code}</strong>` : ""}${order.coupon?.discountType === "PERCENTAGE" ? ` (${order.coupon.discountValue}% off)` : ""}</td><td style="padding:4px 8px;text-align:right;font-size:12px;color:#16a34a">− ${formatPrice(order.couponDiscount)}</td></tr>` : "",
    hasIva ? `<tr><td style="padding:4px 8px;font-size:12px;color:#64748b">IVA</td><td style="padding:4px 8px;text-align:right;font-size:12px;color:#64748b">+ ${formatPrice(order.ivaAmount)}</td></tr>` : "",
    `<tr style="border-top:2px solid #1e293b"><td style="padding:8px 8px 0;font-size:15px;font-weight:900;color:#1e293b">TOTAL</td><td style="padding:8px 8px 0;text-align:right;font-size:15px;font-weight:900;color:#1e293b">${formatPrice(order.total)}</td></tr>`,
  ].join("");

  const statusLabel  = order.status === "PENDING" ? "Pendiente de pago" : order.status === "PAYMENT_REVIEW" ? "Revisión de pago" : "Aprobado";
  const paymentLabel = PAYMENT_LABEL[order.paymentMethod] || order.paymentMethod;
  const shippingLabel = SHIPPING_LABEL[order.shippingMethod] || order.shippingMethod;
  const tipoLabel    = isMayorista ? "Mayorista" : "Minorista";

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
      <div class="row"><span class="row-label">Tipo</span><span class="row-value">${tipoLabel}</span></div>
      ${order.customerEmail ? `<div class="row"><span class="row-label">Email</span><span class="row-value" style="font-weight:400;font-size:11px">${order.customerEmail}</span></div>` : ""}
      ${order.customerPhone ? `<div class="row"><span class="row-label">Teléfono</span><span class="row-value">${order.customerPhone}</span></div>` : ""}
    </div>
    <div class="card">
      <div class="card-title">Pedido</div>
      <div class="row"><span class="row-label">Estado</span><span class="row-value">${statusLabel}</span></div>
      <div class="row"><span class="row-label">Pago</span><span class="row-value">${paymentLabel}</span></div>
      <div class="row"><span class="row-label">Entrega</span><span class="row-value">${shippingLabel}</span></div>
      ${order.wantsInvoice ? `<div class="row"><span class="row-label">Factura</span><span class="row-value" style="color:#2563eb">Solicitada — IVA 21%</span></div>` : ""}
    </div>
  </div>

  ${order.customerNote ? `<div class="note-box" style="background:#fffbeb;border:1px solid #fde68a;color:#92400e">💬 <strong>Nota del pedido:</strong> ${order.customerNote}</div>` : ""}

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
    if (loadingCustomer) return;
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

  const isMayorista = customer?.type === "MAYORISTA";

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
              <h1 className="text-2xl font-bold text-slate-800">Historial de pedidos</h1>
              <p className="text-sm text-slate-500">Pedidos pendientes y aprobados</p>
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

          {loading && (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && orders.length === 0 && (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">📦</div>
              <p className="text-slate-500 text-lg">Aún no tenés pedidos</p>
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
              const discount = order.couponDiscount || 0;
              const iva = order.ivaAmount || 0;
              const subtotal = order.total + discount - iva;

              return (
                <div key={order.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  {/* Cabecera del pedido */}
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-700">Pedido #{order.id}</span>
                          {order.status === "PENDING" ? (
                            <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
                              Pendiente de pago
                            </span>
                          ) : order.status === "PAYMENT_REVIEW" ? (
                            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">
                              Revisión de pago
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
                              Aprobado
                            </span>
                          )}
                          {order.isModified && (
                            <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full font-medium border border-orange-200">
                              ✏️ Modificado
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{formatDate(order.createdAt)}</p>
                        <p className="text-base font-bold text-slate-800 mt-1">{formatPrice(order.total)}</p>
                        <FulfillmentTracker status={order.fulfillmentStatus} shippingMethod={order.shippingMethod} />
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0 self-start flex-wrap justify-end">
                        {/* Ver detalle completo */}
                        <Link
                          to={`/pedidos/${order.id}`}
                          className="px-2.5 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
                        >
                          Ver detalle
                        </Link>

                        {/* Repetir pedido — solo para pedidos ya aprobados (no en revisión de pago) */}
                        {order.status !== "PENDING" && order.status !== "PAYMENT_REVIEW" && (
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
                            Repetir
                          </button>
                        )}

                        {/* Exportar — botones PDF y Excel (solo icono en mobile) */}
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => exportOrderPDF(order, customer)}
                            title="Descargar PDF"
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                            </svg>
                            <span className="hidden sm:inline">PDF</span>
                          </button>
                          <button
                            onClick={() => exportOrderExcel(order, customer)}
                            title="Exportar Excel"
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            <span className="hidden sm:inline">Excel</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Info rápida de método — siempre visible bajo el tracker */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
                      <span className="text-xs text-slate-500">
                        💳 {PAYMENT_LABEL[order.paymentMethod] || order.paymentMethod}
                      </span>
                      <span className="text-xs text-slate-500">
                        {SHIPPING_ICON[order.shippingMethod] || "📦"} {SHIPPING_LABEL[order.shippingMethod] || order.shippingMethod}
                      </span>
                      {order.coupon?.code && (
                        <span className="text-xs text-green-600 font-medium">
                          🏷️ Cupón: {order.coupon.code}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Detalle expandible de items */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 px-5 py-4 space-y-3">
                      {/* Nota del cliente */}
                      {order.customerNote && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-sm text-amber-800">
                          <span className="font-semibold">Nota del pedido:</span> {order.customerNote}
                        </div>
                      )}

                      {/* Items */}
                      {order.items.map((item) => {
                        const img = item.product?.images?.[0];
                        const discontinued = !item.product?.active;

                        return (
                          <div key={item.id} className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0">
                              {img ? (
                                <img
                                  src={getImageUrl(img)}
                                  alt={item.product?.name}
                                  className="w-full h-full object-contain p-0.5"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-300 text-xl">
                                  📦
                                </div>
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${discontinued ? "text-slate-400 line-through" : "text-slate-800"}`}>
                                {item.product?.name || "Producto eliminado"}
                              </p>
                              {discontinued && (
                                <span className="text-xs text-red-400">Producto no disponible</span>
                              )}
                              {/* variantLabel oculto al cliente — solo visible en el panel admin */}
                              <p className="text-xs text-slate-400">
                                {formatPrice(item.price)} × {item.quantity}
                              </p>
                            </div>

                            <p className="text-sm font-semibold text-slate-700 flex-shrink-0">
                              {formatPrice(item.price * item.quantity)}
                            </p>
                          </div>
                        );
                      })}

                      {/* Desglose de totales — subtotal solo si hay diferencias */}
                      <div className="border-t border-slate-100 pt-3 mt-1 space-y-1.5">
                        {(discount > 0 || (isMayorista && iva > 0)) && (
                          <div className="flex justify-between text-xs text-slate-400">
                            <span>Subtotal</span>
                            <span>{formatPrice(subtotal)}</span>
                          </div>
                        )}
                        {discount > 0 && (
                          <div className="flex justify-between text-xs text-green-600 font-medium">
                            <span>Cupón aplicado{order.coupon?.code ? ` (${order.coupon.code})` : ""}</span>
                            <span>−{formatPrice(discount)}</span>
                          </div>
                        )}
                        {isMayorista && iva > 0 && (
                          <div className="flex justify-between text-xs text-slate-400">
                            <span>IVA</span>
                            <span>+{formatPrice(iva)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm font-bold text-slate-800 pt-1 border-t border-slate-100">
                          <span>Total</span>
                          <span>{formatPrice(order.total)}</span>
                        </div>
                      </div>

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

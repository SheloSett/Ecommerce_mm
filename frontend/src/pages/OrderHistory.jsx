import { Fragment, useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useCart } from "../context/CartContext";
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
  RETIRO:           "store",
  ENVIO:            "local_shipping",
  CORREO_ARGENTINO: "mail",
};

// Etapas con iconos Material Symbols para pedidos con envío
const FULFILLMENT_STAGES_ENVIO = [
  { value: "PENDIENTE",      label: "Pendiente",      icon: "schedule" },
  { value: "EN_PREPARACION", label: "En preparación", icon: "inventory_2" },
  { value: "ENVIADO",        label: "Enviado",        icon: "local_shipping" },
  { value: "ENTREGADO",      label: "Entregado",      icon: "done_all" },
];

// "ENVIADO" en DB = "Pedido listo" para retiro en el local
const FULFILLMENT_STAGES_RETIRO = [
  { value: "PENDIENTE",      label: "Pendiente",      icon: "schedule" },
  { value: "EN_PREPARACION", label: "En preparación", icon: "inventory_2" },
  { value: "ENVIADO",        label: "Pedido listo",   icon: "storefront" },
  { value: "ENTREGADO",      label: "Entregado",      icon: "done_all" },
];

function FulfillmentTracker({ status = "PENDIENTE", shippingMethod = "RETIRO" }) {
  const stages =
    shippingMethod === "ENVIO" || shippingMethod === "CORREO_ARGENTINO"
      ? FULFILLMENT_STAGES_ENVIO
      : FULFILLMENT_STAGES_RETIRO;
  const currentIdx = stages.findIndex((s) => s.value === status);

  return (
    <div className="py-3 px-2 overflow-x-auto">
      <div className="flex items-center justify-between min-w-[400px]">
        {stages.map((stage, idx) => {
          const isDone    = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isActive  = isDone || isCurrent;
          return (
            <Fragment key={stage.value}>
              <div className="flex flex-col items-center gap-2 flex-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    isActive
                      ? "bg-[#00873a] text-[#f7fff2]"
                      : "bg-[#dce9ff] text-[#565e74] border border-[#bdcaba]"
                  }`}
                >
                  <span
                    className="material-symbols-outlined text-[18px]"
                    style={{
                      fontVariationSettings: isDone
                        ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20"
                        : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 20",
                    }}
                  >
                    {isDone ? "check_circle" : stage.icon}
                  </span>
                </div>
                <span
                  className={`text-[11px] text-center leading-tight font-semibold ${
                    isActive ? "text-[#006b2c]" : "text-[#565e74]"
                  }`}
                >
                  {stage.label}
                </span>
              </div>
              {idx < stages.length - 1 && (
                <div
                  className={`h-0.5 flex-grow mx-2 mb-5 ${
                    idx < currentIdx ? "bg-[#16A34A]" : "bg-[#e2e8f0]"
                  }`}
                />
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// Devuelve label y clase del badge según estado de pago + fulfillment
function getStatusDisplay(order) {
  if (order.status === "CANCELLED") {
    return { label: "Cancelado", cls: "bg-[#ffdad6] text-[#93000a]" };
  }
  if (order.status === "PENDING") {
    return { label: "Pendiente de pago", cls: "bg-amber-100 text-amber-800" };
  }
  if (order.status === "PAYMENT_REVIEW") {
    return { label: "En revisión", cls: "bg-blue-100 text-blue-700" };
  }
  if (order.status === "QUOTE_APPROVED") {
    return { label: "Aprobada s/pagar", cls: "bg-teal-100 text-teal-700" };
  }
  // APPROVED → mostrar estado de fulfillment
  const fMap = {
    PENDIENTE:      { label: "Pendiente",      cls: "bg-[#dce9ff] text-[#0051d5]" },
    EN_PREPARACION: { label: "En preparación", cls: "bg-[#00873a]/10 text-[#00873a]" },
    ENVIADO: {
      label: order.shippingMethod === "RETIRO" ? "Listo para retiro" : "Enviado",
      cls: "bg-[#00873a]/10 text-[#00873a]",
    },
    ENTREGADO: { label: "Entregado", cls: "bg-[#dce9ff] text-[#565e74]" },
  };
  return (
    fMap[order.fulfillmentStatus] || { label: "Abonada", cls: "bg-green-100 text-green-700" }
  );
}

// ── Exportar pedido a Excel ──────────────────────────────────────────────────
function exportOrderExcel(order, customer) {
  const isMayorista = customer?.type === "MAYORISTA";
  const subtotal = order.total + (order.couponDiscount || 0) - (order.ivaAmount || 0);

  const headerRows = [
    ["Pedido #", order.id],
    ["Fecha", formatDate(order.createdAt)],
    ["Estado", order.status === "PENDING" ? "Pendiente de pago" : order.status === "PAYMENT_REVIEW" ? "Revisión de pago" : order.status === "QUOTE_APPROVED" ? "Aprobada (sin pagar)" : "Abonada"],
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
  ws["!cols"] = [{ wch: 38 }, { wch: 16 }, { wch: 10 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Pedido ${order.id}`);
  XLSX.writeFile(wb, `pedido-${order.id}.xlsx`);
}

// ── Exportar pedido a PDF ──────────────────────────────────────────────────
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

  const statusLabel  = order.status === "PENDING" ? "Pendiente de pago" : order.status === "PAYMENT_REVIEW" ? "Revisión de pago" : order.status === "QUOTE_APPROVED" ? "Aprobada (sin pagar)" : "Abonada";
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

  const [orders, setOrders]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [repeatingId, setRepeatingId] = useState(null);
  const [expandedId, setExpandedId]   = useState(null);

  useEffect(() => {
    if (loadingCustomer) return;
    if (!customer) navigate("/login");
  }, [customer, loadingCustomer, navigate]);

  useEffect(() => {
    if (loadingCustomer || !customer) return;
    ordersApi
      .getMy()
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

  const toggleExpand = (id) => setExpandedId((prev) => (prev === id ? null : id));

  const isMayorista = customer?.type === "MAYORISTA";

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
              Consulta el estado de tus compras y solicitudes de cotización.
            </p>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-[#bdcaba] mb-8 overflow-x-auto whitespace-nowrap">
            <span className="px-6 py-4 text-sm font-bold text-[#006b2c] border-b-2 border-[#62df7d] -mb-[2px] tracking-wide">
              PEDIDOS
            </span>
            {isMayorista && (
              <Link
                to="/cotizaciones"
                className="px-6 py-4 text-sm font-semibold text-[#565e74] hover:text-[#0b1c30] tracking-wide transition-colors"
              >
                COTIZACIONES
              </Link>
            )}
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-4 border-[#00873a] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Empty */}
          {!loading && orders.length === 0 && (
            <div className="text-center py-20">
              <span className="material-symbols-outlined text-6xl text-[#bdcaba] mb-4 block">
                inventory_2
              </span>
              <p className="text-[#565e74] text-lg mb-4">Aún no tenés pedidos</p>
              <button
                onClick={() => navigate("/catalogo")}
                className="px-6 py-2.5 bg-[#00873a] text-white font-semibold rounded-[10px] hover:opacity-90 transition-all"
              >
                Ir al catálogo
              </button>
            </div>
          )}

          {/* Lista */}
          <div className="grid grid-cols-1 gap-6">
            {orders.map((order) => {
              const isExpanded  = expandedId === order.id;
              const isRepeating = repeatingId === order.id;
              const discount    = order.couponDiscount || 0;
              const iva         = order.ivaAmount || 0;
              const subtotal    = order.total + discount - iva;
              const isCancelled = order.status === "CANCELLED";
              const isDelivered =
                order.fulfillmentStatus === "ENTREGADO" && order.status === "APPROVED";
              const isActiveOrder = !isCancelled && !isDelivered;
              const { label: statusLabel, cls: statusCls } = getStatusDisplay(order);
              const firstTwo   = order.items.slice(0, 2);
              const extraCount = order.items.length - 2;

              return (
                <div
                  key={order.id}
                  className={`relative overflow-hidden bg-white rounded-xl border border-[#bdcaba]/30
                    shadow-[0px_4px_20px_rgba(15,23,42,0.05)]
                    hover:-translate-y-0.5 hover:shadow-[0px_8px_30px_rgba(15,23,42,0.08)]
                    transition-all duration-200
                    ${isCancelled ? "opacity-75 grayscale-[0.4]" : ""}`}
                >
                  {/* Strip lateral verde para pedidos activos */}
                  {isActiveOrder && (
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-[#00873a]" />
                  )}

                  <div className="p-6 flex flex-col gap-5">
                    {/* Header: ID + badge | precio + cantidad */}
                    <div className="flex flex-wrap justify-between items-start gap-4">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xl font-semibold text-[#0b1c30]">
                            Pedido #{order.id}
                          </span>
                          <span
                            className={`px-3 py-1 rounded-full text-[12px] font-bold tracking-wider ${statusCls}`}
                          >
                            {statusLabel.toUpperCase()}
                          </span>
                          {order.isModified && (
                            <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-medium border border-orange-200">
                              ✏️ Modificado
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-[#565e74]">
                          {formatDate(order.createdAt)}
                        </span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-2xl font-bold text-[#0b1c30]">
                          {formatPrice(order.total)}
                        </span>
                        <span className="text-xs text-[#565e74]">
                          {order.items.length} producto{order.items.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>

                    {/* Tracker — solo para pedidos no cancelados */}
                    {!isCancelled && (
                      <FulfillmentTracker
                        status={order.fulfillmentStatus}
                        shippingMethod={order.shippingMethod}
                      />
                    )}

                    {/* Footer de la card: thumbnails + chips + botones */}
                    <div className="flex flex-wrap justify-between items-center gap-4 pt-4 border-t border-[#bdcaba]/30">
                      {/* Thumbnails apilados + chip de envío */}
                      <div className="flex gap-4 items-center flex-wrap">
                        <div className="flex -space-x-3">
                          {firstTwo.map((item, i) => {
                            const img = item.product?.images?.[0];
                            return img ? (
                              <img
                                key={i}
                                src={getImageUrl(img)}
                                alt={item.product?.name}
                                className="w-10 h-12 object-cover rounded-md border-2 border-white shadow-sm"
                              />
                            ) : (
                              <div
                                key={i}
                                className="w-10 h-12 bg-[#dce9ff] border-2 border-white rounded-md flex items-center justify-center text-lg"
                              >
                                📦
                              </div>
                            );
                          })}
                          {extraCount > 0 && (
                            <div className="w-10 h-12 bg-[#dce9ff] border-2 border-white rounded-md flex items-center justify-center text-[#3e4a3d] font-bold text-xs">
                              +{extraCount}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 bg-[#dae2fd]/50 px-3 py-1.5 rounded-lg">
                          <span className="material-symbols-outlined text-[16px] text-[#565e74]">
                            {SHIPPING_ICON[order.shippingMethod] || "local_shipping"}
                          </span>
                          <span className="text-xs font-semibold text-[#0b1c30]">
                            {SHIPPING_LABEL[order.shippingMethod] || order.shippingMethod}
                          </span>
                        </div>
                        {order.coupon?.code && (
                          <div className="flex items-center gap-1 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg">
                            <span className="material-symbols-outlined text-[14px] text-green-600">
                              sell
                            </span>
                            <span className="text-xs font-semibold text-green-700">
                              {order.coupon.code}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Botones de acción */}
                      <div className="flex gap-2 items-center flex-wrap justify-end">
                        {/* Exportar PDF */}
                        <button
                          onClick={() => exportOrderPDF(order, customer)}
                          title="Descargar PDF"
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[16px]">print</span>
                          <span className="hidden sm:inline">PDF</span>
                        </button>
                        {/* Exportar Excel */}
                        <button
                          onClick={() => exportOrderExcel(order, customer)}
                          title="Exportar Excel"
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[16px]">download</span>
                          <span className="hidden sm:inline">Excel</span>
                        </button>
                        {/* Ver items (toggle inline) */}
                        <button
                          onClick={() => toggleExpand(order.id)}
                          className="flex items-center gap-1.5 px-4 py-2 border border-[#bdcaba] text-[#0b1c30] text-sm font-semibold rounded-[10px] hover:bg-[#dce9ff]/20 transition-all"
                        >
                          {isExpanded ? "Ocultar" : `Ver ${order.items.length} item${order.items.length !== 1 ? "s" : ""}`}
                        </button>
                        {/* Ver detalle completo */}
                        <Link
                          to={`/pedidos/${order.id}`}
                          className="px-4 py-2 border border-[#bdcaba] text-[#0b1c30] text-sm font-semibold rounded-[10px] hover:bg-[#dce9ff]/20 transition-all"
                        >
                          Ver detalle
                        </Link>
                        {/* Repetir pedido */}
                        {order.status !== "PENDING" && order.status !== "PAYMENT_REVIEW" && (
                          <button
                            onClick={() => handleRepeat(order)}
                            disabled={isRepeating || cartLoading}
                            className="flex items-center gap-2 px-5 py-2 bg-[#0b1c30] text-white text-sm font-semibold rounded-[10px] hover:opacity-90 disabled:opacity-50 transition-all"
                          >
                            {isRepeating ? (
                              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
                            ) : (
                              <span className="material-symbols-outlined text-[20px]">replay</span>
                            )}
                            Repetir pedido
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Nota del cliente — siempre visible si existe */}
                    {order.customerNote && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-sm text-amber-800">
                        <span className="font-semibold">Nota del pedido:</span>{" "}
                        {order.customerNote}
                      </div>
                    )}
                  </div>

                  {/* Items expandibles */}
                  {isExpanded && (
                    <div className="border-t border-[#bdcaba]/30 px-6 py-5 space-y-3 bg-[#f8f9ff]">
                      {order.items.map((item) => {
                        const img          = item.product?.images?.[0];
                        const discontinued = !item.product?.active;
                        return (
                          <div key={item.id} className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-lg bg-[#dce9ff] overflow-hidden flex-shrink-0">
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
                              <p
                                className={`text-sm font-medium truncate ${
                                  discontinued ? "text-slate-400 line-through" : "text-[#0b1c30]"
                                }`}
                              >
                                {item.product?.name || "Producto eliminado"}
                              </p>
                              {discontinued && (
                                <span className="text-xs text-red-400">
                                  Producto no disponible
                                </span>
                              )}
                              {/* variantLabel: visible solo si la eligió el cliente (no si la asignó el admin) */}
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
                                {formatPrice(item.price)} × {item.quantity}
                              </p>
                            </div>
                            <p className="text-sm font-semibold text-[#0b1c30] flex-shrink-0">
                              {formatPrice(item.price * item.quantity)}
                            </p>
                          </div>
                        );
                      })}

                      {/* Desglose de totales */}
                      <div className="border-t border-[#bdcaba]/30 pt-3 mt-1 space-y-1.5">
                        {(discount > 0 || (isMayorista && iva > 0)) && (
                          <div className="flex justify-between text-xs text-[#565e74]">
                            <span>Subtotal</span>
                            <span>{formatPrice(subtotal)}</span>
                          </div>
                        )}
                        {discount > 0 && (
                          <div className="flex justify-between text-xs text-green-600 font-medium">
                            <span>
                              Cupón{order.coupon?.code ? ` (${order.coupon.code})` : ""}
                            </span>
                            <span>−{formatPrice(discount)}</span>
                          </div>
                        )}
                        {isMayorista && iva > 0 && (
                          <div className="flex justify-between text-xs text-[#565e74]">
                            <span>IVA</span>
                            <span>+{formatPrice(iva)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm font-bold text-[#0b1c30] pt-1 border-t border-[#bdcaba]/30">
                          <span>Total</span>
                          <span>{formatPrice(order.total)}</span>
                        </div>
                      </div>

                      {order.items.some((i) => !i.product?.active) && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                          ⚠️ Algunos productos ya no están disponibles y no se agregarán al repetir el pedido.
                        </p>
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
    </>
  );
}

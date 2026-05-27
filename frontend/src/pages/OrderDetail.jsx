import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useCart } from "../context/CartContext";
import { ordersApi, getImageUrl } from "../services/api";
import Navbar from "../components/Navbar";
import toast from "react-hot-toast";

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("es-AR", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

function formatPrice(n) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n ?? 0);
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
  RETIRO: "🏪", ENVIO: "🚚", CORREO_ARGENTINO: "📮",
};

const FULFILLMENT_STAGES_ENVIO = [
  { value: "PENDIENTE",      label: "Pendiente",      icon: "🕐" },
  { value: "EN_PREPARACION", label: "En preparación", icon: "🔧" },
  { value: "ENVIADO",        label: "Enviado",        icon: "🚚" },
  { value: "ENTREGADO",      label: "Entregado",      icon: "✅" },
];

const FULFILLMENT_STAGES_RETIRO = [
  { value: "PENDIENTE",      label: "Pendiente",      icon: "🕐" },
  { value: "EN_PREPARACION", label: "En preparación", icon: "🔧" },
  { value: "ENVIADO",        label: "Pedido listo",   icon: "📦" },
  { value: "ENTREGADO",      label: "Entregado",      icon: "✅" },
];

function FulfillmentTracker({ status = "PENDIENTE", shippingMethod = "RETIRO" }) {
  const stages = (shippingMethod === "ENVIO" || shippingMethod === "CORREO_ARGENTINO")
    ? FULFILLMENT_STAGES_ENVIO : FULFILLMENT_STAGES_RETIRO;
  const currentIdx = stages.findIndex((s) => s.value === status);
  return (
    <div className="flex items-start w-full">
      {stages.map((stage, idx) => {
        const isDone    = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        return (
          <div key={stage.value} className="flex-1 flex flex-col items-center relative">
            {idx > 0 && (
              <div className={`absolute top-3.5 right-1/2 w-full h-0.5 -translate-y-1/2 ${isDone || isCurrent ? "bg-green-300" : "bg-slate-200"}`} />
            )}
            <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 transition-colors ${
              isCurrent ? "border-blue-500 bg-blue-50 text-blue-600 font-bold" :
              isDone    ? "border-green-400 bg-green-50 text-green-600" :
                          "border-slate-200 bg-white text-slate-400"
            }`}>
              {isDone ? "✓" : stage.icon}
            </div>
            <span className={`text-[11px] mt-1.5 text-center leading-tight w-full px-1 ${
              isCurrent ? "text-blue-600 font-semibold" :
              isDone    ? "text-green-600" : "text-slate-400"
            }`}>{stage.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function exportExcel(order, customer) {
  const isMayorista = customer?.type === "MAYORISTA";
  const subtotal = order.total + (order.couponDiscount || 0) - (order.ivaAmount || 0);
  const header = [
    ["Pedido #", order.id], ["Fecha", formatDate(order.createdAt)],
    ["Estado", order.status === "PENDING" ? "Pendiente de pago" : order.status === "PAYMENT_REVIEW" ? "Revisión de pago" : order.status === "QUOTE_APPROVED" ? "Aprobada (sin pagar)" : "Abonada"],
    ["Método de pago", PAYMENT_LABEL[order.paymentMethod] || order.paymentMethod],
    ["Método de entrega", SHIPPING_LABEL[order.shippingMethod] || order.shippingMethod],
    ...(order.customerNote ? [["Nota", order.customerNote]] : []),
    [],
  ];
  // Variante omitida del Excel del cliente — solo aparece en el panel admin
  const itemHeader = ["Producto", "Precio unitario", "Cantidad", "Subtotal"];
  const itemRows = order.items.map((i) => [
    i.product?.name || "Producto eliminado",
    formatPrice(i.price), i.quantity, formatPrice(i.price * i.quantity),
  ]);
  const totals = [
    [], ["", "", "", "Subtotal", formatPrice(subtotal)],
    ...(order.couponDiscount > 0 ? [["", "", "", `Descuento (${order.coupon?.code || "cupón"})`, `−${formatPrice(order.couponDiscount)}`]] : []),
    ...(isMayorista && order.ivaAmount > 0 ? [["", "", "", "IVA", formatPrice(order.ivaAmount)]] : []),
    ...(order.shippingCost > 0 ? [["", "", "", "Envío", formatPrice(order.shippingCost)]] : []),
    ["", "", "", "TOTAL", formatPrice(order.total)],
  ];
  const ws = XLSX.utils.aoa_to_sheet([...header, itemHeader, ...itemRows, ...totals]);
  ws["!cols"] = [{ wch: 38 }, { wch: 16 }, { wch: 10 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Pedido ${order.id}`);
  XLSX.writeFile(wb, `pedido-${order.id}.xlsx`);
}

function exportPDF(order, customer) {
  const isMayorista = customer?.type === "MAYORIST";
  const hasDiscount = (order.couponDiscount || 0) > 0;
  const hasIva      = order.wantsInvoice && (order.ivaAmount || 0) > 0;
  const subtotal    = (order.items || []).reduce((s, i) => s + i.price * i.quantity, 0);

  const itemRows = (order.items || []).map((item) => {
    const imgSrc = item.product?.images?.[0] ? getImageUrl(item.product.images[0]) : null;
    const img = imgSrc
      ? `<img src="${imgSrc}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0;flex-shrink:0"/>`
      : `<div style="width:40px;height:40px;background:#f1f5f9;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">📦</div>`;
    return `<tr>
      <td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;vertical-align:middle">
        <div style="display:flex;align-items:center;gap:10px">
          ${img}
          <div>
            <div style="font-weight:600;font-size:12px;color:#1e293b">${item.product?.name || "Producto eliminado"}</div>
            <div style="font-size:11px;color:#94a3b8">${formatPrice(item.price)} c/u × ${item.quantity}</div>
          </div>
        </div>
      </td>
      <td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:700;color:#1e293b;white-space:nowrap;vertical-align:middle">${formatPrice(item.price * item.quantity)}</td>
    </tr>`;
  }).join("");

  const totalRows = [
    `<tr><td style="padding:4px 8px;font-size:12px;color:#64748b">Subtotal</td><td style="padding:4px 8px;text-align:right;font-size:12px;color:#64748b">${formatPrice(subtotal)}</td></tr>`,
    hasDiscount ? `<tr><td style="padding:4px 8px;font-size:12px;color:#16a34a">Descuento (${order.coupon?.code || "cupón"})</td><td style="padding:4px 8px;text-align:right;font-size:12px;color:#16a34a">−${formatPrice(order.couponDiscount)}</td></tr>` : "",
    (order.shippingCost > 0) ? `<tr><td style="padding:4px 8px;font-size:12px;color:#64748b">Envío</td><td style="padding:4px 8px;text-align:right;font-size:12px;color:#64748b">+${formatPrice(order.shippingCost)}</td></tr>` : "",
    hasIva ? `<tr><td style="padding:4px 8px;font-size:12px;color:#64748b">IVA</td><td style="padding:4px 8px;text-align:right;font-size:12px;color:#64748b">+${formatPrice(order.ivaAmount)}</td></tr>` : "",
    `<tr style="border-top:2px solid #1e293b"><td style="padding:8px 8px 0;font-size:15px;font-weight:900;color:#1e293b">TOTAL</td><td style="padding:8px 8px 0;text-align:right;font-size:15px;font-weight:900;color:#1e293b">${formatPrice(order.total)}</td></tr>`,
  ].join("");

  const addr = order.shippingAddress;
  const addrHtml = addr
    ? `<div style="margin-bottom:14px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;color:#1e293b">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;font-weight:800;margin-bottom:6px">Dirección de envío</div>
        ${addr.street ? `<div>${addr.street}${addr.number ? ` ${addr.number}` : ""}${addr.floor ? ` ${addr.floor}` : ""}</div>` : ""}
        ${addr.city ? `<div>${addr.city}${addr.province ? `, ${addr.province}` : ""}</div>` : ""}
        ${addr.postalCode ? `<div>CP ${addr.postalCode}</div>` : ""}
      </div>` : "";

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><title>Pedido #${order.id}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:12px;color:#1e293b;background:#f1f5f9}.page{max-width:720px;margin:0 auto;background:#fff;padding:28px}.header{display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;border-bottom:2px solid #1e40af;margin-bottom:16px}.logo-name{font-size:18px;font-weight:900;color:#1e40af}.order-badge{background:#1e40af;color:#fff;border-radius:8px;padding:5px 14px;font-size:16px;font-weight:900}.order-date{font-size:10px;color:#94a3b8;text-align:right;margin-top:4px}table{width:100%;border-collapse:collapse}.totals-table{margin-left:auto;width:260px;margin-top:10px;border-top:1px solid #e2e8f0}.footer{margin-top:20px;padding-top:10px;border-top:1px solid #e2e8f0;color:#cbd5e1;font-size:9px;text-align:center}@media print{body{background:#fff}.page{padding:16px;max-width:100%}.print-btn{display:none!important}}</style>
  </head><body>
<div class="print-btn" style="position:fixed;top:12px;right:12px;z-index:9999">
  <button onclick="window.print()" style="background:#1e40af;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer">🖨️ Imprimir</button>
</div>
<div class="page">
  <div class="header"><div class="logo-name">⚡ IGWT Store</div><div><div class="order-badge">Pedido #${order.id}</div><div class="order-date">${formatDate(order.createdAt)}</div></div></div>
  <div style="display:flex;gap:10px;margin-bottom:14px">
    <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;font-weight:800;margin-bottom:8px">Pedido</div>
      <div style="margin-bottom:4px"><span style="font-size:10px;color:#94a3b8;min-width:72px;display:inline-block">Estado</span><span style="font-size:12px;font-weight:600">${order.status === "PENDING" ? "Pendiente de pago" : order.status === "PAYMENT_REVIEW" ? "Revisión de pago" : order.status === "QUOTE_APPROVED" ? "Aprobada (sin pagar)" : "Abonada"}</span></div>
      <div style="margin-bottom:4px"><span style="font-size:10px;color:#94a3b8;min-width:72px;display:inline-block">Pago</span><span style="font-size:12px;font-weight:600">${PAYMENT_LABEL[order.paymentMethod] || order.paymentMethod}</span></div>
      <div><span style="font-size:10px;color:#94a3b8;min-width:72px;display:inline-block">Entrega</span><span style="font-size:12px;font-weight:600">${SHIPPING_LABEL[order.shippingMethod] || order.shippingMethod}</span></div>
    </div>
  </div>
  ${addrHtml}
  ${order.customerNote ? `<div style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:6px;padding:7px 10px;margin-bottom:10px;font-size:11px">💬 <strong>Nota del pedido:</strong> ${order.customerNote}</div>` : ""}
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;font-weight:800;margin-bottom:6px">Productos</div>
  <table><tbody>${itemRows}</tbody></table>
  <table class="totals-table"><tbody>${totalRows}</tbody></table>
  <div class="footer">Generado el ${new Date().toLocaleString("es-AR")} · IGWT Store</div>
  </div></body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, "_blank", "width=820,height=760");
  win.onload = () => { win.focus(); URL.revokeObjectURL(url); };
}

export default function OrderDetail() {
  const { id } = useParams();
  const { customer, loadingCustomer } = useCustomerAuth();
  const { repeatOrder, loading: cartLoading } = useCart();
  const navigate = useNavigate();

  const [order, setOrder]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [repeating, setRepeating] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    if (loadingCustomer) return;
    if (!customer) { navigate("/login"); return; }
    ordersApi.getMyById(id)
      .then((res) => setOrder(res.data))
      .catch(() => { toast.error("No se encontró el pedido"); navigate("/pedidos"); })
      .finally(() => setLoading(false));
  }, [id, customer, loadingCustomer]);

  const handleRepeat = async () => {
    if (!order) return;
    const hasAvailable = order.items.some((i) => i.product?.active);
    if (!hasAvailable) {
      toast.error("Ninguno de los productos de este pedido está disponible actualmente.");
      return;
    }
    setRepeating(true);
    try {
      await repeatOrder(order.items);
      toast.success("Pedido cargado en el carrito");
      navigate("/carrito");
    } catch {
      toast.error("Error al repetir el pedido");
    } finally {
      setRepeating(false);
    }
  };

  if (loadingCustomer || loading) {
    return (
      <>
        <Navbar />
        <div className="ds-page min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </>
    );
  }

  if (!order) return null;

  const subtotalItems  = order.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const shippingCost   = order.shippingCost || 0;
  const couponDiscount = order.couponDiscount || 0;
  const ivaAmount      = order.ivaAmount || 0;

  // El snapshot puede ser un array (formato viejo) o un objeto { items, total, ivaAmount, couponDiscount } (formato nuevo)
  const rawSnap          = order.originalSnapshot;
  const isSnapObj        = rawSnap && !Array.isArray(rawSnap);
  const originalItems    = isSnapObj ? (rawSnap.items || []) : (rawSnap || []);
  const subtotalOriginal = originalItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const originalDiscount = isSnapObj ? (rawSnap.couponDiscount || 0) : couponDiscount;

  // IVA original: si el snapshot nuevo lo tiene guardado lo usamos; si no, lo estimamos
  // proporcionalmente (mismo porcentaje que el IVA actual sobre el subtotal actual).
  const ivaRate        = subtotalItems > 0 && ivaAmount > 0 ? ivaAmount / subtotalItems : 0;
  const originalIva    = isSnapObj
    ? (rawSnap.ivaAmount || 0)
    : Math.round(subtotalOriginal * ivaRate * 100) / 100;

  // Total original: guardado en nuevo formato, o calculado desde subtotal + IVA estimado
  const originalTotal  = isSnapObj
    ? rawSnap.total
    : (subtotalOriginal + originalIva - originalDiscount);
  const addr          = order.shippingAddress;
  const isEnvio       = order.shippingMethod !== "RETIRO";

  return (
    <>
      <Navbar />
      <div className="ds-page min-h-screen bg-slate-50 py-6 px-4">
        <div className="max-w-2xl mx-auto space-y-4">

          {/* Encabezado + volver */}
          <div className="flex items-center gap-3">
            <Link to="/pedidos" className="p-2 rounded-xl hover:bg-slate-200 transition-colors text-slate-500">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Pedido #{order.id}</h1>
              <p className="text-sm text-slate-500">{formatDate(order.createdAt)}</p>
            </div>
            <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
              {order.isModified && (
                <span className="text-xs px-2.5 py-1 bg-orange-100 text-orange-700 rounded-full font-semibold border border-orange-200">✏️ Modificado</span>
              )}
              {order.status === "PENDING" ? (
                <span className="text-xs px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full font-semibold">Pendiente de pago</span>
              ) : order.status === "PAYMENT_REVIEW" ? (
                <span className="text-xs px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full font-semibold">Revisión de pago</span>
              ) : order.status === "QUOTE_APPROVED" ? (
                <span className="text-xs px-2.5 py-1 bg-teal-100 text-teal-700 rounded-full font-semibold">Aprobada (sin pagar)</span>
              ) : (
                <span className="text-xs px-2.5 py-1 bg-green-100 text-green-700 rounded-full font-semibold">Abonada</span>
              )}
            </div>
          </div>

          {/* Estado de entrega */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-600 mb-4">Estado del pedido</h2>
            <FulfillmentTracker status={order.fulfillmentStatus} shippingMethod={order.shippingMethod} />
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-4 pt-4 border-t border-slate-100">
              <span className="text-sm text-slate-500">💳 {PAYMENT_LABEL[order.paymentMethod] || order.paymentMethod}</span>
              <span className="text-sm text-slate-500">{SHIPPING_ICON[order.shippingMethod] || "📦"} {SHIPPING_LABEL[order.shippingMethod] || order.shippingMethod}</span>
              {order.coupon?.code && (
                <span className="text-sm text-green-600 font-medium">🏷️ Cupón: {order.coupon.code}</span>
              )}
            </div>
            {/* Número de seguimiento */}
            {order.trackingNumber && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-sm text-slate-500">
                  📬 Seguimiento: <span className="font-semibold text-slate-700">{order.trackingNumber}</span>
                </p>
              </div>
            )}
          </div>

          {/* Mensaje de la tienda (adminNotes) */}
          {order.adminNotes && (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Mensaje de la tienda</p>
              <p className="text-sm text-blue-800">{order.adminNotes}</p>
            </div>
          )}

          {/* Nota del cliente */}
          {order.customerNote && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">Tu nota</p>
              <p className="text-sm text-amber-800">{order.customerNote}</p>
            </div>
          )}

          {/* Aviso de pedido modificado */}
          {order.isModified && (
            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide mb-0.5">Pedido modificado por la tienda</p>
                <p className="text-sm text-orange-800">La tienda realizó cambios en este pedido después del pago.</p>
              </div>
              {originalItems.length > 0 && (
                <button
                  onClick={() => setShowOriginal((v) => !v)}
                  className="flex-shrink-0 text-xs font-semibold text-orange-600 border border-orange-300 bg-white hover:bg-orange-50 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                >
                  {showOriginal ? "Ver versión actual" : "Ver original"}
                </button>
              )}
            </div>
          )}

          {/* Productos */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-600">
                {showOriginal ? "Pedido original" : "Productos"}{" "}
                <span className="text-slate-400 font-normal">
                  ({showOriginal ? originalItems.length : order.items.length})
                </span>
              </h2>
            </div>
            {showOriginal && (
              <div className="px-5 pt-3 pb-1">
                <p className="text-xs text-orange-600 font-medium bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
                  📋 Esta es la versión original antes de que la tienda realizara cambios.
                </p>
              </div>
            )}
            <div className="divide-y divide-slate-100">
              {(showOriginal ? originalItems : order.items).map((item, idx) => {
                const isOriginalView = showOriginal;
                const img = isOriginalView ? item.image : item.product?.images?.[0];
                const name = isOriginalView ? item.name : (item.product?.name || "Producto eliminado");
                const isActive = isOriginalView ? true : item.product?.active;
                return (
                  <div key={isOriginalView ? idx : item.id} className="flex items-center gap-3 px-5 py-4">
                    <div className="w-14 h-14 rounded-xl bg-slate-100 overflow-hidden flex-shrink-0">
                      {img ? (
                        <img src={getImageUrl(img)} alt={name} className="w-full h-full object-contain p-1" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-300 text-2xl">📦</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${!isActive ? "text-slate-400" : "text-slate-800"}`}>{name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{formatPrice(item.price)} × {item.quantity}</p>
                    </div>
                    <p className="text-sm font-bold text-slate-800 whitespace-nowrap">{formatPrice(item.price * item.quantity)}</p>
                  </div>
                );
              })}
            </div>

            {/* Desglose de precios */}
            {showOriginal ? (
              /* Vista original: desglose del pedido antes de la modificación */
              <div className="border-t border-slate-200 px-5 py-4 space-y-2">
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Subtotal original</span>
                  <span>{formatPrice(subtotalOriginal)}</span>
                </div>
                {originalDiscount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Descuento {order.coupon?.code ? `(${order.coupon.code})` : ""}</span>
                    <span>−{formatPrice(originalDiscount)}</span>
                  </div>
                )}
                {originalIva > 0 && (
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>IVA {!isSnapObj && <span className="text-xs text-slate-400">(estimado)</span>}</span>
                    <span>+{formatPrice(originalIva)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold text-slate-800 pt-2 border-t border-slate-200">
                  <span>Total original</span>
                  <span>{formatPrice(originalTotal)}</span>
                </div>
              </div>
            ) : (
              <div className="border-t border-slate-200 px-5 py-4 space-y-2">
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Subtotal</span>
                  <span>{formatPrice(subtotalItems)}</span>
                </div>
                {couponDiscount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Descuento {order.coupon?.code ? `(${order.coupon.code})` : ""}</span>
                    <span>−{formatPrice(couponDiscount)}</span>
                  </div>
                )}
                {shippingCost > 0 && (
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>Costo de envío</span>
                    <span>+{formatPrice(shippingCost)}</span>
                  </div>
                )}
                {ivaAmount > 0 && (
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>IVA</span>
                    <span>+{formatPrice(ivaAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold text-slate-800 pt-2 border-t border-slate-200">
                  <span>Total</span>
                  <span>{formatPrice(order.total)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Dirección de envío */}
          {isEnvio && addr && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
              <h2 className="text-sm font-semibold text-slate-600 mb-3">Dirección de envío</h2>
              <div className="text-sm text-slate-700 space-y-0.5">
                {addr.street && <p>{addr.street}{addr.number ? ` ${addr.number}` : ""}{addr.floor ? `, ${addr.floor}` : ""}</p>}
                {addr.city && <p>{addr.city}{addr.province ? `, ${addr.province}` : ""}</p>}
                {addr.postalCode && <p>CP {addr.postalCode}</p>}
              </div>
            </div>
          )}

          {/* Acciones */}
          <div className="flex flex-wrap gap-3">
            {/* "Repetir pedido" disponible en cualquier estado del pedido:
                el cliente puede querer rearmar el carrito para volver a pagar uno pendiente
                o para volver a comprar lo mismo que un pedido ya entregado. */}
            <button
              onClick={handleRepeat}
              disabled={repeating || cartLoading}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {repeating ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              Repetir pedido
            </button>
            <button
              onClick={() => exportPDF(order, customer)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Descargar PDF
            </button>
            <button
              onClick={() => exportExcel(order, customer)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-xl hover:bg-green-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Descargar Excel
            </button>
          </div>

        </div>
      </div>
    </>
  );
}

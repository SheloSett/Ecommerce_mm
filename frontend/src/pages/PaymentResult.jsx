import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { paymentsApi } from "../services/api";
import { useCart } from "../context/CartContext";
import { pixelPurchase } from "../services/metaPixel";

// Página de resultado después del pago en MercadoPago
export default function PaymentResult({ type }) {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get("orderId");
  const [order, setOrder] = useState(null);
  const [checked, setChecked] = useState(!orderId); // ya se consultó el estado real del pedido
  const { clearCart } = useCart();

  useEffect(() => {
    if (orderId) {
      // MP devuelve payment_id en la URL al redirigir — lo pasamos al backend para
      // que sincronice el estado de la orden con MP en caso de que el webhook no haya llegado.
      const paymentId = searchParams.get("payment_id") || searchParams.get("collection_id");
      paymentsApi
        .getOrderStatus(orderId, paymentId)
        .then((res) => {
          setOrder(res.data);
          // Antes: if (type === "success" || res.data.status === "APPROVED") — la dirección de
          // "éxito" no garantiza que el pago esté aprobado. Igual el servidor saca lo comprado del
          // carrito cuando se aprueba (utils/cartCleanup.js); esto solo actualiza la pantalla ya.
          if (res.data.status === "APPROVED") {
            clearCart();
            // Meta Pixel: compra confirmada. Mismo eventID que manda el servidor ("order-<id>"),
            // así Meta la cuenta una sola vez aunque lleguen los dos.
            pixelPurchase(res.data);
          }
        })
        .catch(console.error)
        .finally(() => setChecked(true));
    }
  }, [orderId]);

  // Qué se muestra: el estado REAL del pedido, no la dirección a la que volvió MercadoPago. Antes
  // salía solo de `type` (/pago/exitoso, /pago/fallido, /pago/pendiente) y una pestaña que volvía
  // por "fallido" mostraba "Pago rechazado" aunque el pedido ya estuviera pagado (ej. el cliente
  // pagó desde otro navegador). Mientras se consulta, "Verificando el pago…".
  const shown = !checked
    ? "checking"
    : order?.status === "APPROVED"
      ? "success"
      : order?.status === "REJECTED" || order?.status === "CANCELLED"
        ? "failure"
        : order && type === "success"
          ? "pending" // MP dijo que salió bien pero todavía no se confirmó: se está procesando
          : type;

  const configs = {
    checking: {
      icon: "🔄",
      color: "text-slate-600",
      bg: "bg-white",
      border: "border-slate-200",
      title: "Verificando el pago…",
      message: "Estamos confirmando el estado de tu pago con Mercado Pago.",
    },
    success: {
      icon: "✅",
      color: "text-green-600",
      bg: "bg-green-50",
      border: "border-green-200",
      title: "¡Pago exitoso!",
      message: "Tu compra fue procesada correctamente. Recibirás un email de confirmación.",
    },
    failure: {
      icon: "❌",
      color: "text-red-600",
      bg: "bg-red-50",
      border: "border-red-200",
      title: "Pago rechazado",
      message: "No pudimos procesar tu pago. Podés intentarlo nuevamente.",
    },
    pending: {
      icon: "⏳",
      color: "text-yellow-600",
      bg: "bg-yellow-50",
      border: "border-yellow-200",
      title: "Pago pendiente",
      message: "Tu pago está siendo procesado. Te notificaremos cuando se confirme.",
    },
  };

  // Antes: configs[type]
  const config = configs[shown] || configs.pending;

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className={`card p-8 text-center border ${config.border} ${config.bg}`}>
          <div className="text-6xl mb-4">{config.icon}</div>
          <h1 className={`text-2xl font-extrabold mb-2 ${config.color}`}>{config.title}</h1>
          <p className="text-slate-600 mb-6">{config.message}</p>

          {order && (
            <div className="bg-white rounded-xl p-4 text-left mb-6 border border-slate-200">
              <p className="text-sm font-semibold text-slate-700 mb-2">Detalle del pedido</p>
              <div className="text-sm text-slate-600 space-y-1">
                <div className="flex justify-between">
                  <span>Número de orden</span>
                  <span className="font-mono font-bold">#{order.id}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total</span>
                  <span className="font-bold">{formatPrice(order.total)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Cliente</span>
                  <span>{order.customerName}</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {/* Antes: (type === "success" || order?.status === "APPROVED") */}
            {shown === "success" && (
              <Link to="/pedidos" className="btn-primary text-center">
                Ver mis pedidos
              </Link>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <Link to="/" className="btn-secondary flex-1 text-center">
                Volver al inicio
              </Link>
              <Link to="/catalogo" className="btn-secondary flex-1 text-center">
                Seguir comprando
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

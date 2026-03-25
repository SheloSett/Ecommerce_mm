import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { paymentsApi } from "../services/api";
import { useCart } from "../context/CartContext";

// Página de resultado después del pago en MercadoPago
export default function PaymentResult({ type }) {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get("orderId");
  const [order, setOrder] = useState(null);
  const { clearCart } = useCart();

  useEffect(() => {
    if (orderId) {
      paymentsApi
        .getOrderStatus(orderId)
        .then((res) => {
          setOrder(res.data);
          // Limpiar el carrito solo si el pago fue aprobado
          if (type === "success" || res.data.status === "APPROVED") {
            clearCart();
          }
        })
        .catch(console.error);
    }
  }, [orderId]);

  const configs = {
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

  const config = configs[type] || configs.pending;

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

          <div className="flex flex-col sm:flex-row gap-3">
            <Link to="/" className="btn-primary flex-1 text-center">
              Volver al inicio
            </Link>
            <Link to="/catalogo" className="btn-secondary flex-1 text-center">
              Seguir comprando
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useCart } from "../context/CartContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { ordersApi, paymentsApi, couponsApi, getImageUrl } from "../services/api";
import toast from "react-hot-toast";

// Íconos de métodos de pago como SVG inline para no depender de librerías externas
function IconMP() {
  return (
    <svg viewBox="0 0 48 48" className="w-8 h-8" fill="none">
      <circle cx="24" cy="24" r="24" fill="#009EE3" />
      <text x="24" y="30" textAnchor="middle" fill="white" fontSize="16" fontWeight="bold">MP</text>
    </svg>
  );
}
function IconCash() {
  return (
    <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}
function IconTransfer() {
  return (
    <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
    </svg>
  );
}

export default function Checkout() {
  // totalPrice removido: el subtotal ahora siempre se calcula directamente desde items.price
  const { items, /* totalPrice, */ clearCart } = useCart();
  const { customer } = useCustomerAuth();
  const navigate = useNavigate();

  const isMayorista = customer?.type === "MAYORISTA";

  const [loading, setLoading] = useState(false);
  // Estado de éxito: null = en progreso, objeto = orden creada exitosamente (para no-MP)
  const [successOrder, setSuccessOrder] = useState(null);
  // SEGURIDAD: se eliminó la posibilidad de que el cliente edite precios.
  // Los precios siempre se calculan server-side en el backend.
  // const [customPrices, setCustomPrices] = useState({});
  // const [editingPriceId, setEditingPriceId] = useState(null);
  // Factura con IVA — solo para mayoristas
  const [wantsInvoice, setWantsInvoice] = useState(false);
  // IVA_RATE eliminado — el IVA ahora se calcula por producto según su campo ivaRate
  // Cupón de descuento aplicado
  const [couponCode, setCouponCode]         = useState("");
  const [couponResult, setCouponResult]     = useState(null); // { discountAmount, coupon }
  const [couponLoading, setCouponLoading]   = useState(false);

  // Pre-rellenar con datos del cliente si está logueado
  const [form, setForm] = useState({
    customerName:  customer?.name  || "",
    customerEmail: customer?.email || "",
    customerPhone: customer?.phone || "",
    customerCuit:  customer?.cuit  || "",
    documentType:  customer?.documentType || "DNI",
    customerNote:  "",
  });

  // Método de pago: mayoristas siempre usan COTIZACION; minoristas eligen
  const [paymentMethod, setPaymentMethod] = useState(
    isMayorista ? "COTIZACION" : "MERCADOPAGO"
  );

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);

  // SEGURIDAD: getItemPrice eliminado — el precio siempre viene del carrito (calculado server-side).
  // const getItemPrice = (item) => {
  //   const key = item.cartItemId ?? item.id;
  //   return customPrices[key] !== undefined ? customPrices[key] : item.price;
  // };

  // El subtotal siempre usa item.price directamente (sin permitir precios custom del cliente)
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  // Antes: isMayorista usaba getItemPrice para permitir edición — removido por seguridad
  // const subtotal = isMayorista
  //   ? items.reduce((s, i) => s + getItemPrice(i) * i.quantity, 0)
  //   : totalPrice;
  const couponDiscount = couponResult?.discountAmount || 0;
  const baseTotal = Math.max(0, subtotal - couponDiscount);
  // IVA calculado por producto según su campo ivaRate (10.5% o 21%).
  // Se aplica proporcionalmente al subtotal de cada item (ya descontado el cupón en forma proporcional).
  const ivaAmount = (isMayorista && wantsInvoice)
    ? items.reduce((acc, item) => {
        const rate = (item.ivaRate ?? 21) / 100;
        return acc + item.price * item.quantity * rate;
      }, 0)
    : 0;
  const finalTotal = baseTotal + ivaAmount;

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    try {
      const res = await couponsApi.validate(couponCode.trim(), subtotal, form.customerEmail);
      if (res.data.valid) {
        setCouponResult(res.data);
        toast.success(`Cupón aplicado: -${res.data.coupon.discountType === "PERCENTAGE" ? res.data.coupon.discountValue + "%" : formatPrice(res.data.discountAmount)}`);
      } else {
        setCouponResult(null);
        toast.error(res.data.error || "Cupón inválido");
      }
    } catch {
      toast.error("Error al validar el cupón");
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setCouponResult(null);
    setCouponCode("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (items.length === 0) {
      toast.error("Tu carrito está vacío");
      return;
    }
    if (!form.customerName || !form.customerEmail || !form.customerPhone || !form.customerCuit) {
      toast.error("Por favor completá los campos requeridos");
      return;
    }

    setLoading(true);
    try {
      // Crear la orden en la BD con el método de pago correspondiente
      const orderRes = await ordersApi.create({
        customerName:  form.customerName,
        customerEmail: form.customerEmail,
        customerPhone: form.customerPhone,
        // customerId vincula la orden a la cuenta del cliente registrado.
        // El email del formulario es solo para recibir confirmaciones/facturas.
        customerId:    customer?.id || null,
        items: items.map((i) => ({
          productId: i.id,
          quantity: i.quantity,
          // SEGURIDAD: customPrice removido — el backend ignora precios enviados por el cliente.
          // ...(customPrices[i.cartItemId ?? i.id] !== undefined && {
          //   customPrice: customPrices[i.cartItemId ?? i.id],
          // }),
        })),
        paymentMethod: isMayorista ? "COTIZACION" : paymentMethod,
        wantsInvoice: isMayorista ? wantsInvoice : false,
        ...(couponResult ? { couponCode: couponResult.coupon.code } : {}),
        ...(form.customerNote.trim() ? { customerNote: form.customerNote.trim() } : {}),
      });

      const order = orderRes.data;

      if (paymentMethod === "MERCADOPAGO" && !isMayorista) {
        // ── Flujo MercadoPago: redirigir al gateway (sin precios custom) ─────
        // El carrito se limpia en PaymentResult solo si el pago es aprobado
        const prefRes = await paymentsApi.createPreference(order.id);
        const redirectUrl = prefRes.data.sandboxInitPoint || prefRes.data.initPoint;
        window.location.href = redirectUrl;
      } else {
        // ── Flujo manual (Efectivo, Transferencia, Cotización) ───────────────
        // El carrito se limpia inmediatamente: la orden ya está registrada
        await clearCart();
        setSuccessOrder(order);
      }
    } catch (err) {
      const msg = err.response?.data?.error || "Error al procesar el pedido";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // ── Pantalla de éxito (no-MP) ────────────────────────────────────────────────
  if (successOrder) {
    const isCotizacion = successOrder.paymentMethod === "COTIZACION";
    return (
      <div className="min-h-screen flex flex-col bg-slate-50">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="card max-w-md w-full p-8 text-center space-y-6">
            <div className="text-6xl">{isCotizacion ? "📋" : "🎉"}</div>
            <h1 className="text-2xl font-extrabold text-slate-900">
              {isCotizacion ? "¡Cotización enviada!" : "¡Pedido confirmado!"}
            </h1>
            <p className="text-slate-600">
              {isCotizacion
                ? "Recibimos tu solicitud de cotización. Te contactaremos a la brevedad para coordinar precio y entrega."
                : successOrder.paymentMethod === "TRANSFERENCIA"
                ? "Recibimos tu pedido. Realizá la transferencia y envianos el comprobante para confirmar."
                : "Recibimos tu pedido. Nos pondremos en contacto para coordinar el pago y la entrega."}
            </p>

            {/* Detalle del pedido */}
            <div className="bg-slate-50 rounded-xl p-4 text-left space-y-2 border border-slate-200">
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-1">
                {isCotizacion ? `Cotización #${successOrder.id}` : `Pedido #${successOrder.id}`}
              </p>
              {successOrder.items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-slate-700">{item.name || "Producto"} x{item.quantity}</span>
                  <span className="font-medium text-slate-900">{formatPrice(item.price * item.quantity)}</span>
                </div>
              ))}
              {/* Cupón aplicado */}
              {couponResult && (
                <div className="flex justify-between text-sm text-green-700 font-medium border-t border-slate-200 pt-2">
                  <span>
                    Cupón{" "}
                    <span className="font-mono text-xs tracking-widest bg-green-100 px-1.5 py-0.5 rounded">
                      {couponResult.coupon.code}
                    </span>
                  </span>
                  <span>−{formatPrice(couponResult.discountAmount)}</span>
                </div>
              )}
              {/* IVA si solicitó factura — usar el valor real guardado en la orden */}
              {successOrder.ivaAmount > 0 && (
                <div className={`flex justify-between text-sm text-slate-600 ${!couponResult ? "border-t border-slate-200 pt-2" : ""}`}>
                  <span>IVA</span>
                  <span>+{formatPrice(successOrder.ivaAmount)}</span>
                </div>
              )}
              <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-slate-900">
                <span>{isCotizacion ? "Total estimado" : "Total"}</span>
                <span>{formatPrice(successOrder.total)}</span>
              </div>
            </div>

            <p className="text-xs text-slate-400">
              Se envió un email con los detalles a <strong>{successOrder.customerEmail}</strong>
            </p>

            <div className="flex gap-3">
              <Link to="/" className="btn-secondary flex-1 text-center">
                Ir al inicio
              </Link>
              <Link to="/catalogo" className="btn-primary flex-1 text-center">
                Seguir comprando
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Carrito vacío ────────────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
          <p className="text-6xl mb-4">🛒</p>
          <p className="text-xl font-medium mb-4">Tu carrito está vacío</p>
          <Link to="/catalogo" className="btn-primary">Ver productos</Link>
        </div>
      </div>
    );
  }

  // ── Formulario de checkout ───────────────────────────────────────────────────
  const submitLabel = () => {
    if (loading) return null;
    if (isMayorista) return "Enviar cotización →";
    if (paymentMethod === "MERCADOPAGO") return `Pagar ${formatPrice(finalTotal)} con MercadoPago →`;
    return `Confirmar pedido — ${formatPrice(finalTotal)} →`;
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Navbar />
      <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-8">
          {isMayorista ? "Solicitar cotización" : "Finalizar compra"}
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* ── Formulario ────────────────────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="lg:col-span-3 space-y-6">

            {/* Datos del cliente */}
            <div className="card p-6">
              <h2 className="text-lg font-bold text-slate-800 mb-4">Tus datos</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Nombre completo *
                  </label>
                  <input
                    type="text"
                    name="customerName"
                    value={form.customerName}
                    onChange={handleChange}
                    className="input"
                    placeholder="Ej: María González"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    name="customerEmail"
                    value={form.customerEmail}
                    onChange={handleChange}
                    className="input"
                    placeholder="tu@email.com"
                    required
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    {isMayorista
                      ? "Recibirás los detalles de la cotización en este email."
                      : "Recibirás la confirmación de tu pedido en este email."}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Teléfono *
                  </label>
                  <input
                    type="tel"
                    name="customerPhone"
                    value={form.customerPhone}
                    onChange={handleChange}
                    className="input"
                    placeholder="+54 11 1234-5678"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Documento *
                  </label>
                  <div className="flex gap-2">
                    {/* Selector de tipo */}
                    <div className="flex rounded-xl border border-slate-300 overflow-hidden text-sm">
                      {["DNI", "CUIT", "CUIL"].map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setForm((p) => ({ ...p, documentType: type }))}
                          className={`px-3 py-2 font-medium transition-colors ${
                            form.documentType === type
                              ? "bg-blue-600 text-white"
                              : "bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                    {/* Número de documento */}
                    <input
                      type="text"
                      name="customerCuit"
                      value={form.customerCuit}
                      onChange={handleChange}
                      className="input flex-1"
                      placeholder={form.documentType === "DNI" ? "12345678" : "20-12345678-9"}
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Comentarios u observaciones
                  </label>
                  <textarea
                    name="customerNote"
                    value={form.customerNote}
                    onChange={handleChange}
                    rows={3}
                    maxLength={500}
                    className="input resize-none bg-white text-slate-800 placeholder:text-slate-400"
                    placeholder="Ej: entregar en horario de la tarde, producto de regalo, consulta especial..."
                  />
                  <p className="text-xs text-slate-400 mt-1">{form.customerNote.length}/500</p>
                </div>
              </div>
            </div>

            {/* ── MAYORISTA: "A convenir" ────────────────────────────────── */}
            {isMayorista && (
              <div className="card p-6 bg-green-50 border-green-200">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">🤝</span>
                  <h3 className="font-semibold text-green-900">Precio a convenir</h3>
                </div>
                <p className="text-sm text-green-800">
                  Enviaremos tu cotización para confirmar la disponibilidad de stock de todos los productos
                  solicitados. Te contactaremos a la brevedad con la confirmación y los detalles de entrega.
                </p>
              </div>
            )}

            {/* ── MINORISTA: selector de método de pago ─────────────────── */}
            {!isMayorista && (
              <div className="card p-6">
                <h2 className="text-lg font-bold text-slate-800 mb-4">Método de pago</h2>
                <div className="space-y-3">

                  {/* MercadoPago */}
                  <label className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-colors ${paymentMethod === "MERCADOPAGO" ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="MERCADOPAGO"
                      checked={paymentMethod === "MERCADOPAGO"}
                      onChange={() => setPaymentMethod("MERCADOPAGO")}
                      className="sr-only"
                    />
                    <IconMP />
                    <div className="flex-1">
                      <p className="font-semibold text-slate-800">MercadoPago</p>
                      <p className="text-xs text-slate-500">Tarjeta de crédito, débito o efectivo</p>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${paymentMethod === "MERCADOPAGO" ? "border-blue-500 bg-blue-500" : "border-slate-300"}`} />
                  </label>

                  {/* Efectivo */}
                  <label className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-colors ${paymentMethod === "EFECTIVO" ? "border-green-500 bg-green-50" : "border-slate-200 hover:border-slate-300"}`}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="EFECTIVO"
                      checked={paymentMethod === "EFECTIVO"}
                      onChange={() => setPaymentMethod("EFECTIVO")}
                      className="sr-only"
                    />
                    <IconCash />
                    <div className="flex-1">
                      <p className="font-semibold text-slate-800">Efectivo</p>
                      <p className="text-xs text-slate-500">Te contactamos para coordinar el pago y la entrega</p>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${paymentMethod === "EFECTIVO" ? "border-green-500 bg-green-500" : "border-slate-300"}`} />
                  </label>

                  {/* Transferencia */}
                  <label className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-colors ${paymentMethod === "TRANSFERENCIA" ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-slate-300"}`}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="TRANSFERENCIA"
                      checked={paymentMethod === "TRANSFERENCIA"}
                      onChange={() => setPaymentMethod("TRANSFERENCIA")}
                      className="sr-only"
                    />
                    <IconTransfer />
                    <div className="flex-1">
                      <p className="font-semibold text-slate-800">Transferencia bancaria</p>
                      <p className="text-xs text-slate-500">Envianos el comprobante para confirmar tu pedido</p>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${paymentMethod === "TRANSFERENCIA" ? "border-indigo-500 bg-indigo-500" : "border-slate-300"}`} />
                  </label>

                </div>
              </div>
            )}

            {/* Botón principal */}
            <button
              type="submit"
              disabled={loading}
              className={`w-full py-4 text-lg font-bold rounded-xl transition-colors ${
                isMayorista
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "btn-primary"
              } disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                  Procesando...
                </span>
              ) : (
                submitLabel()
              )}
            </button>
          </form>

          {/* ── Resumen del pedido ─────────────────────────────────────────── */}
          <div className="lg:col-span-2">
            <div className="card p-6 sticky top-20">
              <h2 className="text-lg font-bold text-slate-800 mb-4">Resumen del pedido</h2>

              <div className="space-y-3 mb-4 max-h-72 overflow-y-auto">
                {items.map((item) => {
                  const img = item.images?.[0];
                  const key = item.cartItemId ?? item.id;
                  // SEGURIDAD: precio siempre de item.price, nunca editable por el cliente.
                  // Antes existía un input editable con lápiz para mayoristas (removido).
                  const price = item.price;
                  // const isEditing = editingPriceId === key; // removido junto con la edición
                  return (
                    <div key={key} className="flex gap-3">
                      <div className="w-14 h-14 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                        {img ? (
                          <img src={getImageUrl(img)} alt={item.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xl">📦</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{item.name}</p>

                        {/* Precio de solo lectura — igual para minoristas y mayoristas */}
                        <p className="text-xs text-slate-500">x{item.quantity} · {formatPrice(price)} c/u</p>

                        {/* Bloque de precio editable para mayoristas REMOVIDO por seguridad:
                        {isMayorista ? (
                          <div className="flex items-center gap-1 mt-0.5">
                            ... input editable con lápiz ...
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">x{item.quantity} · {formatPrice(price)} c/u</p>
                        )} */}

                        <p className="text-sm font-bold text-slate-900">{formatPrice(price * item.quantity)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-2">
                <div className="flex justify-between text-sm text-slate-600">
                  <span>Subtotal ({items.reduce((s, i) => s + i.quantity, 0)} productos)</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>

                {/* Cupón de descuento — para todos los clientes registrados */}
                {(
                  <div className="pt-1">
                    {couponResult ? (
                      <div className="flex items-center justify-between text-sm text-green-700 font-medium bg-green-50 rounded-lg px-3 py-2">
                        <div>
                          <span className="font-mono font-bold text-xs tracking-widest">{couponResult.coupon.code}</span>
                          <span className="ml-2">
                            {couponResult.coupon.discountType === "PERCENTAGE"
                              ? `−${couponResult.coupon.discountValue}%`
                              : `−${formatPrice(couponResult.discountAmount)}`}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={handleRemoveCoupon}
                          className="text-green-500 hover:text-red-500 text-xs underline"
                        >
                          Quitar
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={couponCode}
                          onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleApplyCoupon())}
                          placeholder="Código de cupón"
                          className="input flex-1 text-sm font-mono tracking-widest py-2"
                        />
                        <button
                          type="button"
                          onClick={handleApplyCoupon}
                          disabled={couponLoading || !couponCode.trim()}
                          className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                        >
                          {couponLoading ? "..." : "Aplicar"}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {couponDiscount > 0 && (
                  <div className="flex justify-between text-sm text-green-700 font-semibold">
                    <span>Descuento cupón</span>
                    <span>−{formatPrice(couponDiscount)}</span>
                  </div>
                )}

                {/* Opción de factura con IVA — solo para mayoristas */}
                {isMayorista && (
                  <label className="flex items-center gap-2.5 py-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={wantsInvoice}
                      onChange={(e) => setWantsInvoice(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                    />
                    <span className="text-sm text-slate-700">
                      Quiero factura <span className="text-slate-400 font-normal">(+ IVA)</span>
                    </span>
                  </label>
                )}

                {/* Línea de IVA — visible solo cuando está tildado */}
                {ivaAmount > 0 && (
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>IVA</span>
                    <span>+{formatPrice(ivaAmount)}</span>
                  </div>
                )}

                {isMayorista && (
                  <div className="flex justify-between text-sm text-green-700 font-medium">
                    <span>Precio final</span>
                    <span>A convenir</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg text-slate-900">
                  <span>{isMayorista ? "Total estimado" : "Total"}</span>
                  <span>{formatPrice(finalTotal)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

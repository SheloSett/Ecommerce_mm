import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { useCart } from "../context/CartContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { ordersApi, paymentsApi, couponsApi, shippingApi, getImageUrl } from "../services/api";
import { useSiteConfig } from "../context/SiteConfigContext";
import toast from "react-hot-toast";

// Provincias argentinas con sus códigos para el selector de Correo Argentino
const PROVINCES = [
  { code: "C", name: "CABA" },
  { code: "B", name: "Buenos Aires" },
  { code: "X", name: "Córdoba" },
  { code: "S", name: "Santa Fe" },
  { code: "M", name: "Mendoza" },
  { code: "T", name: "Tucumán" },
  { code: "E", name: "Entre Ríos" },
  { code: "A", name: "Salta" },
  { code: "N", name: "Misiones" },
  { code: "W", name: "Corrientes" },
  { code: "H", name: "Chaco" },
  { code: "G", name: "Santiago del Estero" },
  { code: "K", name: "Catamarca" },
  { code: "J", name: "San Juan" },
  { code: "D", name: "San Luis" },
  { code: "P", name: "Formosa" },
  { code: "R", name: "Río Negro" },
  { code: "Q", name: "Neuquén" },
  { code: "F", name: "La Rioja" },
  { code: "L", name: "La Pampa" },
  { code: "Y", name: "Jujuy" },
  { code: "U", name: "Chubut" },
  { code: "Z", name: "Santa Cruz" },
  { code: "V", name: "Tierra del Fuego" },
];

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
  const { mayoristaMinimoCompra } = useSiteConfig();
  const navigate = useNavigate();

  const isMayorista = customer?.type === "MAYORISTA";
  // Items sin stock: bloquea el checkout aunque el cliente entre por URL directa
  const hasOutOfStock = items.some((i) => i.outOfStock);

  // Si el cliente entra a /checkout con items sin stock en su carrito,
  // lo mandamos de vuelta a /carrito (que es donde se ven los items y el aviso)
  useEffect(() => {
    if (items.length === 0) return; // si el carrito está vacío, otro return ya lo maneja
    if (hasOutOfStock) {
      toast.error("Tenés productos sin stock. Eliminalos antes de finalizar la compra.");
      navigate("/carrito");
    }
  }, [hasOutOfStock, items.length, navigate]);

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
  const [couponCode, setCouponCode]       = useState("");
  const [couponResult, setCouponResult]   = useState(null); // { discountAmount, coupon }
  const [couponLoading, setCouponLoading] = useState(false);

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

  // Método de envío: "RETIRO" = retirar en el local, "ENVIO" = acordar envío, "CORREO_ARGENTINO" = Correo Argentino
  const [shippingMethod, setShippingMethod] = useState("RETIRO");

  // Datos de dirección para CORREO_ARGENTINO
  const [shippingAddress, setShippingAddress] = useState({
    streetName: "", streetNumber: "", floor: "", apartment: "",
    city: "", provinceCode: "C", postalCode: "",
  });
  // Tarifa de envío cotizada en tiempo real (null = no cotizada aún)
  const [shippingRate, setShippingRate] = useState(null);
  const [rateLoading, setRateLoading]   = useState(false);

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);

  const subtotal       = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const couponDiscount = couponResult?.discountAmount || 0;
  const baseTotal      = Math.max(0, subtotal - couponDiscount);
  // IVA calculado por producto según su campo ivaRate (10.5% o 21%).
  const ivaAmount = (isMayorista && wantsInvoice)
    ? items.reduce((acc, item) => {
        const rate = (item.ivaRate ?? 21) / 100;
        return acc + item.price * item.quantity * rate;
      }, 0)
    : 0;
  // Costo de envío: solo aplica si el método es CORREO_ARGENTINO y ya se cotizó
  const shippingCost = shippingMethod === "CORREO_ARGENTINO" ? (shippingRate?.price || 0) : 0;
  const finalTotal   = baseTotal + ivaAmount + shippingCost;

  // Actualizar handler de dirección de envío
  const handleShippingAddressChange = (e) => {
    setShippingAddress((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  // Cotizar automáticamente cuando cambia el CP destino (debounce 800ms)
  useEffect(() => {
    if (shippingMethod !== "CORREO_ARGENTINO") return;
    if (shippingAddress.postalCode.length < 4) { setShippingRate(null); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setRateLoading(true);
      try {
        const res = await shippingApi.getRates(shippingAddress.postalCode);
        if (!cancelled) setShippingRate(res.data);
      } catch {
        if (!cancelled) setShippingRate(null);
      } finally {
        if (!cancelled) setRateLoading(false);
      }
    }, 800);
    return () => { cancelled = true; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shippingAddress.postalCode, shippingMethod]);

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
    if (hasOutOfStock) {
      toast.error("Hay productos sin stock en tu carrito. Eliminalos para continuar.");
      navigate("/carrito");
      return;
    }
    if (!form.customerName || !form.customerEmail || !form.customerPhone || !form.customerCuit) {
      toast.error("Por favor completá los campos requeridos");
      return;
    }
    // Validar dirección y cotización si se eligió Correo Argentino
    if (shippingMethod === "CORREO_ARGENTINO") {
      const { streetName, streetNumber, city, provinceCode, postalCode } = shippingAddress;
      if (!streetName || !streetNumber || !city || !provinceCode || !postalCode) {
        toast.error("Completá todos los campos de dirección de envío");
        return;
      }
      // No permitir continuar sin cotización confirmada
      if (!shippingRate || shippingCost === 0) {
        toast.error("Ingresá el código postal para cotizar el envío antes de continuar");
        return;
      }
    }
    if (isMayorista && mayoristaMinimoCompra > 0 && subtotal < mayoristaMinimoCompra) {
      toast.error(`El pedido mínimo mayorista es ${formatPrice(mayoristaMinimoCompra)}`);
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
        customerId:    customer?.id || null,
        items: items.map((i) => ({
          productId:    i.id,
          quantity:     i.quantity,
          variantId:    i.variantId   || null,
          variantLabel: i.variantLabel || null,
        })),
        paymentMethod: isMayorista ? "COTIZACION" : paymentMethod,
        shippingMethod,
        // Incluir dirección y costo si el método es Correo Argentino
        ...(shippingMethod === "CORREO_ARGENTINO" ? {
          shippingAddress,
          shippingCost,
        } : {}),
        wantsInvoice: isMayorista ? wantsInvoice : false,
        ...(couponResult ? { couponCode: couponResult.coupon.code } : {}),
        ...(form.customerNote.trim() ? { customerNote: form.customerNote.trim() } : {}),
      });

      const order = orderRes.data;

      if (paymentMethod === "MERCADOPAGO" && !isMayorista) {
        // ── Flujo MercadoPago: redirigir al gateway ──────────────────────────
        // IMPORTANTE: en dev usar sandboxInitPoint (test); en prod usar initPoint (real).
        const prefRes    = await paymentsApi.createPreference(order.id);
        const redirectUrl = import.meta.env.DEV
          ? prefRes.data.sandboxInitPoint
          : prefRes.data.initPoint;
        window.location.href = redirectUrl;
      } else {
        // ── Flujo manual (Efectivo, Transferencia, Cotización) ───────────────
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
      <div className="storefront min-h-screen flex flex-col bg-[#f8f9ff]">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="bg-white rounded-2xl border border-[#bdcaba]/30 shadow-[0px_4px_20px_rgba(15,23,42,0.08)] max-w-md w-full p-8 text-center space-y-6">
            {/* Ícono de éxito */}
            <div className="w-20 h-20 rounded-full bg-[#7ffc97]/30 flex items-center justify-center mx-auto">
              <span
                className="material-symbols-outlined text-[48px] text-[#006b2c]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {isCotizacion ? "description" : "check_circle"}
              </span>
            </div>

            {/* Título */}
            <div>
              <h1 className="text-2xl font-extrabold text-[#0b1c30]">
                {isCotizacion ? "¡Cotización enviada!" : "¡Pedido confirmado!"}
              </h1>
              <p className="text-[#565e74] mt-2 text-sm leading-relaxed">
                {isCotizacion
                  ? "Recibimos tu solicitud de cotización. Te contactaremos a la brevedad para coordinar precio y entrega."
                  : successOrder.paymentMethod === "TRANSFERENCIA"
                  ? "Recibimos tu pedido. Realizá la transferencia y envianos el comprobante para confirmar."
                  : "Recibimos tu pedido. Nos pondremos en contacto para coordinar el pago y la entrega."}
              </p>
            </div>

            {/* Detalle del pedido */}
            <div className="bg-[#f8f9ff] rounded-xl p-4 text-left space-y-2 border border-[#bdcaba]/30">
              <p className="text-xs text-[#565e74] font-bold uppercase tracking-wider mb-2">
                {isCotizacion ? `Cotización #${successOrder.id}` : `Pedido #${successOrder.id}`}
              </p>
              {successOrder.items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm gap-2">
                  <div>
                    <span className="text-[#0b1c30]">{item.product?.name || "Producto"} x{item.quantity}</span>
                    {/* Variante — visible para cualquier cliente que la haya elegido (antes ocultaba a mayoristas) */}
                    {item.variantLabel && (
                      <span className="text-xs text-[#0051d5] ml-1">({item.variantLabel})</span>
                    )}
                  </div>
                  <span className="font-semibold text-[#0b1c30] shrink-0">{formatPrice(item.price * item.quantity)}</span>
                </div>
              ))}
              {/* Cupón aplicado */}
              {couponResult && (
                <div className="flex justify-between text-sm text-[#006b2c] font-medium border-t border-[#bdcaba]/30 pt-2">
                  <span>
                    Cupón{" "}
                    <span className="font-mono text-xs tracking-widest bg-[#7ffc97]/30 px-1.5 py-0.5 rounded">
                      {couponResult.coupon.code}
                    </span>
                  </span>
                  <span>−{formatPrice(couponResult.discountAmount)}</span>
                </div>
              )}
              {/* IVA si solicitó factura — usar el valor real guardado en la orden */}
              {successOrder.ivaAmount > 0 && (
                <div className={`flex justify-between text-sm text-[#565e74] ${!couponResult ? "border-t border-[#bdcaba]/30 pt-2" : ""}`}>
                  <span>IVA</span>
                  <span>+{formatPrice(successOrder.ivaAmount)}</span>
                </div>
              )}
              <div className="border-t border-[#bdcaba]/30 pt-2 flex justify-between font-bold text-[#0b1c30]">
                <span>{isCotizacion ? "Total estimado" : "Total"}</span>
                <span>{formatPrice(successOrder.total)}</span>
              </div>
            </div>

            {/* Método de entrega confirmado */}
            <div className="flex items-start gap-3 bg-[#eff4ff] border border-[#bdcaba]/30 rounded-xl px-4 py-3 text-sm text-[#565e74] text-left">
              <span
                className="material-symbols-outlined text-[#006b2c] flex-shrink-0 mt-0.5"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {successOrder.shippingMethod === "CORREO_ARGENTINO"
                  ? "local_post_office"
                  : successOrder.shippingMethod === "ENVIO"
                  ? "local_shipping"
                  : "storefront"}
              </span>
              <span>
                {successOrder.shippingMethod === "CORREO_ARGENTINO"
                  ? "Tu pedido se enviará por Correo Argentino. Te informaremos el número de seguimiento cuando el envío esté listo."
                  : successOrder.shippingMethod === "ENVIO"
                  ? "Acordamos el envío por WhatsApp una vez confirmado el pedido."
                  : "Retiro en el local — Av. La Plata 744 Timbre 3, CABA."}
              </span>
            </div>

            <p className="text-xs text-[#565e74]">
              Se envió un email con los detalles a <strong>{successOrder.customerEmail}</strong>
            </p>

            <div className="flex flex-col gap-3">
              <Link
                to={isCotizacion ? "/cotizaciones" : "/pedidos"}
                className="w-full py-3.5 bg-[#00873a] text-white font-bold rounded-[10px] hover:brightness-110 transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[20px]">
                  {isCotizacion ? "request_quote" : "receipt_long"}
                </span>
                {isCotizacion ? "Ver mis cotizaciones" : "Ver mis pedidos"}
              </Link>
              <div className="flex gap-3">
                <Link
                  to="/"
                  className="flex-1 py-3 border border-[#bdcaba] text-[#0b1c30] font-semibold rounded-[10px] hover:bg-[#dce9ff]/30 transition-colors text-center text-sm"
                >
                  Ir al inicio
                </Link>
                <Link
                  to="/catalogo"
                  className="flex-1 py-3 border border-[#bdcaba] text-[#0b1c30] font-semibold rounded-[10px] hover:bg-[#dce9ff]/30 transition-colors text-center text-sm"
                >
                  Seguir comprando
                </Link>
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ── Carrito vacío ────────────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <div className="storefront min-h-screen flex flex-col bg-[#f8f9ff]">
        <Navbar />
        <div className="flex-1 flex flex-col items-center justify-center py-32">
          <span className="material-symbols-outlined text-[80px] text-[#bdcaba] mb-6">shopping_cart</span>
          <p className="text-2xl font-bold text-[#0b1c30] mb-2">Tu carrito está vacío</p>
          <p className="text-[#565e74] mb-8">Agregá productos desde el catálogo para empezar.</p>
          <Link
            to="/catalogo"
            className="flex items-center gap-2 px-8 py-3 bg-[#00873a] text-white font-bold rounded-[10px] hover:brightness-110 transition-all"
          >
            <span className="material-symbols-outlined text-[20px]">store</span>
            Ver productos
          </Link>
        </div>
        <Footer />
      </div>
    );
  }

  // ── submitLabel — comentado: la lógica se inlinea en el botón del sidebar para combinar
  // texto + ícono Material Symbol de forma limpia, que no era posible retornando un string.
  // const submitLabel = () => {
  //   if (loading) return null;
  //   if (isMayorista) return "Enviar cotización →";
  //   if (paymentMethod === "MERCADOPAGO") return `Pagar ${formatPrice(finalTotal)} con MercadoPago →`;
  //   return `Confirmar pedido — ${formatPrice(finalTotal)} →`;
  // };

  // Clases de input reutilizables para consistencia visual
  const inputCls = "w-full bg-[#eff4ff] border border-[#bdcaba]/50 rounded-lg px-3 py-3 text-[#0b1c30] placeholder:text-[#565e74]/60 focus:outline-none focus:border-[#0051d5] transition-colors text-sm";

  // Clases de radio card: activa (borde verde) vs. inactiva
  const radioCardCls = (active) =>
    `flex items-center gap-4 p-4 rounded-xl cursor-pointer transition-all ${
      active
        ? "border-2 border-[#006b2c] bg-[#006b2c]/5"
        : "border border-[#bdcaba]/50 hover:border-[#bdcaba] bg-white"
    }`;

  // ── Formulario de checkout ───────────────────────────────────────────────────
  return (
    <div className="storefront min-h-screen flex flex-col bg-[#f8f9ff]">
      <Navbar />
      <main className="flex-1 max-w-[1280px] mx-auto px-6 py-12 w-full">

        {/* Encabezado */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-[#0b1c30] tracking-tight">
            {isMayorista ? "Solicitar cotización" : "Finalizar compra"}
          </h1>
        </div>

        {/* El form envuelve ambas columnas para que el botón del sidebar pueda submitear */}
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

            {/* ── Columna izquierda: formulario (8 cols) ─────────────────────── */}
            <div className="lg:col-span-8 space-y-6">

              {/* ── Sección: Tus datos ── */}
              <section className="bg-white border border-[#bdcaba]/30 rounded-xl p-6 shadow-[0px_4px_20px_rgba(15,23,42,0.05)]">
                <div className="flex items-center gap-2 mb-6">
                  <span className="material-symbols-outlined text-[#006b2c]">person</span>
                  <h2 className="text-xl font-semibold text-[#0b1c30]">Tus datos</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Nombre */}
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#565e74]">
                      Nombre completo *
                    </label>
                    <input
                      type="text"
                      name="customerName"
                      value={form.customerName}
                      onChange={handleChange}
                      className={inputCls}
                      placeholder="Ej: María González"
                      required
                    />
                  </div>
                  {/* Email */}
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#565e74]">
                      Email *
                    </label>
                    <input
                      type="email"
                      name="customerEmail"
                      value={form.customerEmail}
                      onChange={handleChange}
                      className={inputCls}
                      placeholder="tu@email.com"
                      required
                    />
                    <p className="text-xs text-[#565e74]/70 mt-1">
                      {isMayorista
                        ? "Recibirás los detalles de la cotización en este email."
                        : "Recibirás la confirmación de tu pedido en este email."}
                    </p>
                  </div>
                  {/* Teléfono */}
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#565e74]">
                      Teléfono *
                    </label>
                    <input
                      type="tel"
                      name="customerPhone"
                      value={form.customerPhone}
                      onChange={handleChange}
                      className={inputCls}
                      placeholder="+54 11 1234-5678"
                      required
                    />
                  </div>
                  {/* Documento */}
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#565e74]">
                      Documento *
                    </label>
                    <div className="flex gap-2">
                      {/* Segmented control para tipo de documento */}
                      <div className="flex rounded-lg border border-[#bdcaba]/50 overflow-hidden text-sm">
                        {["DNI", "CUIT", "CUIL"].map((type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => setForm((p) => ({ ...p, documentType: type }))}
                            className={`px-3 py-2 font-semibold transition-colors ${
                              form.documentType === type
                                ? "bg-[#0b1c30] text-white"
                                : "bg-[#eff4ff] text-[#565e74] hover:bg-[#dce9ff]"
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
                        className={`${inputCls} flex-1`}
                        placeholder={form.documentType === "DNI" ? "12345678" : "20-12345678-9"}
                        required
                      />
                    </div>
                  </div>
                </div>
                {/* Comentarios — full width debajo del grid */}
                <div className="mt-4 space-y-1">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[#565e74]">
                    Comentarios u observaciones
                  </label>
                  <textarea
                    name="customerNote"
                    value={form.customerNote}
                    onChange={handleChange}
                    rows={3}
                    maxLength={500}
                    className={`${inputCls} resize-none`}
                    placeholder="Ej: entregar en horario de la tarde, producto de regalo, consulta especial..."
                  />
                  <p className="text-xs text-[#565e74]/70 mt-1">{form.customerNote.length}/500</p>
                </div>
              </section>

              {/* ── MAYORISTA: "Precio a convenir" ─────────────────────────────── */}
              {isMayorista && (
                <div className="p-6 rounded-xl border-2 border-[#006b2c] bg-[#006b2c]/5">
                  <div className="flex items-center gap-3 mb-2">
                    <span
                      className="material-symbols-outlined text-[#006b2c]"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      handshake
                    </span>
                    <h3 className="font-semibold text-[#0b1c30]">Precio a convenir</h3>
                  </div>
                  <p className="text-sm text-[#3e4a3d] leading-relaxed">
                    Enviaremos tu cotización para confirmar la disponibilidad de stock de todos los productos
                    solicitados. Te contactaremos a la brevedad con la confirmación y los detalles de entrega.
                  </p>
                </div>
              )}

              {/* ── MINORISTA: Método de pago ──────────────────────────────────── */}
              {!isMayorista && (
                <section className="bg-white border border-[#bdcaba]/30 rounded-xl p-6 shadow-[0px_4px_20px_rgba(15,23,42,0.05)]">
                  <div className="flex items-center gap-2 mb-6">
                    <span className="material-symbols-outlined text-[#006b2c]">payments</span>
                    <h2 className="text-xl font-semibold text-[#0b1c30]">Método de pago</h2>
                  </div>
                  <div className="space-y-3">

                    {/* MercadoPago */}
                    <label className={radioCardCls(paymentMethod === "MERCADOPAGO")}>
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="MERCADOPAGO"
                        checked={paymentMethod === "MERCADOPAGO"}
                        onChange={() => setPaymentMethod("MERCADOPAGO")}
                        className="h-5 w-5 accent-[#006b2c] flex-shrink-0"
                      />
                      <IconMP />
                      <div className="flex-1">
                        <p className="font-semibold text-[#0b1c30] text-sm">MercadoPago</p>
                        <p className="text-xs text-[#565e74]">Tarjeta de crédito, débito o efectivo</p>
                      </div>
                    </label>

                    {/* Efectivo */}
                    <label className={radioCardCls(paymentMethod === "EFECTIVO")}>
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="EFECTIVO"
                        checked={paymentMethod === "EFECTIVO"}
                        onChange={() => setPaymentMethod("EFECTIVO")}
                        className="h-5 w-5 accent-[#006b2c] flex-shrink-0"
                      />
                      <IconCash />
                      <div className="flex-1">
                        <p className="font-semibold text-[#0b1c30] text-sm">Efectivo</p>
                        <p className="text-xs text-[#565e74]">Te contactamos para coordinar el pago y la entrega</p>
                      </div>
                    </label>

                    {/* Transferencia bancaria */}
                    <label className={radioCardCls(paymentMethod === "TRANSFERENCIA")}>
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="TRANSFERENCIA"
                        checked={paymentMethod === "TRANSFERENCIA"}
                        onChange={() => setPaymentMethod("TRANSFERENCIA")}
                        className="h-5 w-5 accent-[#006b2c] flex-shrink-0"
                      />
                      <IconTransfer />
                      <div className="flex-1">
                        <p className="font-semibold text-[#0b1c30] text-sm">Transferencia bancaria</p>
                        <p className="text-xs text-[#565e74]">Envianos el comprobante para confirmar tu pedido</p>
                      </div>
                    </label>

                  </div>
                </section>
              )}

              {/* ── Método de entrega (todos los clientes) ─────────────────────── */}
              <section className="bg-white border border-[#bdcaba]/30 rounded-xl p-6 shadow-[0px_4px_20px_rgba(15,23,42,0.05)]">
                <div className="flex items-center gap-2 mb-6">
                  <span className="material-symbols-outlined text-[#006b2c]">local_shipping</span>
                  <h2 className="text-xl font-semibold text-[#0b1c30]">Método de entrega</h2>
                </div>
                <div className="space-y-3">

                  {/* Retirar en el local */}
                  <label className={radioCardCls(shippingMethod === "RETIRO")}>
                    <input
                      type="radio"
                      name="shippingMethod"
                      value="RETIRO"
                      checked={shippingMethod === "RETIRO"}
                      onChange={() => setShippingMethod("RETIRO")}
                      className="h-5 w-5 accent-[#006b2c] flex-shrink-0"
                    />
                    <span
                      className="material-symbols-outlined text-[#006b2c] flex-shrink-0"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      storefront
                    </span>
                    <div className="flex-1">
                      <p className="font-semibold text-[#0b1c30] text-sm">Retirar en el local</p>
                      <p className="text-xs text-[#565e74]">Av. La Plata 744 Timbre 3, CABA · Coordinamos el horario por WhatsApp</p>
                    </div>
                    <span className="text-xs font-bold text-[#006b2c] flex-shrink-0">Gratis</span>
                  </label>

                  {/* Acordar envío */}
                  <label className={radioCardCls(shippingMethod === "ENVIO")}>
                    <input
                      type="radio"
                      name="shippingMethod"
                      value="ENVIO"
                      checked={shippingMethod === "ENVIO"}
                      onChange={() => setShippingMethod("ENVIO")}
                      className="h-5 w-5 accent-[#006b2c] flex-shrink-0"
                    />
                    <span className="material-symbols-outlined text-[#565e74] flex-shrink-0">local_shipping</span>
                    <div className="flex-1">
                      <p className="font-semibold text-[#0b1c30] text-sm">Acordar envío</p>
                      <p className="text-xs text-[#565e74]">Coordinamos la forma y costo de envío por WhatsApp una vez confirmado el pedido</p>
                    </div>
                    <span className="material-symbols-outlined text-[#bdcaba] text-[18px] flex-shrink-0">handshake</span>
                  </label>

                  {/* Correo Argentino — COMENTADO temporalmente. Todavía no tenemos las APIs
                      integradas con Correo Argentino para cotizar/generar etiquetas, así que la
                      opción queda oculta del flujo de checkout. El backend igual sigue aceptando
                      el valor CORREO_ARGENTINO por si hay órdenes históricas o se reactiva. */}
                  {/*
                  <label className={radioCardCls(shippingMethod === "CORREO_ARGENTINO")}>
                    <input
                      type="radio"
                      name="shippingMethod"
                      value="CORREO_ARGENTINO"
                      checked={shippingMethod === "CORREO_ARGENTINO"}
                      onChange={() => setShippingMethod("CORREO_ARGENTINO")}
                      className="h-5 w-5 accent-[#006b2c] flex-shrink-0"
                    />
                    <span className="material-symbols-outlined text-[#565e74] flex-shrink-0">local_post_office</span>
                    <div className="flex-1">
                      <p className="font-semibold text-[#0b1c30] text-sm">Correo Argentino</p>
                      <p className="text-xs text-[#565e74]">Envío a domicilio — ingresá tu dirección para ver el costo</p>
                    </div>
                    <span className="material-symbols-outlined text-[#bdcaba] text-[18px] flex-shrink-0">arrow_forward_ios</span>
                  </label>
                  */}

                  {/* Formulario de dirección — solo visible cuando se elige Correo Argentino */}
                  {shippingMethod === "CORREO_ARGENTINO" && (
                    <div className="border border-[#bdcaba]/50 rounded-xl p-4 space-y-3 bg-[#eff4ff]/40">
                      <p className="text-xs font-bold uppercase tracking-wider text-[#565e74]">Dirección de entrega</p>

                      {/* Calle + Número */}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-xs text-[#565e74] mb-1">Calle *</label>
                          <input
                            type="text"
                            name="streetName"
                            value={shippingAddress.streetName}
                            onChange={handleShippingAddressChange}
                            className={inputCls}
                            placeholder="Av. Corrientes"
                            required
                          />
                        </div>
                        <div className="w-24">
                          <label className="block text-xs text-[#565e74] mb-1">Número *</label>
                          <input
                            type="text"
                            name="streetNumber"
                            value={shippingAddress.streetNumber}
                            onChange={handleShippingAddressChange}
                            className={inputCls}
                            placeholder="1234"
                            required
                          />
                        </div>
                      </div>

                      {/* Piso + Depto */}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-xs text-[#565e74] mb-1">Piso</label>
                          <input
                            type="text"
                            name="floor"
                            value={shippingAddress.floor}
                            onChange={handleShippingAddressChange}
                            className={inputCls}
                            placeholder="2"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs text-[#565e74] mb-1">Depto</label>
                          <input
                            type="text"
                            name="apartment"
                            value={shippingAddress.apartment}
                            onChange={handleShippingAddressChange}
                            className={inputCls}
                            placeholder="B"
                          />
                        </div>
                      </div>

                      {/* Ciudad */}
                      <div>
                        <label className="block text-xs text-[#565e74] mb-1">Ciudad *</label>
                        <input
                          type="text"
                          name="city"
                          value={shippingAddress.city}
                          onChange={handleShippingAddressChange}
                          className={inputCls}
                          placeholder="Buenos Aires"
                          required
                        />
                      </div>

                      {/* Provincia + CP */}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-xs text-[#565e74] mb-1">Provincia *</label>
                          <select
                            name="provinceCode"
                            value={shippingAddress.provinceCode}
                            onChange={handleShippingAddressChange}
                            className={inputCls}
                          >
                            {PROVINCES.map((p) => (
                              <option key={p.code} value={p.code}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="w-32">
                          <label className="block text-xs text-[#565e74] mb-1">Código Postal *</label>
                          <input
                            type="text"
                            name="postalCode"
                            value={shippingAddress.postalCode}
                            onChange={handleShippingAddressChange}
                            className={inputCls}
                            placeholder="1425"
                            maxLength={10}
                            required
                          />
                        </div>
                      </div>

                      {/* Resultado de la cotización */}
                      {rateLoading && (
                        <div className="flex items-center gap-2 text-xs text-[#565e74] pt-1">
                          <span className="w-3 h-3 border-2 border-[#565e74] border-t-transparent rounded-full animate-spin inline-block" />
                          Cotizando envío...
                        </div>
                      )}
                      {!rateLoading && shippingRate && (
                        <div className="flex items-center justify-between text-sm bg-white border border-[#bdcaba]/50 rounded-lg px-3 py-2">
                          <span className="text-[#565e74]">
                            Correo Arg. Clásico · {shippingRate.deliveryTimeMin}–{shippingRate.deliveryTimeMax} días hábiles
                          </span>
                          <span className="font-bold text-[#006b2c]">{formatPrice(shippingRate.price)}</span>
                        </div>
                      )}
                      {!rateLoading && !shippingRate && shippingAddress.postalCode.length >= 4 && (
                        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                          ⚠️ No se encontró tarifa para ese código postal. Verificá que sea correcto, o elegí &quot;Acordar envío&quot; para coordinar por WhatsApp.
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </section>

              {/* Aviso de compra mínima mayorista */}
              {isMayorista && mayoristaMinimoCompra > 0 && subtotal < mayoristaMinimoCompra && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-start gap-3 text-sm">
                  <span
                    className="material-symbols-outlined text-amber-600 flex-shrink-0"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    warning
                  </span>
                  <div>
                    <p className="font-semibold text-amber-800">Mínimo de compra no alcanzado</p>
                    <p className="text-amber-700 mt-0.5">
                      El pedido mínimo mayorista es <strong>{formatPrice(mayoristaMinimoCompra)}</strong>.
                      Te faltan <strong>{formatPrice(mayoristaMinimoCompra - subtotal)}</strong> para continuar.
                    </p>
                  </div>
                </div>
              )}

              {/* Aviso cuando Correo Argentino está seleccionado pero sin cotización */}
              {shippingMethod === "CORREO_ARGENTINO" && !shippingRate && !rateLoading && (
                <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <span
                    className="material-symbols-outlined text-[18px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    warning
                  </span>
                  <span>Ingresá el código postal de destino para cotizar el envío y poder continuar.</span>
                </div>
              )}

            </div>

            {/* ── Columna derecha: sidebar resumen (4 cols) ──────────────────── */}
            <div className="lg:col-span-4 sticky top-24">
              <div className="bg-[#d3e4fe] border border-[#bdcaba]/30 rounded-xl overflow-hidden shadow-lg">

                {/* Header del sidebar */}
                <div className="p-4 bg-[#3e4a3d]/5 border-b border-[#bdcaba]/30">
                  <h3 className="text-lg font-semibold text-[#0b1c30]">Resumen del pedido</h3>
                </div>

                <div className="p-4 space-y-4">

                  {/* Lista de items */}
                  <div className="space-y-3 max-h-72 overflow-y-auto">
                    {items.map((item) => {
                      const img  = item.images?.[0];
                      const key  = item.cartItemId ?? item.id;
                      // SEGURIDAD: precio siempre de item.price, nunca editable por el cliente.
                      // Antes existía un input editable con lápiz para mayoristas (removido).
                      const price = item.price;
                      // const isEditing = editingPriceId === key; // removido junto con la edición
                      return (
                        <div key={key} className="flex gap-3">
                          <div className="w-14 h-14 rounded-lg overflow-hidden bg-white flex-shrink-0 border border-[#bdcaba]/30">
                            {img ? (
                              <img src={getImageUrl(img)} alt={item.name} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xl">📦</div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[#0b1c30] truncate">{item.name}</p>
                            {/* Variante seleccionada — visible para cualquier cliente que la haya elegido */}
                            {item.variantLabel && (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {item.variantLabel.split(" / ").map((v, vi) => (
                                  <span key={vi} className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#dbe1ff] text-[#00174b]">
                                    {v}
                                  </span>
                                ))}
                              </div>
                            )}
                            <p className="text-xs text-[#565e74]">x{item.quantity} · {formatPrice(price)} c/u</p>
                            <p className="text-sm font-bold text-[#0b1c30]">{formatPrice(price * item.quantity)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <hr className="border-[#bdcaba]/30" />

                  {/* Cupón de descuento */}
                  {couponResult ? (
                    <div className="flex items-center justify-between text-sm text-[#006b2c] font-medium bg-[#7ffc97]/20 rounded-lg px-3 py-2">
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
                        className="text-[#006b2c] hover:text-red-500 text-xs underline"
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
                        className="flex-1 bg-white border border-[#bdcaba]/50 rounded-lg px-3 py-2 text-sm font-mono tracking-widest text-[#0b1c30] placeholder:text-[#565e74]/50 focus:outline-none focus:border-[#0051d5] transition-colors"
                      />
                      <button
                        type="button"
                        onClick={handleApplyCoupon}
                        disabled={couponLoading || !couponCode.trim()}
                        className="px-3 py-2 bg-[#565e74] text-white text-sm font-bold rounded-lg hover:brightness-110 transition-all disabled:opacity-50"
                      >
                        {couponLoading ? "..." : "Aplicar"}
                      </button>
                    </div>
                  )}

                  {/* Cálculos */}
                  <div className="space-y-2 pt-1">
                    <div className="flex justify-between text-sm text-[#565e74]">
                      <span>Subtotal ({items.reduce((s, i) => s + i.quantity, 0)} productos)</span>
                      <span>{formatPrice(subtotal)}</span>
                    </div>

                    {couponDiscount > 0 && (
                      <div className="flex justify-between text-sm text-[#006b2c] font-semibold">
                        <span>Descuento cupón</span>
                        <span>−{formatPrice(couponDiscount)}</span>
                      </div>
                    )}

                    {/* Opción de factura con IVA — solo para mayoristas */}
                    {isMayorista && (
                      <label className="flex items-center gap-2.5 py-1 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={wantsInvoice}
                          onChange={(e) => setWantsInvoice(e.target.checked)}
                          className="w-4 h-4 rounded border-[#bdcaba] accent-[#006b2c] cursor-pointer"
                        />
                        <span className="text-sm text-[#0b1c30]">
                          Quiero factura <span className="text-[#565e74] font-normal">(+ IVA)</span>
                        </span>
                      </label>
                    )}

                    {/* Línea de IVA — visible solo cuando está tildado */}
                    {ivaAmount > 0 && (
                      <div className="flex justify-between text-sm text-[#565e74]">
                        <span>IVA</span>
                        <span>+{formatPrice(ivaAmount)}</span>
                      </div>
                    )}

                    {/* Línea de envío — visible solo para Correo Argentino */}
                    {shippingCost > 0 && (
                      <div className="flex justify-between text-sm text-[#565e74]">
                        <span>Envío (Correo Arg.)</span>
                        <span>+{formatPrice(shippingCost)}</span>
                      </div>
                    )}
                    {shippingMethod === "CORREO_ARGENTINO" && shippingCost === 0 && !rateLoading && (
                      <div className="text-xs text-[#565e74]/70 italic">Costo de envío: ingresá el CP para cotizar</div>
                    )}

                    {isMayorista && (
                      <div className="flex justify-between text-sm text-[#006b2c] font-semibold">
                        <span>Precio final</span>
                        <span>A convenir</span>
                      </div>
                    )}

                    <div className="flex justify-between font-bold text-lg text-[#0b1c30] border-t border-[#bdcaba]/40 pt-3">
                      <span>{isMayorista ? "Total estimado" : "Total"}</span>
                      <span className="text-[#006b2c]">{formatPrice(finalTotal)}</span>
                    </div>
                  </div>

                  {/* Botón de checkout */}
                  <button
                    type="submit"
                    disabled={
                      loading ||
                      rateLoading ||
                      (isMayorista && mayoristaMinimoCompra > 0 && subtotal < mayoristaMinimoCompra) ||
                      // Bloquear si eligió Correo Argentino pero aún no hay cotización confirmada
                      (shippingMethod === "CORREO_ARGENTINO" && (!shippingRate || shippingCost === 0))
                    }
                    className="w-full py-4 bg-[#006b2c] text-white font-semibold rounded-xl shadow-lg hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 group disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 mt-2"
                  >
                    {loading ? (
                      <>
                        <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Procesando...</span>
                      </>
                    ) : rateLoading && shippingMethod === "CORREO_ARGENTINO" ? (
                      <>
                        <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Cotizando envío...</span>
                      </>
                    ) : (
                      <>
                        <span>
                          {isMayorista
                            ? "Enviar cotización"
                            : paymentMethod === "MERCADOPAGO"
                            ? `Pagar ${formatPrice(finalTotal)} con MercadoPago`
                            : `Confirmar pedido · ${formatPrice(finalTotal)}`}
                        </span>
                        <span className="material-symbols-outlined text-[20px] group-hover:translate-x-1 transition-transform">
                          arrow_forward
                        </span>
                      </>
                    )}
                  </button>

                  {/* Nota de seguridad */}
                  <div className="flex items-center justify-center gap-2 text-xs text-[#565e74] opacity-70">
                    <span className="material-symbols-outlined text-[16px]">lock</span>
                    <span>Pago 100% seguro y encriptado</span>
                  </div>

                </div>
              </div>
            </div>

          </div>
        </form>
      </main>
      <Footer />
    </div>
  );
}

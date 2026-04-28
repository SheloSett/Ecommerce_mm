import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { useCart } from "../context/CartContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useSiteConfig } from "../context/SiteConfigContext";
import { getImageUrl } from "../services/api";

export default function Cart() {
  const { items, totalPrice, removeItem, updateQuantity } = useCart();
  const { customer } = useCustomerAuth();
  const { mayoristaMinimoCompra } = useSiteConfig();
  const navigate = useNavigate();

  const isMayorista = customer?.type === "MAYORISTA";
  const minimoActivo = isMayorista && mayoristaMinimoCompra > 0;
  const llegaAlMinimo = totalPrice >= mayoristaMinimoCompra;
  const progreso = minimoActivo ? Math.min(100, (totalPrice / mayoristaMinimoCompra) * 100) : 100;

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);

  const totalItems = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10">

        {/* Encabezado */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-extrabold text-slate-900">
            Mi carrito
            {items.length > 0 && (
              <span className="ml-3 text-base font-semibold text-slate-400">
                ({totalItems} {totalItems === 1 ? "producto" : "productos"})
              </span>
            )}
          </h1>
          <Link
            to="/catalogo"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors shadow"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Seguir comprando
          </Link>
        </div>

        {items.length === 0 ? (
          /* ── Carrito vacío ─────────────────────────────────────── */
          <div className="flex flex-col items-center justify-center py-32 text-slate-400">
            <span className="text-8xl mb-6">🛒</span>
            <p className="text-2xl font-bold text-slate-700 mb-2">Tu carrito está vacío</p>
            <p className="text-slate-400 mb-8">Agregá productos desde el catálogo para empezar.</p>
            <Link
              to="/catalogo"
              className="px-8 py-3 rounded-2xl bg-blue-600 text-white font-bold text-base hover:bg-blue-700 transition-colors shadow-lg"
            >
              Ver catálogo →
            </Link>
          </div>
        ) : (
          /* ── Layout principal: lista + sidebar ─────────────────── */
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start">

            {/* ── Columna izquierda: lista de productos ─────────── */}
            <div className="space-y-4">
              {/* Cabecera de columnas — solo desktop */}
              <div className="hidden md:grid grid-cols-[80px_1fr_120px_130px_40px] gap-4 px-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <span />
                <span>Producto</span>
                <span className="text-center">Cantidad</span>
                <span className="text-right">Subtotal</span>
                <span />
              </div>

              {items.map((item) => {
                const img = item.images?.[0];
                const subtotal = item.price * item.quantity;
                return (
                  <div
                    key={item.cartItemId}
                    className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 grid grid-cols-[80px_1fr] md:grid-cols-[80px_1fr_120px_130px_40px] gap-4 items-center"
                  >
                    {/* Imagen */}
                    <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0" style={{ backgroundColor: "#ffffff" }}>
                      {img ? (
                        <img
                          src={getImageUrl(img)}
                          alt={item.name}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-3xl">📦</div>
                      )}
                    </div>

                    {/* Info del producto */}
                    <div className="min-w-0">
                      <Link
                        to={`/producto/${item.id}`}
                        className="font-bold text-slate-900 text-sm hover:text-blue-600 transition-colors line-clamp-2 leading-tight"
                      >
                        {item.name}
                      </Link>
                      {item.variantLabel && (
                        <p className="text-xs text-slate-500 mt-0.5">{item.variantLabel}</p>
                      )}
                      <p className="text-sm text-blue-600 font-semibold mt-1">
                        {formatPrice(item.price)} <span className="text-slate-400 font-normal text-xs">c/u</span>
                      </p>
                      {/* Controles de cantidad en mobile */}
                      <div className="flex items-center gap-2 mt-3 md:hidden">
                        <QtyControls item={item} isMayorista={isMayorista} updateQuantity={updateQuantity} />
                        <button
                          onClick={() => removeItem(item.cartItemId)}
                          className="ml-auto p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>

                    {/* Controles de cantidad — desktop */}
                    <div className="hidden md:flex justify-center">
                      <QtyControls item={item} isMayorista={isMayorista} updateQuantity={updateQuantity} />
                    </div>

                    {/* Subtotal — desktop */}
                    <div className="hidden md:flex justify-end">
                      <span className="font-extrabold text-slate-900 text-base">{formatPrice(subtotal)}</span>
                    </div>

                    {/* Eliminar — desktop */}
                    <div className="hidden md:flex justify-center">
                      <button
                        onClick={() => removeItem(item.cartItemId)}
                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Eliminar"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Columna derecha: resumen ───────────────────────── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5 sticky top-24">
              <h2 className="text-lg font-extrabold text-slate-900">Resumen del pedido</h2>

              <div className="space-y-2 text-sm text-slate-600">
                <div className="flex justify-between">
                  <span>{totalItems} {totalItems === 1 ? "producto" : "productos"}</span>
                  <span className="font-semibold text-slate-900">{formatPrice(totalPrice)}</span>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 flex justify-between items-center">
                <span className="font-bold text-slate-800">Total</span>
                <span className="text-2xl font-extrabold text-slate-900">{formatPrice(totalPrice)}</span>
              </div>

              {/* Indicador de mínimo mayorista */}
              {minimoActivo && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className={llegaAlMinimo ? "text-emerald-600" : "text-amber-600"}>
                      {llegaAlMinimo
                        ? "✓ Mínimo de compra alcanzado"
                        : `Faltan ${formatPrice(mayoristaMinimoCompra - totalPrice)} para el mínimo`}
                    </span>
                    <span className="text-slate-400">{formatPrice(mayoristaMinimoCompra)}</span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${llegaAlMinimo ? "bg-emerald-500" : "bg-amber-400"}`}
                      style={{ width: `${progreso}%` }}
                    />
                  </div>
                </div>
              )}

              {/* CTA Checkout */}
              <button
                onClick={() => navigate("/checkout")}
                disabled={minimoActivo && !llegaAlMinimo}
                className="btn-primary w-full py-4 text-base font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Finalizar compra →
              </button>

              {/* CTA Catálogo */}
              <Link
                to="/catalogo"
                className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl border-2 border-slate-200 text-slate-600 font-semibold text-sm hover:border-blue-400 hover:text-blue-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Seguir comprando
              </Link>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

function QtyControls({ item, isMayorista, updateQuantity }) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => updateQuantity(item.cartItemId, item.quantity - 1)}
        className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center font-bold text-slate-700 transition-colors"
      >
        −
      </button>
      <input
        type="number"
        min={1}
        max={!isMayorista && item.stock !== -1 ? item.stock : undefined}
        value={item.quantity}
        onChange={(e) => {
          const val = parseInt(e.target.value, 10);
          if (isNaN(val) || val < 1) return;
          const maxQty = !isMayorista && item.stock !== -1 ? item.stock : Infinity;
          updateQuantity(item.cartItemId, Math.min(val, maxQty));
        }}
        className="w-12 text-center text-sm font-bold border border-slate-200 rounded-lg py-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <button
        onClick={() => updateQuantity(item.cartItemId, item.quantity + 1)}
        disabled={!isMayorista && item.stock !== -1 && item.quantity >= item.stock}
        className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center font-bold text-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        +
      </button>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { useCart } from "../context/CartContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useSiteConfig } from "../context/SiteConfigContext";
import { getImageUrl } from "../services/api";

function formatPrice(price) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);
}

export default function Cart() {
  const { items, totalPrice, removeItem, updateQuantity } = useCart();
  const { customer } = useCustomerAuth();
  const { mayoristaMinimoCompra } = useSiteConfig();
  const navigate = useNavigate();

  const isMayorista = customer?.type === "MAYORISTA";
  const minimoActivo = isMayorista && mayoristaMinimoCompra > 0;
  const llegaAlMinimo = totalPrice >= mayoristaMinimoCompra;
  const progreso = minimoActivo ? Math.min(100, (totalPrice / mayoristaMinimoCompra) * 100) : 100;

  const totalItems = items.reduce((s, i) => s + i.quantity, 0);
  // Hay items sin stock = no se puede finalizar la compra
  const hasOutOfStock = items.some((i) => i.outOfStock);

  return (
    <div className="storefront min-h-screen flex flex-col bg-[#f8f9ff]">
      <Navbar />

      <main className="flex-1 max-w-[1280px] mx-auto w-full px-6 py-12">

        {/* ── Encabezado ── */}
        <div className="flex flex-col gap-2 mb-8">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-[#006b2c] font-semibold hover:underline underline-offset-4 w-fit text-sm"
          >
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            Seguir comprando
          </button>
          <h1 className="text-4xl font-bold text-[#0b1c30] tracking-tight">Mi carrito</h1>
          {items.length > 0 && (
            <p className="text-[#565e74]">
              {totalItems} {totalItems === 1 ? "producto" : "productos"} seleccionados
            </p>
          )}
        </div>

        {items.length === 0 ? (
          /* ── Carrito vacío ── */
          <div className="flex flex-col items-center justify-center py-32">
            <span className="material-symbols-outlined text-[80px] text-[#bdcaba] mb-6">
              shopping_cart
            </span>
            <p className="text-2xl font-bold text-[#0b1c30] mb-2">Tu carrito está vacío</p>
            <p className="text-[#565e74] mb-8">
              Agregá productos desde el catálogo para empezar.
            </p>
            <Link
              to="/catalogo"
              className="flex items-center gap-2 px-8 py-3 bg-[#00873a] text-white font-bold rounded-[10px] hover:brightness-110 transition-all"
            >
              <span className="material-symbols-outlined text-[20px]">store</span>
              Ver catálogo
            </Link>
          </div>
        ) : (
          /* ── Layout principal: lista + sidebar ── */
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start">

            {/* ── Lista de productos ── */}
            <div className="space-y-4">
              {/* Cabecera de columnas — solo desktop */}
              <div className="hidden md:grid grid-cols-[80px_1fr_140px_130px_40px] gap-4 px-4 text-xs font-bold uppercase tracking-wider text-[#565e74]">
                <span />
                <span>Producto</span>
                <span className="text-center">Cantidad</span>
                <span className="text-right">Subtotal</span>
                <span />
              </div>

              {items.map((item) => {
                const img      = item.images?.[0];
                const subtotal = item.price * item.quantity;
                const isOut    = item.outOfStock;
                return (
                  <div
                    key={item.cartItemId}
                    className={`bg-white rounded-xl p-4
                      grid grid-cols-[80px_1fr] md:grid-cols-[80px_1fr_140px_130px_40px] gap-4 items-center
                      shadow-[0px_4px_20px_rgba(15,23,42,0.05)]
                      hover:-translate-y-0.5 hover:shadow-[0px_8px_30px_rgba(15,23,42,0.08)]
                      transition-all duration-200
                      ${isOut
                        ? "border-2 border-red-300 bg-red-50/20"
                        : "border border-[#bdcaba]/30"
                      }`}
                  >
                    {/* Imagen */}
                    <div
                      className={`w-20 h-20 rounded-xl overflow-hidden bg-[#dce9ff] flex-shrink-0 ${
                        isOut ? "opacity-50" : ""
                      }`}
                    >
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
                        to={`/producto/${item.slug || item.id}`}
                        className={`font-bold text-sm transition-colors line-clamp-2 leading-tight ${
                          isOut
                            ? "text-[#565e74]"
                            : "text-[#0b1c30] hover:text-[#006b2c]"
                        }`}
                      >
                        {item.name}
                      </Link>
                      {/* Badge "Sin stock" — excepción a la regla de ocultar productos sin stock,
                          porque el cliente lo agregó al carrito antes de que se agotara */}
                      {isOut && (
                        <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-red-100 text-red-700 text-[11px] font-bold rounded-full border border-red-200">
                          <span className="material-symbols-outlined text-[12px]">warning</span>
                          Sin stock disponible
                        </div>
                      )}
                      {/* Variante seleccionada — visible para cualquier cliente que la haya elegido.
                          Antes había un hard-code !isMayorista que ocultaba la variante a mayoristas; ahora se muestra
                          siempre que el item tenga variantLabel (los mayoristas también pueden elegir variantes). */}
                      {item.variantLabel && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.variantLabel.split(" / ").map((v, vi) => (
                            <span
                              key={vi}
                              className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                                isOut
                                  ? "bg-slate-100 text-slate-400"
                                  : "bg-[#dbe1ff] text-[#00174b]"
                              }`}
                            >
                              {v}
                            </span>
                          ))}
                        </div>
                      )}
                      <p
                        className={`text-sm font-bold mt-1 ${
                          isOut ? "text-[#565e74]" : "text-[#006b2c]"
                        }`}
                      >
                        {formatPrice(item.price)}{" "}
                        <span className="font-normal text-xs text-[#565e74]">c/u</span>
                      </p>
                      {/* Controles de cantidad en mobile */}
                      <div className="flex items-center gap-2 mt-3 md:hidden">
                        <QtyControls
                          item={item}
                          isMayorista={isMayorista}
                          updateQuantity={updateQuantity}
                        />
                        <button
                          onClick={() => removeItem(item.cartItemId)}
                          className="ml-auto text-[#565e74] hover:text-red-500 transition-colors p-1.5 hover:bg-red-50 rounded-lg"
                          title="Eliminar"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                    </div>

                    {/* Controles de cantidad — desktop */}
                    <div className="hidden md:flex justify-center">
                      <QtyControls
                        item={item}
                        isMayorista={isMayorista}
                        updateQuantity={updateQuantity}
                      />
                    </div>

                    {/* Subtotal — desktop */}
                    <div className="hidden md:flex justify-end">
                      <span className="font-extrabold text-[#0b1c30] text-base">
                        {formatPrice(subtotal)}
                      </span>
                    </div>

                    {/* Eliminar — desktop */}
                    <div className="hidden md:flex justify-center">
                      <button
                        onClick={() => removeItem(item.cartItemId)}
                        className="p-1.5 text-[#565e74] hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Eliminar"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Sidebar: resumen ── */}
            <div className="bg-white rounded-xl border border-[#bdcaba]/30 shadow-[0px_4px_20px_rgba(15,23,42,0.05)] p-6 space-y-5 sticky top-24">
              <p className="text-xs font-bold uppercase tracking-wider text-[#565e74]">
                Resumen del pedido
              </p>

              <div className="space-y-2 text-sm text-[#565e74]">
                <div className="flex justify-between">
                  <span>
                    {totalItems} {totalItems === 1 ? "producto" : "productos"}
                  </span>
                  <span className="font-semibold text-[#0b1c30]">{formatPrice(totalPrice)}</span>
                </div>
              </div>

              <div className="border-t border-[#bdcaba]/30 pt-4 flex justify-between items-center">
                <span className="font-bold text-[#0b1c30]">Total</span>
                <span className="text-2xl font-extrabold text-[#0b1c30]">
                  {formatPrice(totalPrice)}
                </span>
              </div>

              {/* Indicador de mínimo mayorista */}
              {minimoActivo && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className={llegaAlMinimo ? "text-[#006b2c]" : "text-amber-600"}>
                      {llegaAlMinimo
                        ? "✓ Mínimo de compra alcanzado"
                        : `Faltan ${formatPrice(mayoristaMinimoCompra - totalPrice)}`}
                    </span>
                    <span className="text-[#565e74]">{formatPrice(mayoristaMinimoCompra)}</span>
                  </div>
                  <div className="w-full h-2 bg-[#dce9ff] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        llegaAlMinimo ? "bg-[#00873a]" : "bg-amber-400"
                      }`}
                      style={{ width: `${progreso}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Aviso de items sin stock */}
              {hasOutOfStock && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
                  <span className="material-symbols-outlined text-[16px] flex-shrink-0 mt-0.5">
                    warning
                  </span>
                  <span>
                    Tenés productos sin stock disponible. Eliminalos del carrito para poder
                    finalizar la compra.
                  </span>
                </div>
              )}

              {/* CTA Finalizar compra */}
              <button
                onClick={() => navigate("/checkout")}
                disabled={(minimoActivo && !llegaAlMinimo) || hasOutOfStock}
                className="w-full py-3.5 bg-[#00873a] text-white font-bold rounded-[10px] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base"
              >
                <span className="material-symbols-outlined text-[20px]">shopping_bag</span>
                Finalizar compra
              </button>

              {/* CTA Seguir comprando */}
              <Link
                to="/catalogo"
                className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-[10px] border border-[#bdcaba] text-[#0b1c30] font-semibold text-sm hover:bg-[#dce9ff]/30 transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">store</span>
                Ver más productos
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
        className="w-8 h-8 rounded-full bg-[#dce9ff] hover:bg-[#bdcaba]/60 flex items-center justify-center font-bold text-[#0b1c30] text-lg leading-none transition-colors"
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
        className="w-10 text-center text-sm font-bold text-[#0b1c30] border border-[#bdcaba]/50 rounded-lg py-1 bg-white focus:outline-none focus:ring-2 focus:ring-[#00873a]/30"
      />
      <button
        onClick={() => updateQuantity(item.cartItemId, item.quantity + 1)}
        disabled={!isMayorista && item.stock !== -1 && item.quantity >= item.stock}
        className="w-8 h-8 rounded-full bg-[#dce9ff] hover:bg-[#bdcaba]/60 flex items-center justify-center font-bold text-[#0b1c30] text-lg leading-none transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        +
      </button>
    </div>
  );
}

// TrashIcon SVG — comentado porque se reemplazó por Material Symbol "delete" que ya está cargado
// function TrashIcon() {
//   return (
//     <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
//     </svg>
//   );
// }

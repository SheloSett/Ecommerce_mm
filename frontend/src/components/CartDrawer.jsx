import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useSiteConfig } from "../context/SiteConfigContext";
import { getImageUrl } from "../services/api";

// Drawer lateral del carrito de compras
export default function CartDrawer({ open, onClose }) {
  const { items, totalPrice, removeItem, updateQuantity } = useCart();
  const { customer } = useCustomerAuth();
  const { mayoristaMinimoCompra } = useSiteConfig();
  const isMayorista = customer?.type === "MAYORISTA";
  const minimoActivo = isMayorista && mayoristaMinimoCompra > 0;
  const llegaAlMinimo = totalPrice >= mayoristaMinimoCompra;
  const progreso = minimoActivo ? Math.min(100, (totalPrice / mayoristaMinimoCompra) * 100) : 100;
  const navigate = useNavigate();

  const handleCheckout = () => {
    onClose();
    navigate("/checkout");
  };

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);

  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      {/* Panel del carrito */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-white z-50 shadow-2xl transform transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-bold text-slate-900">
              Carrito ({items.length} {items.length === 1 ? "producto" : "productos"})
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Items */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <span className="text-6xl mb-4">🛒</span>
                <p className="text-lg font-medium">Tu carrito está vacío</p>
                <button
                  onClick={onClose}
                  className="mt-4 text-blue-600 hover:underline text-sm"
                >
                  Seguir comprando
                </button>
              </div>
            ) : (
              items.map((item) => {
                const img = item.images?.[0];
                return (
                  <div key={item.id} className="flex gap-4 bg-slate-50 rounded-xl p-3">
                    {/* Imagen */}
                    <div className="w-20 h-20 rounded-lg overflow-hidden bg-slate-200 flex-shrink-0">
                      {img ? (
                        <img
                          src={getImageUrl(img)}
                          alt={item.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-2xl">📦</div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm truncate">{item.name}</p>
                      {item.variantLabel && (
                        <p className="text-xs text-slate-600 mt-0.5">{item.variantLabel}</p>
                      )}
                      <p className="text-blue-600 font-bold text-sm mt-1">
                        {formatPrice(item.price)}
                      </p>

                      {/* Cantidad */}
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={() => updateQuantity(item.cartItemId, item.quantity - 1)}
                          className="w-7 h-7 rounded-lg bg-slate-200 hover:bg-slate-300 flex items-center justify-center text-sm font-bold transition-colors"
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
                            // Minoristas no pueden superar el stock disponible
                            const maxQty = !isMayorista && item.stock !== -1 ? item.stock : Infinity;
                            updateQuantity(item.cartItemId, Math.min(val, maxQty));
                          }}
                          className="w-12 text-center text-sm font-semibold border border-slate-200 rounded-lg py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                        <button
                          onClick={() => updateQuantity(item.cartItemId, item.quantity + 1)}
                          className="w-7 h-7 rounded-lg bg-slate-200 hover:bg-slate-300 flex items-center justify-center text-sm font-bold transition-colors"
                          // Mayoristas no tienen límite de stock — pueden pedir más del disponible (cotización)
                          // disabled={item.stock !== -1 && item.quantity >= item.stock}  // BUGFIX: limitaba a mayoristas
                          disabled={!isMayorista && item.stock !== -1 && item.quantity >= item.stock}
                        >
                          +
                        </button>
                        <button
                          onClick={() => removeItem(item.cartItemId)}
                          className="ml-auto text-red-400 hover:text-red-600 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer con total */}
          {items.length > 0 && (
            <div className="border-t border-slate-200 px-6 py-4 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-slate-600 font-medium">Total</span>
                <span className="text-xl font-bold text-slate-900">{formatPrice(totalPrice)}</span>
              </div>

              {/* Indicador de compra mínima mayorista — solo si no llegó al mínimo */}
              {minimoActivo && !llegaAlMinimo && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-amber-600">
                      {`Te faltan ${formatPrice(mayoristaMinimoCompra - totalPrice)} para el mínimo`}
                    </span>
                    <span className="text-slate-400">{formatPrice(mayoristaMinimoCompra)}</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300 bg-amber-400"
                      style={{ width: `${progreso}%` }}
                    />
                  </div>
                </div>
              )}

              <button
                onClick={handleCheckout}
                disabled={minimoActivo && !llegaAlMinimo}
                className="btn-primary w-full text-center text-base py-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Ir al Checkout →
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

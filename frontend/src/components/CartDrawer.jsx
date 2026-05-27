import { useNavigate, Link } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useSiteConfig } from "../context/SiteConfigContext";
import { getImageUrl } from "../services/api";

function formatPrice(price) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);
}

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
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-[#f8f9ff] z-50 shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* ── Header oscuro (mismo color que navbar) ── */}
        <div className="flex items-center justify-between px-5 py-4 bg-[#0F172A] flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[#7ffc97]">shopping_cart</span>
            <h2 className="text-base font-bold text-white">Mi carrito</h2>
            {items.length > 0 && (
              <span className="bg-[#00873a] text-[#f7fff2] text-xs font-bold px-2.5 py-0.5 rounded-full">
                {items.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
            aria-label="Cerrar carrito"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* ── Lista de items ── */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-20 text-[#565e74]">
              <span className="material-symbols-outlined text-[64px] text-[#bdcaba] mb-4">
                shopping_cart
              </span>
              <p className="text-base font-semibold text-[#0b1c30] mb-1">Tu carrito está vacío</p>
              <p className="text-sm text-[#565e74] mb-6">Explorá el catálogo para agregar productos</p>
              <button
                onClick={onClose}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#00873a] text-white font-semibold rounded-[10px] hover:opacity-90 transition-all text-sm"
              >
                <span className="material-symbols-outlined text-[18px]">store</span>
                Ver catálogo
              </button>
            </div>
          ) : (
            items.map((item) => {
              const img = item.images?.[0];
              return (
                <div
                  key={item.id}
                  className="bg-white rounded-xl border border-[#bdcaba]/30 p-3 flex gap-3 shadow-[0px_2px_10px_rgba(15,23,42,0.04)]"
                >
                  {/* Imagen */}
                  <div className="w-16 h-16 rounded-lg overflow-hidden bg-[#dce9ff] flex-shrink-0">
                    {img ? (
                      <img
                        src={getImageUrl(img)}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xl">📦</div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#0b1c30] text-sm truncate leading-tight">
                      {item.name}
                    </p>
                    {item.variantLabel && (
                      <span className="inline-block mt-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#dbe1ff] text-[#00174b]">
                        {item.variantLabel}
                      </span>
                    )}
                    <p className="text-[#006b2c] font-bold text-sm mt-1">
                      {formatPrice(item.price)}
                    </p>

                    {/* Controles de cantidad + eliminar */}
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => updateQuantity(item.cartItemId, item.quantity - 1)}
                        className="w-7 h-7 rounded-full bg-[#dce9ff] hover:bg-[#bdcaba]/50 flex items-center justify-center text-sm font-bold text-[#0b1c30] transition-colors"
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
                        className="w-10 text-center text-sm font-bold text-[#0b1c30] border border-[#bdcaba]/50 rounded-lg py-0.5 bg-[#f8f9ff] focus:outline-none focus:ring-2 focus:ring-[#00873a]/30"
                      />
                      <button
                        onClick={() => updateQuantity(item.cartItemId, item.quantity + 1)}
                        // Mayoristas no tienen límite de stock — pueden pedir más del disponible (cotización)
                        // disabled={item.stock !== -1 && item.quantity >= item.stock}  // BUGFIX: limitaba a mayoristas
                        disabled={!isMayorista && item.stock !== -1 && item.quantity >= item.stock}
                        className="w-7 h-7 rounded-full bg-[#dce9ff] hover:bg-[#bdcaba]/50 flex items-center justify-center text-sm font-bold text-[#0b1c30] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        +
                      </button>
                      <button
                        onClick={() => removeItem(item.cartItemId)}
                        className="ml-auto text-[#565e74] hover:text-red-500 transition-colors p-1 rounded-lg hover:bg-red-50"
                        title="Eliminar"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Footer con total y checkout ── */}
        {items.length > 0 && (
          <div className="flex-shrink-0 bg-white border-t border-[#bdcaba]/30 px-5 py-5 space-y-4">
            {/* Indicador de mínimo mayorista */}
            {minimoActivo && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-semibold">
                  <span className={llegaAlMinimo ? "text-[#006b2c]" : "text-amber-600"}>
                    {llegaAlMinimo
                      ? "✓ Mínimo de compra alcanzado"
                      : `Faltan ${formatPrice(mayoristaMinimoCompra - totalPrice)} para el mínimo`}
                  </span>
                  <span className="text-[#565e74]">{formatPrice(mayoristaMinimoCompra)}</span>
                </div>
                <div className="w-full h-1.5 bg-[#dce9ff] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      llegaAlMinimo ? "bg-[#00873a]" : "bg-amber-400"
                    }`}
                    style={{ width: `${progreso}%` }}
                  />
                </div>
              </div>
            )}

            {/* Total */}
            <div className="flex justify-between items-center">
              <span className="text-[#565e74] font-medium text-sm">Total</span>
              <span className="text-xl font-bold text-[#0b1c30]">{formatPrice(totalPrice)}</span>
            </div>

            {/* Ver carrito completo */}
            <Link
              to="/carrito"
              onClick={onClose}
              className="w-full py-2.5 border border-[#bdcaba] text-[#0b1c30] font-semibold rounded-[10px] hover:bg-[#dce9ff]/30 transition-all flex items-center justify-center gap-2 text-sm"
            >
              <span className="material-symbols-outlined text-[18px]">open_in_full</span>
              Ver carrito completo
            </Link>

            {/* Botón checkout */}
            <button
              onClick={handleCheckout}
              disabled={minimoActivo && !llegaAlMinimo}
              className="w-full py-3.5 bg-[#00873a] text-white font-bold rounded-[10px] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">shopping_bag</span>
              Finalizar compra
            </button>
          </div>
        )}
      </div>
    </>
  );
}

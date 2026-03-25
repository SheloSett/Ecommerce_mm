import { Link, useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { getImageUrl } from "../services/api";
import toast from "react-hot-toast";

export default function ProductCard({ product }) {
  const { addItem, items } = useCart();
  const { customer } = useCustomerAuth();
  const navigate = useNavigate();

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);

  // Cantidad actual de este producto en el carrito
  const cartQty = items.find((i) => i.id === product.id)?.quantity || 0;
  // Sin stock disponible: sin stock total, o ya se alcanzó el límite en el carrito (salvo stock ilimitado)
  const outOfStock = product.stock === 0 || (!product.stockUnlimited && cartQty >= product.stock);

  const handleAddToCart = (e) => {
    e.preventDefault(); // Evitar que navegue al detalle al hacer click en el botón
    if (outOfStock) return;
    // Si no hay usuario logueado, redirigir al login sin mostrar notificación
    if (!customer) {
      navigate("/login");
      return;
    }
    addItem(product);
    toast.success(`"${product.name}" agregado al carrito`);
  };

  const img = product.images?.[0];

  return (
    <Link
      to={`/producto/${product.id}`}
      className="card group flex flex-col overflow-hidden hover:shadow-md transition-shadow duration-200"
    >
      {/* Imagen */}
      <div className="relative aspect-square overflow-hidden bg-slate-100">
        {img ? (
          <img
            src={getImageUrl(img)}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl text-slate-300">
            📦
          </div>
        )}

        {/* Badge destacado */}
        {product.featured && (
          <span className="absolute top-2 left-2 bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded-full">
            Destacado
          </span>
        )}

        {/* Badge sin stock */}
        {outOfStock && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <span className="bg-white text-slate-800 text-sm font-bold px-3 py-1 rounded-full">
              {product.stock === 0 ? "Sin stock" : "Máximo en carrito"}
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4 flex flex-col flex-1">
        {product.category && (
          <span className="text-xs text-blue-600 font-semibold uppercase tracking-wide mb-1">
            {product.category.name}
          </span>
        )}
        <h3 className="font-semibold text-slate-800 text-sm leading-tight mb-2 flex-1 line-clamp-2">
          {product.name}
        </h3>
        <div className="flex items-center justify-between mt-auto gap-2">
          {/* Mostrar precio según tipo de cliente:
              - MAYORISTA: precio mayorista si está disponible
              - MINORISTA: precio oferta si existe y es menor al precio normal */}
          <div className="flex flex-col">
            {customer?.type === "MAYORISTA" && product.wholesalePrice ? (
              // Cliente mayorista: mostrar precio oferta mayorista (si existe) o precio mayorista
              product.wholesaleSalePrice && product.wholesaleSalePrice < product.wholesalePrice ? (
                <>
                  <span className="text-xs text-slate-400 line-through">{formatPrice(product.wholesalePrice)}</span>
                  <span className="text-lg font-bold text-green-700">{formatPrice(product.wholesaleSalePrice)}</span>
                  <span className="text-xs text-green-600 font-semibold">Precio mayorista</span>
                </>
              ) : (
                <>
                  <span className="text-lg font-bold text-green-700">{formatPrice(product.wholesalePrice)}</span>
                  <span className="text-xs text-green-600 font-semibold">Precio mayorista</span>
                </>
              )
            ) : product.salePrice && product.salePrice < product.price ? (
              // Cliente minorista con precio de oferta
              <>
                <span className="text-xs text-slate-400 line-through">{formatPrice(product.price)}</span>
                <span className="text-lg font-bold text-red-600">{formatPrice(product.salePrice)}</span>
              </>
            ) : (
              // Precio normal minorista
              <span className="text-lg font-bold text-slate-900">{formatPrice(product.price)}</span>
            )}
          </div>
          {/* Si no hay usuario logueado se muestra "Iniciar sesión" en lugar de "Agregar" */}
          {customer ? (
            <button
              onClick={handleAddToCart}
              disabled={outOfStock}
              className="btn-primary text-sm px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + Agregar
            </button>
          ) : (
            <button
              onClick={handleAddToCart}
              className="btn-secondary text-xs px-3 py-1.5"
            >
              Iniciar sesión
            </button>
          )}
        </div>
        {product.stock > 0 && product.stock <= 5 && (
          <p className="text-xs text-orange-500 font-medium mt-2">
            ⚠️ Últimas {product.stock} unidades
          </p>
        )}
      </div>
    </Link>
  );
}

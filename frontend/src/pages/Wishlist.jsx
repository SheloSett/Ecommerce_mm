import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import SiteMeta from "../components/SiteMeta";
import { useWishlist } from "../context/WishlistContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { getImageUrl } from "../services/api";

// Formatea precio en ARS
function formatPrice(n) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
}

// Card individual de producto favorito — diseño Stitch
function FavoriteCard({ product }) {
  const { remove } = useWishlist();
  const { customer } = useCustomerAuth();
  const navigate = useNavigate();

  // Precio a mostrar según tipo de cliente
  const displayPrice = product.salePrice && product.salePrice < product.price
    ? product.salePrice
    : product.price;
  const priceLabel = customer?.type === "MAYORISTA" ? "mayorista" : "minorista";
  const isOnSale = product.salePrice && product.salePrice < product.price;
  const isLowStock = product.stock > 0 && product.stock <= 5;
  const imageUrl = product.images?.[0] ? getImageUrl(product.images[0]) : null;

  return (
    <div className="group bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300">
      {/* Imagen */}
      <div className="relative bg-slate-50 aspect-[4/5] p-6 flex items-center justify-center overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.name}
            className="object-contain w-full h-full group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300 text-6xl">📦</div>
        )}

        {/* Botón quitar de favoritos */}
        <button
          onClick={() => remove(product.id)}
          className="absolute top-3 right-3 w-10 h-10 flex items-center justify-center bg-white rounded-full shadow-sm text-red-500 hover:text-red-600 hover:scale-110 active:scale-90 transition-all"
          title="Quitar de favoritos"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z"/>
          </svg>
        </button>

        {/* Badge oferta */}
        {isOnSale && (
          <div className="absolute top-3 left-3 bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg uppercase tracking-wide">
            Oferta
          </div>
        )}

        {/* Badge stock bajo */}
        {isLowStock && (
          <div className="absolute bottom-3 left-3 bg-red-50 text-red-600 text-[10px] font-bold px-2 py-1 rounded border border-red-200 flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-2.194-.833-2.964 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            ÚLTIMAS {product.stock} UNIDADES
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4 bg-slate-50/50">
        <h3
          className="font-semibold text-slate-800 text-base mb-1 truncate cursor-pointer hover:text-blue-600 transition-colors"
          onClick={() => navigate(`/producto/${product.id}`)}
        >
          {product.name}
        </h3>

        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-lg font-bold text-green-700">
            {formatPrice(displayPrice)}
          </span>
          {isOnSale && (
            <span className="text-xs text-slate-400 line-through">{formatPrice(product.price)}</span>
          )}
          <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-auto">
            {priceLabel}
          </span>
        </div>

        {/* Botón agregar — va al detalle del producto para seleccionar variante si aplica */}
        <button
          onClick={() => navigate(`/producto/${product.id}`)}
          className="w-full bg-green-600 hover:brightness-110 text-white py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-95"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          Agregar
        </button>
      </div>
    </div>
  );
}

export default function Wishlist() {
  const { wishlist } = useWishlist();
  const navigate = useNavigate();

  return (
    <div className="ds-page min-h-screen flex flex-col bg-slate-50">
      <SiteMeta title="Mis favoritos | IGWT Store" description="Tus productos guardados en IGWT Store." />
      <Navbar />

      <main className="flex-grow max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-10 py-12">

        {/* Encabezado */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">Mis favoritos</h1>
            <p className="text-slate-500 mt-1 text-sm">
              Gestioná tus productos guardados y añadilos al carrito fácilmente.
            </p>
          </div>
          {wishlist.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-full shadow-sm self-start sm:self-auto">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <span className="text-sm font-semibold text-slate-600">
                {wishlist.length} producto{wishlist.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>

        {/* Lista vacía */}
        {wishlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-28 text-slate-400 gap-4">
            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-4xl">🤍</div>
            <p className="text-xl font-semibold text-slate-600">Todavía no guardaste ningún producto</p>
            <p className="text-sm text-slate-400">Hacé click en el corazón de cualquier producto para guardarlo acá.</p>
            <Link
              to="/catalogo"
              className="mt-2 px-6 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition-colors"
            >
              Ver catálogo
            </Link>
          </div>
        ) : (
          <>
            {/* Grid de cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {wishlist.map((p) => (
                <FavoriteCard key={p.id} product={p} />
              ))}
            </div>

            {/* Botón ver más / ir al catálogo */}
            <div className="mt-12 flex justify-center">
              <button
                onClick={() => navigate("/catalogo")}
                className="px-8 py-4 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-full border border-slate-200 shadow-sm transition-all hover:shadow-md"
              >
                Ver más productos en el catálogo
              </button>
            </div>
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}

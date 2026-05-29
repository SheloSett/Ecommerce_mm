import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import SiteMeta from "../components/SiteMeta";
import ProductCard from "../components/ProductCard";
import { useWishlist } from "../context/WishlistContext";

// FavoriteCard — comentada porque se reemplazó por ProductCard para tener un diseño
// consistente con el catálogo y el home (mismo componente, mismas cards).
// function FavoriteCard({ product }) { ... }

export default function Wishlist() {
  const { wishlist, remove } = useWishlist();
  const navigate = useNavigate();

  // Auto-eliminar productos sin stock o desactivados al cargar la lista
  useEffect(() => {
    wishlist.forEach((p) => {
      const sinStock = p.stock === 0 && p.stock !== -1;
      const inactivo = p.active === false;
      if (sinStock || inactivo) remove(p.id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wishlist.length]);

  return (
    <div className="storefront min-h-screen flex flex-col bg-[#f8f9ff]">
      <SiteMeta title="Mis favoritos | IGWT Store" description="Tus productos guardados en IGWT Store." />
      <Navbar />

      <main className="flex-grow max-w-[1280px] mx-auto w-full px-6 py-12">

        {/* Encabezado */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-[#0b1c30] tracking-tight">Mis favoritos</h1>
            <p className="text-[#565e74] mt-1 text-sm">
              {wishlist.length > 0
                ? `${wishlist.length} producto${wishlist.length !== 1 ? "s" : ""} guardado${wishlist.length !== 1 ? "s" : ""}`
                : "Guardá productos para comprarlos después"}
            </p>
          </div>
        </div>

        {/* Lista vacía */}
        {wishlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-28 text-[#565e74] gap-4">
            <span className="material-symbols-outlined text-[80px] text-[#bdcaba]">favorite</span>
            <p className="text-xl font-semibold text-[#0b1c30]">Todavía no guardaste ningún producto</p>
            <p className="text-sm text-[#565e74]">Hacé click en el corazón de cualquier producto para guardarlo acá.</p>
            <Link
              to="/catalogo"
              className="mt-2 flex items-center gap-2 px-6 py-3 bg-[#00873a] text-white font-bold rounded-[10px] hover:brightness-110 transition-all"
            >
              <span className="material-symbols-outlined text-[20px]">store</span>
              Ver catálogo
            </Link>
          </div>
        ) : (
          <>
            {/* Grid de cards — mismo layout que el catálogo */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {wishlist.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>

            {/* Botón ir al catálogo */}
            <div className="mt-12 flex justify-center">
              <button
                onClick={() => navigate("/catalogo")}
                className="flex items-center gap-2 px-8 py-3 border border-[#bdcaba] text-[#0b1c30] font-semibold rounded-[10px] hover:bg-[#dce9ff]/30 transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">store</span>
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

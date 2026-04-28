import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import ProductCard from "../components/ProductCard";
import SiteMeta from "../components/SiteMeta";
import { useWishlist } from "../context/WishlistContext";

export default function Wishlist() {
  const { wishlist, remove } = useWishlist();

  return (
    <div className="min-h-screen flex flex-col">
      <SiteMeta title="Mis favoritos | IGWT Store" description="Tus productos guardados en IGWT Store." />
      <Navbar />
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-extrabold text-slate-900">Mis favoritos</h1>
          {wishlist.length > 0 && (
            <span className="text-sm text-slate-500">{wishlist.length} producto{wishlist.length !== 1 ? "s" : ""}</span>
          )}
        </div>

        {wishlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-4">
            <span className="text-6xl">🤍</span>
            <p className="text-xl font-medium">Todavía no guardaste ningún producto</p>
            <p className="text-sm text-slate-500">Hacé click en el corazón de cualquier producto para guardarlo acá.</p>
            <Link to="/catalogo" className="btn-primary mt-2">Ver catálogo</Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {wishlist.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

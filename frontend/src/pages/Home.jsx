import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import ProductCard from "../components/ProductCard";
import { productsApi, categoriesApi } from "../services/api";

export default function Home() {
  const [featuredProducts, setFeaturedProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      productsApi.getAll({ featured: true, limit: 8 }),
      categoriesApi.getAll(),
    ])
      .then(([productsRes, catsRes]) => {
        setFeaturedProducts(productsRes.data.products);
        setCategories(catsRes.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const categoryIcons = {
    cables: "🔌",
    auriculares: "🎧",
    cargadores: "⚡",
    almacenamiento: "💾",
    perifericos: "🖱️",
    accesorios: "📱",
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      {/* Hero */}
      <section className="bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-extrabold mb-6 leading-tight">
            Tecnología que
            <span className="text-blue-400"> conecta </span>
            tu mundo
          </h1>
          <p className="text-slate-300 text-lg md:text-xl mb-8 max-w-2xl mx-auto">
            Cables, auriculares, cargadores y accesorios de alta calidad.
            Envíos a todo Argentina.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/catalogo" className="btn-primary text-lg px-8 py-3">
              Ver catálogo completo →
            </Link>
            <Link
              to="/catalogo?featured=true"
              className="bg-white/10 hover:bg-white/20 text-white border border-white/30 font-semibold px-8 py-3 rounded-lg transition-colors"
            >
              Productos destacados
            </Link>
          </div>
        </div>
      </section>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 w-full">
        {/* Categorías */}
        {categories.length > 0 && (
          <section className="mb-14">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Explorar por categoría</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
              {categories.map((cat) => (
                <Link
                  key={cat.id}
                  to={`/catalogo?category=${cat.slug}`}
                  className="card p-4 text-center hover:shadow-md hover:border-blue-200 transition-all group"
                >
                  <div className="text-3xl mb-2">
                    {categoryIcons[cat.slug] || "📦"}
                  </div>
                  <p className="text-sm font-semibold text-slate-700 group-hover:text-blue-600 transition-colors">
                    {cat.name}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {cat.totalProducts ?? cat._count?.products ?? 0} productos
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Productos destacados */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-slate-900">Productos destacados</h2>
            <Link to="/catalogo" className="text-blue-600 hover:underline text-sm font-medium">
              Ver todos →
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="card animate-pulse">
                  <div className="aspect-square bg-slate-200" />
                  <div className="p-4 space-y-2">
                    <div className="h-4 bg-slate-200 rounded w-3/4" />
                    <div className="h-4 bg-slate-200 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : featuredProducts.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {featuredProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-slate-400">
              <p className="text-4xl mb-4">📦</p>
              <p>Próximamente habrá productos disponibles.</p>
              <Link to="/catalogo" className="text-blue-600 hover:underline mt-2 block">
                Ver catálogo
              </Link>
            </div>
          )}
        </section>

        {/* Banner MercadoPago */}
        <section className="mt-16 bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-8 text-white text-center">
          <h3 className="text-2xl font-bold mb-2">Pagá con MercadoPago</h3>
          <p className="text-blue-100 mb-4">
            Tarjeta de crédito, débito, efectivo y más. Compra segura garantizada.
          </p>
          <div className="flex justify-center gap-4 text-3xl">
            <span>💳</span>
            <span>🏦</span>
            <span>💵</span>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

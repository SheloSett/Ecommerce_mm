import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import ProductCard from "../components/ProductCard";
import SiteMeta from "../components/SiteMeta";
import { productsApi, categoriesApi, slidesApi, getImageUrl } from "../services/api";
import { useCustomerAuth } from "../context/CustomerAuthContext";

export default function Home() {
  const [featuredProducts, setFeaturedProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [slides, setSlides] = useState([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const timerRef = useRef(null);
  const { customer } = useCustomerAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const visibleFor = customer?.type || "MINORISTA";
    Promise.all([
      productsApi.getAll({ featured: true, limit: 8, visibleFor }),
      categoriesApi.getAll(),
      slidesApi.getAll(),
    ])
      .then(([productsRes, catsRes, slidesRes]) => {
        setFeaturedProducts(productsRes.data.products);
        setCategories(catsRes.data);
        setSlides(slidesRes.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [customer?.type]);

  // Auto-avance del carrusel
  const next = useCallback(() => {
    setCurrentSlide((prev) => (prev + 1) % Math.max(slides.length, 1));
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1) return;
    timerRef.current = setInterval(next, 5000);
    return () => clearInterval(timerRef.current);
  }, [slides.length, next]);

  const goTo = (idx) => {
    clearInterval(timerRef.current);
    setCurrentSlide(idx);
    if (slides.length > 1) timerRef.current = setInterval(next, 5000);
  };

  const handleSlideClick = (slide) => {
    if (!slide.url) return;
    if (slide.url.startsWith("http")) {
      window.open(slide.url, "_blank", "noopener,noreferrer");
    } else {
      navigate(slide.url);
    }
  };

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
      <SiteMeta />
      <Navbar />

      {/* ── Carrusel hero ─────────────────────────────────────────────────── */}
      {slides.length > 0 ? (
        <section className="relative w-full overflow-hidden bg-slate-900" style={{ height: "420px" }}>
          {/* Slides */}
          {slides.map((slide, idx) => (
            <div
              key={slide.id}
              onClick={() => handleSlideClick(slide)}
              className={`absolute inset-0 transition-opacity duration-700 ${
                idx === currentSlide ? "opacity-100 z-10" : "opacity-0 z-0"
              } ${slide.url ? "cursor-pointer" : ""}`}
            >
              {/* Fondo desenfocado: rellena el espacio sin importar la proporción de la imagen */}
              <img
                src={getImageUrl(`/uploads/${slide.image}`)}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70 pointer-events-none"
              />
              {/* Imagen principal: se muestra completa sin recortar, debajo del texto */}
              <img
                src={getImageUrl(`/uploads/${slide.image}`)}
                alt={slide.title || ""}
                className="absolute inset-0 w-full h-full object-contain z-10"
              />
              {/* Gradiente para legibilidad del texto — z-20 para estar sobre la imagen */}
              {(slide.title || slide.subtitle) && (
                <div className="absolute inset-0 z-20 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              )}
              {/* Texto superpuesto — z-30 para estar sobre el gradiente */}
              {(slide.title || slide.subtitle) && (
                <div className="absolute bottom-0 left-0 right-0 p-8 text-white z-30">
                  <div className="max-w-4xl mx-auto">
                    {slide.title && (
                      <h2 className="text-3xl md:text-5xl font-extrabold mb-2 drop-shadow-lg">
                        {slide.title}
                      </h2>
                    )}
                    {slide.subtitle && (
                      <p className="text-lg md:text-xl text-white/85 drop-shadow">
                        {slide.subtitle}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Flechas de navegación */}
          {slides.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); goTo((currentSlide - 1 + slides.length) % slides.length); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-20 bg-black/40 hover:bg-black/60 text-white rounded-full w-10 h-10 flex items-center justify-center transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); goTo((currentSlide + 1) % slides.length); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-20 bg-black/40 hover:bg-black/60 text-white rounded-full w-10 h-10 flex items-center justify-center transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}

          {/* Puntos de navegación */}
          {slides.length > 1 && (
            <div className="absolute bottom-4 left-0 right-0 z-20 flex justify-center gap-2">
              {slides.map((_, idx) => (
                <button
                  key={idx}
                  onClick={(e) => { e.stopPropagation(); goTo(idx); }}
                  className={`rounded-full transition-all ${
                    idx === currentSlide
                      ? "bg-white w-6 h-2"
                      : "bg-white/50 hover:bg-white/75 w-2 h-2"
                  }`}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        /* Hero estático si no hay slides configurados */
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
      )}

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

        {/* Banner Redes Sociales — 3 cards lado a lado, cada una con color de la red */}
        <section className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4">

          {/* Instagram */}
          <a href="https://www.instagram.com/igwtstore/?hl=es" target="_blank" rel="noopener noreferrer"
            className="group relative rounded-2xl overflow-hidden p-6 flex items-center gap-4 transition-transform duration-200 hover:-translate-y-1"
            style={{ background: "linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)" }}>
            <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors duration-200" />
            <div className="relative flex-shrink-0 w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
              </svg>
            </div>
            <div className="relative">
              <p className="text-white font-bold text-base leading-tight">Instagram</p>
              <p className="text-white/70 text-xs mt-0.5">@igwtstore</p>
            </div>
            <svg className="relative ml-auto w-4 h-4 text-white/50 group-hover:text-white group-hover:translate-x-1 transition-all duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>

          {/* TikTok */}
          <a href="https://www.tiktok.com/@igwtstore" target="_blank" rel="noopener noreferrer"
            className="group relative rounded-2xl overflow-hidden p-6 flex items-center gap-4 bg-black transition-transform duration-200 hover:-translate-y-1 border border-slate-700">
            <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 transition-colors duration-200" />
            <div className="relative flex-shrink-0 w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.17 8.17 0 004.78 1.52V6.75a4.85 4.85 0 01-1.01-.06z"/>
              </svg>
            </div>
            <div className="relative">
              <p className="text-white font-bold text-base leading-tight">TikTok</p>
              <p className="text-white/50 text-xs mt-0.5">@igwtstore</p>
            </div>
            <svg className="relative ml-auto w-4 h-4 text-white/30 group-hover:text-white group-hover:translate-x-1 transition-all duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>

          {/* YouTube */}
          <a href="https://www.youtube.com/@igwtstore7143" target="_blank" rel="noopener noreferrer"
            className="group relative rounded-2xl overflow-hidden p-6 flex items-center gap-4 bg-red-600 transition-transform duration-200 hover:-translate-y-1">
            <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors duration-200" />
            <div className="relative flex-shrink-0 w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
            </div>
            <div className="relative">
              <p className="text-white font-bold text-base leading-tight">YouTube</p>
              <p className="text-white/70 text-xs mt-0.5">@igwtstore7143</p>
            </div>
            <svg className="relative ml-auto w-4 h-4 text-white/50 group-hover:text-white group-hover:translate-x-1 transition-all duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>

        </section>

        {/* Banner MercadoPago */}
        <section className="mt-6 bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-8 text-white text-center">
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

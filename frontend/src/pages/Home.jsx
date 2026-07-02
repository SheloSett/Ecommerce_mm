import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import ProductCard from "../components/ProductCard";
import SiteMeta from "../components/SiteMeta";
import { productsApi, categoriesApi, slidesApi, getImageUrl } from "../services/api";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { getRecentIds } from "../utils/recentlyViewed";

const CAROUSEL_PAGE_SIZE = 4; // cards visibles a la vez en los carruseles de la home

export default function Home() {
  const [featuredProducts, setFeaturedProducts] = useState([]);
  const [saleProducts, setSaleProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recentProducts, setRecentProducts] = useState([]);
  // IDs leídos una sola vez del localStorage (snapshot inmutable)
  const recentIds = useState(() => getRecentIds(4))[0];
  const [slides, setSlides] = useState([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const timerRef = useRef(null);
  const [featuredOffset, setFeaturedOffset] = useState(0);
  const [saleOffset, setSaleOffset] = useState(0);
  const { customer } = useCustomerAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const visibleFor = customer?.type || "MINORISTA";
    Promise.all([
      productsApi.getAll({ featured: true, limit: 8, visibleFor }),
      productsApi.getAll({ homeOffer: true, limit: 8, visibleFor }),
      categoriesApi.getAll(),
      slidesApi.getAll(),
    ])
      .then(([productsRes, saleRes, catsRes, slidesRes]) => {
        setFeaturedProducts(productsRes.data.products);
        setSaleProducts(saleRes.data.products);
        setCategories(catsRes.data);
        setSlides(slidesRes.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [customer?.type]);

  // Re-fetchea los productos recientes desde la API para tener _count correcto y poder
  // detectar variantes. No usamos el snapshot de localStorage porque puede carecer de _count.
  useEffect(() => {
    if (recentIds.length === 0) return;
    const visibleFor = customer?.type || "MINORISTA";
    Promise.all(recentIds.map((id) => productsApi.getById(id)))
      .then((results) => {
        const fresh = results
          .map((r) => ({
            ...r.data,
            // getById devuelve variants[] pero no _count — lo calculamos del array
            _count: { variants: (r.data.variants || []).length },
          }))
          .filter((p) => p.active !== false);
        setRecentProducts(fresh);
      })
      .catch(console.error);
  }, [recentIds, customer?.type]);

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

  // Antes: getCategoryEmoji — mapeaba slug a emoji para cada categoría.
  // Comentado porque fue reemplazado por getCategoryIcon (Material Symbols) según el template.
  /*
  const getCategoryEmoji = (slug) => {
    const s = slug.toLowerCase();
    if (s.includes("auricular") || s.includes("audifonos") || s.includes("headphone")) return "🎧";
    if (s.includes("cable"))                                                             return "🔌";
    if (s.includes("cargador") || s.includes("carga"))                                  return "⚡";
    if (s.includes("almacenamiento") || s.includes("disco") || s.includes("pendrive") || s.includes("memoria")) return "💾";
    if (s.includes("periferico") || s.includes("mouse") || s.includes("teclado"))       return "🖱️";
    if (s.includes("accesorio"))                                                         return "📱";
    if (s.includes("parlante") || s.includes("altavoz") || s.includes("bocina") || s.includes("speaker")) return "🔊";
    if (s.includes("adaptador") || s.includes("hub") || s.includes("conversor"))        return "🔄";
    if (s.includes("bateria") || s.includes("pila") || s.includes("powerbank"))         return "🔋";
    if (s.includes("notebook") || s.includes("laptop") || s.includes("computadora") || s.includes("pc")) return "💻";
    if (s.includes("celular") || s.includes("smartphone") || s.includes("movil"))       return "📱";
    if (s.includes("tablet") || s.includes("ipad"))                                     return "📟";
    if (s.includes("camara") || s.includes("foto") || s.includes("video"))              return "📷";
    if (s.includes("impresora") || s.includes("scanner"))                               return "🖨️";
    if (s.includes("red") || s.includes("router") || s.includes("wifi") || s.includes("ethernet")) return "📶";
    if (s.includes("monitor") || s.includes("pantalla") || s.includes("display"))      return "🖥️";
    if (s.includes("gaming") || s.includes("juego") || s.includes("control") || s.includes("joystick") || s.includes("consola")) return "🎮";
    if (s.includes("iluminacion") || s.includes("lampara") || s.includes("luz"))       return "💡";
    if (s.includes("funda") || s.includes("protector") || s.includes("case"))          return "🛡️";
    if (s.includes("soporte") || s.includes("stand") || s.includes("base"))            return "🗜️";
    if (s.includes("limpieza") || s.includes("mantenimiento"))                          return "🧹";
    if (s.includes("audio") || s.includes("microfono") || s.includes("mic"))           return "🎙️";
    return "📦";
  };
  */

  // Mapeo slug → Material Symbol name para las cards de categoría (según template)
  const getCategoryIcon = (slug) => {
    const s = slug.toLowerCase();
    if (s.includes("auricular") || s.includes("audifonos") || s.includes("headphone")) return "headphones";
    if (s.includes("cable"))                                                             return "power";
    if (s.includes("cargador") || s.includes("carga"))                                  return "charging_station";
    if (s.includes("almacenamiento") || s.includes("disco") || s.includes("pendrive") || s.includes("memoria")) return "save";
    if (s.includes("periferico") || s.includes("mouse") || s.includes("teclado"))       return "mouse";
    if (s.includes("accesorio"))                                                         return "devices";
    if (s.includes("parlante") || s.includes("altavoz") || s.includes("bocina") || s.includes("speaker")) return "speaker";
    if (s.includes("adaptador") || s.includes("hub") || s.includes("conversor"))        return "cable";
    if (s.includes("bateria") || s.includes("pila") || s.includes("powerbank"))         return "battery_charging_full";
    if (s.includes("notebook") || s.includes("laptop") || s.includes("computadora") || s.includes("pc")) return "laptop";
    if (s.includes("celular") || s.includes("smartphone") || s.includes("movil"))       return "smartphone";
    if (s.includes("tablet") || s.includes("ipad"))                                     return "tablet";
    if (s.includes("camara") || s.includes("foto") || s.includes("video"))              return "photo_camera";
    if (s.includes("impresora") || s.includes("scanner"))                               return "print";
    if (s.includes("red") || s.includes("router") || s.includes("wifi") || s.includes("ethernet")) return "wifi";
    if (s.includes("monitor") || s.includes("pantalla") || s.includes("display"))      return "monitor";
    if (s.includes("gaming") || s.includes("juego") || s.includes("control") || s.includes("joystick") || s.includes("consola")) return "sports_esports";
    if (s.includes("iluminacion") || s.includes("lampara") || s.includes("luz"))       return "lightbulb";
    if (s.includes("funda") || s.includes("protector") || s.includes("case"))          return "phone_iphone";
    if (s.includes("soporte") || s.includes("stand") || s.includes("base"))            return "precision_manufacturing";
    if (s.includes("limpieza") || s.includes("mantenimiento"))                          return "cleaning_services";
    if (s.includes("audio") || s.includes("microfono") || s.includes("mic"))           return "mic";
    return "devices_other";
  };

  return (
    <div className="storefront min-h-screen flex flex-col bg-[#f8f9ff]">
      <SiteMeta />
      <Navbar />

      {/* ── Carrusel hero ─────────────────────────────────────────────────── */}
      {slides.length > 0 ? (
        <section className="relative w-full overflow-hidden bg-[#0b1c30]" style={{ height: "420px" }}>
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
                src={getImageUrl(slide.image)}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70 pointer-events-none"
              />
              {/* Imagen principal: object-cover para que ocupe todo el ancho del banner (1920×600px recomendado) */}
              <img
                src={getImageUrl(slide.image)}
                alt={slide.title || ""}
                className="absolute inset-0 w-full h-full object-cover z-10"
              />
              {/* Gradiente para legibilidad del texto */}
              {(slide.title || slide.subtitle) && (
                <div className="absolute inset-0 z-20 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              )}
              {/* Texto superpuesto */}
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

          {/* Flechas de navegación — antes: SVG chevron; ahora: Material Symbol */}
          {slides.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); goTo((currentSlide - 1 + slides.length) % slides.length); }}
                className="absolute left-6 top-1/2 -translate-y-1/2 z-20 bg-[#0b1c30]/50 hover:bg-[#00873a] text-white rounded-full w-10 h-10 flex items-center justify-center transition-colors"
              >
                {/*
                  Antes: SVG chevron inline
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                */}
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); goTo((currentSlide + 1) % slides.length); }}
                className="absolute right-6 top-1/2 -translate-y-1/2 z-20 bg-[#0b1c30]/50 hover:bg-[#00873a] text-white rounded-full w-10 h-10 flex items-center justify-center transition-colors"
              >
                {/*
                  Antes: SVG chevron inline
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                */}
                <span className="material-symbols-outlined">chevron_right</span>
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
                      /* Antes: bg-white w-6 h-2 — ahora verde del sistema de diseño */
                      ? "bg-[#62df7d] w-6 h-2"
                      : "bg-white/50 hover:bg-white/75 w-2 h-2"
                  }`}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        /* Hero estático si no hay slides configurados */
        /* Antes: from-slate-900 via-blue-950 — actualizado a tokens del sistema de diseño */
        <section className="bg-gradient-to-br from-[#0b1c30] via-[#0b1c30] to-[#006b2c]/40 text-white py-20 px-4">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-4xl md:text-6xl font-extrabold mb-6 leading-tight">
              Tecnología que
              {/* Antes: text-blue-400 — actualizado a verde */}
              <span className="text-[#62df7d]"> conecta </span>
              tu mundo
            </h1>
            <p className="text-white/70 text-lg md:text-xl mb-8 max-w-2xl mx-auto">
              Cables, auriculares, cargadores y accesorios de alta calidad.
              Envíos a todo Argentina.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {/* Antes: btn-primary genérico — actualizado a tokens del sistema */}
              <Link to="/catalogo" className="bg-[#00873a] hover:brightness-110 text-white font-bold px-8 py-3 rounded-xl transition-all text-lg">
                Ver catálogo completo
              </Link>
              <Link
                to="/catalogo?featured=true"
                className="bg-white/10 hover:bg-white/20 text-white border border-white/30 font-semibold px-8 py-3 rounded-xl transition-colors"
              >
                Productos destacados
              </Link>
            </div>
          </div>
        </section>
      )}

      <main className="flex-1 max-w-[1280px] mx-auto px-6 py-12 w-full">

        {/* Categorías */}
        {categories.length > 0 && (
          <section className="mb-14">
            {/* Antes: text-slate-900 — actualizado a text-[#0b1c30] */}
            <h2 className="text-2xl font-bold text-[#0b1c30] mb-6">Explorar por categoría</h2>
            {/* Antes: card p-4 text-center (card blanca) + emoji + text-blue-600 hover */}
            {/* Ahora: card oscura bg-[#0b1c30] + Material Symbol icon + hover verde según template */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
              {categories.map((cat) => (
                <Link
                  key={cat.id}
                  to={`/catalogo?category=${cat.slug}`}
                  className="bg-[#0b1c30]/90 text-white p-4 rounded-xl flex flex-col items-center justify-center text-center group cursor-pointer hover:bg-[#00873a] transition-all duration-300"
                >
                  <span
                    className="material-symbols-outlined text-[#62df7d] group-hover:text-white mb-2 transition-colors"
                    style={{ fontSize: 32 }}
                  >
                    {getCategoryIcon(cat.slug)}
                  </span>
                  <p className="text-sm font-semibold leading-tight">{cat.name}</p>
                  {/* Contador "X productos" oculto a pedido del cliente (no quiere contadores
                      de categorías ni en el inicio ni en el catálogo):
                  <p className="text-xs opacity-60 mt-1">
                    {cat.totalProducts ?? cat._count?.products ?? 0} productos
                  </p>
                  */}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Botón "Ver el catálogo" */}
        {/* Antes: gradiente secondary con emoji 🛒 + SVG arrow — actualizado a bg-[#00873a] + Material Symbols */}
        <div className="mb-14 -mt-6">
          <Link
            to="/catalogo"
            className="group w-full flex items-center justify-center gap-3 bg-[#00873a] hover:brightness-110 text-white font-bold px-8 py-4 rounded-xl shadow-lg transition-all duration-200 hover:-translate-y-0.5 text-base"
          >
            {/*
              Antes: emoji 🛒 + SVG chevron
              <span>🛒</span>
              <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-200" ...>...</svg>
            */}
            <span className="material-symbols-outlined">shopping_cart</span>
            Ver el catálogo completo
            <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform duration-200">chevron_right</span>
          </Link>
        </div>

        {/* Productos destacados */}
        <section>
          <div className="mb-6">
            {/* Antes: text-slate-900 — actualizado a text-[#0b1c30] */}
            <h2 className="text-2xl font-bold text-[#0b1c30]">Productos destacados</h2>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-[#bdcaba]/30 animate-pulse">
                  {/* Antes: bg-slate-200 — actualizado a bg-[#dce9ff] */}
                  <div className="aspect-square bg-[#dce9ff]" />
                  <div className="p-4 space-y-2">
                    <div className="h-4 bg-[#dce9ff] rounded w-3/4" />
                    <div className="h-4 bg-[#dce9ff] rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : featuredProducts.length > 0 ? (
            <div className="relative">
              {/* Flecha izquierda */}
              {featuredOffset > 0 && (
                <button
                  onClick={() => setFeaturedOffset((o) => Math.max(0, o - CAROUSEL_PAGE_SIZE))}
                  className="absolute -left-5 top-1/2 -translate-y-1/2 z-10 bg-white border border-[#bdcaba]/50 shadow-md rounded-full w-10 h-10 flex items-center justify-center hover:bg-[#eff4ff] transition-colors"
                >
                  {/*
                    Antes: SVG chevron
                    <svg className="w-5 h-5 text-slate-600" ...>...</svg>
                  */}
                  <span className="material-symbols-outlined text-[#565e74] text-[20px]">chevron_left</span>
                </button>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {featuredProducts
                  .slice(featuredOffset, featuredOffset + CAROUSEL_PAGE_SIZE)
                  .map((p) => (
                    <ProductCard key={p.id} product={p} />
                  ))}
              </div>

              {/* Flecha derecha */}
              {featuredOffset + CAROUSEL_PAGE_SIZE < featuredProducts.length && (
                <button
                  onClick={() => setFeaturedOffset((o) => Math.min(featuredProducts.length - CAROUSEL_PAGE_SIZE, o + CAROUSEL_PAGE_SIZE))}
                  className="absolute -right-5 top-1/2 -translate-y-1/2 z-10 bg-white border border-[#bdcaba]/50 shadow-md rounded-full w-10 h-10 flex items-center justify-center hover:bg-[#eff4ff] transition-colors"
                >
                  {/*
                    Antes: SVG chevron
                    <svg className="w-5 h-5 text-slate-600" ...>...</svg>
                  */}
                  <span className="material-symbols-outlined text-[#565e74] text-[20px]">chevron_right</span>
                </button>
              )}

              {/* Indicador de página */}
              {featuredProducts.length > CAROUSEL_PAGE_SIZE && (
                <div className="flex justify-center gap-1.5 mt-4">
                  {Array.from({ length: Math.ceil(featuredProducts.length / CAROUSEL_PAGE_SIZE) }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setFeaturedOffset(i * CAROUSEL_PAGE_SIZE)}
                      className={`rounded-full transition-all ${
                        Math.floor(featuredOffset / CAROUSEL_PAGE_SIZE) === i
                          /* Antes: bg-blue-600 — actualizado a bg-[#0b1c30] */
                          ? "bg-[#0b1c30] w-5 h-2"
                          : "bg-[#bdcaba] hover:bg-[#565e74] w-2 h-2"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-16 text-[#565e74]">
              {/* Antes: emoji 📦 — reemplazado por Material Symbol */}
              {/* <p className="text-4xl mb-4">📦</p> */}
              <span className="material-symbols-outlined text-[56px] text-[#bdcaba] mb-4 block">inventory_2</span>
              <p>Próximamente habrá productos disponibles.</p>
              {/* Antes: text-blue-600 — actualizado a verde */}
              <Link to="/catalogo" className="text-[#006b2c] hover:underline mt-2 block">
                Ver catálogo
              </Link>
            </div>
          )}
        </section>

        {/* Ofertas — solo se renderiza si hay productos con onSale=true */}
        {saleProducts.length > 0 && (
          <section className="mt-14">
            <div className="mb-6 flex items-center gap-2">
              {/* Antes: emoji 🔥 — reemplazado por Material Symbol */}
              {/* <h2 className="text-2xl font-bold text-slate-900">🔥 Ofertas</h2> */}
              <span
                className="material-symbols-outlined text-orange-500"
                style={{ fontVariationSettings: "'FILL' 1", fontSize: 28 }}
              >local_fire_department</span>
              <h2 className="text-2xl font-bold text-[#0b1c30]">Ofertas</h2>
            </div>

            <div className="relative">
              {/* Flecha izquierda */}
              {saleOffset > 0 && (
                <button
                  onClick={() => setSaleOffset((o) => Math.max(0, o - CAROUSEL_PAGE_SIZE))}
                  className="absolute -left-5 top-1/2 -translate-y-1/2 z-10 bg-white border border-[#bdcaba]/50 shadow-md rounded-full w-10 h-10 flex items-center justify-center hover:bg-[#eff4ff] transition-colors"
                >
                  <span className="material-symbols-outlined text-[#565e74] text-[20px]">chevron_left</span>
                </button>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {saleProducts
                  .slice(saleOffset, saleOffset + CAROUSEL_PAGE_SIZE)
                  .map((p) => (
                    <ProductCard key={p.id} product={p} />
                  ))}
              </div>

              {/* Flecha derecha */}
              {saleOffset + CAROUSEL_PAGE_SIZE < saleProducts.length && (
                <button
                  onClick={() => setSaleOffset((o) => Math.min(saleProducts.length - CAROUSEL_PAGE_SIZE, o + CAROUSEL_PAGE_SIZE))}
                  className="absolute -right-5 top-1/2 -translate-y-1/2 z-10 bg-white border border-[#bdcaba]/50 shadow-md rounded-full w-10 h-10 flex items-center justify-center hover:bg-[#eff4ff] transition-colors"
                >
                  <span className="material-symbols-outlined text-[#565e74] text-[20px]">chevron_right</span>
                </button>
              )}

              {/* Indicador de página */}
              {saleProducts.length > CAROUSEL_PAGE_SIZE && (
                <div className="flex justify-center gap-1.5 mt-4">
                  {Array.from({ length: Math.ceil(saleProducts.length / CAROUSEL_PAGE_SIZE) }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setSaleOffset(i * CAROUSEL_PAGE_SIZE)}
                      className={`rounded-full transition-all ${
                        Math.floor(saleOffset / CAROUSEL_PAGE_SIZE) === i
                          /* Antes: bg-orange-500 — actualizado a bg-[#0b1c30] */
                          ? "bg-[#0b1c30] w-5 h-2"
                          : "bg-[#bdcaba] hover:bg-[#565e74] w-2 h-2"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Visitados recientemente */}
        {/* Antes: horizontal scroll con min-w-[280px] (cards enormes según template) */}
        {/* Ahora: grid igual que los demás carruseles — tamaño normal usando ProductCard */}
        {recentProducts.length > 0 && (
          <section className="mt-14">
            {/* Antes: text-slate-900 — actualizado a text-[#0b1c30] */}
            <h2 className="text-2xl font-bold text-[#0b1c30] mb-6">Visto recientemente</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {recentProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        )}

        {/* Banner Redes Sociales — SIN CAMBIOS por solicitud del usuario */}
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
        {/* Antes: from-blue-600 to-blue-700 con emojis — actualizado a bg-[#316bf3] con Material Symbols */}
        {/*
          <section className="mt-6 bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-8 text-white text-center">
            <h3 className="text-2xl font-bold mb-2">Pagá con MercadoPago</h3>
            <p className="text-blue-100 mb-4">...</p>
            <div className="flex justify-center gap-4 text-3xl">
              <span>💳</span><span>🏦</span><span>💵</span>
            </div>
          </section>
        */}
        <section className="mt-6 bg-[#316bf3] rounded-xl p-10 text-center text-white">
          <h3 className="text-2xl font-bold mb-2">Pagá con MercadoPago</h3>
          <p className="text-white/80 mb-6">
            Tarjeta de crédito, débito, efectivo y más. Compra segura garantizada.
          </p>
          <div className="flex justify-center items-center gap-6">
            <span className="material-symbols-outlined" style={{ fontSize: 40 }}>credit_card</span>
            <span className="material-symbols-outlined" style={{ fontSize: 40 }}>account_balance</span>
            <span className="material-symbols-outlined" style={{ fontSize: 40 }}>payments</span>
          </div>
        </section>

      </main>

      {/* Footer: usamos nuestro componente Footer — NO el del template */}
      <Footer />
    </div>
  );
}

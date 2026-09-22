import { useState, useRef, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useNotifications } from "../context/NotificationContext";
import { getImageUrl, productsApi, categoriesApi } from "../services/api";
import { useWishlist } from "../context/WishlistContext";
import { useSiteConfig } from "../context/SiteConfigContext";
import AnnouncementBar from "./AnnouncementBar";
import CartDrawer from "./CartDrawer";
import MobileBottomNav from "./MobileBottomNav";
import useScrollLock from "../utils/useScrollLock";
import toast from "react-hot-toast";
import { trackSearch } from "../services/tracking";

export default function Navbar() {
  const { totalItems } = useCart();
  const { customer, customerLogout } = useCustomerAuth();
  const { wishlist } = useWishlist();
  const { theme, setTheme } = useSiteConfig();
  const { unreadCount, quotesCount } = useNotifications();
  const [cartOpen, setCartOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Búsqueda mobile: la lupa del navbar despliega una barra animada debajo del nav
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  // Categorías para el menú lateral mobile — se cargan la primera vez que se abre el menú
  const [menuCategories, setMenuCategories] = useState([]);
  const [menuCategoriesLoaded, setMenuCategoriesLoaded] = useState(false);
  const [categoriesExpanded, setCategoriesExpanded] = useState(true);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const dropdownRef = useRef(null);
  const searchContainerRef = useRef(null);
  const mobileSearchRef = useRef(null);
  const mobileSearchInputRef = useRef(null);

  // Redirigir al carrito si se navegó con state { openCart: true }
  useEffect(() => {
    if (location.state?.openCart) {
      navigate("/carrito", { replace: true });
    }
  }, [location]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cierra el dropdown de usuario y las sugerencias de búsqueda si se hace clic afuera
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setUserDropdownOpen(false);
      }
      const insideDesktopSearch = searchContainerRef.current?.contains(e.target);
      const insideMobileSearch = mobileSearchRef.current?.contains(e.target);
      if (!insideDesktopSearch && !insideMobileSearch) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Búsqueda en tiempo real: dispara tras 300ms de inactividad (debounce)
  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const visibleFor = customer?.type === "MAYORISTA" ? "MAYORISTA" : "MINORISTA";
        const res = await productsApi.getAll({ search: term, limit: 6, visibleFor });
        const results = res.data.products ?? res.data ?? [];
        setSuggestions(results);
        setShowSuggestions(true);
      } catch {
        setSuggestions([]);
      } finally {
        setSuggestionsLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, customer?.type]);

  // Al navegar se cierran el menú lateral y la búsqueda mobile
  useEffect(() => {
    setMobileMenuOpen(false);
    setMobileSearchOpen(false);
    setShowSuggestions(false);
  }, [location.pathname, location.search]);

  // Bloquea el scroll de la página (y el "tirar para recargar") mientras el menú lateral está abierto.
  // Antes: solo document.body.style.overflow = "hidden", que en iOS no alcanzaba.
  useScrollLock(mobileMenuOpen);

  // Categorías del menú lateral: se piden una sola vez, la primera vez que se abre
  useEffect(() => {
    if (!mobileMenuOpen || menuCategoriesLoaded) return;
    const visibleFor = customer?.type === "MAYORISTA" ? "MAYORISTA" : "MINORISTA";
    categoriesApi.getAll({ visibleFor })
      .then((res) => setMenuCategories(Array.isArray(res.data) ? res.data : []))
      .catch(() => setMenuCategories([]))
      .finally(() => setMenuCategoriesLoaded(true));
  }, [mobileMenuOpen, menuCategoriesLoaded, customer?.type]);

  // Foco automático en el input cuando se abre la búsqueda mobile
  useEffect(() => {
    if (mobileSearchOpen) {
      const t = setTimeout(() => mobileSearchInputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [mobileSearchOpen]);

  // Cierra todo con Escape
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        setMobileMenuOpen(false);
        setMobileSearchOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const openMobileMenu = () => {
    setMobileSearchOpen(false);
    setMobileMenuOpen(true);
  };

  const toggleMobileSearch = () => {
    setMobileMenuOpen(false);
    const willOpen = !mobileSearchOpen;
    setMobileSearchOpen(willOpen);
    // Foco en el mismo toque: iOS solo abre el teclado si el focus ocurre dentro del gesto del
    // usuario (el efecto con setTimeout de arriba queda como respaldo). El input existe siempre en
    // el DOM, solo está transparente, así que se lo puede enfocar antes de que termine la animación.
    if (willOpen) mobileSearchInputRef.current?.focus({ preventScroll: true });
  };

  // ── Barra inferior del celular (MobileBottomNav) ──
  const toggleMobileMenuFromBar = () => {
    setMobileSearchOpen(false);
    setCartOpen(false);
    setMobileMenuOpen((o) => !o);
  };
  const toggleSearchFromBar = () => {
    setCartOpen(false);
    toggleMobileSearch();
  };
  const openCartFromBar = () => {
    setMobileMenuOpen(false);
    setMobileSearchOpen(false);
    if (customer) { setCartOpen((o) => !o); return; }
    // Sin sesión no hay carrito (la compra requiere cuenta): se lo manda a iniciar sesión
    toast("Iniciá sesión para usar el carrito", { icon: "🛒" });
    navigate("/login");
  };
  const closeMobileOverlays = () => {
    setMobileMenuOpen(false);
    setMobileSearchOpen(false);
    setCartOpen(false);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (search.trim()) {
      navigate(`/catalogo?search=${encodeURIComponent(search.trim())}`);
      setSearch("");
      setShowSuggestions(false);
      setMobileSearchOpen(false);
    }
  };

  const handleSelectSuggestion = (product) => {
    trackSearch(search, suggestions.length);
    navigate(`/producto/${product.slug || product.id}`);
    setSearch("");
    setShowSuggestions(false);
    setMobileSearchOpen(false);
  };

  const formatSuggestionPrice = (product) => {
    const price = product.salePrice && product.salePrice < product.price
      ? product.salePrice
      : product.price;
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);
  };

  const handleLogout = () => {
    customerLogout();
    setUserDropdownOpen(false);
    setMobileMenuOpen(false);
    toast.success("Sesión cerrada");
  };

  const isDark = theme === "oscuro";
  const toggleTheme = () => setTheme(isDark ? "clasico" : "oscuro");

  // Lista de sugerencias — compartida entre la búsqueda desktop (dropdown) y la mobile (inline)
  const renderSuggestionItems = () => (
    <>
      {suggestions.map((p) => (
        <button
          key={p.id}
          type="button"
          onMouseDown={() => handleSelectSuggestion(p)}
          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left"
        >
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex-shrink-0 overflow-hidden">
            {p.images?.[0] ? (
              <img src={getImageUrl(p.images[0])} alt={p.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-300 text-sm">📦</div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
            <p className="text-xs text-slate-500">{p.categories?.[0]?.name || ""}</p>
          </div>
          <span className="text-sm font-semibold text-blue-600 flex-shrink-0">
            {formatSuggestionPrice(p)}
          </span>
        </button>
      ))}
      <button
        type="submit"
        onMouseDown={handleSearch}
        className="w-full px-3 py-2 text-xs text-center text-blue-600 hover:bg-blue-50 border-t border-slate-100 font-medium transition-colors"
      >
        Ver todos los resultados para "{search}" →
      </button>
    </>
  );

  // Clase común de los ítems del menú lateral
  const drawerItem = "flex items-center gap-3 w-full px-5 py-3 text-[15px] text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors";

  return (
    <>
      {/* ── Navbar principal — diseño Stitch, color de fondo: #0F172A (nuevo primario del template) ── */}
      {/* bg-[#0F172A]: dark navy del template Stitch, fijo en ambos temas (clasico y oscuro) */}
      <nav className="bg-[#0F172A] border-b border-white/10 shadow-sm sticky top-0 z-40">
        {/* Grid de 3 columnas: logo | búsqueda centrada | iconos */}
        <div className="flex md:grid md:grid-cols-3 items-center justify-between w-full px-4 sm:px-6 md:px-10 max-w-[1280px] mx-auto h-16 md:h-20">

          {/* ── COL 1: Logo ── */}
          <div className="flex items-center">
            <Link to="/" className="flex items-center gap-2 text-xl md:text-2xl font-semibold text-white whitespace-nowrap" style={{ fontFamily: "Outfit, sans-serif" }}>
              <span className="material-symbols-outlined text-[#7ffc97]">bolt</span>
              IGWT Store
            </Link>
          </div>

          {/* ── COL 2: Búsqueda centrada y más larga ── */}
          <div className="hidden md:flex justify-center">
            {/* Búsqueda pill (solo lg+) — centrada en el navbar, ancho completo de la columna */}
            <form
              onSubmit={handleSearch}
              className="hidden lg:flex items-center bg-white/10 rounded-full px-4 py-2 border border-[#bdcaba]/30 gap-2 relative w-full max-w-lg"
              ref={searchContainerRef}
            >
              <input
                type="text"
                placeholder="Buscar productos..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                className="bg-transparent text-sm text-white placeholder-white/50 focus:outline-none focus:ring-0 flex-1 border-0 outline-none"
                autoComplete="off"
              />
              <button
                type="submit"
                className="text-white opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
              >
                {suggestionsLoading ? (
                  <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
                ) : (
                  <span className="material-symbols-outlined">search</span>
                )}
              </button>

              {/* Dropdown de sugerencias de búsqueda */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 overflow-hidden min-w-[320px]">
                  {renderSuggestionItems()}
                </div>
              )}
            </form>
          </div>

          {/* ── COL 3: Link Catálogo + Íconos alineados a la derecha ── */}
          {/* justify-end: empuja los íconos al extremo derecho de la tercera columna */}
          <div className="flex items-center justify-end gap-4">
            <Link
              to="/catalogo"
              className="hidden md:block text-white/70 hover:text-white text-sm font-medium transition-colors mr-2"
            >
              Catálogo
            </Link>

              {/* Lupa — solo cuando la búsqueda pill no se ve (< lg): despliega la barra mobile */}
              <button
                onClick={toggleMobileSearch}
                className={`hidden md:inline-flex lg:hidden text-white active:scale-95 transition-all ${mobileSearchOpen ? "opacity-100" : "opacity-80 hover:opacity-100"}`}
                aria-label={mobileSearchOpen ? "Cerrar búsqueda" : "Buscar"}
                aria-expanded={mobileSearchOpen}
              >
                <span className="material-symbols-outlined">{mobileSearchOpen ? "close" : "search"}</span>
              </button>

              {/* Toggle claro / oscuro — en mobile vive como switch dentro del menú lateral */}
              <button
                onClick={toggleTheme}
                className="hidden md:inline-flex text-white opacity-80 hover:opacity-100 active:scale-95 transition-all"
                aria-label={theme === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
                title={theme === "oscuro" ? "Modo claro" : "Modo oscuro"}
              >
                <span className="material-symbols-outlined">
                  {theme === "oscuro" ? "light_mode" : "dark_mode"}
                </span>
              </button>

              {/* Ícono de usuario — person (material symbol exacto del template) */}
              {customer ? (
                <div className="relative hidden md:block" ref={dropdownRef}>
                  <button
                    onClick={() => setUserDropdownOpen((o) => !o)}
                    className="relative text-white opacity-80 hover:opacity-100 active:scale-95 transition-all"
                    aria-label="Mi cuenta"
                  >
                    {/* Badge de notificaciones no leídas */}
                    {unreadCount > 0 && (
                      <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 z-10">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                    <span className="material-symbols-outlined">person</span>
                  </button>

                  {/* Dropdown de usuario — contenido nuestro, diseño sin cambios */}
                  {userDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-50">
                      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-200 overflow-hidden flex-shrink-0 flex items-center justify-center">
                          <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                              d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{customer.name}</p>
                          <p className="text-xs text-slate-400 truncate">{customer.email}</p>
                          <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                            customer.type === "MAYORISTA"
                              ? "bg-purple-100 text-purple-700"
                              : "bg-blue-100 text-blue-700"
                          }`}>
                            {customer.type === "MAYORISTA" ? "Mayorista" : "Minorista"}
                          </span>
                        </div>
                      </div>
                      <Link
                        to="/favoritos"
                        onClick={() => setUserDropdownOpen(false)}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
                        </svg>
                        <span className="flex-1">Mis favoritos</span>
                        {wishlist.length > 0 && (
                          <span className="min-w-[20px] h-5 bg-red-100 text-red-600 text-xs font-bold rounded-full flex items-center justify-center px-1">
                            {wishlist.length}
                          </span>
                        )}
                      </Link>
                      <Link
                        to="/pedidos"
                        onClick={() => setUserDropdownOpen(false)}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                        </svg>
                        <span className="flex-1">Mis pedidos</span>
                        {customer.type === "MAYORISTA" && unreadCount > 0 && (
                          <span className="min-w-[20px] h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center px-1">
                            {unreadCount > 9 ? "9+" : unreadCount}
                          </span>
                        )}
                      </Link>
                      <Link
                        to="/perfil"
                        onClick={() => setUserDropdownOpen(false)}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                        </svg>
                        Editar perfil
                      </Link>
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                        </svg>
                        Cerrar sesión
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  to="/login"
                  className="hidden md:inline-flex text-white opacity-80 hover:opacity-100 active:scale-95 transition-all"
                  aria-label="Iniciar sesión"
                  title="Iniciar sesión"
                >
                  <span className="material-symbols-outlined">person</span>
                </Link>
              )}

              {/* Carrito — abre el CartDrawer lateral (setCartOpen); antes usaba navigate("/carrito")
                  que mandaba a la página completa pero dejaba el drawer nunca abierto */}
              {customer && (
                <button
                  onClick={() => setCartOpen(true)}
                  className="hidden md:inline-flex text-white opacity-80 hover:opacity-100 active:scale-95 transition-all relative"
                  aria-label="Carrito"
                >
                  <span className="material-symbols-outlined">shopping_cart</span>
                  {totalItems > 0 && (
                    <span className="absolute -top-2 -right-2 bg-[#00873a] text-[#f7fff2] text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                      {totalItems}
                    </span>
                  )}
                </button>
              )}

              {/* Menú móvil — abre el panel lateral (drawer). A pedido del cliente queda también acá
                  arriba aunque la barra inferior tenga la pestaña "Menú": las dos abren el mismo menú. */}
              <button
                onClick={openMobileMenu}
                className="md:hidden text-white opacity-80 hover:opacity-100 active:scale-95 transition-all"
                aria-label="Abrir menú"
                aria-expanded={mobileMenuOpen}
              >
                <span className="material-symbols-outlined">menu</span>
              </button>
            </div>
        </div>

        {/* ── Búsqueda mobile (< lg): barra que se despliega debajo del nav con animación ── */}
        <div
          ref={mobileSearchRef}
          className={`lg:hidden absolute left-0 right-0 top-full bg-[#0F172A] border-t border-white/10 shadow-xl transition-all duration-300 ease-out ${
            mobileSearchOpen ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 -translate-y-3 pointer-events-none"
          }`}
          aria-hidden={!mobileSearchOpen}
        >
          <form onSubmit={handleSearch} className="px-4 sm:px-6 py-3">
            <div className="flex items-center bg-white/10 rounded-full px-4 py-2 border border-[#bdcaba]/30 gap-2">
              <span className="material-symbols-outlined text-white/60">search</span>
              <input
                ref={mobileSearchInputRef}
                type="search"
                placeholder="Buscar productos..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                className="bg-transparent text-base text-white placeholder-white/50 focus:outline-none focus:ring-0 flex-1 border-0 outline-none min-w-0"
                autoComplete="off"
                tabIndex={mobileSearchOpen ? 0 : -1}
              />
              {suggestionsLoading && (
                <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block flex-shrink-0" />
              )}
              <button
                type="button"
                onClick={() => { setMobileSearchOpen(false); mobileSearchInputRef.current?.blur(); }}
                className="md:hidden text-white/60 hover:text-white flex-shrink-0 leading-none"
                aria-label="Cerrar búsqueda"
                tabIndex={mobileSearchOpen ? 0 : -1}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
              </button>
            </div>
            {showSuggestions && suggestions.length > 0 && (
              <div className="mt-2 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden max-h-[60vh] overflow-y-auto">
                {renderSuggestionItems()}
              </div>
            )}
          </form>
        </div>
      </nav>

      {/* ── Menú lateral mobile: entra desde la derecha (mismo patrón que CartDrawer) ── */}
      <div
        className={`md:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-50 touch-none transition-opacity duration-300 ${
          mobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileMenuOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={`md:hidden fixed top-0 right-0 h-full w-[85vw] max-w-sm bg-[#f8f9ff] z-50 shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col ${
          mobileMenuOpen ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Menú"
        aria-hidden={!mobileMenuOpen}
      >
        {/* Header oscuro (mismo color que navbar) */}
        <div className="flex items-center justify-between px-5 py-4 bg-[#0F172A] flex-shrink-0 touch-none">
          <Link
            to="/"
            onClick={() => setMobileMenuOpen(false)}
            className="flex items-center gap-2 text-lg font-semibold text-white"
            style={{ fontFamily: "Outfit, sans-serif" }}
          >
            <span className="material-symbols-outlined text-[#7ffc97]">bolt</span>
            IGWT Store
          </Link>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="text-white/60 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
            aria-label="Cerrar menú"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain py-2">
          {/* 1. Switch modo claro / oscuro */}
          <button
            type="button"
            role="switch"
            aria-checked={isDark}
            onClick={toggleTheme}
            className={`${drawerItem} justify-between`}
          >
            <span className="flex items-center gap-3">
              <span className="material-symbols-outlined text-slate-500">{isDark ? "dark_mode" : "light_mode"}</span>
              <span>{isDark ? "Modo oscuro" : "Modo claro"}</span>
            </span>
            <span
              className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-300 ${
                isDark ? "bg-[#00873a]" : "bg-slate-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-300 ${
                  isDark ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </span>
          </button>

          <div className="my-2 border-t border-slate-200" />

          {/* 2. Perfil */}
          {customer ? (
            <>
              <div className="px-5 py-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-slate-500">person</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{customer.name}</p>
                  <p className="text-xs text-slate-400 truncate">{customer.email}</p>
                  <span className={`inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${
                    customer.type === "MAYORISTA" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                  }`}>
                    {customer.type === "MAYORISTA" ? "Mayorista" : "Minorista"}
                  </span>
                </div>
              </div>
              <Link to="/perfil" onClick={() => setMobileMenuOpen(false)} className={drawerItem}>
                <span className="material-symbols-outlined text-slate-500">manage_accounts</span>
                Mi perfil
              </Link>
              <Link to="/pedidos" onClick={() => setMobileMenuOpen(false)} className={drawerItem}>
                <span className="material-symbols-outlined text-slate-500">receipt_long</span>
                <span className="flex-1">Mis pedidos</span>
                {customer.type === "MAYORISTA" && unreadCount > 0 && (
                  <span className="min-w-[20px] h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center px-1">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Link>
              {/* Antes: solo mayoristas. Ahora también cualquier cliente que tenga una cotización
                  armada por el vendedor desde el panel (quotesCount viene con las notificaciones). */}
              {(customer.type === "MAYORISTA" || quotesCount > 0) && (
                <Link to="/cotizaciones" onClick={() => setMobileMenuOpen(false)} className={drawerItem}>
                  <span className="material-symbols-outlined text-slate-500">request_quote</span>
                  Mis cotizaciones
                </Link>
              )}
              <Link to="/favoritos" onClick={() => setMobileMenuOpen(false)} className={drawerItem}>
                <span className="material-symbols-outlined text-red-400">favorite</span>
                <span className="flex-1">Mis favoritos</span>
                {wishlist.length > 0 && (
                  <span className="min-w-[20px] h-5 bg-red-100 text-red-600 text-xs font-bold rounded-full flex items-center justify-center px-1">
                    {wishlist.length}
                  </span>
                )}
              </Link>
            </>
          ) : (
            <>
              <Link to="/login" onClick={() => setMobileMenuOpen(false)} className={drawerItem}>
                <span className="material-symbols-outlined text-slate-500">login</span>
                Iniciar sesión
              </Link>
              <Link to="/registro" onClick={() => setMobileMenuOpen(false)} className={drawerItem}>
                <span className="material-symbols-outlined text-slate-500">person_add</span>
                Crear cuenta
              </Link>
            </>
          )}

          <div className="my-2 border-t border-slate-200" />

          {/* 3. Inicio — antes iba al final, debajo de Categorías: con la lista desplegada quedaba
              muy abajo y había que scrollear para encontrarlo */}
          <Link to="/" onClick={() => setMobileMenuOpen(false)} className={drawerItem}>
            <span className="material-symbols-outlined text-slate-500">home</span>
            Inicio
          </Link>

          {/* 4. Categorías (desplegable) */}
          <button
            type="button"
            onClick={() => setCategoriesExpanded((o) => !o)}
            className={`${drawerItem} justify-between`}
            aria-expanded={categoriesExpanded}
          >
            <span className="flex items-center gap-3">
              <span className="material-symbols-outlined text-slate-500">category</span>
              Categorías
            </span>
            <span className={`material-symbols-outlined text-slate-400 transition-transform duration-300 ${categoriesExpanded ? "rotate-180" : ""}`}>
              expand_more
            </span>
          </button>
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
              categoriesExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="overflow-hidden">
              {!menuCategoriesLoaded ? (
                <p className="pl-14 pr-5 py-2 text-sm text-slate-400">Cargando...</p>
              ) : menuCategories.length === 0 ? (
                <p className="pl-14 pr-5 py-2 text-sm text-slate-400">Sin categorías</p>
              ) : (
                menuCategories.map((cat) => (
                  <Link
                    key={cat.id}
                    to={`/catalogo?category=${cat.slug}`}
                    onClick={() => setMobileMenuOpen(false)}
                    className="block pl-14 pr-5 py-2.5 text-sm text-slate-600 hover:bg-slate-100 active:bg-slate-200 transition-colors"
                  >
                    {cat.name}
                  </Link>
                ))
              )}
              <Link
                to="/catalogo"
                onClick={() => setMobileMenuOpen(false)}
                className="block pl-14 pr-5 py-2.5 text-sm font-semibold text-[#00873a] hover:bg-slate-100 transition-colors"
              >
                Ver catálogo completo
              </Link>
            </div>
          </div>
        </div>

        {/* Pie: cerrar sesión */}
        {customer && (
          <div className="border-t border-slate-200 flex-shrink-0">
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 w-full px-5 py-3.5 text-[15px] text-red-600 hover:bg-red-50 active:bg-red-100 transition-colors"
            >
              <span className="material-symbols-outlined">logout</span>
              Cerrar sesión
            </button>
          </div>
        )}
      </aside>

      {/* Banners ocultos en páginas de auth para no distraer al usuario */}
      {!["/registro", "/login", "/olvide-mi-contrasena"].includes(location.pathname) &&
        !location.pathname.startsWith("/reset-password") && (
        <>
          {/* Mini banner de anuncio configurable desde el admin */}
          <AnnouncementBar />

          {/* Banner mayorista — visible solo cuando no hay sesión de cliente activa */}
          {!customer && (
            <div className="mayorista-banner bg-amber-400 text-amber-900 text-xs font-medium text-center py-1.5 px-4 leading-tight">
              ⚠️ Atención cliente mayorista: para ver los precios mayoristas debés{" "}
              <Link to="/login" className="underline font-semibold hover:text-amber-950">
                iniciar sesión con tu cuenta
              </Link>
            </div>
          )}
        </>
      )}

      {/* CartDrawer solo si hay sesión de cliente */}
      {customer && <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />}

      {/* Barra de navegación inferior (solo celular) */}
      <MobileBottomNav
        menuOpen={mobileMenuOpen}
        onMenu={toggleMobileMenuFromBar}
        searchOpen={mobileSearchOpen}
        onSearch={toggleSearchFromBar}
        cartOpen={cartOpen}
        onCart={openCartFromBar}
        onCloseOverlays={closeMobileOverlays}
      />
    </>
  );
}

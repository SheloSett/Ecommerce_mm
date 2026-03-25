import { useState, useRef, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useNotifications } from "../context/NotificationContext";
import { getImageUrl } from "../services/api";
import CartDrawer from "./CartDrawer";
import toast from "react-hot-toast";

export default function Navbar() {
  const { totalItems } = useCart();
  const { customer, customerLogout } = useCustomerAuth();
  const { unreadCount, markAllRead } = useNotifications();
  const [cartOpen, setCartOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const dropdownRef = useRef(null);

  // Abrir el carrito automáticamente si se navegó con state { openCart: true }
  useEffect(() => {
    if (location.state?.openCart) {
      setCartOpen(true);
      // Limpiar el state con React Router para que no se reabra si el usuario vuelve atrás
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cierra el dropdown si se hace clic afuera
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setUserDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    if (search.trim()) {
      navigate(`/catalogo?search=${encodeURIComponent(search.trim())}`);
      setSearch("");
    }
  };

  const handleLogout = () => {
    customerLogout();
    setUserDropdownOpen(false);
    toast.success("Sesión cerrada");
  };

  return (
    <>
      <nav className="bg-slate-900 text-white sticky top-0 z-40 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 font-bold text-xl">
              <span className="text-blue-400">⚡</span>
              <span>IGWT Store</span>
            </Link>

            {/* Búsqueda (desktop) */}
            <form onSubmit={handleSearch} className="hidden md:flex flex-1 max-w-md mx-8">
              <div className="relative w-full">
                <input
                  type="text"
                  placeholder="Buscar productos..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 pr-10 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                />
                <button
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  🔍
                </button>
              </div>
            </form>

            {/* Links + Acciones */}
            <div className="flex items-center gap-3">
              <Link
                to="/catalogo"
                className="hidden md:block text-sm text-slate-300 hover:text-white transition-colors"
              >
                Catálogo
              </Link>

              {/* ─── Ícono de usuario ─── */}
              {customer ? (
                // Cliente logueado → dropdown con nombre y logout
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setUserDropdownOpen((o) => !o)}
                    className="relative flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-slate-800 transition-colors"
                    aria-label="Mi cuenta"
                  >
                    {/* Badge de notificaciones no leídas */}
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 z-10">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                    {/* Mostrar avatar si existe, sino el ícono por defecto */}
                    {customer.avatar ? (
                      <img
                        src={getImageUrl(customer.avatar)}
                        alt="Avatar"
                        className="w-6 h-6 rounded-full object-cover border border-slate-600"
                      />
                    ) : (
                      <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                      </svg>
                    )}
                    <span className="hidden md:block text-sm text-slate-200 max-w-[100px] truncate">
                      {customer.name.split(" ")[0]}
                    </span>
                    <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Dropdown */}
                  {userDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-50">
                      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
                        {/* Mini avatar en el dropdown */}
                        <div className="w-9 h-9 rounded-full bg-slate-200 overflow-hidden flex-shrink-0 flex items-center justify-center">
                          {customer.avatar ? (
                            <img src={getImageUrl(customer.avatar)} alt="Avatar" className="w-full h-full object-cover" />
                          ) : (
                            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                            </svg>
                          )}
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
                      {/* Enlace a historial de pedidos */}
                      <Link
                        to="/pedidos"
                        onClick={() => setUserDropdownOpen(false)}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                        </svg>
                        Mis pedidos
                      </Link>
                      {/* Enlace a cotizaciones — solo para clientes MAYORISTA */}
                      {customer.type === "MAYORISTA" && (
                        <Link
                          to="/cotizaciones"
                          onClick={() => { setUserDropdownOpen(false); markAllRead(); }}
                          className="flex items-center gap-2 w-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                          </svg>
                          <span className="flex-1">Mis cotizaciones</span>
                          {/* Badge: muestra cantidad de notificaciones no leídas */}
                          {unreadCount > 0 && (
                            <span className="min-w-[20px] h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center px-1">
                              {unreadCount > 9 ? "9+" : unreadCount}
                            </span>
                          )}
                        </Link>
                      )}
                      {/* Enlace a editar perfil */}
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
                // No logueado → ícono de persona que lleva al login
                <Link
                  to="/login"
                  className="p-2 rounded-xl hover:bg-slate-800 transition-colors"
                  aria-label="Iniciar sesión"
                  title="Iniciar sesión"
                >
                  <svg className="w-5 h-5 text-slate-300 hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                </Link>
              )}

              {/* ─── Carrito: solo visible si el cliente está logueado ─── */}
              {customer && (
                <button
                  onClick={() => setCartOpen(true)}
                  className="relative p-2 hover:text-blue-400 transition-colors"
                  aria-label="Carrito"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                  {totalItems > 0 && (
                    <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                      {totalItems}
                    </span>
                  )}
                </button>
              )}

              {/* Menú móvil */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2"
                aria-label="Menú"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>

          {/* Menú móvil expandido */}
          {mobileMenuOpen && (
            <div className="md:hidden pb-4 space-y-2">
              <form onSubmit={handleSearch}>
                <input
                  type="text"
                  placeholder="Buscar productos..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
                />
              </form>
              <Link
                to="/catalogo"
                className="block py-2 text-slate-300 hover:text-white"
                onClick={() => setMobileMenuOpen(false)}
              >
                Catálogo
              </Link>
              {!customer && (
                <Link
                  to="/login"
                  className="block py-2 text-slate-300 hover:text-white"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Iniciar sesión
                </Link>
              )}
              {customer && customer.type === "MAYORISTA" && (
                <Link
                  to="/cotizaciones"
                  className="block py-2 text-slate-300 hover:text-white"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Mis cotizaciones
                </Link>
              )}
              {customer && (
                <button
                  onClick={() => { handleLogout(); setMobileMenuOpen(false); }}
                  className="block w-full text-left py-2 text-red-400 hover:text-red-300"
                >
                  Cerrar sesión ({customer.name.split(" ")[0]})
                </button>
              )}
            </div>
          )}
        </div>
      </nav>

      {/* CartDrawer solo si hay sesión de cliente */}
      {customer && <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />}
    </>
  );
}

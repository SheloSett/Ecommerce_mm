import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";

// Layout compartido para todas las páginas del panel de administración
export default function AdminLayout({ children, title }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // sidebarOpen controla si el sidebar está visible en mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Cierra el sidebar automáticamente al cambiar de ruta (navegación mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname, location.search]);

  const handleLogout = () => {
    logout();
    toast.success("Sesión cerrada");
    navigate("/admin/login");
  };

  const [searchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "";

  const navItems = [
    { path: "/admin",            label: "Dashboard",  icon: "📊" },
    {
      path: "/admin/productos",
      label: "Productos",
      icon: "📦",
      subItems: [
        { label: "Todos los productos", tab: "" },
        { label: "Sin stock",           tab: "sinstock" },
        { label: "+ Nuevo producto",    href: "/admin/productos/nuevo" },
        { label: "🖨 Generar flyer",      href: "/admin/productos/flyer" },
      ],
    },
    { path: "/admin/categorias", label: "Categorías", icon: "🏷️" },
    { path: "/admin/metricas",   label: "Métricas",   icon: "📈" },
    {
      path: "/admin/ordenes",
      label: "Órdenes",
      icon: "🛒",
      subItems: [
        { label: "Todos los pedidos", tab: "" },
        { label: "Cotizaciones",      tab: "cotizaciones" },
      ],
    },
    { path: "/admin/caja",      label: "Caja",       icon: "💰" },
    { path: "/admin/compras",   label: "Compras",    icon: "🛍️" },
    { path: "/admin/cupones",   label: "Cupones",    icon: "🏷️" },
    { path: "/admin/carrusel",  label: "Carrusel",   icon: "🖼️" },
    {
      path: "/admin/clientes",
      label: "Clientes",
      icon: "👥",
      // Sub-ítems que se muestran cuando se está en /admin/clientes
      subItems: [
        { label: "Lista de Clientes",       tab: "" },
        { label: "Solicitudes Mayorista",  tab: "mayorista" },
        { label: "Carritos Activos",       tab: "carts" },
        { label: "Cambios de Email",       tab: "emails" },
      ],
    },
  ];

  const isActive = (path) =>
    path === "/admin" ? location.pathname === "/admin" : location.pathname.startsWith(path);

  // Contenido del sidebar extraído para reutilizarlo (se renderiza igual en desktop y mobile)
  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
        <Link to="/" target="_blank" className="flex items-center gap-2 font-bold text-lg">
          <span className="text-blue-400">⚡</span>
          <span>IGWT Store</span>
        </Link>
        {/* Botón cerrar sidebar — solo visible en mobile */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden text-slate-400 hover:text-white p-1 rounded-lg"
          aria-label="Cerrar menú"
        >
          ✕
        </button>
      </div>
      <p className="text-xs text-slate-500 px-6 pt-2 pb-1">Panel Admin</p>

      {/* Navegación */}
      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const active = isActive(item.path);
          return (
            <div key={item.path}>
              <Link
                to={item.path}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>

              {/* Sub-ítems: solo se muestran cuando el ítem padre está activo */}
              {active && item.subItems && (
                <div className="mt-1 ml-4 pl-4 border-l border-slate-700 space-y-0.5">
                  {item.subItems.map((sub) => {
                    // sub.href = ruta fija (ej: /admin/productos/nuevo)
                    // sub.tab  = filtro por ?tab= en la ruta padre
                    const to = sub.href
                      ? sub.href
                      : sub.tab ? `${item.path}?tab=${sub.tab}` : item.path;
                    const subActive = !sub.href && currentTab === sub.tab;
                    return (
                      <Link
                        key={sub.href || sub.tab}
                        to={to}
                        className={`flex items-center px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                          subActive
                            ? "bg-slate-700 text-white"
                            : "text-slate-400 hover:bg-slate-800 hover:text-white"
                        }`}
                      >
                        {sub.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Configuracion + Usuario y logout */}
      <div className="px-4 py-4 border-t border-slate-800 space-y-1">
        <Link
          to="/admin/configuracion"
          className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            isActive("/admin/configuracion")
              ? "bg-blue-600 text-white"
              : "text-slate-400 hover:bg-slate-800 hover:text-white"
          }`}
        >
          <span>⚙️</span>
          Configuración
        </Link>
        <p className="text-xs text-slate-500 px-4 mt-2 mb-1 truncate">{user?.email}</p>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <span>🚪</span>
          Cerrar sesión
        </button>
      </div>
    </>
  );

  // overflow-x-hidden previene que cualquier hijo desborde el ancho de la pantalla en mobile
  return (
    <div className="min-h-screen bg-slate-100 flex overflow-x-hidden">
      {/* ── Sidebar desktop: siempre visible en lg+ ── */}
      <aside className="hidden lg:flex w-60 bg-slate-900 text-white flex-col fixed inset-y-0 left-0 z-30">
        {sidebarContent}
      </aside>

      {/* ── Sidebar mobile: overlay + drawer deslizable ── */}
      {/* Overlay oscuro que aparece detrás del drawer al abrir en mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      {/* Drawer mobile: se desliza desde la izquierda */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-slate-900 text-white flex flex-col transition-transform duration-300 lg:hidden ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarContent}
      </aside>

      {/* ── Contenido principal ── */}
      {/* lg:ml-60 compensa el sidebar fijo en desktop; en mobile ocupa todo el ancho */}
      <div className="flex-1 lg:ml-60 min-w-0">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-3 sm:py-4 sticky top-0 z-20 flex items-center gap-3">
          {/* Botón hamburguesa — solo visible en mobile */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden flex flex-col gap-1.5 p-1.5 rounded-lg hover:bg-slate-100 shrink-0"
            aria-label="Abrir menú"
          >
            <span className="block w-5 h-0.5 bg-slate-700" />
            <span className="block w-5 h-0.5 bg-slate-700" />
            <span className="block w-5 h-0.5 bg-slate-700" />
          </button>
          <h1 className="text-lg sm:text-xl font-bold text-slate-800 truncate">{title}</h1>
        </header>

        <main className="p-4 sm:p-8">{children}</main>
      </div>
    </div>
  );
}

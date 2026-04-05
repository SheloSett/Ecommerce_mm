import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";

// Layout compartido para todas las páginas del panel de administración
export default function AdminLayout({ children, title }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

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
    {
      path: "/admin/clientes",
      label: "Clientes",
      icon: "👥",
      // Sub-ítems que se muestran cuando se está en /admin/clientes
      subItems: [
        { label: "Lista de Clientes",      tab: "" },
        { label: "Solicitudes Mayorista",  tab: "mayorista" },
        { label: "Carritos Activos",       tab: "carts" },
      ],
    },
  ];

  const isActive = (path) =>
    path === "/admin" ? location.pathname === "/admin" : location.pathname.startsWith(path);

  return (
    <div className="min-h-screen bg-slate-100 flex">
      {/* Sidebar */}
      <aside className="w-60 bg-slate-900 text-white flex flex-col fixed inset-y-0 left-0 z-30">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-slate-800">
          <Link to="/" target="_blank" className="flex items-center gap-2 font-bold text-lg">
            <span className="text-blue-400">⚡</span>
            <span>IGWT Store</span>
          </Link>
          <p className="text-xs text-slate-500 mt-1">Panel Admin</p>
        </div>

        {/* Navegación */}
        <nav className="flex-1 px-4 py-6 space-y-1">
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

        {/* Usuario y logout */}
        <div className="px-4 py-4 border-t border-slate-800">
          <p className="text-xs text-slate-500 px-4 mb-2 truncate">{user?.email}</p>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <span>🚪</span>
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Contenido principal */}
      <div className="flex-1 ml-60">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-8 py-4 sticky top-0 z-20">
          <h1 className="text-xl font-bold text-slate-800">{title}</h1>
        </header>

        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}

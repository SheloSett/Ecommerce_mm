import { useState, useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import AdminLayout from "../../components/AdminLayout";
import FitText from "../../components/FitText";
import { useAuth } from "../../context/AuthContext";
import { ordersApi, gastosApi } from "../../services/api";

const STATUS_LABEL = {
  PENDING: { label: "Pendiente", color: "bg-yellow-100 text-yellow-800" },
  APPROVED: { label: "Abonada", color: "bg-green-100 text-green-800" },
  REJECTED: { label: "Rechazada", color: "bg-red-100 text-red-800" },
  CANCELLED: { label: "Cancelada", color: "bg-slate-100 text-slate-600" },
};

export default function AdminDashboard() {
  const { isSuperAdmin, user, loading: authLoading } = useAuth();
  const canSeeFinances = isSuperAdmin || user?.permissions?.includes("finanzas");

  const [stats, setStats]           = useState(null);
  const [gastos, setGastos]         = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [statsPrev, setStatsPrev]   = useState(null);
  const [gastosPrev, setGastosPrev] = useState([]);
  const [statsYear, setStatsYear]   = useState(null);
  const [gastosYear, setGastosYear] = useState([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    const now = new Date();

    // Mes actual
    const curFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const curTo   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

    // Mes anterior
    const prevFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const prevTo   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);

    // Acumulado del año (1 enero → hoy)
    const yearFrom = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    const yearTo   = now.toISOString().slice(0, 10);

    Promise.all([
      ordersApi.getStats({ dateFrom: curFrom,  dateTo: curTo }),
      ordersApi.getAll({ limit: 5 }),
      gastosApi.getAll({ dateFrom: curFrom,  dateTo: curTo }),
      ordersApi.getStats({ dateFrom: prevFrom, dateTo: prevTo }),
      gastosApi.getAll({ dateFrom: prevFrom, dateTo: prevTo }),
      ordersApi.getStats({ dateFrom: yearFrom, dateTo: yearTo }),
      gastosApi.getAll({ dateFrom: yearFrom, dateTo: yearTo }),
    ])
      .then(([statsRes, ordersRes, gastosRes, statsPrevRes, gastosPrevRes, statsYearRes, gastosYearRes]) => {
        setStats(statsRes.data);
        setRecentOrders(ordersRes.data.orders);
        setGastos(gastosRes.data);
        setStatsPrev(statsPrevRes.data);
        setGastosPrev(gastosPrevRes.data);
        setStatsYear(statsYearRes.data);
        setGastosYear(gastosYearRes.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);

  const formatDate = (dateStr) =>
    new Date(dateStr).toLocaleDateString("es-AR", {
      day: "2-digit", month: "2-digit", year: "numeric",
    });

  // Calcula las 4 métricas financieras a partir de stats + lista de gastos
  const calcMetrics = (s, g) => {
    if (!s) return null;
    const gastosNeg = g.filter((x) => x.type === "NEGOCIO").reduce((a, x) => a + x.amount, 0);
    const gastosPer = g.filter((x) => x.type === "PERSONAL").reduce((a, x) => a + x.amount, 0);
    const local     = s.totalProfit - gastosNeg;
    const total     = local - gastosPer;
    return { ventas: s.totalRevenue, costo: s.totalCost, bruta: s.totalProfit, gastosNeg, gastosPer, local, total };
  };

  // Nombre del mes anterior en español
  const prevMonthName = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  };

  const statCards = stats
    ? [
        // Ventas y costo solo se muestran si el admin tiene permiso de ver finanzas
        ...(canSeeFinances ? [
          { label: "Total de ventas", value: formatPrice(stats.totalRevenue), icon: "💰", color: "blue" },
          { label: "Costo total",     value: formatPrice(stats.totalCost),    icon: "🏷️", color: "slate" },
        ] : []),
        { label: "Órdenes abonadas",  value: stats.approvedOrders, icon: "✅", color: "green" },
        { label: "Órdenes pendientes", value: stats.pendingOrders, icon: "⏳", color: "yellow" },
        { label: "Productos activos",  value: stats.totalProducts, icon: "📦", color: "purple" },
      ]
    : [];

  // Esperar a que auth cargue antes de evaluar permisos (evita flash de redirect)
  if (!authLoading && !canSeeFinances) {
    // Redirigir a la primera sección a la que sí tiene acceso
    const firstAllowed = user?.permissions?.[0];
    const redirectMap = {
      ordenes: "/admin/ordenes", productos: "/admin/productos",
      clientes: "/admin/clientes", metricas: "/admin/metricas",
      caja: "/admin/caja", cupones: "/admin/cupones",
      compras: "/admin/compras", categorias: "/admin/categorias",
    };
    const target = (firstAllowed && redirectMap[firstAllowed]) || "/admin/ordenes";
    return <Navigate to={target} replace />;
  }

  return (
    <AdminLayout title="Dashboard">
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* Resumen financiero del mes actual — solo visible si el admin tiene permiso "finanzas" */}
          {canSeeFinances && stats && (() => {
            const gastosNegocio  = gastos.filter((g) => g.type === "NEGOCIO").reduce((s, g) => s + g.amount, 0);
            const gastosPersonal = gastos.filter((g) => g.type === "PERSONAL").reduce((s, g) => s + g.amount, 0);
            const gananciaLocal  = stats.totalProfit - gastosNegocio;
            const totalGanancia  = gananciaLocal - gastosPersonal;
            return (
              // md:grid-cols-3 en lugar de sm:grid-cols-3 — evita que las 3 cards se pongan en fila en pantallas angostas
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Ganancia bruta */}
                <div className="relative bg-gradient-to-br from-emerald-400 to-teal-600 rounded-2xl p-4 sm:p-5 text-white shadow-md overflow-hidden">
                  <div className="absolute -top-4 -right-4 w-24 h-24 bg-white/10 rounded-full" />
                  <div className="absolute -bottom-6 -right-2 w-16 h-16 bg-white/10 rounded-full" />
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[11px] font-bold text-emerald-100 uppercase tracking-widest">Ganancia bruta</p>
                    <span className="text-xs font-bold bg-white/25 text-white px-3 py-1 rounded-full">Este mes</span>
                  </div>
                  {/* FitText: en vez de truncar con "...", achicamos el tamaño hasta que entre */}
                  <FitText max={30} min={16} className="font-extrabold">{formatPrice(stats.totalProfit)}</FitText>
                  <div className="mt-4 pt-3 border-t border-white/20 flex flex-col gap-1">
                    <div className="flex justify-between text-xs text-emerald-100">
                      <span>Ventas</span>
                      <span className="font-semibold text-white">{formatPrice(stats.totalRevenue)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-emerald-100">
                      <span>Costo</span>
                      <span className="font-semibold text-white">−{formatPrice(stats.totalCost)}</span>
                    </div>
                  </div>
                </div>
                {/* Ganancia del local */}
                <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-200 space-y-3">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Ganancia del local</p>
                  <div className="flex items-center justify-between text-sm gap-2">
                    <span className="text-slate-600 shrink-0">Ganancia bruta</span>
                    <FitText max={14} min={10} className="font-semibold text-slate-800 text-right flex-1">{formatPrice(stats.totalProfit)}</FitText>
                  </div>
                  <div className="flex items-center justify-between text-sm gap-2">
                    <span className="text-slate-600 shrink-0">🏢 Gastos negocio</span>
                    <FitText max={14} min={10} className="font-semibold text-red-500 text-right flex-1">−{formatPrice(gastosNegocio)}</FitText>
                  </div>
                  <div className="flex items-center justify-between text-sm font-bold border-t border-slate-100 pt-2 gap-2">
                    <span className="text-slate-700 shrink-0">= Ganancia local</span>
                    <FitText max={16} min={11} className={`font-bold text-right flex-1 ${gananciaLocal >= 0 ? "text-emerald-600" : "text-red-500"}`}>{formatPrice(gananciaLocal)}</FitText>
                  </div>
                </div>
                {/* Total ganancia */}
                <div className={`rounded-2xl p-4 sm:p-5 shadow-sm border space-y-3 ${totalGanancia >= 0 ? "bg-blue-50 border-blue-200" : "bg-red-50 border-red-200"}`}>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Total ganancia</p>
                  <div className="flex items-center justify-between text-sm gap-2">
                    <span className="text-slate-600 shrink-0">Ganancia local</span>
                    <FitText max={14} min={10} className="font-semibold text-slate-800 text-right flex-1">{formatPrice(gananciaLocal)}</FitText>
                  </div>
                  <div className="flex items-center justify-between text-sm gap-2">
                    <span className="text-slate-600 shrink-0">👤 Gastos personales</span>
                    <FitText max={14} min={10} className="font-semibold text-red-500 text-right flex-1">−{formatPrice(gastosPersonal)}</FitText>
                  </div>
                  <div className="flex items-center justify-between font-bold border-t border-slate-200 pt-2 gap-2">
                    <span className="text-slate-700 text-sm shrink-0">= Total</span>
                    <FitText max={24} min={14} className={`font-bold text-right flex-1 ${totalGanancia >= 0 ? "text-blue-700" : "text-red-600"}`}>
                      {formatPrice(totalGanancia)}
                    </FitText>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Cards de estadísticas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {statCards.map((card) => (
              <div key={card.label} className="card p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-2xl">{card.icon}</span>
                </div>
                {/* FitText evita que el número se trunque con "..." en tablets (ej: iPad Pro)
                    cuando las cards quedan angostas */}
                <FitText max={20} min={12} className="font-extrabold text-slate-900">{card.value}</FitText>
                <p className="text-sm text-slate-500 mt-1">{card.label}</p>
              </div>
            ))}
          </div>

          {/* ── Mes anterior + Acumulado anual ───────────────────────── */}
          {canSeeFinances && (() => {
            const prev = calcMetrics(statsPrev, gastosPrev);
            const year = calcMetrics(statsYear, gastosYear);
            if (!prev || !year) return null;

            const Row = ({ label, value, red }) => (
              <div className="flex items-center justify-between text-xs gap-2">
                <span className="text-slate-500 shrink-0">{label}</span>
                <FitText max={12} min={9} className={`font-semibold text-right flex-1 ${red ? "text-red-500" : "text-slate-700"}`}>{value}</FitText>
              </div>
            );

            const TotalRow = ({ label, value, pos }) => (
              <div className="flex items-center justify-between text-sm font-bold border-t border-slate-200 pt-2 gap-2 mt-1">
                <span className="text-slate-700 shrink-0">{label}</span>
                <FitText max={14} min={10} className={`font-bold text-right flex-1 ${pos >= 0 ? "text-emerald-600" : "text-red-600"}`}>{value}</FitText>
              </div>
            );

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* Mes anterior */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Mes anterior</p>
                    <span className="text-xs text-slate-400 capitalize">{prevMonthName()}</span>
                  </div>
                  <Row label="Ventas"           value={formatPrice(prev.ventas)} />
                  <Row label="Costo"            value={`−${formatPrice(prev.costo)}`} red />
                  <Row label="Ganancia bruta"   value={formatPrice(prev.bruta)} />
                  <Row label="🏢 Gastos negocio" value={`−${formatPrice(prev.gastosNeg)}`} red />
                  <Row label="Ganancia local"   value={formatPrice(prev.local)} />
                  <Row label="👤 Gastos personales" value={`−${formatPrice(prev.gastosPer)}`} red />
                  <TotalRow label="= Total neto" value={formatPrice(prev.total)} pos={prev.total} />
                </div>

                {/* Acumulado del año */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Acumulado del año</p>
                    <span className="text-xs text-slate-400">{new Date().getFullYear()}</span>
                  </div>
                  <Row label="Ventas"           value={formatPrice(year.ventas)} />
                  <Row label="Costo"            value={`−${formatPrice(year.costo)}`} red />
                  <Row label="Ganancia bruta"   value={formatPrice(year.bruta)} />
                  <Row label="🏢 Gastos negocio" value={`−${formatPrice(year.gastosNeg)}`} red />
                  <Row label="Ganancia local"   value={formatPrice(year.local)} />
                  <Row label="👤 Gastos personales" value={`−${formatPrice(year.gastosPer)}`} red />
                  <TotalRow label="= Total neto" value={formatPrice(year.total)} pos={year.total} />
                </div>

              </div>
            );
          })()}

          {/* Órdenes recientes */}
          <div className="card">
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-200">
              <h2 className="font-bold text-slate-800">Órdenes recientes</h2>
              <Link to="/admin/ordenes" className="text-sm text-blue-600 hover:underline">
                Ver todas →
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 text-xs uppercase tracking-wide border-b border-slate-100">
                    <th className="px-3 sm:px-6 py-3">Orden</th>
                    <th className="px-3 sm:px-6 py-3">Cliente</th>
                    {canSeeFinances && <th className="px-3 sm:px-6 py-3">Total</th>}
                    {/* Estado y Fecha se ocultan en mobile para que la tabla entre sin scroll */}
                    <th className="hidden sm:table-cell px-6 py-3">Estado</th>
                    <th className="hidden sm:table-cell px-6 py-3">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                        No hay órdenes aún
                      </td>
                    </tr>
                  ) : (
                    recentOrders.map((order) => {
                      const status = STATUS_LABEL[order.status] || STATUS_LABEL.PENDING;
                      return (
                        <tr key={order.id} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="px-3 sm:px-6 py-3 font-mono font-semibold text-slate-700">
                            #{order.id}
                          </td>
                          <td className="px-3 sm:px-6 py-3">
                            <p className="font-medium text-slate-800 leading-tight">{order.customerName}</p>
                            {/* Email solo se muestra en pantallas mayores a sm para ahorrar espacio */}
                            <p className="hidden sm:block text-xs text-slate-400">{order.customerEmail}</p>
                            {/* En mobile mostramos el estado debajo del nombre en lugar de columna separada */}
                            <span className={`sm:hidden inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-semibold ${status.color}`}>
                              {status.label}
                            </span>
                          </td>
                          {canSeeFinances && <td className="px-3 sm:px-6 py-3 font-semibold whitespace-nowrap">{formatPrice(order.total)}</td>}
                          {/* Columna Estado: solo en sm+ */}
                          <td className="hidden sm:table-cell px-6 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${status.color}`}>
                              {status.label}
                            </span>
                          </td>
                          {/* Columna Fecha: solo en sm+ */}
                          <td className="hidden sm:table-cell px-6 py-3 text-slate-500">{formatDate(order.createdAt)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Accesos rápidos */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link
              to="/admin/productos"
              className="card p-6 hover:shadow-md transition-shadow flex items-center gap-4 group"
            >
              <span className="text-3xl">📦</span>
              <div>
                <p className="font-bold text-slate-800 group-hover:text-blue-600">Gestionar productos</p>
                <p className="text-sm text-slate-500">Agregar, editar o eliminar</p>
              </div>
            </Link>
            <Link
              to="/admin/categorias"
              className="card p-6 hover:shadow-md transition-shadow flex items-center gap-4 group"
            >
              <span className="text-3xl">🏷️</span>
              <div>
                <p className="font-bold text-slate-800 group-hover:text-blue-600">Categorías</p>
                <p className="text-sm text-slate-500">Organizar el catálogo</p>
              </div>
            </Link>
            <Link
              to="/admin/ordenes"
              className="card p-6 hover:shadow-md transition-shadow flex items-center gap-4 group"
            >
              <span className="text-3xl">🛒</span>
              <div>
                <p className="font-bold text-slate-800 group-hover:text-blue-600">Ver órdenes</p>
                <p className="text-sm text-slate-500">Gestionar pedidos</p>
              </div>
            </Link>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

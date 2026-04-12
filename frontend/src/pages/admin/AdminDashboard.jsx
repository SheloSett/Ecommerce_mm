import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import AdminLayout from "../../components/AdminLayout";
import { ordersApi, gastosApi } from "../../services/api";

const STATUS_LABEL = {
  PENDING: { label: "Pendiente", color: "bg-yellow-100 text-yellow-800" },
  APPROVED: { label: "Abonada", color: "bg-green-100 text-green-800" },
  REJECTED: { label: "Rechazada", color: "bg-red-100 text-red-800" },
  CANCELLED: { label: "Cancelada", color: "bg-slate-100 text-slate-600" },
};

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [gastos, setGastos] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Dashboard siempre muestra el mes actual
    const now = new Date();
    const dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const dateTo   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

    Promise.all([
      ordersApi.getStats({ dateFrom, dateTo }),
      ordersApi.getAll({ limit: 5 }),
      gastosApi.getAll({ dateFrom, dateTo }),
    ])
      .then(([statsRes, ordersRes, gastosRes]) => {
        setStats(statsRes.data);
        setRecentOrders(ordersRes.data.orders);
        setGastos(gastosRes.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);

  const formatDate = (dateStr) =>
    new Date(dateStr).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  const statCards = stats
    ? [
        { label: "Total de ventas", value: formatPrice(stats.totalRevenue), icon: "💰", color: "blue" },
        { label: "Costo total", value: formatPrice(stats.totalCost), icon: "🏷️", color: "slate" },
        { label: "Órdenes abonadas", value: stats.approvedOrders, icon: "✅", color: "green" },
        { label: "Órdenes pendientes", value: stats.pendingOrders, icon: "⏳", color: "yellow" },
        { label: "Productos activos", value: stats.totalProducts, icon: "📦", color: "purple" },
      ]
    : [];

  return (
    <AdminLayout title="Dashboard">
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* Resumen financiero del mes actual */}
          {stats && (() => {
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
                  <p className="text-[11px] font-bold text-emerald-100 uppercase tracking-widest mb-3">Ganancia bruta</p>
                  {/* text-2xl en mobile para que el número no desborde la card */}
                  <p className="text-2xl sm:text-3xl font-extrabold leading-none truncate">{formatPrice(stats.totalProfit)}</p>
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
                    <span className="font-semibold text-slate-800 truncate text-right">{formatPrice(stats.totalProfit)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm gap-2">
                    <span className="text-slate-600 shrink-0">🏢 Gastos negocio</span>
                    <span className="font-semibold text-red-500 truncate text-right">−{formatPrice(gastosNegocio)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm font-bold border-t border-slate-100 pt-2 gap-2">
                    <span className="text-slate-700 shrink-0">= Ganancia local</span>
                    <span className={`truncate text-right ${gananciaLocal >= 0 ? "text-emerald-600" : "text-red-500"}`}>{formatPrice(gananciaLocal)}</span>
                  </div>
                </div>
                {/* Total ganancia */}
                <div className={`rounded-2xl p-4 sm:p-5 shadow-sm border space-y-3 ${totalGanancia >= 0 ? "bg-blue-50 border-blue-200" : "bg-red-50 border-red-200"}`}>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Total ganancia</p>
                  <div className="flex items-center justify-between text-sm gap-2">
                    <span className="text-slate-600 shrink-0">Ganancia local</span>
                    <span className="font-semibold text-slate-800 truncate text-right">{formatPrice(gananciaLocal)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm gap-2">
                    <span className="text-slate-600 shrink-0">👤 Gastos personales</span>
                    <span className="font-semibold text-red-500 truncate text-right">−{formatPrice(gastosPersonal)}</span>
                  </div>
                  <div className="flex items-center justify-between font-bold border-t border-slate-200 pt-2 gap-2">
                    <span className="text-slate-700 text-sm shrink-0">= Total</span>
                    {/* text-xl en mobile, text-2xl en sm+ para que el número entre en la card */}
                    <span className={`text-xl sm:text-2xl truncate text-right ${totalGanancia >= 0 ? "text-blue-700" : "text-red-600"}`}>
                      {formatPrice(totalGanancia)}
                    </span>
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
                <p className="text-xl font-extrabold text-slate-900">{card.value}</p>
                <p className="text-sm text-slate-500 mt-1">{card.label}</p>
              </div>
            ))}
          </div>

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
                    <th className="px-3 sm:px-6 py-3">Total</th>
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
                          <td className="px-3 sm:px-6 py-3 font-semibold whitespace-nowrap">{formatPrice(order.total)}</td>
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

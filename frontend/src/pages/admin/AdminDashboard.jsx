import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import AdminLayout from "../../components/AdminLayout";
import { ordersApi } from "../../services/api";

const STATUS_LABEL = {
  PENDING: { label: "Pendiente", color: "bg-yellow-100 text-yellow-800" },
  APPROVED: { label: "Abonada", color: "bg-green-100 text-green-800" },
  REJECTED: { label: "Rechazada", color: "bg-red-100 text-red-800" },
  CANCELLED: { label: "Cancelada", color: "bg-slate-100 text-slate-600" },
};

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([ordersApi.getStats(), ordersApi.getAll({ limit: 5 })])
      .then(([statsRes, ordersRes]) => {
        setStats(statsRes.data);
        setRecentOrders(ordersRes.data.orders);
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
          {/* Card destacado: Ganancia bruta */}
          {stats && (
            <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-2xl p-6 text-white flex items-center justify-between shadow-lg">
              <div>
                <p className="text-sm font-medium text-emerald-100">Ganancia bruta</p>
                <p className="text-4xl font-extrabold mt-1">{formatPrice(stats.totalProfit)}</p>
                <p className="text-xs text-emerald-200 mt-1">
                  Ventas {formatPrice(stats.totalRevenue)} − Costo {formatPrice(stats.totalCost)}
                </p>
              </div>
              <span className="text-6xl opacity-30">📈</span>
            </div>
          )}

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
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-bold text-slate-800">Órdenes recientes</h2>
              <Link to="/admin/ordenes" className="text-sm text-blue-600 hover:underline">
                Ver todas →
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 text-xs uppercase tracking-wide border-b border-slate-100">
                    <th className="px-6 py-3">Orden</th>
                    <th className="px-6 py-3">Cliente</th>
                    <th className="px-6 py-3">Total</th>
                    <th className="px-6 py-3">Estado</th>
                    <th className="px-6 py-3">Fecha</th>
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
                          <td className="px-6 py-3 font-mono font-semibold text-slate-700">
                            #{order.id}
                          </td>
                          <td className="px-6 py-3">
                            <p className="font-medium text-slate-800">{order.customerName}</p>
                            <p className="text-xs text-slate-400">{order.customerEmail}</p>
                          </td>
                          <td className="px-6 py-3 font-semibold">{formatPrice(order.total)}</td>
                          <td className="px-6 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${status.color}`}>
                              {status.label}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-slate-500">{formatDate(order.createdAt)}</td>
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

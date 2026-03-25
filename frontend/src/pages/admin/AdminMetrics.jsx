import { useState, useEffect } from "react";
import AdminLayout from "../../components/AdminLayout";
import { ordersApi, getImageUrl } from "../../services/api";

export default function AdminMetrics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ordersApi
      .getMetrics()
      .then((res) => setData(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const formatPrice = (v) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(v ?? 0);

  if (loading) {
    return (
      <AdminLayout title="Métricas">
        <div className="flex justify-center py-24">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Métricas">
      <div className="space-y-8">

        {/* ── Top 10 clientes ───────────────────────────────────────────── */}
        <section className="card overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              🏆 Top 10 clientes que más compraron
            </h2>
          </div>
          {data.topClients.length === 0 ? (
            <p className="px-6 py-8 text-center text-slate-400">Sin datos aún</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wide border-b border-slate-100 bg-slate-50">
                  <th className="px-6 py-3 w-8">#</th>
                  <th className="px-6 py-3">Cliente</th>
                  <th className="px-6 py-3">Órdenes</th>
                  <th className="px-6 py-3 text-right">Total comprado</th>
                </tr>
              </thead>
              <tbody>
                {data.topClients.map((c, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-6 py-3 font-bold text-slate-400 text-xs">{i + 1}</td>
                    <td className="px-6 py-3">
                      <p className="font-semibold text-slate-800">{c.name}</p>
                      <p className="text-xs text-slate-400">{c.email}</p>
                    </td>
                    <td className="px-6 py-3 text-slate-600">{c.orders}</td>
                    <td className="px-6 py-3 text-right font-bold text-slate-900">
                      {formatPrice(c.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ── Top 10 más vendidos + Top 10 más rentables ─────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* Top por cantidad */}
          <section className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h2 className="font-bold text-slate-800 flex items-center gap-2">
                📦 Top 10 productos más vendidos
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Por cantidad de unidades</p>
            </div>
            {data.topByQuantity.length === 0 ? (
              <p className="px-6 py-8 text-center text-slate-400">Sin datos aún</p>
            ) : (
              <ul className="divide-y divide-slate-50">
                {data.topByQuantity.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <span className="text-xs font-bold text-slate-400 w-5 flex-shrink-0">{i + 1}</span>
                    <div className="w-9 h-9 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                      {p.image
                        ? <img src={getImageUrl(p.image)} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-base">📦</div>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
                      <p className="text-xs text-slate-400">{formatPrice(p.revenue)} en ventas</p>
                    </div>
                    <span className="text-sm font-bold text-blue-600 flex-shrink-0">
                      {p.quantity} u.
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Top por ganancia */}
          <section className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h2 className="font-bold text-slate-800 flex items-center gap-2">
                💰 Top 10 productos más rentables
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Por ganancia bruta (venta − costo)</p>
            </div>
            {data.topByProfit.length === 0 ? (
              <p className="px-6 py-8 text-center text-slate-400">Sin datos aún</p>
            ) : (
              <ul className="divide-y divide-slate-50">
                {data.topByProfit.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <span className="text-xs font-bold text-slate-400 w-5 flex-shrink-0">{i + 1}</span>
                    <div className="w-9 h-9 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                      {p.image
                        ? <img src={getImageUrl(p.image)} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-base">📦</div>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
                      <p className="text-xs text-slate-400">{p.quantity} u. vendidas</p>
                    </div>
                    <span className="text-sm font-bold text-emerald-600 flex-shrink-0">
                      {formatPrice(p.profit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

        </div>
      </div>
    </AdminLayout>
  );
}

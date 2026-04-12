import { useState, useEffect, useCallback } from "react";
import AdminLayout from "../../components/AdminLayout";
import { ordersApi, gastosApi, getImageUrl } from "../../services/api";

const formatPrice = (v) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(v ?? 0);

// Primer y último día del mes actual como string YYYY-MM-DD
const today = new Date();
const DEFAULT_FROM = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
const DEFAULT_TO   = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

export default function AdminMetrics() {
  const [dateFrom, setDateFrom] = useState(DEFAULT_FROM);
  const [dateTo,   setDateTo]   = useState(DEFAULT_TO);
  const [stats,    setStats]    = useState(null);
  const [gastos,   setGastos]   = useState([]);
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, gastosRes, metricsRes] = await Promise.all([
        ordersApi.getStats({ dateFrom, dateTo }),
        gastosApi.getAll({ dateFrom, dateTo }),
        ordersApi.getMetrics({ dateFrom, dateTo }),
      ]);
      setStats(statsRes.data);
      setGastos(gastosRes.data);
      setData(metricsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Presets rápidos de fecha
  const setPreset = (preset) => {
    const now = new Date();
    if (preset === "mes") {
      setDateFrom(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
      setDateTo(new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10));
    } else if (preset === "mes_ant") {
      setDateFrom(new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10));
      setDateTo(new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10));
    } else if (preset === "anio") {
      setDateFrom(new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10));
      setDateTo(new Date(now.getFullYear(), 11, 31).toISOString().slice(0, 10));
    }
  };

  const gastosNegocio  = gastos.filter((g) => g.type === "NEGOCIO").reduce((s, g) => s + g.amount, 0);
  const gastosPersonal = gastos.filter((g) => g.type === "PERSONAL").reduce((s, g) => s + g.amount, 0);
  const gananciaLocal  = (stats?.totalProfit ?? 0) - gastosNegocio;
  const totalGanancia  = gananciaLocal - gastosPersonal;

  return (
    <AdminLayout title="Métricas">
      <div className="space-y-8">

        {/* ── Selector de fechas ──────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-slate-600">Período:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <span className="text-slate-400 text-sm">→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <div className="flex gap-2 ml-2">
            {[
              { label: "Este mes",  key: "mes" },
              { label: "Mes ant.", key: "mes_ant" },
              { label: "Este año", key: "anio" },
            ].map((p) => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-24">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
          </div>
        ) : (
          <>
            {/* ── Resumen financiero ─────────────────────────────────────────── */}
            {stats && (
              // md:grid-cols-3 — en mobile las 3 cards se apilan, en md+ van en fila
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                {/* Ganancia bruta */}
                <div className="relative bg-gradient-to-br from-emerald-400 to-teal-600 rounded-2xl p-4 sm:p-5 text-white shadow-md overflow-hidden">
                  <div className="absolute -top-4 -right-4 w-24 h-24 bg-white/10 rounded-full" />
                  <div className="absolute -bottom-6 -right-2 w-16 h-16 bg-white/10 rounded-full" />
                  <p className="text-[11px] font-bold text-emerald-100 uppercase tracking-widest mb-3">Ganancia bruta</p>
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
                    <span className={`text-xl sm:text-2xl truncate text-right ${totalGanancia >= 0 ? "text-blue-700" : "text-red-600"}`}>
                      {formatPrice(totalGanancia)}
                    </span>
                  </div>
                </div>

              </div>
            )}

            {!data ? null : (
              <>
                {/* ── Top 10 clientes ─────────────────────────────────────────── */}
                <section className="card">
                  <div className="px-4 sm:px-6 py-4 border-b border-slate-200 bg-slate-50">
                    <h2 className="font-bold text-slate-800 flex items-center gap-2">
                      🏆 Top 10 clientes que más compraron
                    </h2>
                  </div>
                  {data.topClients.length === 0 ? (
                    <p className="px-6 py-8 text-center text-slate-400">Sin datos en este período</p>
                  ) : (
                    // overflow-x-auto permite scroll horizontal en mobile sin cortar la tabla
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-slate-500 uppercase tracking-wide border-b border-slate-100 bg-slate-50">
                            <th className="px-3 sm:px-6 py-3 w-8">#</th>
                            <th className="px-3 sm:px-6 py-3">Cliente</th>
                            <th className="px-3 sm:px-6 py-3">Órdenes</th>
                            <th className="px-3 sm:px-6 py-3 text-right whitespace-nowrap">Total comprado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.topClients.map((c, i) => (
                            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                              <td className="px-3 sm:px-6 py-3 font-bold text-slate-400 text-xs">{i + 1}</td>
                              <td className="px-3 sm:px-6 py-3">
                                <p className="font-semibold text-slate-800">{c.name}</p>
                                <p className="text-xs text-slate-400">{c.email}</p>
                              </td>
                              <td className="px-3 sm:px-6 py-3 text-slate-600">{c.orders}</td>
                              <td className="px-3 sm:px-6 py-3 text-right font-bold text-slate-900 whitespace-nowrap">
                                {formatPrice(c.total)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* ── Top 10 más vendidos + más rentables ─────────────────────── */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <section className="card overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
                      <h2 className="font-bold text-slate-800">📦 Top 10 productos más vendidos</h2>
                      <p className="text-xs text-slate-500 mt-0.5">Por cantidad de unidades</p>
                    </div>
                    {data.topByQuantity.length === 0 ? (
                      <p className="px-6 py-8 text-center text-slate-400">Sin datos en este período</p>
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
                            <span className="text-sm font-bold text-blue-600 flex-shrink-0">{p.quantity} u.</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="card overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
                      <h2 className="font-bold text-slate-800">💰 Top 10 productos más rentables</h2>
                      <p className="text-xs text-slate-500 mt-0.5">Por ganancia bruta (venta − costo)</p>
                    </div>
                    {data.topByProfit.length === 0 ? (
                      <p className="px-6 py-8 text-center text-slate-400">Sin datos en este período</p>
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
              </>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}

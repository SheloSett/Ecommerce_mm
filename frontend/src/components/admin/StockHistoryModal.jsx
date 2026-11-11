import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { productsApi } from "../../services/api";
import { reasonLabel, changeText, shortfallOf, refOf, unitLabel, movementDate } from "../../utils/stockMovements";

// Historial de stock de un producto (y sus variantes): cada venta, compra, cancelación o carga a mano,
// con el número con el que quedó y quién lo hizo. Lo escribe el backend en cada cambio de stock
// (services/stock.service.js); los movimientos anteriores a que existiera no están.
export default function StockHistoryModal({ product, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    productsApi.stockMovements(product.id)
      .then((res) => { if (alive) setData(res.data); })
      .catch((err) => { if (alive) setError(err.response?.data?.error || "No se pudo cargar el historial"); });
    return () => { alive = false; };
  }, [product.id]);

  // Escape cierra
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const movements = data?.movements || [];
  const hasVariants = movements.some((m) => m.variantId);

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-900">📋 Historial de stock</h3>
            <p className="text-sm text-slate-500">{product.name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Cerrar">✕</button>
        </div>

        <div className="overflow-y-auto p-5">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && !data && <p className="text-sm text-slate-500">Cargando…</p>}
          {data && movements.length === 0 && (
            <p className="text-sm text-slate-500">
              Todavía no hay movimientos. Desde ahora queda anotada cada venta, compra, cancelación o carga a mano.
            </p>
          )}
          {movements.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 font-semibold uppercase tracking-wide border-b border-slate-200">
                    <th className="py-2 pr-3">Fecha</th>
                    <th className="py-2 pr-3">Motivo</th>
                    {hasVariants && <th className="py-2 pr-3">Variante</th>}
                    <th className="py-2 pr-3 text-right">Cambio</th>
                    <th className="py-2 pr-3 text-right">Quedó</th>
                    <th className="py-2 pr-3">Detalle</th>
                    <th className="py-2">Quién</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => {
                    const ref = refOf(m);
                    const faltaron = shortfallOf(m);
                    return (
                      <tr key={m.id} className="border-b border-slate-100 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-600">{movementDate(m.createdAt)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{reasonLabel(m.reason)}</td>
                        {hasVariants && <td className="py-2 pr-3 text-slate-600">{unitLabel(m, data.variantLabels) || "—"}</td>}
                        <td className={`py-2 pr-3 text-right font-semibold ${m.delta > 0 ? "text-green-600" : m.delta < 0 ? "text-red-600" : "text-slate-500"}`}>
                          {changeText(m.delta)}
                        </td>
                        <td className="py-2 pr-3 text-right font-semibold text-slate-800">{m.after}</td>
                        <td className="py-2 pr-3 text-slate-600">
                          {ref && (ref.to
                            ? <Link to={ref.to} className="text-blue-600 hover:underline" onClick={onClose}>{ref.text}</Link>
                            : <span>{ref.text}</span>)}
                          {faltaron > 0 && (
                            <span className="block text-amber-700">No alcanzó: faltaron {faltaron}</span>
                          )}
                          {m.note && <span className="block text-slate-500">{m.note}</span>}
                        </td>
                        <td className="py-2 text-slate-600">{m.actor || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

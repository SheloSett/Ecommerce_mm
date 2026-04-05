import { useState, useEffect } from "react";
import AdminLayout from "../../components/AdminLayout";
import { gastosApi } from "../../services/api";
import toast from "react-hot-toast";

const TABS = [
  { key: "NEGOCIO",  label: "Gastos del Negocio",  color: "blue" },
  { key: "PERSONAL", label: "Gastos Personales",    color: "purple" },
];

const EMPTY_FORM = { amount: "", description: "", date: new Date().toISOString().slice(0, 10) };

const formatPrice = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);

const formatDate = (d) =>
  new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

export default function AdminCaja() {
  const [tab, setTab]       = useState("NEGOCIO");
  const [gastos, setGastos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState(EMPTY_FORM);

  const fetchGastos = async () => {
    setLoading(true);
    try {
      const res = await gastosApi.getAll();
      setGastos(res.data);
    } catch {
      toast.error("Error al cargar gastos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchGastos(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.amount || !form.description) {
      toast.error("Completá el monto y la descripción");
      return;
    }
    setSaving(true);
    try {
      await gastosApi.create({ ...form, type: tab });
      toast.success("Gasto registrado");
      setForm(EMPTY_FORM);
      fetchGastos();
    } catch {
      toast.error("Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("¿Eliminar este gasto?")) return;
    try {
      await gastosApi.remove(id);
      setGastos((prev) => prev.filter((g) => g.id !== id));
      toast.success("Gasto eliminado");
    } catch {
      toast.error("Error al eliminar");
    }
  };

  const filtered = gastos.filter((g) => g.type === tab);
  const total = filtered.reduce((acc, g) => acc + g.amount, 0);
  const activeTab = TABS.find((t) => t.key === tab);

  return (
    <AdminLayout title="Caja">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Tabs */}
        <div className="flex gap-2 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-5 py-2.5 text-sm font-semibold rounded-t-lg transition-colors ${
                tab === t.key
                  ? t.color === "blue"
                    ? "bg-blue-600 text-white"
                    : "bg-purple-600 text-white"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Formulario nuevo gasto */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4">Registrar gasto</h2>
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Monto $"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className="w-full sm:w-36 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <input
              type="text"
              placeholder="Descripción"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="w-full sm:w-40 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              + Agregar
            </button>
          </form>
        </div>

        {/* Total */}
        <div className={`rounded-2xl p-5 flex items-center justify-between ${
          tab === "NEGOCIO" ? "bg-blue-50 border border-blue-200" : "bg-purple-50 border border-purple-200"
        }`}>
          <div>
            <p className="text-sm text-slate-500 font-medium">{activeTab.label}</p>
            <p className={`text-3xl font-extrabold ${tab === "NEGOCIO" ? "text-blue-700" : "text-purple-700"}`}>
              {formatPrice(total)}
            </p>
          </div>
          <span className="text-4xl opacity-30">{tab === "NEGOCIO" ? "🏢" : "👤"}</span>
        </div>

        {/* Lista de gastos */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="p-8 flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-slate-400">
              <p className="text-4xl mb-2">📭</p>
              <p>No hay gastos registrados</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Fecha</th>
                  <th className="px-4 py-3 text-left">Descripción</th>
                  <th className="px-4 py-3 text-right font-semibold">Monto</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((g, i) => (
                  <tr key={g.id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(g.date)}</td>
                    <td className="px-4 py-3 text-slate-800">{g.description}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatPrice(g.amount)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDelete(g.id)}
                        className="text-red-400 hover:text-red-600 transition-colors text-base"
                        title="Eliminar"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </AdminLayout>
  );
}

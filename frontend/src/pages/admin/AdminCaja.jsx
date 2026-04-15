import { useState, useEffect } from "react";
import AdminLayout from "../../components/AdminLayout";
import { gastosApi, productsApi } from "../../services/api";
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
  // Tipo de gasto: "GASTO" (normal) o "RMA" (devolución de producto)
  const [subtype, setSubtype] = useState("GASTO");
  // Productos disponibles para RMA (solo los que tienen costo cargado)
  const [products, setProducts]     = useState([]);
  const [loadingProds, setLoadingProds] = useState(false);
  // Producto seleccionado para RMA
  const [rmaProductId, setRmaProductId] = useState("");
  // Cantidad para RMA (afecta el monto: costo × qty)
  const [rmaQty, setRmaQty] = useState(1);

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

  // Cargar productos al cambiar a RMA
  useEffect(() => {
    if (subtype !== "RMA" || products.length > 0) return;
    setLoadingProds(true);
    productsApi.getAllAdmin({ limit: 500 })
      .then((res) => {
        // Solo productos con costo definido (los demás no tienen valor de RMA)
        const withCost = (res.data.products || res.data).filter((p) => p.cost > 0);
        setProducts(withCost);
      })
      .catch(() => toast.error("Error al cargar productos"))
      .finally(() => setLoadingProds(false));
  }, [subtype, products.length]);

  // Al seleccionar un producto en RMA, auto-rellenar el monto con costo × cantidad
  const handleRmaProduct = (id) => {
    setRmaProductId(id);
    const product = products.find((p) => String(p.id) === String(id));
    if (product) {
      setForm((f) => ({ ...f, amount: String(product.cost * rmaQty) }));
    }
  };

  // Al cambiar cantidad en RMA, recalcular el monto
  const handleRmaQty = (qty) => {
    const q = Math.max(1, parseInt(qty) || 1);
    setRmaQty(q);
    const product = products.find((p) => String(p.id) === String(rmaProductId));
    if (product) {
      setForm((f) => ({ ...f, amount: String(product.cost * q) }));
    }
  };

  useEffect(() => { fetchGastos(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (subtype === "RMA") {
      if (!rmaProductId) { toast.error("Seleccioná un producto"); return; }
      if (!form.amount)  { toast.error("El monto es requerido"); return; }
    } else {
      if (!form.amount || !form.description) {
        toast.error("Completá el monto y la descripción");
        return;
      }
    }
    // Para RMA: descripción automática con nombre y cantidad del producto
    const product = products.find((p) => String(p.id) === String(rmaProductId));
    const description = subtype === "RMA"
      ? `RMA: ${product?.name || "Producto"}${rmaQty > 1 ? ` (x${rmaQty})` : ""}`
      : form.description;

    setSaving(true);
    try {
      await gastosApi.create({
        ...form,
        description,
        type: tab,
        subtype,
        ...(subtype === "RMA" ? { productId: parseInt(rmaProductId) } : {}),
      });
      toast.success(subtype === "RMA" ? "RMA registrado" : "Gasto registrado");
      setForm(EMPTY_FORM);
      setRmaProductId("");
      setRmaQty(1);
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
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">

            {/* Selector de tipo */}
            <div className="flex gap-2">
              {["GASTO", "RMA"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setSubtype(s); setRmaProductId(""); setRmaQty(1); setForm(EMPTY_FORM); }}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                    subtype === s
                      ? s === "RMA"
                        ? "bg-orange-500 text-white border-orange-500"
                        : "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-600 border-slate-300 hover:border-slate-400"
                  }`}
                >
                  {s === "RMA" ? "🔄 RMA" : "💸 Gasto"}
                </button>
              ))}
            </div>

            {subtype === "GASTO" ? (
              /* ── Formulario GASTO ── */
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500">Monto $</label>
                  <input
                    type="number" min="0" step="0.01" placeholder="0.00"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full sm:w-36 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs font-medium text-slate-500">Descripción</label>
                  <input
                    type="text" placeholder="Ej: Alquiler, servicios..."
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500">Fecha</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    className="w-full sm:w-40 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div className="flex flex-col gap-1 justify-end">
                  <span className="text-xs font-medium text-transparent select-none">.</span>
                  <button
                    type="submit" disabled={saving}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    + Agregar
                  </button>
                </div>
              </div>
            ) : (
              /* ── Formulario RMA ── */
              <div className="flex flex-col gap-3">
                {/* Fila 1: selector de producto */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500">Producto devuelto</label>
                  <select
                    value={rmaProductId}
                    onChange={(e) => handleRmaProduct(e.target.value)}
                    className="w-full px-3 py-2 border border-orange-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-orange-50"
                    disabled={loadingProds}
                  >
                    <option value="">{loadingProds ? "Cargando productos..." : "— Seleccioná un producto —"}</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — costo unitario: {formatPrice(p.cost)}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Fila 2: cantidad + monto + fecha + botón */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-500">Cantidad</label>
                    <input
                      type="number" min="1" step="1" placeholder="1"
                      value={rmaQty}
                      onChange={(e) => handleRmaQty(e.target.value)}
                      className="w-full sm:w-24 px-3 py-2 border border-orange-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-orange-50"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-500">Monto total $</label>
                    {/* Monto auto-calculado (costo × cantidad), editable por si hay diferencia */}
                    <input
                      type="number" min="0" step="0.01" placeholder="0.00"
                      value={form.amount}
                      onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                      className="w-full sm:w-36 px-3 py-2 border border-orange-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-orange-50"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-500">Fecha</label>
                    <input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                      className="w-full sm:w-40 px-3 py-2 border border-orange-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-orange-50"
                    />
                  </div>
                  <div className="flex flex-col gap-1 justify-end">
                    <span className="text-xs font-medium text-transparent select-none">.</span>
                    <button
                      type="submit" disabled={saving}
                      className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      + Agregar
                    </button>
                  </div>
                </div>
              </div>
            )}
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
                    <td className="px-4 py-3 text-slate-800">
                      <div className="flex items-center gap-2">
                        {g.subtype === "RMA" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 border border-orange-200 whitespace-nowrap">
                            🔄 RMA
                          </span>
                        )}
                        {g.description}
                      </div>
                    </td>
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

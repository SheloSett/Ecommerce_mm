import { useState, useEffect, useCallback } from "react";
import AdminLayout from "../../components/AdminLayout";
import { purchasesApi, productsApi } from "../../services/api";
import toast from "react-hot-toast";

const formatPrice = (v) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(v ?? 0);

const today = () => new Date().toISOString().slice(0, 10);

const emptyRow = () => ({
  _id: Math.random().toString(36).slice(2),
  sku: "",
  productName: "",
  cost: "",
  quantity: "",
  matched: null,        // producto existente encontrado por SKU
  matchedVariant: null, // variante encontrada por SKU (si el SKU es de variante)
});

export default function AdminPurchases() {
  const [purchases, setPurchases] = useState([]);
  const [products, setProducts]   = useState([]); // para SKU lookup local
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  // Estado del formulario
  const [supplier, setSupplier] = useState("");
  const [date, setDate]         = useState(today());
  const [rows, setRows]         = useState([emptyRow()]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      purchasesApi.getAll(),
      productsApi.getAllAdmin({ limit: 500 }),
    ])
      .then(([pRes, prodRes]) => {
        setPurchases(pRes.data);
        setProducts(prodRes.data.products || prodRes.data || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Al salir del campo SKU, buscar en productos Y en sus variantes
  const handleSkuBlur = (rowId, sku) => {
    if (!sku.trim()) return;
    const skuLower = sku.trim().toLowerCase();

    // 1. Buscar por SKU del producto
    let matched = products.find((p) => p.sku && p.sku.toLowerCase() === skuLower) || null;
    let matchedVariant = null;

    // 2. Si no hay match de producto, buscar por SKU de variante
    if (!matched) {
      for (const p of products) {
        const variant = (p.variants || []).find((v) => v.sku && v.sku.toLowerCase() === skuLower);
        if (variant) {
          matched = p;
          matchedVariant = variant;
          break;
        }
      }
    }

    setRows((prev) =>
      prev.map((r) =>
        r._id === rowId
          ? {
              ...r,
              matched: matched || null,
              matchedVariant: matchedVariant || null,
              // Auto-completar nombre: producto + variante si corresponde
              productName:
                matched && !r.productName.trim()
                  ? matchedVariant
                    ? `${matched.name} (${matchedVariant.combination.map((c) => c.value).join(" / ")})`
                    : matched.name
                  : r.productName,
            }
          : r
      )
    );
  };

  const updateRow = (rowId, field, value) => {
    setRows((prev) =>
      prev.map((r) =>
        r._id === rowId
          ? {
              ...r,
              [field]: value,
              // Resetear match cuando el SKU cambia
              ...(field === "sku" ? { matched: null, matchedVariant: null } : {}),
            }
          : r
      )
    );
  };

  const addRow    = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (rowId) => {
    if (rows.length === 1) return; // siempre al menos 1 fila
    setRows((prev) => prev.filter((r) => r._id !== rowId));
  };

  const resetForm = () => {
    setSupplier("");
    setDate(today());
    setRows([emptyRow()]);
    setShowForm(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!supplier.trim()) return toast.error("Ingresá el nombre del proveedor");

    const validRows = rows.filter(
      (r) => r.productName.trim() && r.cost !== "" && r.quantity !== ""
    );
    if (validRows.length === 0) {
      return toast.error("Completá al menos un producto con nombre, costo y cantidad");
    }

    for (const r of validRows) {
      if (isNaN(parseFloat(r.cost)) || parseFloat(r.cost) < 0) {
        return toast.error(`Costo inválido en "${r.productName}"`);
      }
      if (isNaN(parseInt(r.quantity)) || parseInt(r.quantity) <= 0) {
        return toast.error(`Cantidad inválida en "${r.productName}"`);
      }
    }

    const items = validRows.map((r) => ({
      sku:         r.sku.trim() || null,
      productName: r.productName.trim(),
      cost:        parseFloat(r.cost),
      quantity:    parseInt(r.quantity),
    }));

    setSaving(true);
    try {
      await purchasesApi.create({ supplier: supplier.trim(), date, items });
      toast.success("Compra registrada correctamente");
      resetForm();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al guardar la compra");
    } finally {
      setSaving(false);
    }
  };

  // Totales del formulario en tiempo real
  const formTotalUnits = rows.reduce((s, r) => s + (parseInt(r.quantity) || 0), 0);
  const formTotalCost  = rows.reduce(
    (s, r) => s + (parseFloat(r.cost) || 0) * (parseInt(r.quantity) || 0),
    0
  );

  return (
    <AdminLayout title="Compras">
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-slate-500 max-w-xl">
            Registrá las compras de stock. Si el SKU coincide con un producto existente, el stock
            se suma y el costo se recalcula como promedio ponderado. Si el SKU no existe, se crea
            el producto como inactivo para que lo configures antes de publicarlo.
          </p>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="flex-shrink-0 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Nueva Compra
            </button>
          )}
        </div>

        {/* Formulario nueva compra */}
        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5"
          >
            <h2 className="text-base font-bold text-slate-800">Nueva Compra</h2>

            {/* Proveedor + Fecha */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Proveedor *
                </label>
                <input
                  type="text"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  placeholder="Nombre del proveedor"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Fecha *
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  required
                />
              </div>
            </div>

            {/* Tabla de productos */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">
                Productos comprados
              </label>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide border-b border-slate-200">
                      <th className="px-3 py-2 text-left w-52">SKU</th>
                      <th className="px-3 py-2 text-left w-40">Nombre del producto</th>
                      <th className="px-3 py-2 text-right w-36">Costo unitario</th>
                      <th className="px-3 py-2 text-right w-28">Cantidad</th>
                      <th className="px-3 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={row._id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="text"
                            value={row.sku}
                            onChange={(e) => updateRow(row._id, "sku", e.target.value)}
                            onBlur={(e) => handleSkuBlur(row._id, e.target.value)}
                            placeholder="SKU"
                            className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                          {/* Badge según tipo de match */}
                          {row.matched && row.matchedVariant && (
                            <p className="text-xs text-emerald-600 font-semibold mt-0.5">
                              ✓ variante · stock: {row.matchedVariant.stock}
                            </p>
                          )}
                          {row.matched && !row.matchedVariant && (
                            <p className="text-xs text-emerald-600 font-semibold mt-0.5">
                              ✓ actualiza stock
                            </p>
                          )}
                          {row.sku && !row.matched && (
                            <p className="text-xs text-blue-500 mt-0.5">nuevo producto</p>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={row.productName}
                            onChange={(e) => updateRow(row._id, "productName", e.target.value)}
                            placeholder="Nombre del producto"
                            className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                          {/* Mostrar stock actual si se actualizará */}
                          {row.matched && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              Stock actual: {row.matched.stock} · Costo actual: {formatPrice(row.matched.cost)}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={row.cost}
                            onChange={(e) => updateRow(row._id, "cost", e.target.value)}
                            placeholder="0"
                            min="0"
                            step="0.01"
                            className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={row.quantity}
                            onChange={(e) => updateRow(row._id, "quantity", e.target.value)}
                            placeholder="0"
                            min="1"
                            className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeRow(row._id)}
                            disabled={rows.length === 1}
                            className="text-slate-300 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={addRow}
                className="mt-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                + Agregar producto
              </button>
            </div>

            {/* Resumen de totales */}
            <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 text-sm border border-slate-100">
              <span className="text-slate-500">
                {rows.filter((r) => r.productName).length} producto(s) · {formTotalUnits} unidades
              </span>
              <span className="font-bold text-slate-800">
                Costo total: {formatPrice(formTotalCost)}
              </span>
            </div>

            {/* Botones */}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "Guardando…" : "Guardar compra"}
              </button>
            </div>
          </form>
        )}

        {/* Historial de compras */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-bold text-slate-800">Historial de compras</h2>
            <span className="text-sm text-slate-400">{purchases.length} registros</span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : purchases.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <p className="text-4xl mb-2">📦</p>
              <p className="text-sm">No hay compras registradas todavía</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {purchases.map((purchase) => {
                const totalCost  = purchase.items.reduce((s, it) => s + it.cost * it.quantity, 0);
                const totalUnits = purchase.items.reduce((s, it) => s + it.quantity, 0);
                const isOpen     = expandedId === purchase.id;

                return (
                  <div key={purchase.id}>
                    {/* Fila resumen (clickeable para expandir) */}
                    <button
                      onClick={() => setExpandedId(isOpen ? null : purchase.id)}
                      className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 font-bold text-sm flex-shrink-0">
                          #{purchase.id}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800">{purchase.supplier}</p>
                          <p className="text-xs text-slate-400">
                            {new Date(purchase.date).toLocaleDateString("es-AR", {
                              day: "2-digit",
                              month: "long",
                              year: "numeric",
                            })}
                            {" · "}
                            {purchase.items.length} producto{purchase.items.length !== 1 ? "s" : ""}
                            {" · "}
                            {totalUnits} unidades
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-slate-800">{formatPrice(totalCost)}</span>
                        <span className="text-slate-400 text-xs">{isOpen ? "▲" : "▼"}</span>
                      </div>
                    </button>

                    {/* Detalle de items */}
                    {isOpen && (
                      <div className="px-6 pb-5">
                        <table className="w-full text-sm border border-slate-100 rounded-xl overflow-hidden">
                          <thead>
                            <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                              <th className="px-4 py-2 text-left">SKU</th>
                              <th className="px-4 py-2 text-left">Producto</th>
                              <th className="px-4 py-2 text-right">Costo unit.</th>
                              <th className="px-4 py-2 text-right">Cantidad</th>
                              <th className="px-4 py-2 text-right">Subtotal</th>
                            </tr>
                          </thead>
                          <tbody>
                            {purchase.items.map((item) => (
                              <tr key={item.id} className="border-t border-slate-100">
                                <td className="px-4 py-2 text-slate-400 text-xs">{item.sku || "—"}</td>
                                <td className="px-4 py-2 font-medium text-slate-800">{item.productName}</td>
                                <td className="px-4 py-2 text-right text-slate-600">{formatPrice(item.cost)}</td>
                                <td className="px-4 py-2 text-right text-slate-600">{item.quantity}</td>
                                <td className="px-4 py-2 text-right font-semibold text-slate-800">
                                  {formatPrice(item.cost * item.quantity)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-slate-200 bg-slate-50">
                              <td colSpan={3} className="px-4 py-2 text-xs text-slate-400">Total</td>
                              <td className="px-4 py-2 text-right font-semibold text-slate-700">{totalUnits}</td>
                              <td className="px-4 py-2 text-right font-bold text-slate-800">{formatPrice(totalCost)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

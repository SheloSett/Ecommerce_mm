import { useState, useEffect, useCallback } from "react";
import AdminLayout from "../../components/AdminLayout";
import { purchasesApi, productsApi, suppliersApi } from "../../services/api";
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
  // productId: solo se usa al EDITAR — liga la fila al producto original para que el backend lo
  // reuse en vez de crear un duplicado (sobre todo en productos creados sin SKU).
  productId: null,
  createdProduct: false, // si esta fila había creado un producto (info para la edición)
});

export default function AdminPurchases() {
  const [purchases, setPurchases] = useState([]);
  const [products, setProducts]   = useState([]); // para SKU lookup local
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  // Estado del formulario
  const [supplier, setSupplier]     = useState("");   // nombre del proveedor (snapshot que se envía)
  const [supplierId, setSupplierId] = useState("");   // id del proveedor seleccionado en el desplegable
  const [date, setDate]             = useState(today());
  const [rows, setRows]             = useState([emptyRow()]);

  // Lista de proveedores para el desplegable + alta inline ("+ Nuevo")
  const [suppliers, setSuppliers]           = useState([]);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [savingSupplier, setSavingSupplier]   = useState(false);

  // Edición: editingId = id de la compra en edición (null = alta). originalItems guarda los items
  // originales para detectar productos creados que quedan huérfanos al editar.
  const [editingId, setEditingId]         = useState(null);
  const [originalItems, setOriginalItems] = useState([]);

  // Modal de decisiones Eliminar/Mantener por producto creado (usado al editar y al eliminar).
  // { open, title, products:[{productId,productName}], decisions:{[id]:"delete"|"keep"}, onConfirm }
  const [decisionModal, setDecisionModal] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      purchasesApi.getAll(),
      productsApi.getAllAdmin({ limit: 500 }),
      suppliersApi.getAll(),
    ])
      .then(([pRes, prodRes, supRes]) => {
        setPurchases(pRes.data);
        setProducts(prodRes.data.products || prodRes.data || []);
        setSuppliers(supRes.data || []);
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
    setSupplierId("");
    setDate(today());
    setRows([emptyRow()]);
    setShowForm(false);
    // Resetear también estado de edición y alta inline de proveedor
    setEditingId(null);
    setOriginalItems([]);
    setShowNewSupplier(false);
    setNewSupplierName("");
  };

  // Alta inline de proveedor desde el desplegable (mismo patrón que WarehouseSupplierFields)
  const handleCreateSupplier = async () => {
    const name = newSupplierName.trim();
    if (!name) return;
    setSavingSupplier(true);
    try {
      const res = await suppliersApi.create({ name });
      const created = res.data;
      const listRes = await suppliersApi.getAll();
      setSuppliers(listRes.data);
      setSupplierId(created.id.toString());
      setSupplier(created.name);
      setNewSupplierName("");
      setShowNewSupplier(false);
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al crear el proveedor");
    } finally {
      setSavingSupplier(false);
    }
  };

  // Cuando el admin elige un proveedor del desplegable, guardamos id + nombre.
  const handleSelectSupplier = (id) => {
    setSupplierId(id);
    const found = suppliers.find((s) => s.id.toString() === id);
    setSupplier(found ? found.name : "");
  };

  // Valida las filas y devuelve el array de items (o null si hay error, mostrando un toast).
  const buildItemsOrError = () => {
    const validRows = rows.filter(
      (r) => r.productName.trim() && r.cost !== "" && r.quantity !== ""
    );
    if (validRows.length === 0) {
      toast.error("Completá al menos un producto con nombre, costo y cantidad");
      return null;
    }
    for (const r of validRows) {
      if (isNaN(parseFloat(r.cost)) || parseFloat(r.cost) < 0) {
        toast.error(`Costo inválido en "${r.productName}"`);
        return null;
      }
      if (isNaN(parseInt(r.quantity)) || parseInt(r.quantity) <= 0) {
        toast.error(`Cantidad inválida en "${r.productName}"`);
        return null;
      }
    }
    return validRows.map((r) => ({
      sku:         r.sku.trim() || null,
      productName: r.productName.trim(),
      cost:        parseFloat(r.cost),
      quantity:    parseInt(r.quantity),
      productId:   r.productId ?? null, // solo se usa al editar (reusar producto, no duplicar)
    }));
  };

  // Antes este handler solo creaba la compra. Ahora distingue alta vs edición y, en edición, pide
  // confirmación por los productos creados que quedan huérfanos antes de enviar.
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!supplier.trim()) return toast.error("Elegí un proveedor");
    const items = buildItemsOrError();
    if (!items) return;

    if (editingId) {
      // Productos creados por la compra original cuyo productId ya no está en las filas → huérfanos.
      const presentIds = new Set(items.map((it) => it.productId).filter(Boolean));
      const orphaned = originalItems
        .filter((it) => it.createdProduct && it.productId && !presentIds.has(it.productId))
        .map((it) => ({ productId: it.productId, productName: it.productName }));

      if (orphaned.length > 0) {
        openDecisionModal({
          title: "Al editar, estos productos creados por la compra quedan sin línea. Elegí qué hacer:",
          products: orphaned,
          confirmLabel: "Guardar cambios",
          onConfirm: (decisions) => submitPurchase(items, decisions),
        });
        return;
      }
      submitPurchase(items, {});
    } else {
      submitPurchase(items, null); // alta (sin decisiones)
    }
  };

  // Ejecuta create o update según editingId. decisions = null en alta.
  const submitPurchase = async (items, decisions) => {
    setSaving(true);
    try {
      const payload = { supplier: supplier.trim(), supplierId: supplierId || null, date, items };
      if (editingId) {
        const res = await purchasesApi.update(editingId, { ...payload, productDecisions: decisions || {} });
        toast.success("Compra actualizada");
        const skipped = res.data?._skippedDueToSales || [];
        if (skipped.length) {
          toast(`No se borraron (tienen ventas): ${skipped.join(", ")}`, { icon: "⚠️", duration: 6000 });
        }
      } else {
        await purchasesApi.create(payload);
        toast.success("Compra registrada correctamente");
      }
      closeDecisionModal();
      resetForm();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al guardar la compra");
    } finally {
      setSaving(false);
    }
  };

  // Carga una compra existente en el formulario para editarla.
  const startEdit = (purchase) => {
    setEditingId(purchase.id);
    setOriginalItems(purchase.items);
    setSupplierId(purchase.supplierId ? purchase.supplierId.toString() : "");
    setSupplier(purchase.supplier || "");
    setDate(new Date(purchase.date).toISOString().slice(0, 10));
    setRows(
      purchase.items.map((it) => ({
        _id: Math.random().toString(36).slice(2),
        sku: it.sku || "",
        productName: it.productName,
        cost: it.cost != null ? it.cost.toString() : "",
        quantity: it.quantity != null ? it.quantity.toString() : "",
        matched: null,
        matchedVariant: null,
        productId: it.productId ?? null,
        createdProduct: it.createdProduct ?? false,
      }))
    );
    setShowNewSupplier(false);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Inicia la eliminación de una compra: si creó productos (que aún existen), pide decisión por cada uno.
  const startDelete = (purchase) => {
    const existingIds = new Set(products.map((p) => p.id));
    const created = purchase.items
      .filter((it) => it.createdProduct && it.productId && existingIds.has(it.productId))
      .map((it) => ({ productId: it.productId, productName: it.productName }));

    if (created.length > 0) {
      openDecisionModal({
        title: "Esta compra creó estos productos. Elegí qué hacer con cada uno:",
        products: created,
        confirmLabel: "Eliminar compra",
        onConfirm: (decisions) => doDelete(purchase.id, decisions),
      });
    } else {
      if (!window.confirm(`¿Eliminar la compra #${purchase.id}? Se revertirá el stock y el costo.`)) return;
      doDelete(purchase.id, {});
    }
  };

  const doDelete = async (id, decisions) => {
    try {
      const res = await purchasesApi.remove(id, { productDecisions: decisions || {} });
      toast.success("Compra eliminada");
      const skipped = res.data?.skippedDueToSales || [];
      if (skipped.length) {
        toast(`No se borraron (tienen ventas): ${skipped.join(", ")}`, { icon: "⚠️", duration: 6000 });
      }
      closeDecisionModal();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al eliminar la compra");
    }
  };

  // ── Modal de decisiones (Eliminar / Mantener por producto creado) ──
  const openDecisionModal = ({ title, products, onConfirm, confirmLabel }) => {
    const decisions = {};
    products.forEach((p) => { decisions[p.productId] = "keep"; }); // default seguro: mantener
    setDecisionModal({ open: true, title, products, decisions, onConfirm, confirmLabel: confirmLabel || "Confirmar" });
  };
  const closeDecisionModal = () => setDecisionModal(null);
  const setDecision = (productId, value) =>
    setDecisionModal((m) => (m ? { ...m, decisions: { ...m.decisions, [productId]: value } } : m));

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
            <h2 className="text-base font-bold text-slate-800">
              {editingId ? `Editar compra #${editingId}` : "Nueva Compra"}
            </h2>

            {/* Proveedor + Fecha */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Proveedor *
                </label>
                {/* Antes era un input de texto libre. Ahora es un desplegable de proveedores con alta
                    inline (+ Nuevo), para vincular la compra a la entidad Proveedor: */}
                {/* <input type="text" value={supplier} onChange={(e) => setSupplier(e.target.value)}
                       placeholder="Nombre del proveedor" className="w-full ..." required /> */}
                {!showNewSupplier ? (
                  <div className="flex gap-2">
                    <select
                      value={supplierId}
                      onChange={(e) => handleSelectSupplier(e.target.value)}
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      <option value="">
                        {(!supplierId && supplier) ? `${supplier} (sin vincular)` : "Elegí un proveedor…"}
                      </option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowNewSupplier(true)}
                      className="whitespace-nowrap text-sm font-semibold text-blue-600 border border-blue-200 rounded-lg px-3 hover:bg-blue-50 transition-colors"
                    >
                      + Nuevo
                    </button>
                  </div>
                ) : (
                  <div className="border border-blue-200 rounded-lg p-3 bg-blue-50 space-y-2">
                    <p className="text-xs font-semibold text-blue-700">Nuevo proveedor</p>
                    <input
                      type="text"
                      placeholder="Nombre del proveedor"
                      value={newSupplierName}
                      onChange={(e) => setNewSupplierName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); handleCreateSupplier(); }
                      }}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleCreateSupplier}
                        disabled={savingSupplier || !newSupplierName.trim()}
                        className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-semibold"
                      >
                        {savingSupplier ? "Creando..." : "Crear"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowNewSupplier(false); setNewSupplierName(""); }}
                        className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 bg-white"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
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
              {/* Wrapper con overflow-x-auto: en mobile la tabla se scrollea horizontal en vez
                  de aplastar los inputs. min-width del table fuerza el scroll cuando no entra. */}
              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: "640px" }}>
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
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
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
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
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
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={row.quantity}
                            onChange={(e) => updateRow(row._id, "quantity", e.target.value)}
                            placeholder="0"
                            min="1"
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
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
                {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Guardar compra"}
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
                      <div className="px-4 pb-5 overflow-x-auto">
                        {/* Acciones de la compra: editar (revierte + reaplica) y eliminar (revierte) */}
                        <div className="flex gap-2 justify-end mb-3">
                          <button
                            type="button"
                            onClick={() => startEdit(purchase)}
                            className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-semibold"
                          >
                            ✏️ Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => startDelete(purchase)}
                            className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 text-xs font-semibold"
                          >
                            🗑 Eliminar
                          </button>
                        </div>
                        <table className="w-full min-w-[380px] text-sm border border-slate-100 rounded-xl overflow-hidden">
                          <thead>
                            <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                              <th className="px-3 py-2 text-left hidden sm:table-cell">SKU</th>
                              <th className="px-3 py-2 text-left">Producto</th>
                              <th className="px-3 py-2 text-right">Costo unit.</th>
                              <th className="px-3 py-2 text-right">Cant.</th>
                              <th className="px-3 py-2 text-right">Subtotal</th>
                            </tr>
                          </thead>
                          <tbody>
                            {purchase.items.map((item) => (
                              <tr key={item.id} className="border-t border-slate-100">
                                <td className="px-3 py-2 text-slate-400 text-xs hidden sm:table-cell">{item.sku || "—"}</td>
                                <td className="px-3 py-2 font-medium text-slate-800">{item.productName}</td>
                                <td className="px-3 py-2 text-right text-slate-600">{formatPrice(item.cost)}</td>
                                <td className="px-3 py-2 text-right text-slate-600">{item.quantity}</td>
                                <td className="px-3 py-2 text-right font-semibold text-slate-800">
                                  {formatPrice(item.cost * item.quantity)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            {/* Una celda por columna para evitar conflictos entre colSpan y hidden en mobile */}
                            <tr className="border-t-2 border-slate-200 bg-slate-50">
                              <td className="px-3 py-2 text-xs text-slate-400 hidden sm:table-cell">Total</td>
                              <td className="px-3 py-2 text-xs text-slate-400">Total</td>
                              <td className="px-3 py-2"></td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-700">{totalUnits}</td>
                              <td className="px-3 py-2 text-right font-bold text-slate-800">{formatPrice(totalCost)}</td>
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

      {/* Modal de decisiones: Eliminar / Mantener por cada producto creado por la compra.
          Se usa tanto al ELIMINAR una compra como al EDITARLA (cuando una línea creada queda huérfana). */}
      {decisionModal?.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-800">¿Qué hacemos con los productos creados?</h2>
            <p className="text-sm text-slate-500">{decisionModal.title}</p>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {decisionModal.products.map((p) => {
                const decision = decisionModal.decisions[p.productId];
                return (
                  <div
                    key={p.productId}
                    className="flex items-center justify-between gap-3 border border-slate-200 rounded-xl px-3 py-2"
                  >
                    <span className="text-sm font-medium text-slate-800 truncate">{p.productName}</span>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setDecision(p.productId, "keep")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                          decision === "keep"
                            ? "bg-emerald-600 text-white border-emerald-600"
                            : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        Mantener
                      </button>
                      <button
                        type="button"
                        onClick={() => setDecision(p.productId, "delete")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                          decision === "delete"
                            ? "bg-red-600 text-white border-red-600"
                            : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-slate-400">
              "Eliminar" borra el producto de la base. Si tiene ventas registradas, se mantiene igual y te avisamos.
            </p>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={closeDecisionModal}
                className="px-4 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => decisionModal.onConfirm(decisionModal.decisions)}
                disabled={saving}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {decisionModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

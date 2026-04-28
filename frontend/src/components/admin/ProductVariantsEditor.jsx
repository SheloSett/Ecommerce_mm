import { useState, useEffect, useRef } from "react";
import { variantsApi, getImageUrl } from "../../services/api";
import toast from "react-hot-toast";

const formatPrice = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n ?? 0);

export default function ProductVariantsEditor({ productId, basePrice }) {
  const [attributes, setAttributes] = useState([]);
  const [variants,   setVariants]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [generating, setGenerating] = useState(false);

  // Estado para agregar un atributo nuevo
  const [newAttrName,   setNewAttrName]   = useState("");
  const [newAttrValues, setNewAttrValues] = useState(""); // CSV: "Rojo, Azul, Verde"
  const [savingAttr,    setSavingAttr]    = useState(false);

  // Estado de edición inline de variantes
  const [editing, setEditing] = useState({}); // { [variantId]: { stock, price, cost, sku, imageFile, imagePreview } }
  const [savingVariant, setSavingVariant] = useState(null);
  const imageInputRefs = useRef({}); // refs para inputs de imagen por variante

  // Estado de edición inline de atributos (agregar/quitar valores)
  const [editingAttr, setEditingAttr] = useState(null); // { id, name, values: string[] }
  const [newAttrValue, setNewAttrValue] = useState(""); // valor nuevo a agregar al atributo en edición
  const [savingAttrEdit, setSavingAttrEdit] = useState(false);

  useEffect(() => {
    if (!productId) return;
    fetchAll();
  }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [attrsRes, varsRes] = await Promise.all([
        variantsApi.getAttributes(productId),
        variantsApi.getVariants(productId),
      ]);
      setAttributes(attrsRes.data);
      setVariants(varsRes.data);
    } catch {
      toast.error("Error al cargar variantes");
    } finally {
      setLoading(false);
    }
  };

  // ── Atributos ────────────────────────────────────────────────────────────────

  const handleAddAttribute = async () => {
    if (!newAttrName.trim()) { toast.error("Ingresá el nombre del atributo"); return; }
    const values = newAttrValues.split(",").map((v) => v.trim()).filter(Boolean);
    if (values.length === 0) { toast.error("Ingresá al menos un valor"); return; }

    setSavingAttr(true);
    try {
      const res = await variantsApi.createAttribute(productId, { name: newAttrName.trim(), values });
      setAttributes((prev) => [...prev, res.data]);
      setNewAttrName("");
      setNewAttrValues("");
      toast.success("Atributo agregado");
    } catch {
      toast.error("Error al crear atributo");
    } finally {
      setSavingAttr(false);
    }
  };

  const handleDeleteAttribute = async (id) => {
    if (!confirm("¿Eliminar este atributo? Se regenerarán las variantes.")) return;
    try {
      await variantsApi.deleteAttribute(id);
      setAttributes((prev) => prev.filter((a) => a.id !== id));
      setVariants([]);
      toast.success("Atributo eliminado");
    } catch {
      toast.error("Error al eliminar atributo");
    }
  };

  // ── Edición de atributos (valores) ──────────────────────────────────────────

  const startEditAttr = (attr) => {
    setEditingAttr({ id: attr.id, name: attr.name, values: attr.values.map((v) => v.value) });
    setNewAttrValue("");
  };

  const cancelEditAttr = () => {
    setEditingAttr(null);
    setNewAttrValue("");
  };

  const addValueToEditingAttr = () => {
    const val = newAttrValue.trim();
    if (!val) return;
    if (editingAttr.values.includes(val)) { toast.error("Ese valor ya existe"); return; }
    setEditingAttr((prev) => ({ ...prev, values: [...prev.values, val] }));
    setNewAttrValue("");
  };

  const removeValueFromEditingAttr = (val) => {
    setEditingAttr((prev) => ({ ...prev, values: prev.values.filter((v) => v !== val) }));
  };

  const handleSaveAttrEdit = async () => {
    if (editingAttr.values.length === 0) { toast.error("Debe quedar al menos un valor"); return; }
    setSavingAttrEdit(true);
    try {
      const res = await variantsApi.updateAttribute(editingAttr.id, {
        name:   editingAttr.name,
        values: editingAttr.values,
      });
      setAttributes((prev) => prev.map((a) => (a.id === editingAttr.id ? res.data : a)));
      cancelEditAttr();
      toast.success("Atributo actualizado");
    } catch {
      toast.error("Error al guardar atributo");
    } finally {
      setSavingAttrEdit(false);
    }
  };

  // ── Generar variantes ────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (attributes.length === 0) { toast.error("Agregá al menos un atributo primero"); return; }
    setGenerating(true);
    try {
      const res = await variantsApi.generate(productId);
      setVariants(res.data);
      setEditing({});
      toast.success(`${res.data.length} variante(s) generada(s)`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al generar variantes");
    } finally {
      setGenerating(false);
    }
  };

  // ── Edición de variantes ─────────────────────────────────────────────────────

  const startEdit = (v) => {
    setEditing((prev) => ({
      ...prev,
      [v.id]: {
        stock:          String(v.stock ?? 0),
        stockUnlimited: v.stockUnlimited ?? false,
        price:          v.price != null ? String(v.price) : "",
        cost:           v.cost  != null ? String(v.cost)  : "",
        sku:            v.sku ?? "",
        imageFile:      null,
        imagePreview:   v.image ? getImageUrl(`/uploads/${v.image}`) : null,
      },
    }));
  };

  const cancelEdit = (id) => {
    setEditing((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  const handleSaveVariant = async (id) => {
    const e = editing[id];
    setSavingVariant(id);
    try {
      const formData = new FormData();
      formData.append("stock",          parseInt(e.stock) || 0);
      formData.append("stockUnlimited", e.stockUnlimited);
      formData.append("price",          e.price === "" ? "" : parseFloat(e.price) || "");
      formData.append("cost",           e.cost  === "" ? "" : parseFloat(e.cost)  || "");
      formData.append("sku",            e.sku);
      if (e.imageFile) formData.append("image", e.imageFile);
      const res = await variantsApi.updateVariant(id, formData);
      setVariants((prev) => prev.map((v) => (v.id === id ? res.data : v)));
      cancelEdit(id);
      toast.success("Variante guardada");
    } catch {
      toast.error("Error al guardar variante");
    } finally {
      setSavingVariant(null);
    }
  };

  // ── Eliminar todo ────────────────────────────────────────────────────────────

  const handleDeleteAll = async () => {
    if (!confirm("¿Eliminar todas las variantes y atributos de este producto?")) return;
    try {
      await variantsApi.deleteAll(productId);
      setAttributes([]);
      setVariants([]);
      toast.success("Variantes eliminadas");
    } catch {
      toast.error("Error al eliminar variantes");
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!productId) {
    return (
      <div className="text-sm text-slate-400 italic p-4 text-center">
        Guardá el producto primero para poder agregar variantes.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 flex justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
      </div>
    );
  }

  const comboLabel = (combination) =>
    Array.isArray(combination) ? combination.map((c) => `${c.name}: ${c.value}`).join(" · ") : "";

  return (
    <div className="space-y-6">

      {/* ── Atributos definidos ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-700 text-sm">Atributos</h3>
          {(attributes.length > 0 || variants.length > 0) && (
            <button
              type="button"
              onClick={handleDeleteAll}
              className="text-xs text-red-500 hover:text-red-700 underline"
            >
              Eliminar todo
            </button>
          )}
        </div>

        {attributes.length === 0 ? (
          <p className="text-sm text-slate-400 italic">Sin atributos. Agregá uno abajo.</p>
        ) : (
          <div className="flex flex-col gap-2 mb-3">
            {attributes.map((attr) => (
              <div key={attr.id} className="bg-slate-100 rounded-lg px-3 py-2">
                {editingAttr?.id === attr.id ? (
                  /* ── modo edición del atributo ── */
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-600">{attr.name}</p>

                    {/* valores actuales con botón para eliminar cada uno */}
                    <div className="flex flex-wrap gap-1">
                      {editingAttr.values.map((val) => (
                        <span key={val} className="flex items-center gap-1 bg-white border border-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded-full">
                          {val}
                          <button
                            type="button"
                            onClick={() => removeValueFromEditingAttr(val)}
                            className="text-slate-400 hover:text-red-500 leading-none"
                            title="Quitar valor"
                          >✕</button>
                        </span>
                      ))}
                    </div>

                    {/* input para agregar un valor nuevo */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Nuevo valor (ej: Azul)"
                        value={newAttrValue}
                        onChange={(e) => setNewAttrValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addValueToEditingAttr(); } }}
                        className="flex-1 px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <button
                        type="button"
                        onClick={addValueToEditingAttr}
                        className="px-3 py-1 bg-slate-600 hover:bg-slate-700 text-white text-xs rounded"
                      >+ Agregar</button>
                    </div>

                    {/* acciones guardar / cancelar */}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSaveAttrEdit}
                        disabled={savingAttrEdit}
                        className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded disabled:opacity-50"
                      >{savingAttrEdit ? "Guardando…" : "Guardar"}</button>
                      <button
                        type="button"
                        onClick={cancelEditAttr}
                        className="px-3 py-1 border border-slate-500 hover:bg-slate-600 text-slate-200 text-xs rounded transition-colors"
                      >Cancelar</button>
                    </div>
                  </div>
                ) : (
                  /* ── modo lectura del atributo ── */
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <p className="text-xs font-bold text-slate-600 mb-1">{attr.name}</p>
                      <div className="flex flex-wrap gap-1">
                        {attr.values.map((v) => (
                          <span key={v.id} className="bg-white border border-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded-full">
                            {v.value}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0 mt-0.5">
                      <button
                        type="button"
                        onClick={() => startEditAttr(attr)}
                        className="text-xs text-blue-500 hover:text-blue-700 underline"
                        title="Editar valores"
                      >Editar</button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAttribute(attr.id)}
                        className="text-slate-400 hover:text-red-500 text-sm"
                        title="Eliminar atributo"
                      >✕</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Agregar atributo */}
        <div className="border border-dashed border-slate-300 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nuevo atributo</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Nombre (ej: Color, Metros, Voltaje)"
              value={newAttrName}
              onChange={(e) => setNewAttrName(e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <input
              type="text"
              placeholder="Valores separados por coma: Rojo, Azul, Verde"
              value={newAttrValues}
              onChange={(e) => setNewAttrValues(e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              type="button"
              onClick={handleAddAttribute}
              disabled={savingAttr}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg disabled:opacity-50 whitespace-nowrap"
            >
              + Agregar
            </button>
          </div>
        </div>
      </div>

      {/* ── Botón generar variantes ── */}
      {attributes.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
          >
            {generating ? "Generando…" : "⚡ Generar / actualizar variantes"}
          </button>
          <p className="text-xs text-slate-400">
            Conserva el stock y precio de las combinaciones ya existentes.
          </p>
        </div>
      )}

      {/* ── Tabla de variantes ── */}
      {variants.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Combinación</th>
                <th className="px-4 py-3 text-center w-16">Foto</th>
                <th className="px-4 py-3 text-center w-24">Stock</th>
                <th className="px-4 py-3 text-center w-32">Precio (vacío = base)</th>
                <th className="px-4 py-3 text-center w-32">Costo</th>
                <th className="px-4 py-3 text-center w-28">SKU</th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v, i) => {
                const e = editing[v.id];
                return (
                  <tr key={v.id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                    <td className="px-4 py-3 text-slate-700 font-medium">{comboLabel(v.combination)}</td>

                    {e ? (
                      <>
                        {/* Foto — edit */}
                        <td className="px-2 py-2 text-center">
                          <div className="flex flex-col items-center gap-1">
                            {e.imagePreview && (
                              <img src={e.imagePreview} alt="" className="w-10 h-10 object-cover rounded border border-slate-200" />
                            )}
                            <input
                              ref={(el) => { imageInputRefs.current[v.id] = el; }}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(ev) => {
                                const file = ev.target.files?.[0];
                                if (!file) return;
                                const preview = URL.createObjectURL(file);
                                setEditing((p) => ({ ...p, [v.id]: { ...e, imageFile: file, imagePreview: preview } }));
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => imageInputRefs.current[v.id]?.click()}
                              className="text-xs text-blue-500 hover:text-blue-700 underline whitespace-nowrap"
                            >
                              {e.imagePreview ? "Cambiar" : "+ Foto"}
                            </button>
                          </div>
                        </td>
                        {/* Stock — edit */}
                        <td className="px-3 py-2">
                          <div className="flex flex-col items-center gap-1">
                            <input
                              type="number" min="0"
                              value={e.stockUnlimited ? "" : e.stock}
                              disabled={e.stockUnlimited}
                              onChange={(ev) => setEditing((p) => ({ ...p, [v.id]: { ...e, stock: ev.target.value } }))}
                              className="w-full px-2 py-1 border border-slate-300 rounded text-sm text-center disabled:bg-slate-100"
                            />
                            <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={e.stockUnlimited}
                                onChange={(ev) => setEditing((p) => ({ ...p, [v.id]: { ...e, stockUnlimited: ev.target.checked } }))}
                              />
                              Ilimitado
                            </label>
                          </div>
                        </td>
                        {/* Precio — edit */}
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" step="0.01" placeholder={`Base: ${formatPrice(basePrice)}`}
                            value={e.price}
                            onChange={(ev) => setEditing((p) => ({ ...p, [v.id]: { ...e, price: ev.target.value } }))}
                            className="w-full px-2 py-1 border border-slate-300 rounded text-sm text-center"
                          />
                        </td>
                        {/* Costo — edit */}
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" step="0.01" placeholder="Base"
                            value={e.cost}
                            onChange={(ev) => setEditing((p) => ({ ...p, [v.id]: { ...e, cost: ev.target.value } }))}
                            className="w-full px-2 py-1 border border-slate-300 rounded text-sm text-center"
                          />
                        </td>
                        {/* SKU — edit */}
                        <td className="px-3 py-2">
                          <input
                            type="text" placeholder="SKU"
                            value={e.sku}
                            onChange={(ev) => setEditing((p) => ({ ...p, [v.id]: { ...e, sku: ev.target.value } }))}
                            className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
                          />
                        </td>
                        {/* Acciones — edit */}
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => handleSaveVariant(v.id)}
                              disabled={savingVariant === v.id}
                              className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              {savingVariant === v.id ? "…" : "✓"}
                            </button>
                            <button
                              type="button"
                              onClick={() => cancelEdit(v.id)}
                              className="px-2 py-1 border border-slate-500 hover:bg-slate-600 text-slate-200 text-xs rounded transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        {/* Foto — view */}
                        <td className="px-2 py-3 text-center">
                          {v.image ? (
                            <img
                              src={getImageUrl(`/uploads/${v.image}`)}
                              alt=""
                              className="w-10 h-10 object-cover rounded border border-slate-200 mx-auto"
                            />
                          ) : (
                            <span className="text-slate-300 text-lg">—</span>
                          )}
                        </td>
                        {/* Stock — view */}
                        <td className="px-4 py-3 text-center text-slate-600">
                          {v.stockUnlimited ? <span className="text-green-600 font-semibold">∞</span> : v.stock}
                        </td>
                        {/* Precio — view */}
                        <td className="px-4 py-3 text-center text-slate-600">
                          {v.price != null ? formatPrice(v.price) : <span className="text-slate-400 text-xs">Base</span>}
                        </td>
                        {/* Costo — view */}
                        <td className="px-4 py-3 text-center text-slate-600">
                          {v.cost != null ? formatPrice(v.cost) : <span className="text-slate-400 text-xs">Base</span>}
                        </td>
                        {/* SKU — view */}
                        <td className="px-4 py-3 text-center text-slate-500 text-xs">{v.sku || "—"}</td>
                        {/* Acciones — view */}
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => startEdit(v)}
                            className="px-3 py-1 text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg"
                          >
                            Editar
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
import { variantsApi, getImageUrl } from "../../services/api";
import toast from "react-hot-toast";

const formatPrice = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n ?? 0);

export default function ProductVariantsEditor({ productId, basePrice, baseWholesalePrice, productImages = [] }) {
  const [attributes, setAttributes] = useState([]);
  const [variants,   setVariants]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [generating, setGenerating] = useState(false);

  // Estado para agregar un atributo nuevo
  const [newAttrName,       setNewAttrName]       = useState("");
  const [newAttrValues,     setNewAttrValues]     = useState([]); // array de chips/tags
  const [newAttrValueInput, setNewAttrValueInput] = useState(""); // texto en curso del chip input
  const [newAttrVisibility, setNewAttrVisibility] = useState("AMBOS");
  const [savingAttr,        setSavingAttr]        = useState(false);

  // Estado de edición inline de variantes
  const [editing, setEditing] = useState({}); // { [variantId]: { stock, price, cost, sku, imageFile, imagePreview } }
  const [savingVariant, setSavingVariant] = useState(null);
  const imageInputRefs = useRef({}); // refs para inputs de imagen por variante

  // Estado de edición inline de atributos (agregar/quitar valores)
  const [editingAttr, setEditingAttr] = useState(null); // { id, name, values: string[] }
  const [newAttrValue, setNewAttrValue] = useState(""); // valor nuevo a agregar al atributo en edición
  const [savingAttrEdit, setSavingAttrEdit] = useState(false);

  // Sugerencias para autocomplete: nombres de atributos y valores ya usados en otros productos
  // Estructura: { names: ["Color", "Tamaño"], valuesByName: { "Color": ["Rojo", "Azul"] } }
  const [suggestions, setSuggestions] = useState({ names: [], valuesByName: {} });

  useEffect(() => {
    if (!productId) return;
    fetchAll();
    // Cargar sugerencias en paralelo (no bloquea la UI principal si falla)
    variantsApi.getSuggestions()
      .then((res) => setSuggestions(res.data))
      .catch(() => {});
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
    // Flush del input en curso: si el usuario escribió algo sin presionar Enter, lo agregamos igual
    const pendingInput = newAttrValueInput.trim();
    const values = pendingInput
      ? [...new Set([...newAttrValues, pendingInput])]
      : [...newAttrValues];
    if (values.length === 0) { toast.error("Ingresá al menos un valor"); return; }

    const hadVariants = variants.length > 0;
    setSavingAttr(true);
    try {
      const res = await variantsApi.createAttribute(productId, {
        name: newAttrName.trim(),
        visibility: newAttrVisibility,
        values,
      });
      setAttributes((prev) => [...prev, res.data]);
      setNewAttrName("");
      setNewAttrValues([]);
      setNewAttrValueInput("");
      setNewAttrVisibility("AMBOS");
      // Si ya había combinaciones generadas, regenerar automáticamente para que se actualicen
      // con el nuevo atributo. Si era el primer atributo, el usuario debe presionar "Generar" manualmente.
      if (hadVariants) {
        try {
          const genRes = await variantsApi.generate(productId);
          setVariants(genRes.data);
          setEditing({});
          toast.success("Atributo agregado y combinaciones actualizadas");
        } catch {
          toast.success("Atributo agregado");
          toast.error("No se pudieron regenerar las combinaciones automáticamente");
        }
      } else {
        toast.success("Atributo agregado");
      }
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
    setEditingAttr({
      id: attr.id,
      name: attr.name,
      visibility: attr.visibility || "AMBOS",
      values: attr.values.map((v) => v.value),
    });
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

  // Mover un valor del atributo hacia arriba o abajo en la lista (controla el orden de las variantes)
  const moveValueInEditingAttr = (val, direction) => {
    setEditingAttr((prev) => {
      const arr = [...prev.values];
      const idx = arr.indexOf(val);
      if (idx === -1) return prev;
      const newIdx = direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= arr.length) return prev;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return { ...prev, values: arr };
    });
  };

  const handleSaveAttrEdit = async () => {
    if (editingAttr.values.length === 0) { toast.error("Debe quedar al menos un valor"); return; }
    const hadVariants = variants.length > 0;
    setSavingAttrEdit(true);
    try {
      const res = await variantsApi.updateAttribute(editingAttr.id, {
        name:       editingAttr.name,
        visibility: editingAttr.visibility,
        values:     editingAttr.values,
      });
      setAttributes((prev) => prev.map((a) => (a.id === editingAttr.id ? res.data : a)));
      // Si ya había variantes generadas, regenerar automáticamente para reflejar los nuevos valores
      // (conserva stock/precio de las combinaciones que sigan existiendo). Si no, solo refresca la lista.
      if (hadVariants) {
        try {
          const genRes = await variantsApi.generate(productId);
          setVariants(genRes.data);
          setEditing({});
        } catch {
          // Si falla el regen, al menos refrescamos para que la visibility se vea reflejada
          const varsRes = await variantsApi.getVariants(productId);
          setVariants(varsRes.data);
        }
      } else {
        const varsRes = await variantsApi.getVariants(productId);
        setVariants(varsRes.data);
      }
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
    // La visibility ahora se controla a nivel atributo. Leemos la del primer atributo del producto
    // como fuente de verdad para decidir qué inputs de precio mostrar en la fila de la variante.
    const attrVisibility = attributes[0]?.visibility || v.visibility || "AMBOS";
    setEditing((prev) => ({
      ...prev,
      [v.id]: {
        stock:              String(v.stock ?? 0),
        stockUnlimited:     v.stockUnlimited ?? false,
        // Precios: 4 campos. Los minoristas usan price/salePrice, mayoristas wholesalePrice/wholesaleSalePrice
        price:              v.price              != null ? String(v.price)              : "",
        salePrice:          v.salePrice          != null ? String(v.salePrice)          : "",
        wholesalePrice:     v.wholesalePrice     != null ? String(v.wholesalePrice)     : "",
        wholesaleSalePrice: v.wholesaleSalePrice != null ? String(v.wholesaleSalePrice) : "",
        cost:               v.cost  != null ? String(v.cost)  : "",
        sku:                v.sku ?? "",
        // Ubicación en depósito (override opcional del producto)
        module:             v.module ?? "",
        shelf:              v.shelf  ?? "",
        // Visibilidad heredada del atributo (read-only en esta fila)
        visibility:         attrVisibility,
        // images: array de URLs de las fotos del producto asignadas a esta variante.
        // Fallback al campo viejo 'image' (string único) para variantes anteriores a la migración.
        images:             Array.isArray(v.images) && v.images.length > 0
                              ? [...v.images]
                              : (v.image ? [v.image] : []),
        pickerOpen:         false,
      },
    }));
  };

  const cancelEdit = (id) => {
    setEditing((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  const handleSaveVariant = async (id) => {
    const e = editing[id];
    const isMin = e.visibility === "MINORISTA" || e.visibility === "AMBOS";
    const isMay = e.visibility === "MAYORISTA" || e.visibility === "AMBOS";

    // Validación: el precio base (no la oferta) es obligatorio para cada tipo de cliente visible.
    // Si la variante no tiene precio propio Y el producto padre tampoco, no se puede guardar.
    // El precio de oferta sigue siendo opcional.
    if (isMin && !e.price && !basePrice) {
      toast.error("Falta el precio minorista (cargalo en la variante o en el producto base)");
      return;
    }
    if (isMay && !e.wholesalePrice && !baseWholesalePrice) {
      toast.error("Falta el precio mayorista (cargalo en la variante o en el producto base)");
      return;
    }
    // Validar que la oferta sea menor al precio base (cuando ambos están cargados en la variante)
    if (e.salePrice && e.price && parseFloat(e.salePrice) >= parseFloat(e.price)) {
      toast.error("La oferta minorista debe ser menor al precio minorista");
      return;
    }
    if (e.wholesaleSalePrice && e.wholesalePrice && parseFloat(e.wholesaleSalePrice) >= parseFloat(e.wholesalePrice)) {
      toast.error("La oferta mayorista debe ser menor al precio mayorista");
      return;
    }

    setSavingVariant(id);
    try {
      // Solo enviamos los precios relevantes según visibility para no pisar campos con "".
      // Si visibility es MINORISTA mandamos price/salePrice y null en wholesale*. Y viceversa.
      const payload = {
        stock:              parseInt(e.stock) || 0,
        stockUnlimited:     e.stockUnlimited,
        price:              isMin ? (e.price              === "" ? "" : (parseFloat(e.price)              || "")) : null,
        salePrice:          isMin ? (e.salePrice          === "" ? "" : (parseFloat(e.salePrice)          || "")) : null,
        wholesalePrice:     isMay ? (e.wholesalePrice     === "" ? "" : (parseFloat(e.wholesalePrice)     || "")) : null,
        wholesaleSalePrice: isMay ? (e.wholesaleSalePrice === "" ? "" : (parseFloat(e.wholesaleSalePrice) || "")) : null,
        cost:               e.cost  === "" ? "" : (parseFloat(e.cost)  || ""),
        sku:                e.sku,
        // Ubicación en depósito (override del producto; vacío → el backend lo guarda como null)
        module:             e.module ?? "",
        shelf:              e.shelf  ?? "",
        visibility:         e.visibility || "AMBOS",
        images:             e.images || [],
        image:              e.images && e.images.length > 0 ? e.images[0] : null,
      };
      const res = await variantsApi.updateVariant(id, payload);
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

  // ── Helpers de UI ──────────────────────────────────────────────────────────
  // Badge pequeño para visibility — funciona en ambos temas con variantes dark:
  const VisibilityBadge = ({ visibility }) => {
    const cfg = {
      AMBOS:     { label: "Todos",      cls: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-700/50 dark:text-slate-300 dark:border-slate-600" },
      MINORISTA: { label: "Minoristas", cls: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30" },
      MAYORISTA: { label: "Mayoristas", cls: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30" },
    }[visibility || "AMBOS"];
    return (
      <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${cfg.cls}`}>
        {cfg.label}
      </span>
    );
  };

  // Toggle segmentado para elegir visibility — funciona en ambos temas
  const VisibilityToggle = ({ value, onChange }) => {
    const opts = [
      { v: "AMBOS",     label: "Todos",      active: "bg-slate-700 text-white dark:bg-slate-600" },
      { v: "MINORISTA", label: "Minoristas", active: "bg-blue-600 text-white" },
      { v: "MAYORISTA", label: "Mayoristas", active: "bg-purple-600 text-white" },
    ];
    return (
      <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-0.5">
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${value === o.v ? o.active : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">

      {/* ── HEADER MINIMALISTA ── */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Atributos y variantes</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Las combinaciones se generan automáticamente.</p>
        </div>
        {(attributes.length > 0 || variants.length > 0) && (
          <button
            type="button"
            onClick={handleDeleteAll}
            className="text-xs text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 transition-colors"
          >
            Eliminar todo
          </button>
        )}
      </div>

      {/* ── ATRIBUTOS: empty state o lista de cards ── */}
      <div>
        {attributes.length === 0 ? (
          <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-8 text-center bg-slate-50 dark:bg-slate-900/30">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Sin atributos definidos</p>
            <p className="text-xs text-slate-500">Agregá uno abajo para empezar.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {attributes.map((attr) => {
              const isEditing = editingAttr?.id === attr.id;
              return (
                <div key={attr.id} className="bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                  {/* Cabecera + valores: layout horizontal compacto */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-[120px] shrink-0">
                      <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">{attr.name}</p>
                      <VisibilityBadge visibility={attr.visibility} />
                    </div>
                    <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                      {attr.values.map((v) => (
                        <span key={v.id} className="bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-700/50 dark:text-slate-200 dark:border-slate-600/50 text-xs font-medium px-2.5 py-1 rounded-md border">
                          {v.value}
                        </span>
                      ))}
                    </div>
                    {!isEditing && (
                      <div className="flex gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEditAttr(attr)}
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:text-slate-400 dark:hover:text-blue-400 dark:hover:bg-slate-700/50 rounded-md transition-colors"
                          title="Editar atributo"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAttribute(attr.id)}
                          className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 dark:text-slate-400 dark:hover:text-red-400 dark:hover:bg-slate-700/50 rounded-md transition-colors"
                          title="Eliminar atributo"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Modo edición: panel desplegable abajo */}
                  {isEditing && (
                    <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-4 space-y-4 bg-slate-50 dark:bg-slate-900/30">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Visibilidad</p>
                        <VisibilityToggle
                          value={editingAttr.visibility}
                          onChange={(v) => setEditingAttr((prev) => ({ ...prev, visibility: v }))}
                        />
                      </div>

                      <div>
                        <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Valores</p>
                        <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
                          {editingAttr.values.length === 0 ? (
                            <span className="text-xs text-slate-500 italic">Sin valores — agregá uno abajo</span>
                          ) : editingAttr.values.map((val, idx) => (
                            <span key={val} className="flex items-center gap-1 bg-white border border-slate-300 text-slate-700 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100 text-xs font-medium pl-2.5 pr-1 py-0.5 rounded-md">
                              {val}
                              {/* Botones ↑/↓ — controlan el orden de los valores y por lo tanto de las variantes
                                  generadas (la primera variante es la que se autoselecciona en la vista del cliente). */}
                              <button
                                type="button"
                                onClick={() => moveValueInEditingAttr(val, "up")}
                                disabled={idx === 0}
                                className="text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 leading-none transition-colors disabled:opacity-30 disabled:hover:text-slate-400 px-1"
                                title="Subir"
                              >↑</button>
                              <button
                                type="button"
                                onClick={() => moveValueInEditingAttr(val, "down")}
                                disabled={idx === editingAttr.values.length - 1}
                                className="text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 leading-none transition-colors disabled:opacity-30 disabled:hover:text-slate-400 px-1"
                                title="Bajar"
                              >↓</button>
                              <button
                                type="button"
                                onClick={() => removeValueFromEditingAttr(val)}
                                className="text-slate-400 hover:text-red-500 dark:hover:text-red-400 leading-none transition-colors px-1"
                                title="Quitar valor"
                              >✕</button>
                            </span>
                          ))}
                        </div>

                        <div className="flex gap-2">
                          <input
                            type="text"
                            list={`attr-values-edit-${editingAttr.id}`}
                            placeholder="Agregar valor..."
                            value={newAttrValue}
                            onChange={(e) => setNewAttrValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addValueToEditingAttr(); } }}
                            className="flex-1 px-3 py-2 bg-white border border-slate-300 text-slate-800 placeholder:text-slate-400 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={addValueToEditingAttr}
                            className="px-3 py-2 bg-slate-700 hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500 text-white text-xs font-semibold rounded-md whitespace-nowrap"
                          >Agregar</button>
                          <datalist id={`attr-values-edit-${editingAttr.id}`}>
                            {(suggestions.valuesByName[editingAttr.name] || [])
                              .filter((v) => !editingAttr.values.includes(v))
                              .map((v) => <option key={v} value={v} />)}
                          </datalist>
                        </div>
                      </div>

                      <div className="flex gap-2 justify-end pt-2 border-t border-slate-200 dark:border-slate-700">
                        <button
                          type="button"
                          onClick={cancelEditAttr}
                          className="px-4 py-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 text-xs font-semibold transition-colors"
                        >Cancelar</button>
                        <button
                          type="button"
                          onClick={handleSaveAttrEdit}
                          disabled={savingAttrEdit}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-md disabled:opacity-50"
                        >
                          {savingAttrEdit ? "Guardando…" : "Guardar"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Form "Nuevo atributo" — card compacta, theme-aware ── */}
        <div className="mt-3 bg-slate-50 dark:bg-slate-800/30 border border-slate-300 dark:border-slate-700 border-dashed rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Agregar nuevo atributo</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {/* Nombre del atributo */}
            <input
              type="text"
              list="attr-names-suggestions"
              placeholder="Nombre (ej: Color, Talla)"
              value={newAttrName}
              onChange={(e) => setNewAttrName(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-300 text-slate-800 placeholder:text-slate-400 dark:bg-slate-900/50 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {/* Valores — chip/tag input: Enter o coma agrega el tag */}
            <div
              className="flex flex-wrap gap-1.5 items-center px-2 py-1.5 bg-white border border-slate-300 dark:bg-slate-900/50 dark:border-slate-600 rounded-md focus-within:ring-2 focus-within:ring-blue-500 min-h-[38px] cursor-text"
              onClick={(e) => e.currentTarget.querySelector("input")?.focus()}
            >
              {newAttrValues.map((val) => (
                <span
                  key={val}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 text-xs font-medium rounded-full"
                >
                  {val}
                  <button
                    type="button"
                    onClick={() => setNewAttrValues((prev) => prev.filter((v) => v !== val))}
                    className="hover:text-red-500 transition-colors leading-none"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                type="text"
                list="attr-values-suggestions"
                placeholder={newAttrValues.length === 0 ? "Escribí un valor y presioná Enter" : "Otro valor…"}
                value={newAttrValueInput}
                onChange={(e) => {
                  // Si el usuario tipea una coma, hacer flush del valor actual como chip
                  const raw = e.target.value;
                  if (raw.includes(",")) {
                    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
                    const toAdd = parts.filter((p) => !newAttrValues.includes(p));
                    if (toAdd.length) setNewAttrValues((prev) => [...prev, ...toAdd]);
                    setNewAttrValueInput("");
                  } else {
                    setNewAttrValueInput(raw);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const val = newAttrValueInput.trim();
                    if (!val) return;
                    if (!newAttrValues.includes(val)) setNewAttrValues((prev) => [...prev, val]);
                    setNewAttrValueInput("");
                  }
                  // Backspace sobre input vacío elimina el último chip
                  if (e.key === "Backspace" && newAttrValueInput === "" && newAttrValues.length > 0) {
                    setNewAttrValues((prev) => prev.slice(0, -1));
                  }
                }}
                className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <VisibilityToggle value={newAttrVisibility} onChange={setNewAttrVisibility} />
            <button
              type="button"
              onClick={handleAddAttribute}
              disabled={savingAttr}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-md disabled:opacity-50 transition-colors"
            >
              {savingAttr ? "Agregando…" : "Agregar atributo"}
            </button>
          </div>

          {/* Datalists ocultos para autocomplete */}
          <datalist id="attr-names-suggestions">
            {suggestions.names.map((n) => <option key={n} value={n} />)}
          </datalist>
          <datalist id="attr-values-suggestions">
            {(suggestions.valuesByName[newAttrName.trim()] ||
              Array.from(new Set(Object.values(suggestions.valuesByName).flat()))
            ).map((v) => <option key={v} value={v} />)}
          </datalist>
        </div>
      </div>

      {/* ── CTA "Generar combinaciones" — solo aparece la primera vez (no hay variantes) ──
          Después de la primera generación, las combinaciones se regeneran automáticamente al guardar
          cambios en un atributo, así que no hace falta el botón manual. */}
      {attributes.length > 0 && variants.length === 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-blue-50 dark:bg-slate-800/40 border border-blue-200 dark:border-slate-700 rounded-xl">
          <p className="text-xs text-slate-600 dark:text-slate-400 min-w-0">
            Generá las combinaciones a partir de los atributos definidos.
          </p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-md disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {generating ? "Generando…" : "Generar combinaciones"}
          </button>
        </div>
      )}

      {/* ── Tabla de combinaciones ── */}
      {variants.length > 0 && (
        <div className="bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          {/* Header compacto */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Combinaciones</p>
              <span className="text-[10px] font-semibold bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded">{variants.length}</span>
            </div>
            <p className="text-[10px] text-slate-500">Editá stock, precios y fotos por fila</p>
          </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold bg-slate-50 dark:bg-slate-900/30">
                <th className="px-4 py-2.5 text-left">Combinación</th>
                <th className="px-3 py-2.5 text-center w-20">Foto</th>
                <th className="px-3 py-2.5 text-center w-28">Stock</th>
                <th className="px-3 py-2.5 text-center w-56">Precios</th>
                <th className="px-3 py-2.5 text-center w-28">Costo</th>
                <th className="px-3 py-2.5 text-center w-32">SKU</th>
                <th className="px-3 py-2.5 text-center w-36">Ubicación</th>
                <th className="px-3 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v, i) => {
                const e = editing[v.id];
                return (
                  <tr key={v.id} className={`border-b border-slate-200/50 dark:border-slate-700/50 ${i % 2 === 0 ? "bg-transparent" : "bg-slate-50/50 dark:bg-slate-900/20"}`}>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200 font-medium">{comboLabel(v.combination)}</td>

                    {e ? (
                      <>
                        {/* Foto — picker MULTI-SELECT de las imágenes del producto.
                            Una variante puede tener varias fotos asignadas. */}
                        <td className="px-2 py-2 text-center">
                          <div className="flex flex-col items-center gap-1">
                            {e.images && e.images.length > 0 ? (
                              <div className="flex items-center gap-1 flex-wrap justify-center max-w-[120px]">
                                {e.images.slice(0, 3).map((url, idx) => (
                                  <img key={idx} src={getImageUrl(url)} alt="" className="w-8 h-8 object-cover rounded border border-blue-300" />
                                ))}
                                {e.images.length > 3 && (
                                  <span className="text-xs font-bold text-slate-600 ml-1">+{e.images.length - 3}</span>
                                )}
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded border border-dashed border-slate-300 flex items-center justify-center text-slate-300 text-lg">📷</div>
                            )}
                            {productImages.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => setEditing((p) => ({ ...p, [v.id]: { ...e, pickerOpen: !e.pickerOpen } }))}
                                className="text-xs text-blue-500 hover:text-blue-700 underline whitespace-nowrap"
                              >
                                {e.images?.length > 0 ? `Editar (${e.images.length})` : "Elegir"}
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-400 leading-tight text-center max-w-[80px]">
                                Subí fotos al producto primero
                              </span>
                            )}
                            {/* Picker MULTI-SELECT: modal centrado. Cada thumbnail es un toggle. */}
                            {e.pickerOpen && productImages.length > 0 && (
                              <div
                                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                                onClick={() => setEditing((p) => ({ ...p, [v.id]: { ...e, pickerOpen: false } }))}
                              >
                                <div
                                  className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5 max-h-[80vh] overflow-y-auto"
                                  onClick={(ev) => ev.stopPropagation()}
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <h3 className="font-bold text-slate-800">Elegir fotos para esta variante</h3>
                                    <button
                                      type="button"
                                      onClick={() => setEditing((p) => ({ ...p, [v.id]: { ...e, pickerOpen: false } }))}
                                      className="text-slate-400 hover:text-slate-700 text-xl leading-none"
                                    >×</button>
                                  </div>
                                  <p className="text-xs text-slate-500 mb-4">Tocá cada foto para agregar o quitar. Se mostrarán todas en el carrusel cuando el cliente elija esta variante.</p>
                                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                    {productImages.map((url, idx) => {
                                      const isSelected = (e.images || []).includes(url);
                                      return (
                                        <button
                                          key={idx}
                                          type="button"
                                          onClick={() => setEditing((p) => {
                                            const current = e.images || [];
                                            const next = current.includes(url)
                                              ? current.filter((u) => u !== url)
                                              : [...current, url];
                                            return { ...p, [v.id]: { ...e, images: next } };
                                          })}
                                          className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${isSelected ? "border-blue-500 ring-2 ring-blue-200" : "border-slate-200 hover:border-blue-300"}`}
                                        >
                                          <img src={getImageUrl(url)} alt="" className="w-full h-full object-cover" />
                                          {isSelected && (
                                            <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center shadow">✓</div>
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
                                    <button
                                      type="button"
                                      onClick={() => setEditing((p) => ({ ...p, [v.id]: { ...e, images: [] } }))}
                                      className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700"
                                    >
                                      Limpiar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditing((p) => ({ ...p, [v.id]: { ...e, pickerOpen: false } }))}
                                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg"
                                    >
                                      Listo
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
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
                              className="w-full px-2 py-1 bg-white border border-slate-300 text-slate-800 placeholder:text-slate-400 dark:bg-slate-900/50 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500 rounded text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
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
                        {/* Visibilidad de la variante ya NO es editable por fila — viene heredada del atributo */}
                        {/* Precios — edit. Muestra solo los inputs relevantes según visibility heredada del atributo */}
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            {/* Precios minorista — visibles si visibility es MINORISTA o AMBOS */}
                            {(e.visibility === "MINORISTA" || e.visibility === "AMBOS") && (
                              <>
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] text-slate-500 w-12 shrink-0">Min</span>
                                  <input
                                    type="number" min="0" step="0.01" placeholder={`Base: ${formatPrice(basePrice)}`}
                                    value={e.price}
                                    onChange={(ev) => setEditing((p) => ({ ...p, [v.id]: { ...e, price: ev.target.value } }))}
                                    className="flex-1 px-2 py-1 bg-white border border-slate-300 text-slate-800 placeholder:text-slate-400 dark:bg-slate-900/50 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  />
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] text-red-500 w-12 shrink-0">Of.Min</span>
                                  <input
                                    type="number" min="0" step="0.01" placeholder="—"
                                    value={e.salePrice}
                                    onChange={(ev) => setEditing((p) => ({ ...p, [v.id]: { ...e, salePrice: ev.target.value } }))}
                                    className="flex-1 px-2 py-1 bg-white border border-slate-300 text-slate-800 placeholder:text-slate-400 dark:bg-slate-900/50 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  />
                                </div>
                              </>
                            )}
                            {/* Precios mayorista — visibles si visibility es MAYORISTA o AMBOS */}
                            {(e.visibility === "MAYORISTA" || e.visibility === "AMBOS") && (
                              <>
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] text-purple-600 w-12 shrink-0">May</span>
                                  <input
                                    type="number" min="0" step="0.01" placeholder="—"
                                    value={e.wholesalePrice}
                                    onChange={(ev) => setEditing((p) => ({ ...p, [v.id]: { ...e, wholesalePrice: ev.target.value } }))}
                                    className="flex-1 px-2 py-1 bg-white border border-slate-300 text-slate-800 placeholder:text-slate-400 dark:bg-slate-900/50 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  />
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] text-red-500 w-12 shrink-0">Of.May</span>
                                  <input
                                    type="number" min="0" step="0.01" placeholder="—"
                                    value={e.wholesaleSalePrice}
                                    onChange={(ev) => setEditing((p) => ({ ...p, [v.id]: { ...e, wholesaleSalePrice: ev.target.value } }))}
                                    className="flex-1 px-2 py-1 bg-white border border-slate-300 text-slate-800 placeholder:text-slate-400 dark:bg-slate-900/50 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                        {/* Costo — edit */}
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" step="0.01" placeholder="Base"
                            value={e.cost}
                            onChange={(ev) => setEditing((p) => ({ ...p, [v.id]: { ...e, cost: ev.target.value } }))}
                            className="w-full px-2 py-1 bg-white border border-slate-300 text-slate-800 placeholder:text-slate-400 dark:bg-slate-900/50 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500 rounded text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        {/* SKU — edit */}
                        <td className="px-3 py-2">
                          <input
                            type="text" placeholder="SKU"
                            value={e.sku}
                            onChange={(ev) => setEditing((p) => ({ ...p, [v.id]: { ...e, sku: ev.target.value } }))}
                            className="w-full px-2 py-1 bg-slate-900/50 border border-slate-600 rounded text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        {/* Ubicación — edit. Módulo + Estante lado a lado. Vacío = usa la del producto. */}
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <input
                              type="text" placeholder="Mód."
                              value={e.module}
                              onChange={(ev) => setEditing((p) => ({ ...p, [v.id]: { ...e, module: ev.target.value } }))}
                              className="w-1/2 px-2 py-1 bg-white border border-slate-300 text-slate-800 placeholder:text-slate-400 dark:bg-slate-900/50 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500 rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            <input
                              type="text" placeholder="Est."
                              value={e.shelf}
                              onChange={(ev) => setEditing((p) => ({ ...p, [v.id]: { ...e, shelf: ev.target.value } }))}
                              className="w-1/2 px-2 py-1 bg-white border border-slate-300 text-slate-800 placeholder:text-slate-400 dark:bg-slate-900/50 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500 rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                          <p className="text-[9px] text-slate-400 mt-0.5 text-center leading-tight">vacío = usa la del producto</p>
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
                        {/* Foto — view. Muestra hasta 3 thumbnails de v.images + contador "+N". */}
                        <td className="px-2 py-3 text-center">
                          {(() => {
                            const imgs = Array.isArray(v.images) && v.images.length > 0
                              ? v.images
                              : (v.image ? [v.image] : []);
                            if (imgs.length === 0) return <span className="text-slate-300 text-lg">—</span>;
                            return (
                              <div className="flex items-center gap-0.5 flex-wrap justify-center max-w-[120px] mx-auto">
                                {imgs.slice(0, 3).map((url, idx) => (
                                  <img key={idx} src={getImageUrl(url)} alt="" className="w-8 h-8 object-cover rounded border border-slate-200" />
                                ))}
                                {imgs.length > 3 && (
                                  <span className="text-xs font-bold text-slate-600 ml-1">+{imgs.length - 3}</span>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        {/* Stock — view */}
                        <td className="px-4 py-3 text-center text-slate-600 dark:text-slate-300">
                          {v.stockUnlimited ? <span className="text-green-600 font-semibold">∞</span> : v.stock}
                        </td>
                        {/* Visibilidad de la variante ya NO se muestra acá — el badge está en el atributo arriba */}
                        {/* Precios — view. Lista compacta de los precios definidos */}
                        <td className="px-4 py-3 text-center text-slate-600 dark:text-slate-300">
                          <div className="flex flex-col gap-0.5 text-xs">
                            {(v.visibility === "MINORISTA" || v.visibility === "AMBOS" || !v.visibility) && (
                              <div>
                                <span className="text-slate-400 dark:text-slate-500 mr-1">Base minorista:</span>
                                {v.price != null ? formatPrice(v.price) : <span className="text-slate-400 dark:text-slate-500">Base</span>}
                                {v.salePrice != null && (
                                  <span className="text-red-500 dark:text-red-400 ml-1">(of: {formatPrice(v.salePrice)})</span>
                                )}
                              </div>
                            )}
                            {(v.visibility === "MAYORISTA" || v.visibility === "AMBOS") && (
                              <div>
                                <span className="text-purple-500 dark:text-purple-400 mr-1">Base mayorista:</span>
                                {v.wholesalePrice != null ? formatPrice(v.wholesalePrice) : <span className="text-slate-400 dark:text-slate-500">Base</span>}
                                {v.wholesaleSalePrice != null && (
                                  <span className="text-red-500 dark:text-red-400 ml-1">(of: {formatPrice(v.wholesaleSalePrice)})</span>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        {/* Costo — view */}
                        <td className="px-4 py-3 text-center text-slate-600 dark:text-slate-300">
                          {v.cost != null ? formatPrice(v.cost) : <span className="text-slate-400 dark:text-slate-500 text-xs">Base</span>}
                        </td>
                        {/* SKU — view */}
                        <td className="px-4 py-3 text-center text-slate-500 dark:text-slate-400 text-xs">{v.sku || "—"}</td>
                        {/* Ubicación — view. Muestra módulo/estante propios de la variante (si tiene). */}
                        <td className="px-4 py-3 text-center text-xs">
                          {(v.module || v.shelf) ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30 font-semibold">
                              📍 {v.module || "—"} · {v.shelf || "—"}
                            </span>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500">Usa la del producto</span>
                          )}
                        </td>
                        {/* Acciones — view */}
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => startEdit(v)}
                            className="px-3 py-1 text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-200 rounded-md transition-colors"
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
        </div>
      )}
    </div>
  );
}

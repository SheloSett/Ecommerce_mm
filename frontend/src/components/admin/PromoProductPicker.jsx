import { useEffect, useMemo, useRef, useState } from "react";
import { productsApi, getImageUrl } from "../../services/api";
import { flattenTree, indentedLabel, idsInBranch } from "../../utils/categoryTree";

// Lista de productos con casillas para elegir cuáles entran en un descuento por monto (pedido de la
// clienta, 24/11/2026: "una selección, con un botón en el encabezado de la lista que diga seleccionar
// todos, y poder destildar los productos que necesite"). Reemplaza al desplegable de categorías + buscador.
//
// Se filtra por texto y/o categoría (con sus subcategorías); la casilla del encabezado elige o quita
// TODOS los filtrados (aunque no se dibujen todos: se muestran hasta MAX_ROWS para no trabar la ventana).
//
// props:
//   categories      — el árbol de categorías (categoriesApi.getAll)
//   selected        — ids elegidos (array de números)
//   onChange(ids)
//   legacyCategoryIds — categorías elegidas con la versión anterior: al cargar se pasan a sus productos
//   onLegacyConverted() — avisa que ya se pasaron (para no mandarlas más)
const MAX_ROWS = 300;
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function PromoProductPicker({ categories, selected, onChange, legacyCategoryIds = [], onLegacyConverted }) {
  const [products, setProducts] = useState(null); // null = cargando
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const headerBox = useRef(null);

  useEffect(() => {
    let vivo = true;
    // Todos, sin los pausados a mano (lo agotado sí: puede volver a tener stock durante la promo)
    productsApi.getAllAdmin({ all: true, excludePaused: true })
      .then((r) => { if (vivo) setProducts(r.data?.products || []); })
      .catch(() => { if (vivo) setProducts([]); });
    return () => { vivo = false; };
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Una promo hecha con categorías (versión anterior): sus productos quedan tildados, y desde ahí se
  // destilda lo que no va.
  useEffect(() => {
    if (!products || legacyCategoryIds.length === 0) return;
    const branch = new Set(legacyCategoryIds.flatMap((id) => idsInBranch(categories, Number(id))));
    const fromCats = products.filter((p) => (p.categories || []).some((c) => branch.has(c.id))).map((p) => p.id);
    onChange([...new Set([...selected, ...fromCats])]);
    onLegacyConverted?.();
  }, [products]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!products) return [];
    const words = norm(search).split(/\s+/).filter(Boolean);
    const branch = categoryId ? new Set(idsInBranch(categories, Number(categoryId))) : null;
    return products.filter((p) => {
      if (onlySelected && !selectedSet.has(p.id)) return false;
      if (branch && !(p.categories || []).some((c) => branch.has(c.id))) return false;
      if (words.length) {
        const name = norm(p.name);
        if (!words.every((w) => name.includes(w)) && !(p.sku && norm(p.sku).includes(words.join(" ")))) return false;
      }
      return true;
    });
  }, [products, search, categoryId, onlySelected, selectedSet, categories]);

  const filteredSelected = filtered.filter((p) => selectedSet.has(p.id)).length;
  const allFilteredSelected = filtered.length > 0 && filteredSelected === filtered.length;

  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = filteredSelected > 0 && !allFilteredSelected;
  }, [filteredSelected, allFilteredSelected]);

  const toggleAllFiltered = () => {
    const ids = new Set(filtered.map((p) => p.id));
    if (allFilteredSelected) onChange(selected.filter((id) => !ids.has(id)));
    else onChange([...new Set([...selected, ...ids])]);
  };
  const toggle = (id) => onChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Filtros */}
      <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o SKU…"
          className="input text-sm flex-1 min-w-0"
        />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input text-sm sm:w-56">
          <option value="">Todas las categorías</option>
          {flattenTree(categories).map((c) => (
            <option key={c.id} value={c.id}>{indentedLabel(c)}</option>
          ))}
        </select>
      </div>

      {/* Encabezado: seleccionar todos (los filtrados) */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 bg-white">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer select-none">
          <input
            ref={headerBox}
            type="checkbox"
            checked={allFilteredSelected}
            onChange={toggleAllFiltered}
            disabled={filtered.length === 0}
            className="w-4 h-4 rounded border-slate-300"
          />
          {allFilteredSelected ? "Quitar todos" : "Seleccionar todos"} ({filtered.length})
        </label>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-semibold text-blue-700">{selected.length} elegido{selected.length === 1 ? "" : "s"}</span>
          <label className="flex items-center gap-1.5 text-slate-500 cursor-pointer select-none">
            <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} className="w-3.5 h-3.5" />
            Ver solo los elegidos
          </label>
        </div>
      </div>

      {/* Lista */}
      <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
        {products === null ? (
          <p className="p-4 text-center text-sm text-slate-400">Cargando productos…</p>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-center text-sm text-slate-400">{onlySelected ? "Todavía no elegiste ninguno" : "Ningún producto coincide"}</p>
        ) : (
          <>
            {filtered.length > MAX_ROWS && (
              <p className="px-3 py-1.5 text-xs text-slate-500 bg-slate-50 sticky top-0">
                Se ven los primeros {MAX_ROWS} de {filtered.length}. “Seleccionar todos” elige los {filtered.length}; para destildar
                uno puntual, buscalo arriba.
              </p>
            )}
            {filtered.slice(0, MAX_ROWS).map((p) => (
              <label key={p.id} className="flex items-center gap-3 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={selectedSet.has(p.id)} onChange={() => toggle(p.id)} className="w-4 h-4 rounded border-slate-300 flex-shrink-0" />
                {p.images?.[0]
                  ? <img src={getImageUrl(p.images[0])} alt="" loading="lazy" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                  : <span className="w-8 h-8 rounded bg-slate-100 flex-shrink-0" />}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-slate-700 truncate">{p.name}</span>
                  {(p.categories || []).length > 0 && (
                    <span className="block text-[11px] text-slate-400 truncate">{p.categories.map((c) => c.name).join(" · ")}</span>
                  )}
                </span>
              </label>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

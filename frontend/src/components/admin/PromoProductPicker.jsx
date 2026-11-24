import { useEffect, useMemo, useRef, useState } from "react";
import { productsApi } from "../../services/api";
import { flattenTree, indentedLabel, idsInBranch } from "../../utils/categoryTree";

// Lista de productos con casillas para elegir cuáles entran en un descuento por monto (pedido de la
// clienta, 24/11/2026: "una selección, con un botón en el encabezado de la lista que diga seleccionar
// todos, y poder destildar los productos que necesite"). Reemplaza al desplegable de categorías + buscador.
//
// Segunda versión (24/11/2026, "la sigo sintiendo fea, ruidosa y cargada"): sin foto ni categoría en cada
// fila, letra más chica, los no elegidos en gris, sin el cartel de "se ven los primeros 300", y en vez de
// "Ver solo los elegidos" tres pestañas: Todos / Elegidos / Sin elegir (con 527 de 545 tildados, lo útil
// es ver los 18 que faltan).
//
// Se filtra por texto y/o categoría (con sus subcategorías); la casilla del encabezado elige o quita TODOS
// los que se ven en la lista.
//
// props:
//   categories      — el árbol de categorías (categoriesApi.getAll)
//   selected        — ids elegidos (array de números)
//   onChange(ids)
//   legacyCategoryIds — categorías elegidas con la versión anterior: al cargar se pasan a sus productos
//   onLegacyConverted() — avisa que ya se pasaron (para no mandarlas más)

// Tope de filas dibujadas, para que una lista enorme no trabe la ventana (hoy hay ~550 productos).
// "Seleccionar todos" elige igual todos los filtrados, aunque no se dibujen.
const MAX_ROWS = 1500;
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function PromoProductPicker({ categories, selected, onChange, legacyCategoryIds = [], onLegacyConverted }) {
  const [products, setProducts] = useState(null); // null = cargando
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  // Pestaña: "all" | "on" (elegidos) | "off" (sin elegir). En "on" y "off" la lista se congela al entrar a
  // la pestaña (snapshot): si no, al tildar un producto en "Sin elegir" desaparecería de abajo del dedo.
  const [tab, setTab] = useState({ key: "all", ids: null });
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

  // Lo que deja el buscador y la categoría (las pestañas cuentan sobre esto)
  const matching = useMemo(() => {
    if (!products) return [];
    const words = norm(search).split(/\s+/).filter(Boolean);
    const branch = categoryId ? new Set(idsInBranch(categories, Number(categoryId))) : null;
    return products.filter((p) => {
      if (branch && !(p.categories || []).some((c) => branch.has(c.id))) return false;
      if (words.length) {
        const name = norm(p.name);
        if (!words.every((w) => name.includes(w)) && !(p.sku && norm(p.sku).includes(words.join(" ")))) return false;
      }
      return true;
    });
  }, [products, search, categoryId, categories]);

  const matchingOn = matching.filter((p) => selectedSet.has(p.id)).length;
  const counts = { all: matching.length, on: matchingOn, off: matching.length - matchingOn };

  const shown = tab.ids ? matching.filter((p) => tab.ids.has(p.id)) : matching;
  const shownOn = shown.filter((p) => selectedSet.has(p.id)).length;
  const allShownOn = shown.length > 0 && shownOn === shown.length;

  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = shownOn > 0 && !allShownOn;
  }, [shownOn, allShownOn]);

  const openTab = (key) => {
    if (key === "all") return setTab({ key, ids: null });
    const want = key === "on";
    setTab({ key, ids: new Set((products || []).filter((p) => selectedSet.has(p.id) === want).map((p) => p.id)) });
  };

  const toggleAllShown = () => {
    const ids = new Set(shown.map((p) => p.id));
    if (allShownOn) onChange(selected.filter((id) => !ids.has(id)));
    else onChange([...new Set([...selected, ...ids])]);
  };
  const toggle = (id) => onChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const TABS = [["all", "Todos"], ["on", "Elegidos"], ["off", "Sin elegir"]];
  const emptyText = tab.key === "on" ? "No hay elegidos" : tab.key === "off" ? "No queda ninguno sin elegir" : "Ningún producto coincide";

  return (
    <div className="space-y-2">
      {/* Buscador y categoría */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-slate-400 pointer-events-none">search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto o SKU"
            className="input text-sm w-full !pl-9"
          />
        </div>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input text-sm sm:w-52">
          <option value="">Todas las categorías</option>
          {flattenTree(categories).map((c) => (
            <option key={c.id} value={c.id}>{indentedLabel(c)}</option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        {/* Encabezado: seleccionar todos (los que se ven) + pestañas */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
          <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700 cursor-pointer select-none">
            <input
              ref={headerBox}
              type="checkbox"
              checked={allShownOn}
              onChange={toggleAllShown}
              disabled={shown.length === 0}
              className="w-4 h-4 accent-blue-600"
            />
            {allShownOn ? "Quitar todos" : "Seleccionar todos"}
          </label>
          <div className="flex rounded-md bg-slate-200 p-0.5 text-xs">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => openTab(key)}
                className={`px-2.5 py-1 rounded transition-colors ${
                  tab.key === key ? "bg-white text-slate-800 font-semibold shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {label} <span className="tabular-nums">{counts[key]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Lista */}
        <ul className="max-h-72 overflow-y-auto py-1">
          {products === null ? (
            <li className="px-3 py-6 text-center text-sm text-slate-400">Cargando productos…</li>
          ) : shown.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-slate-400">{emptyText}</li>
          ) : (
            shown.slice(0, MAX_ROWS).map((p) => {
              const on = selectedSet.has(p.id);
              return (
                <li key={p.id}>
                  <label
                    className="flex items-center gap-2.5 px-3 py-1 cursor-pointer hover:bg-slate-500/5"
                    title={(p.categories || []).map((c) => c.name).join(" · ")}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggle(p.id)} className="w-4 h-4 accent-blue-600 flex-shrink-0" />
                    {/* Sin cortar con "…": en el celular dos modelos parecidos quedaban iguales */}
                    <span className={`text-[13px] leading-snug min-w-0 break-words ${on ? "text-slate-700" : "text-slate-400"}`}>{p.name}</span>
                  </label>
                </li>
              );
            })
          )}
          {shown.length > MAX_ROWS && (
            <li className="px-3 py-2 text-xs text-slate-400">…y {shown.length - MAX_ROWS} más: buscalos arriba.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

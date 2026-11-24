import { useEffect, useMemo, useRef, useState } from "react";
import { productsApi, getImageUrl } from "../../services/api";
import { flattenTree, idsInBranch } from "../../utils/categoryTree";

// Productos que entran en un descuento por monto, agrupados por categoría (Productos → Descuento por
// monto → "Solo algunos productos").
//
// Historia (todo el 24/11/2026, pedidos de la clienta):
//   1. "Una selección, con un botón en el encabezado de la lista que diga seleccionar todos, y poder
//      destildar los productos que necesite" → lista con casillas (reemplazó al desplegable de categorías).
//   2. "La sigo sintiendo fea, ruidosa y cargada" → sin fotos, pestañas Todos / Elegidos / Sin elegir.
//   3. Se le mostraron 5 opciones (artifact) y eligió "la B pero con fotos": ESTA versión.
//
// Cómo es: arriba un buscador y "Seleccionar todos" (los que se ven) con "N de M elegidos". Abajo una fila
// por categoría principal, con su casilla (pone o saca la categoría entera), "x de n" y una flecha que la
// abre. Adentro, las subcategorías (cada una con su casilla) y los productos con foto chica. Un producto
// que está en dos categorías (ej. "ULTIMAS UNIDADES" y la suya) aparece en las dos; tildarlo en una lo
// tilda en la otra (es el mismo producto). Al buscar se abren solas las categorías con resultados.
//
// props:
//   categories      — el árbol de categorías (categoriesApi.getAll)
//   selected        — ids elegidos (array de números)
//   onChange(ids)
//   legacyCategoryIds — categorías elegidas con la versión anterior: al cargar se pasan a sus productos
//   onLegacyConverted() — avisa que ya se pasaron (para no mandarlas más)

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const branchIds = (node) => [node.id, ...(node.children || []).flatMap(branchIds)];
const inBranch = (p, ids) => (p.categories || []).some((c) => ids.has(c.id));

// Casilla que también puede quedar "a medias" (algunos elegidos)
function TriCheck({ checked, partial, onChange, disabled, label, className = "" }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = partial; }, [partial]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={label}
      className={`w-4 h-4 accent-blue-600 flex-shrink-0 cursor-pointer ${className}`}
    />
  );
}

export default function PromoProductPicker({ categories, selected, onChange, legacyCategoryIds = [], onLegacyConverted }) {
  const [products, setProducts] = useState(null); // null = cargando
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(() => new Set()); // categorías abiertas

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

  // Una fila por categoría principal; adentro sus subcategorías (y "Otros de X" para los productos que
  // están en la principal pero en ninguna subcategoría). Al final, "Sin categoría".
  const groups = useMemo(() => {
    if (!products) return [];
    const roots = categories || [];
    const out = roots.map((root) => {
      const items = products.filter((p) => inBranch(p, new Set(branchIds(root))));
      const subs = (root.children || [])
        .map((child) => ({ key: `c${child.id}`, name: child.name, items: items.filter((p) => inBranch(p, new Set(branchIds(child)))) }))
        .filter((s) => s.items.length);
      if (subs.length) {
        const inSubs = new Set(subs.flatMap((s) => s.items.map((p) => p.id)));
        const rest = items.filter((p) => !inSubs.has(p.id));
        if (rest.length) subs.push({ key: `r${root.id}`, name: `Otros de ${root.name}`, items: rest });
      }
      return { key: `c${root.id}`, name: root.name, items, subs };
    }).filter((g) => g.items.length);
    const known = new Set(flattenTree(roots).map((c) => c.id));
    const orphans = products.filter((p) => !(p.categories || []).some((c) => known.has(c.id)));
    if (orphans.length) out.push({ key: "none", name: "Sin categoría", items: orphans, subs: [] });
    return out;
  }, [products, categories]);

  // Búsqueda por palabras en el nombre, o por SKU
  const words = norm(search).split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  const matches = (p) => {
    const name = norm(p.name);
    return words.every((w) => name.includes(w)) || (p.sku && norm(p.sku).includes(words.join(" ")));
  };
  const view = searching
    ? groups.map((g) => ({
        ...g,
        items: g.items.filter(matches),
        subs: g.subs.map((s) => ({ ...s, items: s.items.filter(matches) })).filter((s) => s.items.length),
      })).filter((g) => g.items.length)
    : groups;
  const visible = !products ? [] : searching ? products.filter(matches) : products;

  const countOn = (items) => items.reduce((n, p) => n + (selectedSet.has(p.id) ? 1 : 0), 0);
  const setMany = (items, on) => {
    const ids = new Set(items.map((p) => p.id));
    onChange(on ? [...new Set([...selected, ...ids])] : selected.filter((id) => !ids.has(id)));
  };
  const toggle = (id) => onChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const toggleOpen = (key) => setOpen((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const visibleOn = countOn(visible);
  const allVisibleOn = visible.length > 0 && visibleOn === visible.length;
  const totalOn = products ? countOn(products) : 0;

  const productRow = (p, indent) => {
    const on = selectedSet.has(p.id);
    const img = p.images?.[0];
    return (
      <label key={p.id} className={`flex items-center gap-2.5 py-1 pr-3 ${indent} cursor-pointer hover:bg-slate-500/5`}>
        <input type="checkbox" checked={on} onChange={() => toggle(p.id)} className="w-4 h-4 accent-blue-600 flex-shrink-0" />
        {img
          ? <img src={getImageUrl(img, 80)} alt="" loading="lazy" className={`w-8 h-8 rounded object-cover flex-shrink-0 border border-slate-100 transition-opacity ${on ? "" : "opacity-40"}`} />
          : <span className="w-8 h-8 rounded bg-slate-100 flex-shrink-0" />}
        {/* Sin cortar con "…": en el celular dos modelos parecidos quedaban iguales */}
        <span className={`text-[13px] leading-snug min-w-0 break-words ${on ? "text-slate-700" : "text-slate-400"}`}>{p.name}</span>
      </label>
    );
  };

  return (
    <div className="space-y-2">
      {/* Buscador */}
      <div className="relative">
        <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-slate-400 pointer-events-none">search</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto o SKU"
          className="input text-sm w-full !pl-9"
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        {/* Encabezado: seleccionar todos (los que se ven) */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
          <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-700 cursor-pointer select-none">
            <TriCheck
              checked={allVisibleOn}
              partial={visibleOn > 0 && !allVisibleOn}
              onChange={() => setMany(visible, !allVisibleOn)}
              disabled={visible.length === 0}
            />
            {allVisibleOn ? "Quitar todos" : "Seleccionar todos"}
          </label>
          {products && (
            <span className="text-xs text-slate-500 tabular-nums">{totalOn} de {products.length} elegidos</span>
          )}
        </div>

        {/* Categorías */}
        <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
          {products === null ? (
            <p className="px-3 py-6 text-center text-sm text-slate-400">Cargando productos…</p>
          ) : view.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-400">Ningún producto coincide</p>
          ) : (
            view.map((g) => {
              const on = countOn(g.items);
              const full = on === g.items.length;
              const isOpen = searching || open.has(g.key);
              return (
                <div key={g.key}>
                  <div className="flex items-center gap-2.5 px-3 py-2">
                    <TriCheck
                      checked={full}
                      partial={on > 0 && !full}
                      onChange={() => setMany(g.items, !full)}
                      label={`Toda la categoría ${g.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => toggleOpen(g.key)}
                      aria-expanded={isOpen}
                      disabled={searching}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left text-sm font-semibold text-slate-700"
                    >
                      <span className="flex-1 min-w-0 break-words">{g.name}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums whitespace-nowrap ${full ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                        {on} de {g.items.length}
                      </span>
                      <span className={`material-symbols-outlined text-[20px] text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}>expand_more</span>
                    </button>
                  </div>
                  {isOpen && (
                    <div className="pb-1.5">
                      {g.subs.length === 0
                        ? g.items.map((p) => productRow(p, "pl-9"))
                        : g.subs.map((s) => {
                            const sOn = countOn(s.items);
                            const sFull = sOn === s.items.length;
                            return (
                              <div key={s.key}>
                                <label className="flex items-center gap-2.5 pl-9 pr-3 pt-2 pb-1 cursor-pointer select-none">
                                  <TriCheck checked={sFull} partial={sOn > 0 && !sFull} onChange={() => setMany(s.items, !sFull)} />
                                  <span className="flex-1 min-w-0 text-xs font-semibold text-slate-500 break-words">{s.name}</span>
                                  <span className="text-[11px] text-slate-400 tabular-nums whitespace-nowrap">{sOn} de {s.items.length}</span>
                                </label>
                                {s.items.map((p) => productRow(p, "pl-[3.75rem]"))}
                              </div>
                            );
                          })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

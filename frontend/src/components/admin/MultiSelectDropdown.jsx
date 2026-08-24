import { useState, useRef, useEffect, useMemo } from "react";

// Desplegable de selección múltiple con checkboxes, para los filtros del panel admin
// (proveedores y categorías). Un <select multiple> nativo obliga a mantener Ctrl apretado para
// sumar opciones y no deja ver de un vistazo qué hay elegido, por eso va este.
//
// options: [{ value, label, depth? }] — `depth` sangra la opción (categorías anidadas).
// value/onChange: array de `value` seleccionados (strings), controlado desde afuera.
// searchable: agrega un buscador arriba (se activa solo si hay muchas opciones).
export default function MultiSelectDropdown({
  label,
  options,
  value = [],
  onChange,
  placeholder = "Todos",
  searchable = false,
  widthClass = "w-56",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);

  // Cerrar al hacer click afuera. Mismo patrón que el menú de tres puntos del listado.
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Al cerrar se limpia la búsqueda: si no, al reabrir la lista sigue recortada sin que se note.
  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const visible = useMemo(() => {
    if (!query.trim()) return options;
    // Insensible a mayúsculas y tildes, igual que el buscador de productos del listado.
    const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const q = norm(query);
    return options.filter((o) => norm(o.label).includes(q));
  }, [options, query]);

  const toggle = (val) => {
    onChange(value.includes(val) ? value.filter((v) => v !== val) : [...value, val]);
  };

  // Texto del botón: con una sola opción se muestra su nombre; con varias, el conteo.
  const summary =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? `1 seleccionado`)
        : `${value.length} seleccionados`;

  return (
    <div className="flex flex-col gap-1" ref={ref}>
      <label className="text-xs font-semibold text-slate-500">{label}</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={[
            "flex items-center justify-between gap-2 border rounded-lg px-3 py-1.5 text-sm bg-white transition-colors",
            widthClass,
            value.length > 0
              ? "border-blue-500 text-slate-700 font-medium"
              : "border-slate-300 text-slate-500 hover:border-slate-400",
          ].join(" ")}
        >
          <span className="truncate">{summary}</span>
          <span className="text-slate-400 text-xs shrink-0">{open ? "▲" : "▼"}</span>
        </button>

        {open && (
          <div className={`absolute z-30 mt-1 ${widthClass} min-w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden`}>
            {searchable && (
              <div className="p-2 border-b border-slate-100">
                <input
                  type="text"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar..."
                  className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            )}

            <div className="max-h-60 overflow-y-auto py-1">
              {visible.length === 0 ? (
                <p className="px-3 py-2 text-xs text-slate-400">Sin resultados</p>
              ) : (
                visible.map((o) => (
                  <label
                    key={o.value}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer"
                    style={{ paddingLeft: `${12 + (o.depth || 0) * 14}px` }}
                  >
                    <input
                      type="checkbox"
                      checked={value.includes(o.value)}
                      onChange={() => toggle(o.value)}
                      className="rounded border-slate-300"
                    />
                    <span className="truncate">{o.label}</span>
                  </label>
                ))
              )}
            </div>

            {value.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full border-t border-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 text-left"
              >
                ✕ Quitar selección ({value.length})
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

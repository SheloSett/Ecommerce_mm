import { useRef, useState } from "react";
import { customersApi } from "../../services/api";

// Elegir el cliente de la tienda de una etiqueta: las sugerencias (por DNI, teléfono o nombre) y, al final,
// "Buscar otro cliente…", que abre un buscador por nombre o email ahí mismo. Antes solo se podía elegir
// entre las sugerencias: una etiqueta sin sugerencias no se podía vincular sin abrirla.
//
// props: value (id o ""), valueName (nombre del elegido si no es una sugerencia), suggestions
// ([{ customerId, name, reason }]), onChange(id | "", nombre | null)
const SEARCH = "__buscar__";

export default function CustomerPicker({ value, valueName, suggestions = [], onChange }) {
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);

  const search = (text) => {
    setQ(text);
    clearTimeout(timer.current);
    if (text.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await customersApi.getAll({ search: text.trim() });
        const list = Array.isArray(res.data) ? res.data : (res.data?.customers || []);
        setResults(list.slice(0, 10));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const close = () => { setSearching(false); setQ(""); setResults([]); };
  const pick = (c) => { onChange(c.id, c.name); close(); };

  if (searching) {
    return (
      // El resultado va debajo, en la misma fila (no flotando): así no queda tapado en las últimas filas
      <div className="space-y-1">
        <div className="flex gap-1">
          <input
            autoFocus
            value={q}
            onChange={(e) => search(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") close(); }}
            placeholder="Nombre o email del cliente…"
            className="w-full border border-blue-400 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <button type="button" onClick={close} className="px-2 text-xs text-slate-500 hover:text-slate-800">Cancelar</button>
        </div>
        {q.trim().length >= 2 && (
          <div className="border border-slate-200 rounded-lg bg-white max-h-48 overflow-y-auto divide-y divide-slate-100">
            {loading ? (
              <p className="px-3 py-2 text-[11px] text-slate-400">Buscando…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-slate-400">Ningún cliente con ese nombre o email. Si no tiene cuenta en la tienda, dejala sin cliente.</p>
            ) : (
              results.map((c) => (
                <button key={c.id} type="button" onClick={() => pick(c)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50">
                  <span className="font-semibold text-slate-800">{c.name}</span>
                  <span className="text-slate-400 ml-1.5">{c.email}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  const inSuggestions = suggestions.some((s) => s.customerId === value);
  return (
    <select
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        if (v === SEARCH) { setSearching(true); return; }
        if (!v) { onChange("", null); return; }
        const s = suggestions.find((x) => String(x.customerId) === v);
        onChange(Number(v), s ? s.name : valueName);
      }}
      className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white"
    >
      <option value="">Sin cliente vinculado</option>
      {suggestions.map((s) => <option key={s.customerId} value={s.customerId}>{s.name} — {s.reason}</option>)}
      {value && !inSuggestions && <option value={value}>{valueName || `Cliente #${value}`} — elegido a mano</option>}
      <option value={SEARCH}>🔍 Buscar otro cliente…</option>
    </select>
  );
}

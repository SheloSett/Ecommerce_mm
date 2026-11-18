import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import AdminLayout from "../../components/AdminLayout";
import ShippingLabelModal from "../../components/admin/ShippingLabelModal";
import { shippingLabelsApi } from "../../services/api";
import { DEFAULT_SENDER } from "../../utils/shippingLabel";

// Etiquetas de envío guardadas (una o más por cliente) y la importación de las viejas de BarTender.
//
// Importar: se eligen los .btw (o la carpeta entera). El servidor los lee y sugiere de qué cliente es
// cada uno, sin guardar nada; acá se revisa la lista y se confirma. Por defecto quedan destildadas:
//   - las que no son de envío (sin remitente: frágil, artículos, garantía…);
//   - las ya importadas (mismo nombre de archivo);
//   - las repetidas de una misma persona (el 10×10 y el 10×15): queda la más nueva.
// El cliente sugerido se elige solo si coincide el DNI, el teléfono o el nombre completo; "nombre
// parecido" queda como opción para elegir a mano.
const BATCH = 50;
const STRONG = 0.85;

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");

export default function AdminShippingLabels() {
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // etiqueta abierta en el editor
  const [rows, setRows] = useState(null);       // importación en revisión
  const [parsing, setParsing] = useState(null); // { done, total }
  const [useCurrentSender, setUseCurrentSender] = useState(true);
  const [importing, setImporting] = useState(false);
  const [defaultSender, setDefaultSender] = useState(DEFAULT_SENDER);
  const searchTimer = useRef(null);

  const load = useCallback(async (q = "") => {
    setLoading(true);
    try {
      const res = await shippingLabelsApi.list(q.trim() ? { search: q.trim() } : {});
      setLabels(res.data.labels || []);
      if (res.data.defaultSender) setDefaultSender(res.data.defaultSender);
    } catch {
      toast.error("No se pudieron cargar las etiquetas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSearch = (v) => {
    setSearch(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(v), 300);
  };

  const remove = async (l) => {
    if (!window.confirm(`¿Borrar la etiqueta de ${l.recipientName}?`)) return;
    try {
      await shippingLabelsApi.remove(l.id);
      setLabels((prev) => prev.filter((x) => x.id !== l.id));
      toast.success("Etiqueta borrada");
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo borrar");
    }
  };

  // ── Importación ──────────────────────────────────────────────────────────
  const pickFiles = async (fileList) => {
    const files = [...(fileList || [])].filter((f) => f.name.toLowerCase().endsWith(".btw"));
    if (files.length === 0) { toast.error("No hay archivos .btw en lo que elegiste"); return; }
    setRows(null);
    setParsing({ done: 0, total: files.length });
    const results = [];
    try {
      for (let i = 0; i < files.length; i += BATCH) {
        const chunk = files.slice(i, i + BATCH);
        const fd = new FormData();
        chunk.forEach((f) => fd.append("files", f, f.name));
        fd.append("lastModified", JSON.stringify(chunk.map((f) => f.lastModified)));
        const res = await shippingLabelsApi.parseImport(fd);
        results.push(...(res.data.results || []));
        if (res.data.defaultSender) setDefaultSender(res.data.defaultSender);
        setParsing({ done: Math.min(files.length, i + BATCH), total: files.length });
      }
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudieron leer los archivos");
      setParsing(null);
      return;
    }
    setParsing(null);

    // La más nueva de cada persona
    const newest = {};
    for (const r of results) {
      if (r.error || !r.personKey) continue;
      if (!newest[r.personKey] || (r.lastModified || 0) > (newest[r.personKey].lastModified || 0)) newest[r.personKey] = r;
    }
    setRows(results.map((r, idx) => {
      if (r.error) return { idx, ...r, checked: false, flags: [r.error] };
      const flags = [];
      if (!r.isShipping) flags.push("no es de envío");
      if (r.alreadyImported) flags.push("ya importada");
      const newer = newest[r.personKey];
      const isOlder = newer && newer !== r;
      if (isOlder) flags.push(`hay una más nueva: ${newer.fileName}`);
      const top = r.suggestions?.[0];
      return {
        idx, ...r, flags,
        checked: r.isShipping && !r.alreadyImported && !isOlder,
        customerId: top && top.score >= STRONG ? top.customerId : "",
      };
    }));
  };

  const setRow = (idx, patch) => setRows((rs) => rs.map((r) => (r.idx === idx ? { ...r, ...patch } : r)));
  const selected = useMemo(() => (rows || []).filter((r) => r.checked && !r.error), [rows]);

  const confirmImport = async () => {
    if (selected.length === 0) return;
    setImporting(true);
    let created = 0;
    let skipped = 0;
    try {
      const payload = selected.map((r) => ({
        customerId: r.customerId || null,
        recipientName: r.label.recipientName,
        recipientDetails: r.label.recipientDetails,
        transport: r.label.transport,
        insurance: r.label.insurance,
        sender: useCurrentSender ? defaultSender : (r.label.sender || defaultSender),
        sourceFile: r.fileName,
        sourceSize: r.label.size,
      }));
      // De a 50: el servidor acepta hasta 100 KB por pedido (express.json) y 200 podían pasarse
      for (let i = 0; i < payload.length; i += 50) {
        const res = await shippingLabelsApi.importLabels(payload.slice(i, i + 50));
        created += res.data.created || 0;
        skipped += res.data.skipped || 0;
      }
      toast.success(`${created} etiqueta${created === 1 ? "" : "s"} importada${created === 1 ? "" : "s"}${skipped ? ` (${skipped} ya estaban)` : ""}`);
      setRows(null);
      load(search);
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudieron guardar las etiquetas");
    } finally {
      setImporting(false);
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">🏷 Etiquetas de envío</h1>
            <p className="text-sm text-slate-500">Las etiquetas de 10 × 15 de cada cliente. También se abren desde cada pedido.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setEditing({ sender: defaultSender })} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">
              + Nueva etiqueta
            </button>
            <label className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
              📂 Importar carpeta de BarTender
              <input type="file" className="hidden" webkitdirectory="" directory="" multiple onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }} />
            </label>
            <label className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
              Elegir archivos .btw
              <input type="file" className="hidden" accept=".btw" multiple onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
        </div>

        {parsing && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Leyendo etiquetas… {parsing.done} de {parsing.total}
          </div>
        )}

        {/* Revisión de la importación */}
        {rows && (
          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/40 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-800">Revisá antes de importar</h2>
                <p className="text-xs text-slate-500">
                  {rows.length} archivos leídos · {selected.length} para importar. Los archivos de BarTender no se modifican.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={useCurrentSender} onChange={(e) => setUseCurrentSender(e.target.checked)} className="w-4 h-4" />
                  Poner el remitente actual ({defaultSender.split("\n")[0]}) en todas
                </label>
                <button onClick={() => setRows(null)} className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm">Cancelar</button>
                <button onClick={confirmImport} disabled={importing || selected.length === 0} className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-40">
                  {importing ? "Importando…" : `Importar ${selected.length}`}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="p-2 w-8"></th>
                    <th className="p-2 text-left">Destinatario</th>
                    <th className="p-2 text-left">Cliente de la tienda</th>
                    <th className="p-2 text-left">Archivo</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.idx} className={`border-t border-slate-100 align-top ${r.checked ? "" : "opacity-60"}`}>
                      <td className="p-2">
                        <input type="checkbox" checked={!!r.checked} disabled={!!r.error} onChange={(e) => setRow(r.idx, { checked: e.target.checked })} className="w-4 h-4" />
                      </td>
                      <td className="p-2">
                        <p className="font-semibold text-slate-800">{r.label?.recipientName || "—"}</p>
                        <p className="text-xs text-slate-500 whitespace-pre-line line-clamp-3">{r.label?.recipientDetails}</p>
                        {r.label?.transport && <p className="text-[11px] text-slate-400">{r.label.transport}{r.label.insurance ? ` · seguro ${r.label.insurance}` : ""}</p>}
                        {r.flags?.length > 0 && <p className="text-[11px] font-semibold text-amber-700 mt-0.5">{r.flags.join(" · ")}</p>}
                      </td>
                      <td className="p-2 min-w-[14rem]">
                        {!r.error && (
                          <select value={r.customerId ?? ""} onChange={(e) => setRow(r.idx, { customerId: e.target.value ? Number(e.target.value) : "" })}
                            className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white">
                            <option value="">Sin cliente vinculado</option>
                            {(r.suggestions || []).map((s) => (
                              <option key={s.customerId} value={s.customerId}>{s.name} — {s.reason}</option>
                            ))}
                          </select>
                        )}
                        {!r.error && (r.suggestions || []).length === 0 && <p className="text-[11px] text-slate-400 mt-0.5">No hay un cliente parecido</p>}
                      </td>
                      <td className="p-2 text-xs text-slate-500">
                        <p className="break-all">{r.fileName}</p>
                        <p>{r.label?.size ? `${r.label.size} · ` : ""}{fmtDate(r.lastModified)}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Etiquetas guardadas */}
        <div className="space-y-3">
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Buscar por nombre, dirección, DNI o teléfono…"
            className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {loading ? (
            <p className="text-sm text-slate-400 py-8 text-center">Cargando…</p>
          ) : labels.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">{search ? "Ninguna etiqueta coincide." : "Todavía no hay etiquetas guardadas. Importá la carpeta de BarTender o creá una nueva."}</p>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
              {labels.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-[12rem]">
                    <p className="font-semibold text-slate-800">{l.recipientName}</p>
                    <p className="text-xs text-slate-500 truncate">{(l.recipientDetails || "").split("\n").slice(0, 2).join(" · ")}</p>
                    <p className="text-[11px] text-slate-400">
                      {l.customer ? `Cliente: ${l.customer.name}` : "Sin cliente vinculado"}
                      {l.transport ? ` · ${l.transport}` : ""}
                      {l.sourceFile ? ` · de BarTender${l.sourceSize ? ` (${l.sourceSize})` : ""}` : ""}
                      {` · ${fmtDate(l.updatedAt)}`}
                    </p>
                  </div>
                  <button onClick={() => setEditing(l)} className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-semibold hover:bg-blue-100">Abrir / imprimir</button>
                  <button onClick={() => remove(l)} className="px-2 py-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 text-sm" title="Borrar">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <ShippingLabelModal
          initial={editing}
          others={editing.customerId ? labels.filter((l) => l.customerId === editing.customerId) : []}
          subtitle={editing.customer ? `Cliente: ${editing.customer.name}` : undefined}
          onClose={() => setEditing(null)}
          onSaved={(saved) => setLabels((prev) => [saved, ...prev.filter((x) => x.id !== saved.id)])}
        />
      )}
    </AdminLayout>
  );
}

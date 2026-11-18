import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import AdminLayout from "../../components/AdminLayout";
import ShippingLabelModal from "../../components/admin/ShippingLabelModal";
import { shippingLabelsApi } from "../../services/api";
import { DEFAULT_SENDER } from "../../utils/shippingLabel";

// Etiquetas de envío: las confirmadas (una o más por cliente) y las pendientes de revisar.
//
// "Subir carpeta de BarTender": el servidor lee los .btw y guarda las de envío como PENDIENTES (no guarda
// los archivos ni los modifica). La revisión se hace de a poco y la puede seguir otra persona: cada
// pendiente trae el cliente sugerido (por DNI, teléfono o nombre) y se confirma, se descarta o se abre
// para editarla (guardarla la confirma). Desde un pedido también se abre la pendiente con el mismo nombre.
//
// Antes (primera versión del 18/11/2026): se revisaba todo en una tabla en el momento y lo que no se
// tildaba se perdía hasta volver a subir la carpeta.
const BATCH = 50;
const STRONG = 0.85; // DNI, teléfono o nombre completo: se elige solo. "Nombre parecido" queda para elegir.

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function AdminShippingLabels() {
  const [tab, setTab] = useState("labels"); // "labels" | "pending"
  const [labels, setLabels] = useState([]);
  const [pending, setPending] = useState([]);   // pendientes con suggestions, newerFile y lo elegido en pantalla
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [pendingFilter, setPendingFilter] = useState("");
  const [editing, setEditing] = useState(null);
  const [uploading, setUploading] = useState(null); // { done, total }
  const [busy, setBusy] = useState(false);
  const [defaultSender, setDefaultSender] = useState(DEFAULT_SENDER);
  const searchTimer = useRef(null);

  const loadLabels = useCallback(async (q = "") => {
    setLoading(true);
    try {
      const res = await shippingLabelsApi.list(q.trim() ? { search: q.trim() } : {});
      setLabels(res.data.labels || []);
      setPendingCount(res.data.pendingCount || 0);
      if (res.data.defaultSender) setDefaultSender(res.data.defaultSender);
    } catch {
      toast.error("No se pudieron cargar las etiquetas");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      const res = await shippingLabelsApi.list({ pending: true });
      setPending((res.data.labels || []).map((l) => {
        const top = l.suggestions?.[0];
        return { ...l, checked: false, chosenCustomerId: top && top.score >= STRONG ? top.customerId : "" };
      }));
      setPendingCount(res.data.pendingCount || 0);
    } catch {
      toast.error("No se pudieron cargar las pendientes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (tab === "labels") loadLabels(search); else loadPending(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSearch = (v) => {
    setSearch(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadLabels(v), 300);
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

  // ── Subir la carpeta: todo queda como pendiente ──────────────────────────
  const upload = async (fileList) => {
    const files = [...(fileList || [])].filter((f) => f.name.toLowerCase().endsWith(".btw"));
    if (files.length === 0) { toast.error("No hay archivos .btw en lo que elegiste"); return; }
    setUploading({ done: 0, total: files.length });
    const sum = { created: 0, repeated: 0, notShipping: 0, unreadable: [] };
    try {
      for (let i = 0; i < files.length; i += BATCH) {
        const chunk = files.slice(i, i + BATCH);
        const fd = new FormData();
        chunk.forEach((f) => fd.append("files", f, f.name));
        fd.append("lastModified", JSON.stringify(chunk.map((f) => f.lastModified)));
        const { data } = await shippingLabelsApi.upload(fd);
        sum.created += data.created || 0;
        sum.repeated += data.repeated || 0;
        sum.notShipping += data.notShipping || 0;
        sum.unreadable.push(...(data.unreadable || []));
        setUploading({ done: Math.min(files.length, i + BATCH), total: files.length });
      }
      const extra = [
        sum.repeated ? `${sum.repeated} ya estaban` : "",
        sum.notShipping ? `${sum.notShipping} no eran de envío` : "",
        sum.unreadable.length ? `${sum.unreadable.length} no se pudieron leer` : "",
      ].filter(Boolean).join(" · ");
      toast.success(`${sum.created} etiqueta${sum.created === 1 ? "" : "s"} para revisar${extra ? ` (${extra})` : ""}`, { duration: 8000 });
      setTab("pending");
      loadPending();
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudieron subir las etiquetas");
      if (sum.created) loadPending();
    } finally {
      setUploading(null);
    }
  };

  // ── Revisión de pendientes ───────────────────────────────────────────────
  const setRow = (id, patch) => setPending((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const visiblePending = useMemo(() => {
    const q = norm(pendingFilter.trim());
    return q ? pending.filter((r) => norm(`${r.recipientName} ${r.recipientDetails} ${r.sourceFile}`).includes(q)) : pending;
  }, [pending, pendingFilter]);
  const selected = pending.filter((r) => r.checked);

  const confirm = async (rows) => {
    if (rows.length === 0) return;
    setBusy(true);
    try {
      const { data } = await shippingLabelsApi.confirm(rows.map((r) => ({ id: r.id, customerId: r.chosenCustomerId || null })));
      const ids = new Set(rows.map((r) => r.id));
      setPending((rs) => rs.filter((r) => !ids.has(r.id)));
      setPendingCount((n) => Math.max(0, n - (data.confirmed || 0)));
      toast.success(`${data.confirmed} confirmada${data.confirmed === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudieron confirmar");
    } finally {
      setBusy(false);
    }
  };

  const discard = async (rows) => {
    if (rows.length === 0) return;
    if (!window.confirm(rows.length === 1 ? `¿Descartar la etiqueta de ${rows[0].recipientName}?` : `¿Descartar ${rows.length} etiquetas pendientes?`)) return;
    setBusy(true);
    try {
      const { data } = await shippingLabelsApi.discard(rows.map((r) => r.id));
      const ids = new Set(rows.map((r) => r.id));
      setPending((rs) => rs.filter((r) => !ids.has(r.id)));
      setPendingCount((n) => Math.max(0, n - (data.discarded || 0)));
      toast.success(`${data.discarded} descartada${data.discarded === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudieron descartar");
    } finally {
      setBusy(false);
    }
  };

  // Una pendiente abierta en el editor: se lleva el cliente elegido en la fila
  const openPending = (r) => setEditing({ ...r, customerId: r.chosenCustomerId || r.customerId || null, customer: r.chosenCustomerId ? { name: r.suggestions.find((s) => s.customerId === r.chosenCustomerId)?.name } : r.customer });

  const tabBtn = (key, text) => (
    <button onClick={() => setTab(key)} className={`px-4 py-2 rounded-xl text-sm font-semibold ${tab === key ? "bg-slate-800 text-white" : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
      {text}
    </button>
  );

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
            <label className={`px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
              📂 Subir carpeta de BarTender
              <input type="file" className="hidden" webkitdirectory="" directory="" multiple onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            </label>
            <label className={`px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
              Subir archivos .btw
              <input type="file" className="hidden" accept=".btw" multiple onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
        </div>

        {uploading && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Subiendo etiquetas… {uploading.done} de {uploading.total}
          </div>
        )}

        <div className="flex gap-2">
          {tabBtn("labels", "Etiquetas")}
          {tabBtn("pending", `Pendientes de revisar${pendingCount ? ` (${pendingCount})` : ""}`)}
        </div>

        {tab === "pending" ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Importadas de BarTender y todavía sin revisar. Elegí el cliente (si es de la tienda) y confirmalas, o abrilas para corregir algo:
              al guardarlas quedan confirmadas. Las que sobran (por ejemplo, la versión vieja de alguien) se descartan.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input value={pendingFilter} onChange={(e) => setPendingFilter(e.target.value)} placeholder="Filtrar por nombre, dirección o archivo…"
                className="flex-1 min-w-[14rem] px-4 py-2 border border-slate-300 rounded-xl text-base sm:text-sm" />
              <button onClick={() => confirm(selected)} disabled={busy || selected.length === 0} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-40">
                Confirmar {selected.length || ""}
              </button>
              <button onClick={() => discard(selected)} disabled={busy || selected.length === 0} className="px-4 py-2 rounded-xl border border-red-300 text-red-600 text-sm font-semibold disabled:opacity-40">
                Descartar {selected.length || ""}
              </button>
            </div>
            {loading ? (
              <p className="text-sm text-slate-400 py-8 text-center">Cargando…</p>
            ) : visiblePending.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">{pending.length ? "Ninguna pendiente coincide." : "No hay etiquetas pendientes. Subí la carpeta de BarTender para importarlas."}</p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="p-2 w-8">
                        <input type="checkbox" className="w-4 h-4"
                          checked={visiblePending.length > 0 && visiblePending.every((r) => r.checked)}
                          onChange={(e) => { const ids = new Set(visiblePending.map((r) => r.id)); setPending((rs) => rs.map((r) => (ids.has(r.id) ? { ...r, checked: e.target.checked } : r))); }} />
                      </th>
                      <th className="p-2 text-left">Destinatario</th>
                      <th className="p-2 text-left">Cliente de la tienda</th>
                      <th className="p-2 text-left">Archivo</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePending.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100 align-top">
                        <td className="p-2"><input type="checkbox" checked={r.checked} onChange={(e) => setRow(r.id, { checked: e.target.checked })} className="w-4 h-4" /></td>
                        <td className="p-2">
                          <p className="font-semibold text-slate-800">{r.recipientName}</p>
                          <p className="text-xs text-slate-500 whitespace-pre-line line-clamp-3">{r.recipientDetails}</p>
                          {r.transport && <p className="text-[11px] text-slate-400">{r.transport}{r.insurance ? ` · seguro ${r.insurance}` : ""}</p>}
                          {r.newerFile && <p className="text-[11px] font-semibold text-amber-700 mt-0.5">hay una más nueva: {r.newerFile}</p>}
                        </td>
                        <td className="p-2 min-w-[14rem]">
                          <select value={r.chosenCustomerId ?? ""} onChange={(e) => setRow(r.id, { chosenCustomerId: e.target.value ? Number(e.target.value) : "" })}
                            className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white">
                            <option value="">Sin cliente vinculado</option>
                            {(r.suggestions || []).map((s) => <option key={s.customerId} value={s.customerId}>{s.name} — {s.reason}</option>)}
                          </select>
                          {(r.suggestions || []).length === 0 && <p className="text-[11px] text-slate-400 mt-0.5">Sin sugerencias (se puede vincular abriéndola)</p>}
                        </td>
                        <td className="p-2 text-xs text-slate-500">
                          <p className="break-all">{r.sourceFile}</p>
                          <p>{r.sourceSize ? `${r.sourceSize} · ` : ""}{fmtDate(r.sourceDate)}</p>
                        </td>
                        <td className="p-2 whitespace-nowrap text-right">
                          <button onClick={() => confirm([r])} disabled={busy} className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100">Confirmar</button>
                          <button onClick={() => openPending(r)} className="ml-1 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100">Abrir</button>
                          <button onClick={() => discard([r])} disabled={busy} className="ml-1 px-2 py-1 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 text-xs" title="Descartar">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Buscar por nombre, dirección, DNI o teléfono…"
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {loading ? (
              <p className="text-sm text-slate-400 py-8 text-center">Cargando…</p>
            ) : labels.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">
                {search ? "Ninguna etiqueta coincide." : pendingCount ? `Todavía no hay etiquetas confirmadas: hay ${pendingCount} pendientes de revisar.` : "Todavía no hay etiquetas. Subí la carpeta de BarTender o creá una nueva."}
              </p>
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
        )}
      </div>

      {editing && (
        <ShippingLabelModal
          initial={editing}
          others={editing.customerId && !editing.pending ? labels.filter((l) => l.customerId === editing.customerId) : []}
          subtitle={editing.customer?.name ? `Cliente: ${editing.customer.name}` : undefined}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            // Guardada: sale de pendientes (si lo era) y queda en la lista
            setPending((rs) => rs.filter((r) => r.id !== saved.id));
            if (editing.pending) {
              setPendingCount((n) => Math.max(0, n - 1));
              setEditing((e) => (e ? { ...e, pending: false } : e)); // un segundo guardado ya no descuenta
            }
            setLabels((prev) => [saved, ...prev.filter((x) => x.id !== saved.id)]);
          }}
        />
      )}
    </AdminLayout>
  );
}

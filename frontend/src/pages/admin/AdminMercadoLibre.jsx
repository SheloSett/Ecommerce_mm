import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import AdminLayout from "../../components/AdminLayout";
import { mlApi } from "../../services/api";
import { poolStatus, numbersMatch, cycleKind, parseStockNumber, since, accountStatus } from "../../utils/mlTexts";
import { movementDate } from "../../utils/stockMovements";

// Productos → Mercado Libre: las publicaciones de la cuenta, cada una vinculada (o no) a un producto o
// variante de la página. Las publicaciones que Mercado Libre agrupa (mismo producto, distinta
// condición de venta) comparten stock y aparecen juntas. Vincular no cambia nada: el stock se
// empieza a compartir al "Activar", eligiendo qué número queda. Ver backend/src/services/ml/.

const TONE = {
  ok:   "bg-emerald-100 text-emerald-700",
  warn: "bg-amber-100 text-amber-700",
  bad:  "bg-red-100 text-red-700",
  off:  "bg-slate-100 text-slate-600",
};
const FILTERS = [
  { id: "todos",     label: "Todas" },
  { id: "sin",       label: "Sin vincular" },
  { id: "vinculado", label: "Vinculadas" },
  { id: "activo",    label: "Compartiendo stock" },
  { id: "problema",  label: "Con problemas" },
];

function errorText(err, fallback) {
  return err?.response?.data?.error || fallback;
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">{children}</div>
      </div>
    </div>
  );
}

// Elegir el producto o la variante de la página para un pozo.
function LinkModal({ pool, onClose, onDone }) {
  const [q, setQ] = useState("");
  const [units, setUnits] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim().length < 2) { setUnits([]); return; }
      mlApi.units(q.trim()).then((res) => setUnits(res.data.units || [])).catch(() => setUnits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const link = async (u) => {
    setBusy(true);
    try {
      await mlApi.link(pool.id, u.productId, u.variantId);
      toast.success("Vinculado. Para compartir stock, apretá Activar.");
      onDone();
    } catch (err) {
      toast.error(errorText(err, "No se pudo vincular"));
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ u, hint }) => (
    <button type="button" disabled={busy} onClick={() => link(u)}
      className="w-full text-left rounded-xl border border-slate-200 px-3 py-2 hover:bg-blue-50 disabled:opacity-50">
      <div className="text-sm font-medium text-slate-800">{u.name}</div>
      <div className="text-xs text-slate-500">
        {u.sku ? `SKU ${u.sku} · ` : ""}{u.stockUnlimited ? "stock ilimitado" : `stock ${u.qty}`}{hint ? ` · ${hint}` : ""}
        {u.linked ? <span className="text-amber-600"> · ya vinculado a otra publicación</span> : null}
      </div>
    </button>
  );

  return (
    <Modal title="Vincular con un producto de la página" onClose={onClose}>
      <p className="text-sm text-slate-600">{pool.listings[0]?.title}</p>
      {pool.suggestions?.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-500 uppercase">Sugeridos</div>
          {pool.suggestions.map((u) => <Row key={`${u.productId}:${u.variantId ?? ""}`} u={u} hint={u.by === "sku" ? "mismo SKU" : "título parecido"} />)}
        </div>
      )}
      <div className="space-y-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o SKU…"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        {units.map((u) => <Row key={`${u.productId}:${u.variantId ?? ""}`} u={u} />)}
        {q.trim().length >= 2 && units.length === 0 && <p className="text-xs text-slate-400">Sin resultados.</p>}
      </div>
    </Modal>
  );
}

// Activar o resolver: qué número queda en los dos lados.
function NumberModal({ pool, mode, onClose, onDone }) {
  const [choice, setChoice] = useState(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const web = pool.unit?.qty;
  const ml = pool.review?.ml ?? pool.mlQty;

  const submit = async () => {
    const number = choice === "number" ? parseStockNumber(typed) : null;
    if (choice === "number" && number === null) { toast.error("Escribí un número entero, de 0 a 99999"); return; }
    setBusy(true);
    try {
      const fn = mode === "resolve" ? mlApi.resolve : mlApi.activate;
      const res = await fn(pool.id, choice, number);
      toast.success(`Listo: quedan ${res.data.number} en los dos lados`);
      onDone();
    } catch (err) {
      toast.error(errorText(err, "No se pudo guardar"));
    } finally {
      setBusy(false);
    }
  };

  const Option = ({ id, children }) => (
    <label className={`flex items-start gap-3 rounded-xl border px-3 py-2 cursor-pointer ${choice === id ? "border-blue-500 bg-blue-50" : "border-slate-200"}`}>
      <input type="radio" name="choice" checked={choice === id} onChange={() => setChoice(id)} className="mt-1" />
      <div className="text-sm">{children}</div>
    </label>
  );

  return (
    <Modal title={mode === "resolve" ? "Resolver la diferencia" : "Empezar a compartir stock"} onClose={onClose}>
      <p className="text-sm text-slate-600"><b>{pool.unit?.name}</b> ↔ {pool.listings[0]?.title}</p>
      {mode === "resolve" && (pool.review?.reason || pool.lastError) && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">{pool.review?.reason || pool.lastError}</div>
      )}
      <p className="text-sm text-slate-600">¿Qué número queda? Se carga en los dos lados.</p>
      <div className="space-y-2">
        <Option id="web">El de la página: <b>{web ?? "?"}</b></Option>
        <Option id="ml">El de Mercado Libre: <b>{ml ?? "se lee en el momento"}</b></Option>
        <Option id="number">
          Otro número (por ejemplo, el que contaste):
          <input type="text" inputMode="numeric" value={typed} onFocus={() => setChoice("number")} onChange={(e) => setTyped(e.target.value)}
            className="mt-1 w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
        </Option>
      </div>
      <p className="text-xs text-slate-500">Ojo: de acá en adelante cada cambio se carga en un solo lado. Si entran 5 unidades y se suman en la página y también en Mercado Libre, el stock sube 10.</p>
      <button type="button" disabled={!choice || busy} onClick={submit}
        className="w-full px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
        {busy ? "Guardando…" : "Confirmar"}
      </button>
    </Modal>
  );
}

function CyclesModal({ pool, onClose }) {
  const [cycles, setCycles] = useState(null);
  useEffect(() => {
    mlApi.cycles(pool.id).then((res) => setCycles(res.data.cycles || [])).catch(() => setCycles([]));
  }, [pool.id]);
  return (
    <Modal title="Bitácora" onClose={onClose}>
      {!cycles && <p className="text-sm text-slate-500">Cargando…</p>}
      {cycles?.length === 0 && <p className="text-sm text-slate-500">Todavía no hay movimientos.</p>}
      {cycles?.map((c) => (
        <div key={c.id} className="border-b border-slate-100 pb-2 text-sm">
          <div className="flex justify-between gap-2">
            <span className="font-semibold text-slate-700">{cycleKind(c.kind)}{c.result ? ` · ${c.result}` : ""}</span>
            <span className="text-xs text-slate-400 whitespace-nowrap">{movementDate(c.createdAt)}</span>
          </div>
          {c.detail && <div className="text-xs text-slate-500">{c.detail}</div>}
          {(c.webBefore != null || c.webAfter != null) && <div className="text-xs text-slate-500">Página: {c.webBefore ?? "?"} → {c.webAfter ?? "?"}</div>}
        </div>
      ))}
    </Modal>
  );
}

export default function AdminMercadoLibre() {
  const [status, setStatus] = useState(null);
  const [pools, setPools] = useState(null);
  const [filter, setFilter] = useState("todos");
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null); // { type, pool }
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([mlApi.status(), mlApi.pools()]);
      setStatus(s.data);
      setPools(p.data.pools || []);
    } catch (err) {
      toast.error(errorText(err, "No se pudo cargar Mercado Libre"));
      setPools((prev) => prev || []);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Mientras se traen las publicaciones, mirar cada unos segundos hasta que termine.
  useEffect(() => {
    if (!status?.refreshing) return undefined;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [status, load]);

  const refresh = async () => {
    try {
      await mlApi.refresh();
      toast.success("Trayendo las publicaciones de Mercado Libre…");
      setStatus((s) => ({ ...s, refreshing: true }));
    } catch (err) {
      toast.error(errorText(err, "No se pudo empezar"));
    }
  };

  const act = async (pool, fn, okText) => {
    setBusyId(pool.id);
    try {
      await fn(pool.id);
      toast.success(okText);
      await load();
    } catch (err) {
      toast.error(errorText(err, "No se pudo"));
    } finally {
      setBusyId(null);
    }
  };

  const shown = useMemo(() => {
    const text = q.trim().toLowerCase();
    // Primero lo que necesita atención: problemas, después sin vincular o sin activar, al final lo que anda.
    const rank = (p) => (p.productId && p.status !== "OK" ? 0 : !p.productId || !p.active ? 1 : 2);
    return (pools || []).filter((p) => {
      if (filter === "sin" && p.productId) return false;
      if (filter === "vinculado" && !p.productId) return false;
      if (filter === "activo" && !(p.productId && p.active && p.status === "OK")) return false;
      if (filter === "problema" && !(p.productId && p.status !== "OK")) return false;
      if (!text) return true;
      return p.listings.some((l) => l.title?.toLowerCase().includes(text) || l.sku?.toLowerCase().includes(text) || l.itemId.toLowerCase().includes(text))
        || p.unit?.name?.toLowerCase().includes(text);
    }).sort((a, b) => rank(a) - rank(b));
  }, [pools, filter, q]);

  const account = accountStatus(status?.status);

  return (
    <AdminLayout title="Mercado Libre">
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600 space-y-0.5">
            <div>
              Cuenta: <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${TONE[account.tone]}`}>{account.text}</span>
              {status && <> · Modo: <b>{status.mode === "ACTIVO" ? "Activo" : status.mode === "OBSERVAR" ? "Observar" : "Apagado"}</b></>}
            </div>
            <div className="text-xs text-slate-500">
              Publicaciones traídas {since(status?.listingsAt)}{status?.listingsResult ? ` (${status.listingsResult})` : ""}
              {status?.mode !== "ACTIVO" && status?.status === "CONECTADA" && <> · <Link to="/admin/configuracion" className="text-blue-600 hover:underline">el modo se cambia en Configuración</Link></>}
            </div>
          </div>
          <button type="button" onClick={refresh} disabled={status?.refreshing || status?.status !== "CONECTADA"}
            className="px-4 py-2 rounded-xl bg-yellow-400 hover:bg-yellow-500 text-slate-900 text-sm font-semibold disabled:opacity-50">
            {status?.refreshing ? "Trayendo…" : "Traer publicaciones"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${filter === f.id ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200"}`}>
              {f.label}
            </button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…"
            className="ml-auto w-full sm:w-64 rounded-xl border border-slate-300 px-3 py-1.5 text-sm" />
        </div>

        {!pools && <p className="text-sm text-slate-500">Cargando…</p>}
        {pools?.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 text-sm text-slate-500">
            Todavía no hay publicaciones. Apretá <b>Traer publicaciones</b> (con la cuenta conectada).
          </div>
        )}

        <div className="space-y-3">
          {shown.map((p) => {
            const st = poolStatus(p);
            const match = numbersMatch(p);
            const busy = busyId === p.id;
            return (
              <div key={p.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
                <div className="flex gap-3">
                  {p.listings[0]?.thumbnail
                    ? <img src={p.listings[0].thumbnail} alt="" className="w-14 h-14 rounded-lg object-cover border border-slate-100" />
                    : <div className="w-14 h-14 rounded-lg bg-slate-100" />}
                  <div className="min-w-0 flex-1">
                    {p.listings.map((l) => (
                      <div key={`${l.itemId}:${l.variationId || ""}`} className="text-sm">
                        <span className="font-medium text-slate-800">{l.title}</span>
                        <span className="text-xs text-slate-400"> · {l.permalink ? <a href={l.permalink} target="_blank" rel="noopener noreferrer" className="hover:underline">{l.itemId}</a> : l.itemId}
                          {l.sku ? ` · SKU ${l.sku}` : ""}{l.status && l.status !== "active" ? ` · ${l.status === "paused" ? "pausada" : l.status}` : ""}</span>
                      </div>
                    ))}
                    <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-semibold ${TONE[st.tone]}`}>{st.text}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">Mercado Libre</div>
                    <div className="font-bold text-slate-800">{p.mlQty ?? "—"}</div>
                  </div>
                  <div className={`rounded-xl px-3 py-2 ${match === false ? "bg-amber-50" : "bg-slate-50"}`}>
                    <div className="text-xs text-slate-500 truncate">{p.unit ? p.unit.name : "Página: sin vincular"}</div>
                    <div className="font-bold text-slate-800">{p.unit ? (p.unit.stockUnlimited ? "∞" : p.unit.qty) : "—"}</div>
                  </div>
                </div>

                {p.lastError && <div className="text-xs text-red-600">{p.lastError}</div>}
                {p.pendingWrite != null && <div className="text-xs text-slate-500">Escribiendo {p.pendingWrite} en Mercado Libre…</div>}

                <div className="flex flex-wrap gap-2">
                  {!p.productId && (
                    <button type="button" onClick={() => setModal({ type: "link", pool: p })}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">Vincular</button>
                  )}
                  {p.productId && !p.active && p.status === "OK" && (
                    <button type="button" onClick={() => setModal({ type: "activate", pool: p })}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700">Activar</button>
                  )}
                  {(p.status === "REVISAR" || p.status === "ERROR") && (
                    <button type="button" onClick={() => setModal({ type: "resolve", pool: p })}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600">Resolver</button>
                  )}
                  {["ERROR", "CERRADO", "ROTO"].includes(p.status) && (
                    <button type="button" disabled={busy} onClick={() => act(p, mlApi.check, "Se vuelve a revisar en un momento")}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Reintentar</button>
                  )}
                  {p.productId && p.active && (
                    <button type="button" disabled={busy}
                      onClick={() => window.confirm("¿Dejar de compartir el stock de este producto? Los dos lados quedan con el número de ahora.") && act(p, mlApi.deactivate, "Ya no comparte stock")}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Desactivar</button>
                  )}
                  {p.productId && !p.active && (
                    <button type="button" disabled={busy} onClick={() => act(p, mlApi.unlink, "Desvinculado")}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Desvincular</button>
                  )}
                  {p.productId && (
                    <button type="button" onClick={() => setModal({ type: "cycles", pool: p })}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50">Bitácora</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {modal?.type === "link" && <LinkModal pool={modal.pool} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {(modal?.type === "activate" || modal?.type === "resolve") && (
        <NumberModal pool={modal.pool} mode={modal.type} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />
      )}
      {modal?.type === "cycles" && <CyclesModal pool={modal.pool} onClose={() => setModal(null)} />}
    </AdminLayout>
  );
}

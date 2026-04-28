import { useState, useEffect } from "react";
import AdminLayout from "../../components/AdminLayout";
import { returnsApi } from "../../services/api";
import { useBadges } from "../../context/BadgeContext";
import toast from "react-hot-toast";

function formatARS(n) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n ?? 0);
}

function formatDate(d) {
  return new Date(d).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_MAP = {
  PENDING:  { label: "Pendiente",  dot: "bg-amber-400",  text: "text-amber-700",  bg: "bg-amber-50 border-amber-200" },
  APPROVED: { label: "Aprobada",   dot: "bg-green-500",  text: "text-green-700",  bg: "bg-green-50 border-green-200" },
  REJECTED: { label: "Rechazada",  dot: "bg-red-500",    text: "text-red-700",    bg: "bg-red-50 border-red-200" },
};

function StatusPill({ status }) {
  const s = STATUS_MAP[status] || { label: status, dot: "bg-slate-400", text: "text-slate-600" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export default function AdminReturns() {
  const { decrementBadge } = useBadges();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filterStatus, setFilterStatus] = useState(""); // "" = todos
  const [selected, setSelected] = useState(null);

  // Modal de resolución
  const [resolving, setResolving] = useState(false); // "APPROVED" | "REJECTED"
  const [adminNotes, setAdminNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function load(status) {
    setLoading(true);
    try {
      const { data } = await returnsApi.getAll(status ? { status } : {});
      setRequests(data);
    } catch {
      toast.error("Error al cargar solicitudes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(filterStatus); }, [filterStatus]);

  function openResolve(action) {
    setResolving(action);
    setAdminNotes("");
  }

  async function handleResolve() {
    if (!adminNotes.trim()) {
      return toast.error(
        resolving === "APPROVED"
          ? "Las instrucciones de devolución son obligatorias."
          : "El motivo de rechazo es obligatorio."
      );
    }
    setSaving(true);
    try {
      const { data } = await returnsApi.updateStatus(selected.id, resolving, adminNotes.trim());
      toast.success(resolving === "APPROVED" ? "Solicitud aprobada. Email enviado al cliente." : "Solicitud rechazada.");
      setSelected(data);
      setResolving(false);
      setRequests((prev) => prev.map((r) => (r.id === data.id ? data : r)));
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al actualizar.");
    } finally {
      setSaving(false);
    }
  }

  const counts = {
    total:    requests.length,
    pending:  requests.filter((r) => r.status === "PENDING").length,
    approved: requests.filter((r) => r.status === "APPROVED").length,
    rejected: requests.filter((r) => r.status === "REJECTED").length,
  };

  return (
    <AdminLayout title="Botón de Arrepentimiento">
      {/* ── Contadores ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total",      value: counts.total,    color: "text-slate-700" },
          { label: "Pendientes", value: counts.pending,  color: "text-amber-600" },
          { label: "Aprobadas",  value: counts.approved, color: "text-green-600" },
          { label: "Rechazadas", value: counts.rejected,  color: "text-red-600" },
        ].map((c) => (
          <div key={c.label} className="card p-4 text-center">
            <p className={`text-3xl font-bold ${c.color}`}>{c.value}</p>
            <p className="text-xs text-slate-500 mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {/* ── Filtro ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-5">
        {[
          { value: "",         label: "Todas" },
          { value: "PENDING",  label: "Pendientes" },
          { value: "APPROVED", label: "Aprobadas" },
          { value: "REJECTED", label: "Rechazadas" },
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setFilterStatus(f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filterStatus === f.value
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Tabla ──────────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Cargando…</div>
        ) : requests.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">No hay solicitudes con ese filtro.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-5 py-3 text-left">#</th>
                  <th className="px-5 py-3 text-left">Cliente</th>
                  <th className="px-5 py-3 text-left">Pedido</th>
                  <th className="px-5 py-3 text-left">Fecha</th>
                  <th className="px-5 py-3 text-left">Estado</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-mono text-slate-500">{r.id}</td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-800">{r.customerName}</p>
                      <p className="text-xs text-slate-400">{r.customerEmail}</p>
                    </td>
                    <td className="px-5 py-3">
                      {/* Pedido #null comentado — orderId puede ser null si no fue ingresado */}
                      {/* <span className="font-medium text-slate-700">Pedido #{r.orderId}</span> */}
                      {r.orderId
                        ? <span className="font-medium text-slate-700">Pedido #{r.orderId}</span>
                        : <span className="text-xs text-slate-400">Sin pedido</span>
                      }
                      {r.order && (
                        <p className="text-xs text-slate-400">{formatARS(r.order.total)}</p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs">{formatDate(r.createdAt)}</td>
                    <td className="px-5 py-3"><StatusPill status={r.status} /></td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => {
                          setSelected(r);
                          setResolving(false);
                          setAdminNotes("");
                          // Marcar como visto al abrir el detalle → actualiza badge instantáneo
                          if (!r.seenByAdmin) {
                            returnsApi.markSeen(r.id).catch(() => {});
                            decrementBadge("devoluciones");
                          }
                        }}
                        className="text-blue-600 hover:underline text-xs font-medium"
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Panel lateral: detalle ──────────────────────────────────────── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Overlay */}
          <div className="absolute inset-0 bg-black/40" onClick={() => { setSelected(null); setResolving(false); }} />

          {/* Drawer */}
          <aside className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col h-full overflow-y-auto">
            {/* Cabecera */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
              <div>
                <p className="font-bold text-slate-800">Solicitud #{selected.id}</p>
                <StatusPill status={selected.status} />
              </div>
              <button onClick={() => { setSelected(null); setResolving(false); }} className="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
            </div>

            <div className="p-6 space-y-5 flex-1">

              {/* Datos del cliente */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Cliente</p>
                <p className="font-semibold text-slate-800">{selected.customerName}</p>
                <p className="text-sm text-slate-500">{selected.customerEmail}</p>
                {selected.customerPhone && (
                  <p className="text-sm text-slate-500 mt-0.5">📞 {selected.customerPhone}</p>
                )}
                {selected.customerPhone && (
                  <a
                    href={`https://wa.me/${selected.customerPhone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-2 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.558 4.115 1.535 5.845L.057 23.082a.75.75 0 0 0 .921.921l5.237-1.478A11.946 11.946 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.716 9.716 0 0 1-4.953-1.355l-.355-.212-3.683 1.038 1.038-3.683-.212-.355A9.716 9.716 0 0 1 2.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/>
                    </svg>
                    Contactar por WhatsApp
                  </a>
                )}
              </div>

              {/* Pedido */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Pedido</p>
                {/* Pedido #null comentado — el orderId puede no existir si el formulario no lo solicita */}
                {/* <p className="font-semibold text-slate-800">Pedido #{selected.orderId}</p> */}
                {selected.orderId && (
                  <p className="font-semibold text-slate-800">Pedido #{selected.orderId}</p>
                )}
                {selected.order && (
                  <>
                    <p className="text-sm text-slate-500 mb-2">{formatARS(selected.order.total)}</p>
                    <div className="space-y-1">
                      {(selected.order.items || []).map((item) => (
                        <div key={item.id} className="flex items-center gap-2 text-sm text-slate-600">
                          <span className="text-slate-400">{item.quantity}×</span>
                          <span>{item.product?.name || "Producto"}</span>
                          <span className="ml-auto text-slate-400">{formatARS(item.price)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Motivo */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Motivo del cliente</p>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-700 italic">
                  "{selected.reason}"
                </div>
              </div>

              {/* Fecha */}
              <p className="text-xs text-slate-400">Enviada el {formatDate(selected.createdAt)}</p>

              {/* Notas del admin (si ya resolvió) */}
              {selected.adminNotes && (
                <div className={`border rounded-lg p-3 ${
                  selected.status === "APPROVED"
                    ? "bg-green-50 border-green-200"
                    : "bg-red-50 border-red-200"
                }`}>
                  <p className={`text-xs font-semibold mb-1 ${selected.status === "APPROVED" ? "text-green-700" : "text-red-700"}`}>
                    {selected.status === "APPROVED" ? "📦 Instrucciones enviadas" : "❌ Motivo de rechazo"}
                  </p>
                  <p className={`text-sm whitespace-pre-line ${selected.status === "APPROVED" ? "text-green-800" : "text-red-800"}`}>
                    {selected.adminNotes}
                  </p>
                </div>
              )}

              {/* ── Acciones: solo si está pendiente ── */}
              {selected.status === "PENDING" && !resolving && (
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => openResolve("APPROVED")}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
                  >
                    ✅ Aprobar
                  </button>
                  <button
                    onClick={() => openResolve("REJECTED")}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
                  >
                    ❌ Rechazar
                  </button>
                </div>
              )}

              {/* ── Formulario de resolución ── */}
              {selected.status === "PENDING" && resolving && (
                <div className={`border rounded-xl p-4 ${resolving === "APPROVED" ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                  <p className={`font-semibold text-sm mb-3 ${resolving === "APPROVED" ? "text-green-800" : "text-red-800"}`}>
                    {resolving === "APPROVED"
                      ? "📦 Instrucciones para envío de la devolución"
                      : "❌ Motivo del rechazo"}
                  </p>
                  <textarea
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    rows={resolving === "APPROVED" ? 6 : 4}
                    placeholder={
                      resolving === "APPROVED"
                        ? "Ej: Enviá el paquete a Av. La Plata 744, Buenos Aires. Usá el servicio Andreani o correo preferido. Colocá en el sobre tu nombre y número de pedido. Cuando lo despachés, envianos el número de seguimiento por WhatsApp..."
                        : "Ej: El producto no puede ser devuelto porque supera los 10 días hábiles desde la recepción."
                    }
                    className="input resize-none mb-3"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleResolve}
                      disabled={saving || !adminNotes.trim()}
                      className={`flex-1 font-semibold py-2.5 rounded-lg text-sm text-white transition-colors disabled:opacity-50 ${
                        resolving === "APPROVED" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
                      }`}
                    >
                      {saving ? "Guardando…" : resolving === "APPROVED" ? "Confirmar aprobación" : "Confirmar rechazo"}
                    </button>
                    <button
                      onClick={() => setResolving(false)}
                      className="btn-secondary text-sm px-4"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </AdminLayout>
  );
}

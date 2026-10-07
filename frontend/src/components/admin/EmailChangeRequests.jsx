import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { customersApi } from "../../services/api";

// Solicitudes de los clientes para cambiar el email de su cuenta (Admin → Emails → Cambios de email).
// Antes era la pestaña "Cambios de Email" de Clientes (AdminCustomers.jsx); se movió tal cual.
export default function EmailChangeRequests() {
  const [emailRequests, setEmailRequests]       = useState([]);
  const [loadingEmailReqs, setLoadingEmailReqs] = useState(false);
  const [rejectModal, setRejectModal]           = useState(null);  // { id }
  const [rejectNotes, setRejectNotes]           = useState("");

  const fetchEmailRequests = async () => {
    setLoadingEmailReqs(true);
    try {
      const res = await customersApi.getAllEmailChangeRequests();
      setEmailRequests(res.data);
    } catch {
      toast.error("Error al cargar solicitudes de email");
    } finally {
      setLoadingEmailReqs(false);
    }
  };

  useEffect(() => { fetchEmailRequests(); }, []);

  const handleApproveEmail = async (id) => {
    if (!confirm("¿Aprobar este cambio de email? El email del cliente se actualizará.")) return;
    try {
      await customersApi.approveEmailChangeRequest(id);
      toast.success("Email actualizado correctamente");
      fetchEmailRequests();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al aprobar");
    }
  };

  const handleRejectEmail = async () => {
    if (!rejectModal) return;
    try {
      await customersApi.rejectEmailChangeRequest(rejectModal.id, rejectNotes);
      toast.success("Solicitud rechazada");
      setRejectModal(null);
      setRejectNotes("");
      fetchEmailRequests();
    } catch {
      toast.error("Error al rechazar");
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-slate-500">
          {loadingEmailReqs ? "Cargando..." : `${emailRequests.filter(r => r.status === "PENDING").length} solicitud(es) pendiente(s)`}
        </p>
        <button onClick={fetchEmailRequests} className="text-xs text-blue-600 hover:underline">
          Actualizar
        </button>
      </div>

      {loadingEmailReqs ? (
        <div className="text-center py-16 text-slate-400">Cargando...</div>
      ) : emailRequests.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">📧</p>
          <p>No hay solicitudes de cambio de email</p>
        </div>
      ) : (
        <div className="space-y-3">
          {emailRequests.map((req) => (
            <div key={req.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-800">{req.customer.name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      req.status === "PENDING"  ? "bg-amber-100 text-amber-700" :
                      req.status === "APPROVED" ? "bg-emerald-100 text-emerald-700" :
                      "bg-red-100 text-red-700"
                    }`}>
                      {req.status === "PENDING" ? "Pendiente" : req.status === "APPROVED" ? "Aprobada" : "Rechazada"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Email actual: <span className="font-medium text-slate-700">{req.customer.email}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    Email solicitado: <span className="font-medium text-blue-700">{req.newEmail}</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Motivo: <span className="italic text-slate-600">"{req.reason}"</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    {new Date(req.createdAt).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })}
                  </p>
                  {req.adminNotes && (
                    <p className="text-xs text-red-500 mt-1">Respuesta: {req.adminNotes}</p>
                  )}
                </div>

                {req.status === "PENDING" && (
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleApproveEmail(req.id)}
                      className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 transition-colors"
                    >
                      Aprobar
                    </button>
                    <button
                      onClick={() => { setRejectModal({ id: req.id }); setRejectNotes(""); }}
                      className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 text-xs font-semibold rounded-lg hover:bg-red-100 transition-colors"
                    >
                      Rechazar
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal rechazo */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-slate-800">Rechazar solicitud</h3>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Motivo del rechazo (opcional)
              </label>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={3}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400 resize-none"
                placeholder="Ej: el email solicitado ya está en uso..."
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRejectModal(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleRejectEmail}
                className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700"
              >
                Confirmar rechazo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

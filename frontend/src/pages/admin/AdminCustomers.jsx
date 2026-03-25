import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import AdminLayout from "../../components/AdminLayout";
import { customersApi, mayoristaRequestsApi, cartsApi } from "../../services/api";

// Badges de estado
const STATUS_BADGE = {
  PENDING:  { label: "Pendiente",  className: "bg-yellow-100 text-yellow-800" },
  APPROVED: { label: "Aprobado",   className: "bg-green-100 text-green-800" },
  REJECTED: { label: "Rechazado",  className: "bg-red-100 text-red-800" },
};

// Badges de tipo
const TYPE_BADGE = {
  MAYORISTA: { label: "Mayorista", className: "bg-purple-100 text-purple-800" },
  MINORISTA: { label: "Minorista", className: "bg-blue-100 text-blue-800" },
};

// Sub-tabs de filtro de clientes por estado
const CUSTOMER_TABS = [
  { key: "",         label: "Todos" },
  { key: "PENDING",  label: "Pendientes" },
  { key: "APPROVED", label: "Aprobados" },
  { key: "REJECTED", label: "Rechazados" },
];

export default function AdminCustomers() {
  const [searchParams] = useSearchParams();
  // El tab activo viene de la URL (?tab=mayorista | ?tab=carts | vacío = lista clientes)
  const mainTab = searchParams.get("tab") || "";

  // ── Estado clientes ──────────────────────────────────────────────────────────
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab] = useState("");
  const [search, setSearch]       = useState("");

  // ── Estado solicitudes mayorista ─────────────────────────────────────────────
  const [mayoristaRequests, setMayoristaRequests]           = useState([]);
  const [loadingRequests, setLoadingRequests]               = useState(false);
  const [mayoristaFilter, setMayoristaFilter]               = useState("PENDING");

  // ── Estado carritos activos ───────────────────────────────────────────────────
  const [carts, setCarts]               = useState([]);
  const [loadingCarts, setLoadingCarts] = useState(false);
  const [expandedCart, setExpandedCart] = useState(null);    // id del carrito expandido
  const [confirmClear, setConfirmClear] = useState(null);    // id del carrito pendiente de confirmar limpiar

  // Modal de notas/rechazo (solo para clientes PENDING)
  const [notesModal, setNotesModal] = useState(null); // { customer }
  const [notesText, setNotesText]   = useState("");

  // Modal de edición completa (para clientes APPROVED / REJECTED)
  const [editModal, setEditModal] = useState(null); // { ...customer fields }

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const params = {};
      if (activeTab) params.status = activeTab;
      if (search)    params.search = search;
      const res = await customersApi.getAll(params);
      setCustomers(res.data);
    } catch {
      toast.error("Error al cargar clientes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const fetchMayoristaRequests = async () => {
    setLoadingRequests(true);
    try {
      const params = mayoristaFilter ? { status: mayoristaFilter } : {};
      const res = await mayoristaRequestsApi.getAll(params);
      setMayoristaRequests(res.data);
    } catch {
      toast.error("Error al cargar solicitudes");
    } finally {
      setLoadingRequests(false);
    }
  };

  useEffect(() => {
    if (mainTab === "mayorista") fetchMayoristaRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, mayoristaFilter]);  // mainTab viene de URL, se actualiza al navegar

  const fetchCarts = async (silent = false) => {
    // silent=true evita mostrar el spinner en los refrescos automáticos del polling
    if (!silent) setLoadingCarts(true);
    try {
      const res = await cartsApi.getAll();
      setCarts(res.data);
    } catch {
      toast.error("Error al cargar carritos");
    } finally {
      if (!silent) setLoadingCarts(false);
    }
  };

  useEffect(() => {
    if (mainTab !== "carts") return;

    // Carga inicial con spinner
    fetchCarts();

    // Polling cada 5 segundos para ver cambios en tiempo real
    const interval = setInterval(() => fetchCarts(true), 5000);

    // Limpiamos el intervalo al salir de la tab o desmontar el componente
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  const handleClearCart = async (customerId) => {
    try {
      await cartsApi.clearCart(customerId);
      toast.success("Carrito limpiado");
      setConfirmClear(null);
      fetchCarts(true);
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al limpiar carrito");
    }
  };

  const handleDeleteItem = async (itemId) => {
    try {
      await cartsApi.deleteItem(itemId);
      fetchCarts(true);
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al eliminar item");
    }
  };

  const handleUpdateItemQty = async (itemId, quantity) => {
    if (quantity < 1) return;
    try {
      await cartsApi.updateItem(itemId, quantity);
      fetchCarts(true);
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al actualizar cantidad");
    }
  };

  const handleApproveRequest = async (req) => {
    try {
      await mayoristaRequestsApi.approve(req.id);
      toast.success(`${req.customer.name} ahora es Mayorista`);
      fetchMayoristaRequests();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al aprobar");
    }
  };

  const handleRejectRequest = async (req) => {
    try {
      await mayoristaRequestsApi.reject(req.id);
      toast.success("Solicitud rechazada");
      fetchMayoristaRequests();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al rechazar");
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    fetchCustomers();
  };

  // Aprobar directamente desde la fila (solo para PENDING)
  const handleApprove = async (customer) => {
    try {
      await customersApi.updateStatus(customer.id, "APPROVED");
      toast.success(`${customer.name} aprobado`);
      fetchCustomers();
    } catch {
      toast.error("Error al aprobar cliente");
    }
  };

  // Abrir modal de rechazo con nota (solo para PENDING)
  const openRejectModal = (customer) => {
    setNotesModal({ customer });
    setNotesText("");
  };

  // Confirmar rechazo con nota opcional
  const handleConfirmReject = async () => {
    if (!notesModal) return;
    try {
      await customersApi.updateStatus(notesModal.customer.id, "REJECTED", notesText);
      toast.success(`${notesModal.customer.name} rechazado`);
      setNotesModal(null);
      fetchCustomers();
    } catch {
      toast.error("Error al rechazar cliente");
    }
  };

  // Abrir modal de edición (para APPROVED / REJECTED)
  const openEditModal = (customer) => {
    setEditModal({
      id:      customer.id,
      name:    customer.name,
      phone:   customer.phone    || "",
      company: customer.company  || "",
      type:    customer.type,
      status:  customer.status,
      notes:   customer.notes    || "",
    });
  };

  // Guardar edición completa
  const handleSaveEdit = async () => {
    if (!editModal) return;
    try {
      await customersApi.update(editModal.id, {
        name:    editModal.name,
        phone:   editModal.phone,
        company: editModal.company,
        type:    editModal.type,
        status:  editModal.status,
        notes:   editModal.notes,
      });
      toast.success("Cliente actualizado");
      setEditModal(null);
      fetchCustomers();
    } catch {
      toast.error("Error al actualizar cliente");
    }
  };

  // Eliminar
  const handleDelete = async (customer) => {
    if (!confirm(`¿Eliminar a ${customer.name}? Esta acción no se puede deshacer.`)) return;
    try {
      await customersApi.delete(customer.id);
      toast.success("Cliente eliminado");
      fetchCustomers();
    } catch {
      toast.error("Error al eliminar cliente");
    }
  };

  // En "Todos" se excluyen los rechazados (aparecen solo en su tab)
  const displayedCustomers = activeTab === ""
    ? customers.filter((c) => c.status !== "REJECTED")
    : customers;

  // Contar pendientes para badge en tab
  const pendingCount = customers.filter((c) => c.status === "PENDING").length;

  // Solicitudes mayoristas PENDING para badge en la pestaña principal
  const pendingRequestsCount = mayoristaRequests.filter((r) => r.status === "PENDING").length;

  return (
    <AdminLayout title="Clientes">
      {/* ══ Panel Solicitudes Mayorista ══ */}
      {mainTab === "mayorista" && (
        <>
          {/* Filtro de estado */}
          <div className="flex gap-2 mb-6">
            {[
              { key: "PENDING",  label: "Pendientes" },
              { key: "APPROVED", label: "Aprobadas" },
              { key: "REJECTED", label: "Rechazadas" },
              { key: "",         label: "Todas" },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setMayoristaFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  mayoristaFilter === f.key
                    ? "bg-purple-100 text-purple-700"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {loadingRequests ? (
            <div className="text-center py-16 text-slate-400">Cargando...</div>
          ) : mayoristaRequests.length === 0 ? (
            <div className="text-center py-16 text-slate-400">No hay solicitudes en esta sección</div>
          ) : (
            <div className="space-y-3">
              {mayoristaRequests.map((req) => (
                <div key={req.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-800">{req.customer.name}</p>
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                          {req.customer.type === "MAYORISTA" ? "Mayorista" : "Minorista"}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          req.status === "PENDING"  ? "bg-yellow-100 text-yellow-700" :
                          req.status === "APPROVED" ? "bg-green-100 text-green-700"  :
                          "bg-red-100 text-red-700"
                        }`}>
                          {req.status === "PENDING" ? "Pendiente" : req.status === "APPROVED" ? "Aprobada" : "Rechazada"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{req.customer.email}</p>
                      {req.customer.phone && (
                        <p className="text-xs text-slate-400">{req.customer.phone}</p>
                      )}
                      {req.message && (
                        <p className="text-sm text-slate-600 mt-2 bg-slate-50 rounded-lg px-3 py-2 italic">
                          "{req.message}"
                        </p>
                      )}
                      <p className="text-xs text-slate-300 mt-2">
                        {new Date(req.createdAt).toLocaleDateString("es-AR", {
                          day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
                        })}
                      </p>
                    </div>

                    {/* Acciones solo para PENDING */}
                    {req.status === "PENDING" && (
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleApproveRequest(req)}
                          className="bg-green-100 text-green-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-200 transition-colors"
                        >
                          Aprobar
                        </button>
                        <button
                          onClick={() => handleRejectRequest(req)}
                          className="bg-red-100 text-red-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-200 transition-colors"
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
        </>
      )}

      {/* ══ Panel Clientes ══ (mainTab vacío = /admin/clientes sin ?tab) */}
      {mainTab === "" && (<>

      {/* Sub-tabs de filtro por estado */}
      <div className="flex gap-2 mb-6 border-b border-slate-100">
        {CUSTOMER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
            {tab.key === "PENDING" && pendingCount > 0 && activeTab !== "PENDING" && (
              <span className="ml-2 bg-yellow-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Buscador */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, email o empresa..."
          className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Buscar
        </button>
      </form>

      {/* Tabla */}
      {loading ? (
        <div className="text-center py-16 text-slate-400">Cargando...</div>
      ) : displayedCustomers.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No hay clientes en esta sección</div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500 text-xs uppercase tracking-wide">
                <th className="px-5 py-3.5">Cliente</th>
                <th className="px-5 py-3.5">Teléfono</th>
                <th className="px-5 py-3.5">Empresa</th>
                <th className="px-5 py-3.5">Tipo</th>
                <th className="px-5 py-3.5">Estado</th>
                <th className="px-5 py-3.5">Fecha</th>
                <th className="px-5 py-3.5">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedCustomers.map((c) => {
                const status = STATUS_BADGE[c.status];
                const type   = TYPE_BADGE[c.type];
                return (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    {/* Nombre + email */}
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-800">{c.name}</p>
                      <p className="text-slate-400 text-xs">{c.email}</p>
                      {c.notes && (
                        <p className="text-orange-500 text-xs mt-0.5 italic">📝 {c.notes}</p>
                      )}
                    </td>

                    {/* Teléfono */}
                    <td className="px-5 py-4 text-slate-600">{c.phone || "—"}</td>

                    {/* Empresa */}
                    <td className="px-5 py-4 text-slate-600">{c.company || "—"}</td>

                    {/* Tipo: solo badge estático, editable desde el modal */}
                    <td className="px-5 py-4">
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${type.className}`}>
                        {type.label}
                      </span>
                    </td>

                    {/* Estado */}
                    <td className="px-5 py-4">
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${status.className}`}>
                        {status.label}
                      </span>
                    </td>

                    {/* Fecha */}
                    <td className="px-5 py-4 text-slate-400 text-xs">
                      {new Date(c.createdAt).toLocaleDateString("es-AR")}
                    </td>

                    {/* Acciones: PENDING → Aprobar + Rechazar | APPROVED/REJECTED → Editar + Eliminar */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        {c.status === "PENDING" ? (
                          <>
                            <button
                              onClick={() => handleApprove(c)}
                              className="bg-green-100 text-green-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-200 transition-colors"
                            >
                              Aprobar
                            </button>
                            <button
                              onClick={() => openRejectModal(c)}
                              className="bg-red-100 text-red-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-200 transition-colors"
                            >
                              Rechazar
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => openEditModal(c)}
                            className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-200 transition-colors"
                          >
                            Editar
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(c)}
                          className="bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-200 transition-colors"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de rechazo con nota (solo para PENDING) */}
      {notesModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-slate-800 mb-1">Rechazar cliente</h3>
            <p className="text-sm text-slate-500 mb-4">
              Vas a rechazar a <strong>{notesModal.customer.name}</strong>. Podés agregar una nota
              interna (opcional).
            </p>
            <textarea
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
              placeholder="Motivo del rechazo (uso interno)..."
              rows={3}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400 mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setNotesModal(null)}
                className="px-4 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmReject}
                className="bg-red-600 text-white px-5 py-2 rounded-xl text-sm font-medium hover:bg-red-700 transition-colors"
              >
                Confirmar rechazo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de edición completa (para APPROVED / REJECTED) */}
      {editModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Editar cliente</h3>

            <div className="grid grid-cols-2 gap-4 mb-4">
              {/* Nombre */}
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre</label>
                <input
                  type="text"
                  value={editModal.name}
                  onChange={(e) => setEditModal({ ...editModal, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Teléfono */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
                <input
                  type="text"
                  value={editModal.phone}
                  onChange={(e) => setEditModal({ ...editModal, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Empresa */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Empresa</label>
                <input
                  type="text"
                  value={editModal.company}
                  onChange={(e) => setEditModal({ ...editModal, company: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Tipo */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
                <select
                  value={editModal.type}
                  onChange={(e) => setEditModal({ ...editModal, type: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="MAYORISTA">Mayorista</option>
                  <option value="MINORISTA">Minorista</option>
                </select>
              </div>

              {/* Estado */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Estado</label>
                <select
                  value={editModal.status}
                  onChange={(e) => setEditModal({ ...editModal, status: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="PENDING">Pendiente</option>
                  <option value="APPROVED">Aprobado</option>
                  <option value="REJECTED">Rechazado</option>
                </select>
              </div>

              {/* Notas internas */}
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Notas internas</label>
                <textarea
                  value={editModal.notes}
                  onChange={(e) => setEditModal({ ...editModal, notes: e.target.value })}
                  rows={2}
                  placeholder="Notas internas (opcional)..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setEditModal(null)}
                className="px-4 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEdit}
                className="bg-blue-600 text-white px-5 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Guardar cambios
              </button>
            </div>
          </div>
        </div>
      )}
      </>)}

      {/* ══ Panel Carritos Activos ══ */}
      {mainTab === "carts" && (
        <>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <p className="text-sm text-slate-500">
                {loadingCarts ? "Cargando..." : `${carts.length} carrito${carts.length !== 1 ? "s" : ""} activo${carts.length !== 1 ? "s" : ""}`}
              </p>
              {/* Indicador de actualización en tiempo real */}
              <span className="flex items-center gap-1 text-xs text-green-600">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                En vivo
              </span>
            </div>
            <button
              onClick={() => fetchCarts()}
              className="text-xs text-blue-600 hover:underline"
            >
              Actualizar ahora
            </button>
          </div>

          {loadingCarts ? (
            <div className="text-center py-16 text-slate-400">Cargando...</div>
          ) : carts.length === 0 ? (
            <div className="text-center py-16 text-slate-400">No hay carritos activos en este momento</div>
          ) : (
            <div className="space-y-3">
              {carts.map((cart) => {
                const total = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
                const totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
                const isExpanded = expandedCart === cart.id;

                return (
                  <div key={cart.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    {/* Cabecera del carrito */}
                    <div className="flex items-center justify-between gap-4 p-5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-800">{cart.customer.name}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            cart.customer.type === "MAYORISTA"
                              ? "bg-purple-100 text-purple-700"
                              : "bg-blue-100 text-blue-700"
                          }`}>
                            {cart.customer.type === "MAYORISTA" ? "Mayorista" : "Minorista"}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{cart.customer.email}</p>
                        {cart.customer.phone && (
                          <p className="text-xs text-slate-400">{cart.customer.phone}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-xs text-slate-500">
                            🛒 {totalItems} producto{totalItems !== 1 ? "s" : ""}
                          </span>
                          <span className="text-sm font-semibold text-slate-800">
                            ${total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                          </span>
                          <span className="text-xs text-slate-300">
                            Actualizado: {new Date(cart.updatedAt).toLocaleString("es-AR", {
                              day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                            })}
                          </span>
                        </div>
                      </div>

                      <div className="flex gap-2 flex-shrink-0 items-center">
                        <button
                          onClick={() => setExpandedCart(isExpanded ? null : cart.id)}
                          className="bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-200 transition-colors"
                        >
                          {isExpanded ? "Ocultar" : "Ver items"}
                        </button>

                        {/* Confirmación inline sin confirm() del browser */}
                        {confirmClear === cart.id ? (
                          <div className="flex gap-1 items-center">
                            <span className="text-xs text-slate-500">¿Confirmar?</span>
                            <button
                              onClick={() => handleClearCart(cart.customer.id)}
                              className="bg-red-600 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-red-700 transition-colors"
                            >
                              Sí
                            </button>
                            <button
                              onClick={() => setConfirmClear(null)}
                              className="bg-slate-200 text-slate-600 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-300 transition-colors"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmClear(cart.id)}
                            className="bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-200 transition-colors"
                          >
                            Limpiar
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Items expandibles */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 divide-y divide-slate-50">
                        {cart.items.map((item) => (
                          <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                            {/* Imagen del producto */}
                            {item.image ? (
                              <img
                                src={item.image.startsWith("http") ? item.image : `${import.meta.env.VITE_API_URL || "http://localhost:4000"}${item.image}`}
                                alt={item.name}
                                className="w-10 h-10 object-cover rounded-lg bg-slate-100 flex-shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 text-slate-300 text-lg">
                                📦
                              </div>
                            )}

                            {/* Nombre y precio unitario */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate">{item.name}</p>
                              <p className="text-xs text-slate-400">
                                ${item.price.toLocaleString("es-AR", { minimumFractionDigits: 2 })} c/u
                              </p>
                            </div>

                            {/* Controles de cantidad */}
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                onClick={() => handleUpdateItemQty(item.id, item.quantity - 1)}
                                disabled={item.quantity <= 1}
                                className="w-6 h-6 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-bold transition-colors"
                              >
                                −
                              </button>
                              <span className="w-8 text-center text-sm font-medium text-slate-700">
                                {item.quantity}
                              </span>
                              <button
                                onClick={() => handleUpdateItemQty(item.id, item.quantity + 1)}
                                className="w-6 h-6 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 text-sm font-bold transition-colors"
                              >
                                +
                              </button>
                            </div>

                            {/* Subtotal */}
                            <p className="text-sm font-semibold text-slate-700 flex-shrink-0 w-24 text-right">
                              ${(item.price * item.quantity).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                            </p>

                            {/* Botón eliminar item */}
                            <button
                              onClick={() => handleDeleteItem(item.id)}
                              className="flex-shrink-0 text-slate-300 hover:text-red-500 transition-colors text-lg leading-none"
                              title="Eliminar item"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        {/* Total del carrito */}
                        <div className="flex justify-end px-5 py-3 bg-slate-50">
                          <p className="text-sm font-bold text-slate-800">
                            Total: ${total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </AdminLayout>
  );
}

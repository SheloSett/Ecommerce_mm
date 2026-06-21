import { useState, useEffect, useCallback } from "react";
import AdminLayout from "../../components/AdminLayout";
import { suppliersApi } from "../../services/api";
import toast from "react-hot-toast";

// ABM de proveedores. Vive en /admin/compras/proveedores (dropdown "Compras" del sidebar).
// Reutiliza suppliersApi (getAll/create/update/remove). Los proveedores son internos del admin.
export default function AdminSuppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);

  // Estado del modal de alta/edición. editing = null → alta; editing = {id,...} → edición.
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState({ name: "", street: "", phone: "" });

  const load = useCallback(() => {
    setLoading(true);
    suppliersApi
      .getAll()
      .then((res) => setSuppliers(res.data))
      .catch(() => toast.error("Error al cargar proveedores"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", street: "", phone: "" });
    setShowForm(true);
  };

  const openEdit = (s) => {
    setEditing(s);
    setForm({ name: s.name || "", street: s.street || "", phone: s.phone || "" });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("El nombre del proveedor es requerido");

    const payload = {
      name:   form.name.trim(),
      street: form.street.trim() || null,
      phone:  form.phone.trim() || null,
    };

    setSaving(true);
    try {
      if (editing) {
        await suppliersApi.update(editing.id, payload);
        toast.success("Proveedor actualizado");
      } else {
        await suppliersApi.create(payload);
        toast.success("Proveedor creado");
      }
      closeForm();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al guardar el proveedor");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s) => {
    const productCount = s._count?.products ?? 0;
    const warning = productCount > 0
      ? `\n\n${productCount} producto(s) quedarán SIN proveedor (no se borran).`
      : "";
    if (!window.confirm(`¿Eliminar el proveedor "${s.name}"?${warning}`)) return;

    try {
      const res = await suppliersApi.remove(s.id);
      const unlinked = res.data?.unlinkedProducts ?? 0;
      toast.success(
        unlinked > 0
          ? `Proveedor eliminado · ${unlinked} producto(s) desvinculado(s)`
          : "Proveedor eliminado"
      );
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al eliminar el proveedor");
    }
  };

  return (
    <AdminLayout title="Proveedores">
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-slate-500 max-w-xl">
            Administrá tus proveedores. Podés crearlos también desde el formulario de un producto;
            acá completás datos opcionales como la calle y el teléfono.
          </p>
          <button
            onClick={openCreate}
            className="flex-shrink-0 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Nuevo proveedor
          </button>
        </div>

        {/* Tabla de proveedores */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-bold text-slate-800">Lista de proveedores</h2>
            <span className="text-sm text-slate-400">{suppliers.length} registros</span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : suppliers.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <p className="text-4xl mb-2">🚚</p>
              <p className="text-sm">No hay proveedores cargados todavía</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: "560px" }}>
                <thead>
                  <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide border-b border-slate-200">
                    <th className="px-4 py-3 text-left">Nombre</th>
                    <th className="px-4 py-3 text-left">Calle</th>
                    <th className="px-4 py-3 text-left">Teléfono</th>
                    <th className="px-4 py-3 text-right">Productos</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-800">{s.name}</td>
                      <td className="px-4 py-3 text-slate-600">{s.street || "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{s.phone || "—"}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{s._count?.products ?? 0}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => openEdit(s)}
                            className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-semibold"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleDelete(s)}
                            className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 text-xs font-semibold"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal alta/edición */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">
                {editing ? "Editar proveedor" : "Nuevo proveedor"}
              </h2>
              <button type="button" onClick={closeForm} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Nombre del proveedor"
                className="input"
                autoFocus
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Calle <span className="text-slate-400 font-normal">(opcional)</span></label>
              <input
                type="text"
                value={form.street}
                onChange={(e) => setForm({ ...form, street: e.target.value })}
                placeholder="Ej: Av. Siempre Viva 742"
                className="input"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Teléfono <span className="text-slate-400 font-normal">(opcional)</span></label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Ej: 11 2345-6789"
                className="input"
              />
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear proveedor"}
              </button>
            </div>
          </form>
        </div>
      )}
    </AdminLayout>
  );
}

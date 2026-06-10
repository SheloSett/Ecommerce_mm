import { useState } from "react";
import { suppliersApi } from "../../services/api";
import toast from "react-hot-toast";

// Campos de depósito (módulo + estante) y proveedor de un producto.
// Compartido entre AdminProductCreate y el modal de edición de AdminProducts.
// Solo se muestra en el panel admin — estos datos no se exponen a los clientes.
//
// Props:
//  - form / setForm: estado del formulario del producto (usa form.supplierId, form.module, form.shelf)
//  - suppliers / setSuppliers: lista de proveedores (setSuppliers se usa para refrescar tras crear uno nuevo)
export default function WarehouseSupplierFields({ form, setForm, suppliers, setSuppliers }) {
  // Mini-formulario inline "Nuevo proveedor" (igual patrón que el de categorías)
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [savingSupplier, setSavingSupplier] = useState(false);

  const handleCreateSupplier = async () => {
    const name = newSupplierName.trim();
    if (!name) return;
    setSavingSupplier(true);
    try {
      const res = await suppliersApi.create({ name });
      const created = res.data;
      // Recargar la lista para que aparezca el nuevo proveedor y seleccionarlo automáticamente
      const listRes = await suppliersApi.getAll();
      setSuppliers(listRes.data);
      setForm((f) => ({ ...f, supplierId: created.id.toString() }));
      setNewSupplierName("");
      setShowNewSupplier(false);
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al crear el proveedor");
    } finally {
      setSavingSupplier(false);
    }
  };

  return (
    <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-700">📦 Depósito y proveedor</span>
        <span className="text-xs text-slate-400">— solo visible para el admin</span>
      </div>

      {/* Proveedor: select de existentes + creación inline */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Proveedor</label>
        {!showNewSupplier ? (
          <div className="flex gap-2">
            <select
              value={form.supplierId || ""}
              onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
              className="input flex-1 bg-white"
            >
              <option value="">Sin proveedor</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowNewSupplier(true)}
              className="whitespace-nowrap text-sm font-semibold text-blue-600 border border-blue-200 rounded-lg px-3 hover:bg-blue-50 transition-colors"
            >
              + Nuevo
            </button>
          </div>
        ) : (
          <div className="border border-blue-200 rounded-lg p-3 bg-blue-50 space-y-2">
            <p className="text-xs font-semibold text-blue-700">Nuevo proveedor</p>
            <input
              type="text"
              placeholder="Nombre del proveedor"
              value={newSupplierName}
              onChange={(e) => setNewSupplierName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreateSupplier();
                }
              }}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCreateSupplier}
                disabled={savingSupplier || !newSupplierName.trim()}
                className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-semibold"
              >
                {savingSupplier ? "Creando..." : "Crear"}
              </button>
              <button
                type="button"
                onClick={() => { setShowNewSupplier(false); setNewSupplierName(""); }}
                className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 bg-white"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Módulo + Estante: lado a lado — representan dónde está físicamente el artículo en el depósito */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Ubicación física en el depósito</label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Módulo</label>
            <input
              type="text"
              value={form.module || ""}
              onChange={(e) => setForm({ ...form, module: e.target.value })}
              placeholder="Ej: A3"
              className="input bg-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Estante</label>
            <input
              type="text"
              value={form.shelf || ""}
              onChange={(e) => setForm({ ...form, shelf: e.target.value })}
              placeholder="Ej: 2"
              className="input bg-white"
            />
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Dónde está guardado el artículo en el depósito. Aparece al imprimir la orden para facilitar la separación del pedido.
        </p>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import AdminLayout from "../../components/AdminLayout";
import { categoriesApi } from "../../services/api";
import toast from "react-hot-toast";

export default function AdminCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCat, setEditingCat] = useState(null);
  const [name, setName] = useState("");
  // parentId: null = categoría raíz; número = subcategoría del padre seleccionado
  const [parentId, setParentId] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchCategories = () => {
    setLoading(true);
    categoriesApi
      .getAll()
      .then((res) => setCategories(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const openCreate = () => {
    setEditingCat(null);
    setName("");
    setParentId("");
    setShowModal(true);
  };

  const openEdit = (cat) => {
    setEditingCat(cat);
    setName(cat.name);
    // Si la categoría tiene padre, pre-seleccionarlo en el dropdown
    setParentId(cat.parentId ? String(cat.parentId) : "");
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      // parentId vacío se envía como null (categoría raíz)
      const data = { name, parentId: parentId ? parseInt(parentId) : null };

      if (editingCat) {
        await categoriesApi.update(editingCat.id, data);
        toast.success("Categoría actualizada");
      } else {
        await categoriesApi.create(data);
        toast.success("Categoría creada");
      }
      setShowModal(false);
      fetchCategories();
    } catch (err) {
      const msg = err.response?.data?.error || "Error al guardar";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cat) => {
    if (!confirm(`¿Eliminar la categoría "${cat.name}"?`)) return;
    try {
      await categoriesApi.delete(cat.id);
      toast.success("Categoría eliminada");
      fetchCategories();
    } catch (err) {
      const msg = err.response?.data?.error || "Error al eliminar";
      toast.error(msg);
    }
  };

  // Categorías raíz para el dropdown de "padre" en el modal (excluye la que se está editando)
  const rootCategories = categories.filter((c) => !editingCat || c.id !== editingCat.id);

  return (
    <AdminLayout title="Categorías">
      <div className="space-y-6">
        <div className="flex justify-end">
          <button onClick={openCreate} className="btn-primary">
            + Nueva categoría
          </button>
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 text-xs uppercase tracking-wide border-b border-slate-200 bg-slate-50">
                <th className="px-6 py-3">Nombre</th>
                <th className="px-6 py-3">Slug</th>
                <th className="px-6 py-3">Productos</th>
                <th className="px-6 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
                  </td>
                </tr>
              ) : categories.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-400">
                    No hay categorías. ¡Crea la primera!
                  </td>
                </tr>
              ) : (
                // Renderizar categorías raíz y sus subcategorías anidadas
                categories.map((cat) => (
                  <>
                    {/* Fila de categoría principal */}
                    <tr key={cat.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-6 py-3 font-semibold text-slate-800">{cat.name}</td>
                      <td className="px-6 py-3 font-mono text-slate-500 text-xs">{cat.slug}</td>
                      <td className="px-6 py-3 text-slate-600">{cat._count?.products || 0}</td>
                      <td className="px-6 py-3">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => openEdit(cat)}
                            className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleDelete(cat)}
                            className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 text-xs font-semibold"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Filas de subcategorías: indentadas con borde izquierdo */}
                    {cat.children && cat.children.map((sub) => (
                      <tr key={sub.id} className="border-b border-slate-50 hover:bg-slate-50 bg-slate-50/50">
                        <td className="px-6 py-2.5">
                          <div className="flex items-center gap-2 pl-4 border-l-2 border-blue-200">
                            <span className="text-blue-400 text-xs">↳</span>
                            <span className="text-slate-700 font-medium">{sub.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-2.5 font-mono text-slate-400 text-xs">{sub.slug}</td>
                        <td className="px-6 py-2.5 text-slate-500">{sub._count?.products || 0}</td>
                        <td className="px-6 py-2.5">
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => openEdit({ ...sub, parentId: cat.id })}
                              className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => handleDelete(sub)}
                              className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 text-xs font-semibold"
                            >
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal crear/editar */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-bold text-slate-800">
                {editingCat ? "Editar categoría" : "Nueva categoría"}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input"
                  placeholder="Ej: Cables USB"
                  required
                  autoFocus
                />
              </div>

              {/* Selector de categoría padre (opcional) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Categoría padre <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="input"
                >
                  <option value="">— Sin padre (categoría principal) —</option>
                  {rootCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  Si seleccionás una categoría padre, esta se creará como subcategoría.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary flex-1"
                >
                  Cancelar
                </button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? "Guardando..." : editingCat ? "Guardar" : "Crear"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

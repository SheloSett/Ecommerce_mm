import { useState, useEffect } from "react";
import AdminLayout from "../../components/AdminLayout";
import { categoriesApi, productsApi, getImageUrl } from "../../services/api";
import toast from "react-hot-toast";

const formatPrice = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n ?? 0);

// Badge del conteo: si hay productos, es un botón clickeable (abre el modal con la lista).
function CountBadge({ count, onClick }) {
  if (!count) return <span className="text-slate-400 text-xs">0</span>;
  return (
    <button
      onClick={onClick}
      title="Ver productos vinculados"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold transition-colors"
    >
      {count}
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
  );
}

export default function AdminCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCat, setEditingCat] = useState(null);
  const [name, setName] = useState("");
  // parentId: null = categoría raíz; número = subcategoría del padre seleccionado
  const [parentId, setParentId] = useState("");
  // hidden: los productos de esta categoría no se mezclan en el listado general del catálogo
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);

  // Modal "ver productos vinculados" a una categoría
  const [viewingCat, setViewingCat] = useState(null);
  const [catProducts, setCatProducts] = useState([]);
  const [loadingCatProducts, setLoadingCatProducts] = useState(false);

  // Abre el modal y trae los productos vinculados a esa categoría (por slug).
  const openProducts = async (cat) => {
    setViewingCat(cat);
    setCatProducts([]);
    setLoadingCatProducts(true);
    try {
      const res = await productsApi.getAllAdmin({ category: cat.slug, limit: 100 });
      setCatProducts(res.data.products || []);
    } catch {
      toast.error("No se pudieron cargar los productos");
    } finally {
      setLoadingCatProducts(false);
    }
  };

  const fetchCategories = () => {
    setLoading(true);
    categoriesApi
      // all: true → cuenta TODOS los productos vinculados (activos + inactivos), no solo los visibles
      .getAll({ all: true })
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
    setHidden(false);
    setShowModal(true);
  };

  const openEdit = (cat) => {
    setEditingCat(cat);
    setName(cat.name);
    // Si la categoría tiene padre, pre-seleccionarlo en el dropdown
    setParentId(cat.parentId ? String(cat.parentId) : "");
    setHidden(cat.hidden === true);
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      // parentId vacío se envía como null (categoría raíz)
      const data = { name, parentId: parentId ? parseInt(parentId) : null, hidden };

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
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3 hidden sm:table-cell">Slug</th>
                <th className="px-4 py-3 table-cell">Productos</th>
                <th className="px-4 py-3 text-right">Acciones</th>
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
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {cat.name}
                        {/* Badge para las categorías ocultas del catálogo general */}
                        {cat.hidden && (
                          <span
                            className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 align-middle"
                            title="Sus productos no aparecen en el catálogo general — solo eligiendo esta categoría o buscándolos"
                          >
                            🙈 Oculta
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-500 text-xs hidden sm:table-cell">{cat.slug}</td>
                      <td className="px-4 py-3 table-cell">
                        <CountBadge count={cat._count?.products || 0} onClick={() => openProducts(cat)} />
                      </td>
                      <td className="px-4 py-3">
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
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2 pl-4 border-l-2 border-blue-200">
                            <span className="text-blue-400 text-xs">↳</span>
                            <span className="text-slate-700 font-medium">{sub.name}</span>
                            {sub.hidden && (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200"
                                title="Sus productos no aparecen en el catálogo general — solo eligiendo esta categoría o buscándolos"
                              >
                                🙈 Oculta
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-400 text-xs hidden sm:table-cell">{sub.slug}</td>
                        <td className="px-4 py-2.5 table-cell">
                          <CountBadge count={sub._count?.products || 0} onClick={() => openProducts(sub)} />
                        </td>
                        <td className="px-4 py-2.5">
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

      {/* Modal "ver productos vinculados" */}
      {viewingCat && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setViewingCat(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div className="min-w-0">
                <h2 className="font-bold text-slate-800 truncate">Productos en “{viewingCat.name}”</h2>
                <p className="text-xs text-slate-500">
                  {loadingCatProducts ? "Cargando…" : `${catProducts.length} producto${catProducts.length !== 1 ? "s" : ""} vinculado${catProducts.length !== 1 ? "s" : ""}`}
                </p>
              </div>
              <button onClick={() => setViewingCat(null)} className="p-2 hover:bg-slate-100 rounded-lg shrink-0">✕</button>
            </div>
            <div className="p-4 overflow-y-auto">
              {loadingCatProducts ? (
                <div className="py-12 flex justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                </div>
              ) : catProducts.length === 0 ? (
                <p className="text-center text-slate-400 py-8 text-sm">No hay productos en esta categoría.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {catProducts.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-2.5">
                      {p.images?.[0] ? (
                        <img src={getImageUrl(p.images[0])} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">📦</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                        <p className="text-xs text-slate-400">{formatPrice(p.price)}{p.sku ? ` · ${p.sku}` : ""}</p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${p.active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>
                        {p.active ? "Activo" : "Inactivo"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

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

              {/* Ocultar del catálogo general: los productos de esta categoría no se mezclan con
                  el resto. Solo se acceden eligiendo esta categoría o buscándolos. */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hidden}
                    onChange={(e) => setHidden(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-blue-600 cursor-pointer"
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-700">
                      Ocultar del catálogo general
                    </span>
                    <span className="block text-xs text-slate-400 mt-0.5 leading-snug">
                      Sus productos no aparecen en “Todos los productos” ni navegando el catálogo.
                      La categoría sigue visible en los filtros: elegirla es la forma de verlos.
                      La búsqueda los encuentra igual.
                    </span>
                  </span>
                </label>
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

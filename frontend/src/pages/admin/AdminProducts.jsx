import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import AdminLayout from "../../components/AdminLayout";
import { productsApi, categoriesApi, getImageUrl } from "../../services/api";
import toast from "react-hot-toast";

const EMPTY_FORM = {
  name: "",
  description: "",
  cost: "",
  price: "",
  salePrice: "",
  wholesalePrice: "",
  wholesaleSalePrice: "",
  minQuantity: "1",
  stock: "",
  stockUnlimited: false,
  stockBreak: "",
  // priceTiers: array de { minQty, price } para descuentos por cantidad (minoristas)
  priceTiers: [],
  // wholesalePriceTiers: igual que priceTiers pero para clientes MAYORISTA
  wholesalePriceTiers: [],
  sku: "",
  youtubeUrl: "",
  weight: "",
  length: "",
  width: "",
  height: "",
  // categoryId: "",  // Reemplazado por categoryIds (array M2M)
  categoryIds: [],
  featured: false,
  active: true,
  visibility: "AMBOS",
};

// Genera el breadcrumb de una categoría: "Padre > Hijo" o solo "Nombre"
function getCategoryBreadcrumb(category) {
  if (!category) return null;
  if (category.parent) return `${category.parent.name} > ${category.name}`;
  return category.name;
}

// Lista los breadcrumbs de todas las categorías de un producto, separados por " · "
function getProductCategoryLabels(categories) {
  if (!categories || categories.length === 0) return null;
  return categories.map(getCategoryBreadcrumb).join(" · ");
}

// Genera un SKU simple a partir del nombre del producto (slug-like)
function nameToSku(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .substring(0, 30);
}

// Editor de niveles de precio por cantidad (reutilizable para minoristas y mayoristas)
function TierEditor({ label, tiers, fieldKey, setForm }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-slate-700">
          {label}
          <span className="ml-1 text-xs font-normal text-slate-400">— opcional</span>
        </label>
        <button
          type="button"
          onClick={() => setForm((f) => ({ ...f, [fieldKey]: [...f[fieldKey], { minQty: "", price: "" }] }))}
          className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
        >
          + Agregar nivel
        </button>
      </div>
      {tiers.length === 0 ? (
        <p className="text-xs text-slate-400 italic">Sin descuentos por cantidad configurados.</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-3 py-2 text-left font-semibold">Desde (unidades)</th>
                <th className="px-3 py-2 text-left font-semibold">Precio unitario</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier, idx) => (
                <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 text-xs">+</span>
                      <input
                        type="number"
                        min="1"
                        value={tier.minQty}
                        onChange={(e) =>
                          setForm((f) => {
                            const updated = [...f[fieldKey]];
                            updated[idx] = { ...updated[idx], minQty: e.target.value };
                            return { ...f, [fieldKey]: updated };
                          })
                        }
                        placeholder="ej: 10"
                        className="w-24 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <span className="text-xs text-slate-400">unid.</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 text-sm">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={tier.price}
                        onChange={(e) =>
                          setForm((f) => {
                            const updated = [...f[fieldKey]];
                            updated[idx] = { ...updated[idx], price: e.target.value };
                            return { ...f, [fieldKey]: updated };
                          })
                        }
                        placeholder="0.00"
                        className="w-32 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, [fieldKey]: f[fieldKey].filter((_, i) => i !== idx) }))
                      }
                      className="text-red-400 hover:text-red-600 text-base leading-none"
                      title="Eliminar nivel"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-400 mt-1">
        Se aplica el precio del mayor nivel que no supere la cantidad pedida.
      </p>
    </div>
  );
}

export default function AdminProducts() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "all";
  const isSinStock      = activeTab === "sinstock";
  const isQuiebreStock  = activeTab === "quiebrestock";

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [newImages, setNewImages] = useState([]);
  const [keepImages, setKeepImages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // Tab activa via searchParams: "" = todos, "sinstock" = sin stock
  // (reemplaza el estado local activeTab que ya no se usa)

  // IDs de productos con la sección "Edición rápida" abierta
  const [openQuickEdit, setOpenQuickEdit] = useState(new Set());
  // Valores del form de edición rápida por producto { [productId]: { price, salePrice, ... } }
  const [quickEditValues, setQuickEditValues] = useState({});
  // IDs de productos guardando en edición rápida
  const [quickEditSaving, setQuickEditSaving] = useState(new Set());
  // ID del producto con el menú de tres puntos abierto
  const [openMenuId, setOpenMenuId] = useState(null);

  const fileInputRef = useRef();
  const menuRef = useRef();

  const fetchProducts = (searchTerm = "") => {
    setLoading(true);
    productsApi
      .getAllAdmin({ search: searchTerm, limit: 100 })
      .then((res) => setProducts(res.data.products))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchProducts();
    categoriesApi.getAll().then((res) => setCategories(res.data));
  }, []);

  // Cerrar el menú de tres puntos si se hace click fuera de él
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchProducts(search);
  };

  const openCreate = () => {
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setNewImages([]);
    setKeepImages([]);
    setShowModal(true);
  };

  const openEdit = (product) => {
    setEditingProduct(product);
    setForm({
      name: product.name,
      description: product.description || "",
      cost: product.cost?.toString() || "",
      price: product.price.toString(),
      salePrice: product.salePrice?.toString() || "",
      wholesalePrice: product.wholesalePrice?.toString() || "",
      wholesaleSalePrice: product.wholesaleSalePrice?.toString() || "",
      minQuantity: product.minQuantity?.toString() || "1",
      stock: product.stock.toString(),
      stockUnlimited: product.stockUnlimited || false,
      stockBreak: product.stockBreak?.toString() || "",
      priceTiers: Array.isArray(product.priceTiers) ? product.priceTiers : [],
      wholesalePriceTiers: Array.isArray(product.wholesalePriceTiers) ? product.wholesalePriceTiers : [],
      sku: product.sku || "",
      youtubeUrl: product.youtubeUrl || "",
      weight: product.weight?.toString() || "",
      length: product.length?.toString() || "",
      width:  product.width?.toString()  || "",
      height: product.height?.toString() || "",
      // categoryId: product.categoryId?.toString() || "",  // Reemplazado por M2M
      categoryIds: product.categories?.map((c) => c.id.toString()) || [],
      featured: product.featured,
      active: product.active,
      visibility: product.visibility || "AMBOS",
    });
    setNewImages([]);
    setKeepImages(product.images || []);
    setShowModal(true);
  };

  const handleImageSelect = (e) => {
    const files = Array.from(e.target.files);
    setNewImages(files);
  };

  const removeKeepImage = (img) => {
    setKeepImages((prev) => prev.filter((i) => i !== img));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.price || !form.cost) {
      toast.error("Nombre, precio y costo son requeridos");
      return;
    }

    // Validar que el precio de oferta sea menor al precio normal
    if (form.salePrice && Number(form.salePrice) >= Number(form.price)) {
      toast.error("El precio de oferta debe ser menor al precio normal");
      return;
    }

    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("name", form.name);
      formData.append("description", form.description);
      formData.append("cost", form.cost);
      formData.append("price", form.price);
      formData.append("salePrice", form.salePrice);
      formData.append("wholesalePrice", form.wholesalePrice);
      formData.append("wholesaleSalePrice", form.wholesaleSalePrice);
      formData.append("minQuantity", form.minQuantity || "1");
      formData.append("stock", form.stockUnlimited ? "0" : (form.stock || "0"));
      formData.append("stockUnlimited", form.stockUnlimited);
      formData.append("stockBreak", form.stockBreak || "");
      // priceTiers/wholesalePriceTiers se envían como JSON string (FormData no admite arrays de objetos directamente)
      formData.append("priceTiers", JSON.stringify(form.priceTiers || []));
      formData.append("wholesalePriceTiers", JSON.stringify(form.wholesalePriceTiers || []));
      formData.append("sku", form.sku);
      formData.append("youtubeUrl", form.youtubeUrl);
      formData.append("weight", form.weight);
      formData.append("length", form.length);
      formData.append("width",  form.width);
      formData.append("height", form.height);
      // categoryId: form.categoryId — Reemplazado por M2M: enviar cada ID por separado
      form.categoryIds.forEach((id) => formData.append("categoryIds", id));
      formData.append("featured", form.featured);
      formData.append("active", form.active);
      formData.append("visibility", form.visibility || "AMBOS");

      newImages.forEach((file) => formData.append("images", file));

      if (editingProduct) {
        keepImages.forEach((img) => formData.append("keepImages", img));
        await productsApi.update(editingProduct.id, formData);
        toast.success("Producto actualizado");
      } else {
        await productsApi.create(formData);
        toast.success("Producto creado");
      }

      setShowModal(false);
      fetchProducts(search);
    } catch (err) {
      const msg = err.response?.data?.error || "Error al guardar el producto";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product) => {
    setOpenMenuId(null);
    if (!confirm(`¿Eliminar "${product.name}"? Esta acción no se puede deshacer.`)) return;
    try {
      await productsApi.delete(product.id);
      toast.success("Producto eliminado");
      fetchProducts(search);
    } catch (err) {
      toast.error("Error al eliminar el producto");
    }
  };

  // Toggle del switch "Publicado" — actualiza el estado activo directamente.
  // Si el producto está sin stock (y no es ilimitado) no se puede publicar.
  const handleToggleActive = async (product) => {
    const sinStock = !product.stockUnlimited && product.stock <= 0;
    if (!product.active && sinStock) {
      toast.error("No se puede publicar un producto sin stock. Primero agregá stock.");
      return;
    }
    try {
      const updated = await productsApi.quickUpdate(product.id, { active: !product.active });
      setProducts((prev) => prev.map((p) => (p.id === product.id ? updated.data : p)));
      toast.success(updated.data.active ? "Producto publicado" : "Producto despublicado");
    } catch (err) {
      toast.error("Error al cambiar el estado del producto");
    }
  };

  // Abrir/cerrar la sección de edición rápida e inicializar los valores del form
  const toggleQuickEdit = (product) => {
    setOpenQuickEdit((prev) => {
      const next = new Set(prev);
      if (next.has(product.id)) {
        next.delete(product.id);
      } else {
        next.add(product.id);
        // Inicializar valores de edición rápida con los datos actuales del producto
        setQuickEditValues((vals) => ({
          ...vals,
          [product.id]: {
            price: product.price?.toString() || "",
            salePrice: product.salePrice?.toString() || "",
            wholesalePrice: product.wholesalePrice?.toString() || "",
            wholesaleSalePrice: product.wholesaleSalePrice?.toString() || "",
            minQuantity: product.minQuantity?.toString() || "1",
            stock: product.stock?.toString() || "0",
            stockUnlimited: product.stockUnlimited || false,
          },
        }));
      }
      return next;
    });
  };

  // Actualizar un campo en el form de edición rápida para un producto específico
  const setQuickField = (productId, field, value) => {
    setQuickEditValues((vals) => ({
      ...vals,
      [productId]: { ...vals[productId], [field]: value },
    }));
  };

  // Guardar los cambios de la edición rápida
  const handleQuickSave = async (product) => {
    const vals = quickEditValues[product.id];
    if (!vals) return;

    // Validar precio oferta minorista < precio minorista
    const basePrice = Number(vals.price);
    const offerPrice = Number(vals.salePrice);
    if (vals.salePrice && vals.salePrice !== "" && (!basePrice || offerPrice >= basePrice)) {
      toast.error("El precio de oferta minorista debe ser menor al precio minorista");
      return;
    }

    // Validar precio oferta mayorista < precio mayorista
    const baseWholesale = Number(vals.wholesalePrice);
    const offerWholesale = Number(vals.wholesaleSalePrice);
    if (vals.wholesaleSalePrice && vals.wholesaleSalePrice !== "" && (!baseWholesale || offerWholesale >= baseWholesale)) {
      toast.error("El precio de oferta mayorista debe ser menor al precio mayorista");
      return;
    }

    setQuickEditSaving((prev) => new Set(prev).add(product.id));
    try {
      const updated = await productsApi.quickUpdate(product.id, {
        price: vals.price,
        salePrice: vals.salePrice || null,
        wholesalePrice: vals.wholesalePrice || null,
        wholesaleSalePrice: vals.wholesaleSalePrice || null,
        minQuantity: vals.minQuantity,
        stock: vals.stockUnlimited ? 0 : vals.stock,
        stockUnlimited: vals.stockUnlimited,
      });
      setProducts((prev) => prev.map((p) => (p.id === product.id ? updated.data : p)));
      toast.success("Cambios guardados");
    } catch (err) {
      toast.error("Error al guardar los cambios");
    } finally {
      setQuickEditSaving((prev) => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
    }
  };

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);

  return (
    <AdminLayout title="Productos">
      <div className="space-y-4">

        {/* ── Capital en stock ─────────────────────────────────────────────── */}
        {(() => {
          const withCost     = products.filter(p => !p.stockUnlimited && p.cost != null && p.cost > 0);
          const sinCosto     = products.filter(p => !p.stockUnlimited && (p.cost == null || p.cost <= 0)).length;
          const capitalTotal = withCost.reduce((sum, p) => sum + p.stock * p.cost, 0);
          const infinitos    = products.filter(p => p.stockUnlimited).length;
          return (
            <div className="rounded-2xl bg-gradient-to-r from-slate-800 to-slate-700 text-white px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-4 shadow-lg">
              <div className="flex-1">
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-1">Capital total en stock</p>
                <p className="text-4xl font-extrabold tracking-tight">
                  {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(capitalTotal)}
                </p>
              </div>
              <div className="flex flex-col gap-1 text-sm sm:text-right">
                <span className="text-slate-300">
                  <span className="font-semibold text-white">{withCost.length}</span> producto{withCost.length !== 1 ? "s" : ""} contabilizados
                </span>
                {sinCosto > 0 && (
                  <span className="text-amber-400 font-medium">
                    ⚠ {sinCosto} sin costo — no incluidos
                  </span>
                )}
                {infinitos > 0 && (
                  <span className="text-slate-400">
                    ∞ {infinitos} con stock ilimitado — no incluidos
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        {/* Header con búsqueda y botón crear */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <form onSubmit={handleSearch} className="flex gap-2 flex-1 max-w-md">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input"
              placeholder="Buscar productos..."
            />
            <button type="submit" className="btn-secondary px-4">🔍</button>
          </form>
          <button onClick={() => navigate("/admin/productos/nuevo")} className="btn-primary">
            + Nuevo producto
          </button>
        </div>

        {/* Pestañas de filtro */}
        {(() => {
          const tabs = [
            { key: "all",          label: "Todos" },
            { key: "sinstock",     label: "Sin stock" },
            { key: "quiebrestock", label: "Quiebre de stock" },
          ];
          const lowStockCount = products.filter(p => p.stockBreak != null && !p.stockUnlimited && p.stock <= p.stockBreak).length;
          return (
            <div className="flex gap-2 flex-wrap">
              {tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => { t.key === "all" ? setSearchParams({}) : setSearchParams({ tab: t.key }); }}
                  className={[
                    "px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors",
                    activeTab === t.key
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-600 border-slate-300 hover:border-slate-400",
                  ].join(" ")}
                >
                  {t.label}
                  {t.key === "quiebrestock" && lowStockCount > 0 && (
                    <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">{lowStockCount}</span>
                  )}
                </button>
              ))}
            </div>
          );
        })()}

        {/* Lista de productos en cards */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
          </div>
        ) : products.length === 0 ? (
          <div className="card py-16 text-center text-slate-400">
            No hay productos. ¡Crea el primero!
          </div>
        ) : (
          <div className="space-y-3">
            {products.filter(p =>
              isSinStock     ? (!p.stockUnlimited && p.stock <= 0) :
              isQuiebreStock ? (p.stockBreak !== null && !p.stockUnlimited && p.stock <= p.stockBreak) :
              true
            ).map((p) => {
              const img = p.images?.[0];
              // Antes: getCategoryBreadcrumb(p.category) — ahora M2M array
              const breadcrumb = getProductCategoryLabels(p.categories);
              const isQuickOpen = openQuickEdit.has(p.id);
              const qv = quickEditValues[p.id] || {};
              const isSaving = quickEditSaving.has(p.id);
              const sku = p.sku || nameToSku(p.name);

              return (
                <div key={p.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                  {/* Cabecera del producto */}
                  <div className="flex items-center gap-4 px-5 py-4">
                    {/* Imagen del producto */}
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-100 flex-shrink-0 border border-slate-200">
                      {img ? (
                        <img src={getImageUrl(img)} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xl">📦</div>
                      )}
                    </div>

                    {/* Info del producto */}
                    <div className="flex-1 min-w-0">
                      {breadcrumb && (
                        <p className="text-xs text-slate-400 mb-0.5 truncate">{breadcrumb}</p>
                      )}
                      <p className="font-bold text-slate-800 text-sm uppercase tracking-wide truncate">
                        {p.name}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {p.sku && (
                          <span className="text-xs text-slate-400 font-mono">SKU: {p.sku}</span>
                        )}
                        <span className="text-xs text-slate-500">
                          Stock: {p.stockUnlimited ? "Ilimitado" : (p.stock === 0 ? (
                            <span className="text-red-500">Sin stock</span>
                          ) : p.stock <= 5 ? (
                            <span className="text-orange-500">{p.stock} unid.</span>
                          ) : (
                            <span className="text-green-600">{p.stock} unid.</span>
                          ))}
                        </span>
                        <span className="text-xs text-slate-400">
                          Tenés 1 variante en este producto.
                        </span>
                        {p.featured && (
                          <span className="text-xs text-blue-600 font-medium">⭐ Destacado</span>
                        )}
                      </div>
                    </div>

                    {/* Controles derecha */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {/* Toggle Publicado */}
                      {(() => {
                        const sinStock = !p.stockUnlimited && p.stock <= 0;
                        return (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 hidden sm:block">
                              {sinStock ? "Sin stock" : p.active ? "Publicado" : "Inactivo"}
                            </span>
                            <button
                              onClick={() => handleToggleActive(p)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                                sinStock ? "bg-slate-200 cursor-not-allowed opacity-50" : p.active ? "bg-green-500" : "bg-slate-300"
                              }`}
                              title={sinStock ? "Sin stock — agregá stock para publicar" : p.active ? "Click para despublicar" : "Click para publicar"}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                                  p.active ? "translate-x-6" : "translate-x-1"
                                }`}
                              />
                            </button>
                          </div>
                        );
                      })()}
                      </div>

                      {/* Botón Editar producto (abre modal completo) */}
                      <button
                        onClick={() => openEdit(p)}
                        className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-semibold transition-colors hidden sm:block"
                      >
                        Editar producto
                      </button>

                      {/* Menú tres puntos */}
                      <div className="relative" ref={openMenuId === p.id ? menuRef : null}>
                        <button
                          onClick={() => setOpenMenuId(openMenuId === p.id ? null : p.id)}
                          className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
                          title="Más opciones"
                        >
                          ⋮
                        </button>
                        {openMenuId === p.id && (
                          <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1 min-w-[160px]">
                            {/* Mostrar "Editar" en móvil donde el botón verde está oculto */}
                            <button
                              onClick={() => { openEdit(p); setOpenMenuId(null); }}
                              className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 sm:hidden"
                            >
                              ✏️ Editar producto
                            </button>
                            <button
                              onClick={() => handleDelete(p)}
                              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                            >
                              🗑️ Eliminar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                  {/* Botón de edición rápida */}
                  <div className="border-t border-slate-100">
                    <button
                      onClick={() => toggleQuickEdit(p)}
                      className="flex items-center gap-2 px-5 py-2.5 text-sm text-slate-600 hover:bg-slate-50 w-full transition-colors font-medium"
                    >
                      <span>{isQuickOpen ? "Cerrar edición rápida" : "Edición rápida"}</span>
                      <span className={`transition-transform ${isQuickOpen ? "rotate-180" : ""}`}>
                        ∧
                      </span>
                    </button>

                    {/* Panel de edición rápida */}
                    {isQuickOpen && (
                      <div className="border-t border-slate-100 bg-slate-50 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-slate-500 font-semibold uppercase tracking-wide border-b border-slate-200">
                              <th className="px-5 py-3 w-56">Variantes</th>
                              <th className="px-4 py-3 w-32">Stock</th>
                              <th className="px-4 py-3 w-36">Precio minorista</th>
                              <th className="px-4 py-3 w-36">Oferta minorista</th>
                              <th className="px-4 py-3 w-36">Precio mayorista</th>
                              <th className="px-4 py-3 w-36">Oferta mayorista</th>
                              <th className="px-4 py-3 w-28">Cantidad mín.</th>
                              <th className="px-4 py-3"></th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              {/* Columna: variante (imagen + nombre + SKU) */}
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-white border border-slate-200 flex-shrink-0">
                                    {img ? (
                                      <img src={getImageUrl(img)} alt={p.name} className="w-full h-full object-cover" />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-base">📦</div>
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-slate-700 font-medium text-xs">Sin atributos</p>
                                    <p className="text-slate-400 text-xs">SKU: {sku}</p>
                                  </div>
                                </div>
                              </td>

                              {/* Columna: Stock */}
                              <td className="px-4 py-4">
                                {qv.stockUnlimited ? (
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="text"
                                      value="∞"
                                      readOnly
                                      className="w-20 px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-400 text-center text-sm cursor-not-allowed"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setQuickField(p.id, "stockUnlimited", false)}
                                      className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                                      title="Activar stock limitado"
                                    >
                                      Limitar
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="number"
                                      min="0"
                                      value={qv.stock ?? ""}
                                      onChange={(e) => setQuickField(p.id, "stock", e.target.value)}
                                      className="w-20 px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-center"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setQuickField(p.id, "stockUnlimited", true)}
                                      className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                                      title="Hacer stock ilimitado"
                                    >
                                      ∞
                                    </button>
                                  </div>
                                )}
                              </td>

                              {/* Columna: Precio */}
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-1">
                                  <span className="text-slate-500 text-sm">$</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={qv.price ?? ""}
                                    onChange={(e) => setQuickField(p.id, "price", e.target.value)}
                                    className="w-28 px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                  />
                                </div>
                              </td>

                              {/* Columna: Oferta minorista (debe ser < precio minorista) */}
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-1">
                                  <span className="text-slate-500 text-sm">$</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={qv.salePrice ?? ""}
                                    onChange={(e) => setQuickField(p.id, "salePrice", e.target.value)}
                                    placeholder="—"
                                    className="w-28 px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm placeholder-slate-300"
                                  />
                                </div>
                              </td>

                              {/* Columna: Precio mayorista */}
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-1">
                                  <span className="text-slate-500 text-sm">$</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={qv.wholesalePrice ?? ""}
                                    onChange={(e) => setQuickField(p.id, "wholesalePrice", e.target.value)}
                                    placeholder="—"
                                    className="w-28 px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm placeholder-slate-300"
                                  />
                                </div>
                              </td>

                              {/* Columna: Oferta mayorista (debe ser < precio mayorista) */}
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-1">
                                  <span className="text-slate-500 text-sm">$</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={qv.wholesaleSalePrice ?? ""}
                                    onChange={(e) => setQuickField(p.id, "wholesaleSalePrice", e.target.value)}
                                    placeholder="—"
                                    className="w-28 px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm placeholder-slate-300"
                                  />
                                </div>
                              </td>

                              {/* Columna: Cantidad mínima */}
                              <td className="px-4 py-4">
                                <input
                                  type="number"
                                  min="1"
                                  value={qv.minQuantity ?? "1"}
                                  onChange={(e) => setQuickField(p.id, "minQuantity", e.target.value)}
                                  className="w-20 px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-center"
                                />
                              </td>

                              {/* Botón Guardar */}
                              <td className="px-4 py-4">
                                <button
                                  onClick={() => handleQuickSave(p)}
                                  disabled={isSaving}
                                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
                                >
                                  {isSaving ? "..." : "Guardar"}
                                </button>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal editar producto (crear va a /admin/productos/nuevo) */}
      {showModal && editingProduct && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">
                Editar producto
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Nombre */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input"
                  required
                />
              </div>

              {/* SKU */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">SKU</label>
                <input
                  type="text"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder={form.name ? nameToSku(form.name) : "Código interno del producto"}
                  className="input"
                />
              </div>

              {/* Video de YouTube */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Video de YouTube</label>
                <input
                  type="url"
                  value={form.youtubeUrl}
                  onChange={(e) => setForm({ ...form, youtubeUrl: e.target.value })}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="input"
                />
              </div>

              {/* Peso y dimensiones */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Peso y dimensiones</label>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "Peso", key: "weight", unit: "kg" },
                    { label: "Largo", key: "length", unit: "cm" },
                    { label: "Ancho", key: "width",  unit: "cm" },
                    { label: "Alto",  key: "height", unit: "cm" },
                  ].map(({ label, key, unit }) => (
                    <div key={key}>
                      <label className="block text-xs text-slate-500 mb-1">{label}</label>
                      <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-400">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={form[key]}
                          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                          placeholder="—"
                          className="flex-1 px-3 py-2 text-sm focus:outline-none w-0"
                        />
                        <span className="px-2 py-2 bg-slate-50 text-slate-400 text-xs border-l border-slate-300">{unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Descripción */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Descripción</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="input resize-none"
                  rows={3}
                  placeholder="Descripción del producto..."
                />
              </div>

              {/* Costo (interno) */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
                  Costo *
                  <span className="ml-1 normal-case font-normal text-slate-400">— solo visible para el admin</span>
                </label>
                <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-400">
                  <span className="px-3 py-2 bg-slate-50 text-slate-400 text-sm border-r border-slate-300">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.cost}
                    onChange={(e) => setForm({ ...form, cost: e.target.value })}
                    placeholder="0.00"
                    required
                    className="flex-1 px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
              </div>

              {/* Precios: minorista, oferta minorista, mayorista, oferta mayorista */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Precio minorista", key: "price", required: true },
                  { label: "Oferta minorista", key: "salePrice" },
                  { label: "Precio mayorista", key: "wholesalePrice" },
                  { label: "Oferta mayorista", key: "wholesaleSalePrice" },
                ].map(({ label, key, required }) => (
                  <div key={key}>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
                      {label}{required && " *"}
                    </label>
                    <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-400">
                      <span className="px-2 py-2 bg-slate-50 text-slate-400 text-sm border-r border-slate-300">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form[key]}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                        placeholder="—"
                        required={required}
                        className="flex-1 px-2 py-2 text-sm focus:outline-none w-0"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Stock, Quiebre de stock y Cantidad mínima */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Stock</label>
                  {form.stockUnlimited ? (
                    <div className="input bg-slate-50 text-slate-400 flex items-center">∞ Ilimitado</div>
                  ) : (
                    <input
                      type="number"
                      min="0"
                      value={form.stock}
                      onChange={(e) => setForm({ ...form, stock: e.target.value })}
                      className="input"
                    />
                  )}
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.stockUnlimited}
                      onChange={(e) => setForm({ ...form, stockUnlimited: e.target.checked })}
                      className="w-4 h-4 accent-blue-600"
                    />
                    <span className="text-xs text-slate-500">Stock ilimitado</span>
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Quiebre de stock</label>
                  <input
                    type="number"
                    min="0"
                    value={form.stockBreak}
                    onChange={(e) => setForm({ ...form, stockBreak: e.target.value })}
                    placeholder="—"
                    className="input"
                  />
                  <p className="text-xs text-slate-400 mt-1">Alerta cuando el stock llega a este número</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Cantidad mínima</label>
                  <input
                    type="number"
                    min="1"
                    value={form.minQuantity}
                    onChange={(e) => setForm({ ...form, minQuantity: e.target.value })}
                    className="input"
                  />
                </div>
              </div>

              {/* Categorías (M2M — múltiple selección con checkboxes) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Categorías
                  {form.categoryIds.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-blue-600">
                      {form.categoryIds.length} seleccionada{form.categoryIds.length > 1 ? "s" : ""}
                    </span>
                  )}
                </label>
                <div className="border border-slate-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-slate-100">
                  {categories.map((c) => {
                    // Genera la lista plana de opciones: padre + hijos indentados
                    const opts = c.children && c.children.length > 0
                      ? [{ id: c.id, label: c.name, indent: false }, ...c.children.map((s) => ({ id: s.id, label: `↳ ${s.name}`, indent: true }))]
                      : [{ id: c.id, label: c.name, indent: false }];
                    return opts.map((opt) => {
                      const checked = form.categoryIds.includes(opt.id.toString());
                      return (
                        <label key={opt.id} className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 ${opt.indent ? "pl-6" : ""}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const sid = opt.id.toString();
                              setForm((f) => ({
                                ...f,
                                categoryIds: checked
                                  ? f.categoryIds.filter((id) => id !== sid)
                                  : [...f.categoryIds, sid],
                              }));
                            }}
                            className="rounded border-slate-300 text-blue-600"
                          />
                          <span className="text-sm text-slate-700">{opt.label}</span>
                        </label>
                      );
                    });
                  })}
                </div>
              </div>

              {/* Opciones */}
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.featured}
                    onChange={(e) => setForm({ ...form, featured: e.target.checked })}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span className="text-sm font-medium text-slate-700">⭐ Destacado en Home</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span className="text-sm font-medium text-slate-700">Activo (visible en tienda)</span>
                </label>
              </div>

              {/* Visibilidad por tipo de cliente */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Visible para</label>
                <div className="flex gap-3">
                  {[
                    { value: "AMBOS",     label: "Todos",       icon: "👥" },
                    { value: "MINORISTA", label: "Minorista",   icon: "🛒" },
                    { value: "MAYORISTA", label: "Mayorista",   icon: "🏭" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm({ ...form, visibility: opt.value })}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl border-2 text-sm font-medium transition-colors ${
                        form.visibility === opt.value
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      <span>{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Descuentos por cantidad — Minoristas (priceTiers) */}
              <TierEditor
                label="Descuentos por cantidad — Minoristas"
                tiers={form.priceTiers}
                fieldKey="priceTiers"
                setForm={setForm}
              />

              {/* Descuentos por cantidad — Mayoristas (wholesalePriceTiers) */}
              <TierEditor
                label="Descuentos por cantidad — Mayoristas"
                tiers={form.wholesalePriceTiers}
                fieldKey="wholesalePriceTiers"
                setForm={setForm}
              />

              {/* Imágenes existentes (al editar) */}
              {keepImages.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Imágenes actuales
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {keepImages.map((img) => (
                      <div key={img} className="relative group">
                        <img
                          src={getImageUrl(img)}
                          alt=""
                          className="w-16 h-16 object-cover rounded-lg border border-slate-200"
                        />
                        <button
                          type="button"
                          onClick={() => removeKeepImage(img)}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Hover en la imagen y click en ✕ para eliminarla.
                  </p>
                </div>
              )}

              {/* Subir nuevas imágenes */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {editingProduct ? "Agregar nuevas imágenes" : "Imágenes"} (máx. 10, 5MB c/u)
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageSelect}
                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                />
                {newImages.length > 0 && (
                  <p className="text-xs text-blue-600 mt-1">
                    {newImages.length} imagen{newImages.length > 1 ? "es" : ""} seleccionada{newImages.length > 1 ? "s" : ""}
                  </p>
                )}
              </div>

              {/* Botones */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary flex-1"
                >
                  Cancelar
                </button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                      Guardando...
                    </span>
                  ) : editingProduct ? (
                    "Guardar cambios"
                  ) : (
                    "Crear producto"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

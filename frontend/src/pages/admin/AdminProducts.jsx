import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import AdminLayout from "../../components/AdminLayout";
import { productsApi, categoriesApi, suppliersApi, variantsApi, getImageUrl } from "../../services/api";
import toast from "react-hot-toast";
import RichTextEditor from "../../components/RichTextEditor";
import ProductVariantsEditor from "../../components/admin/ProductVariantsEditor";
import TierEditor from "../../components/admin/TierEditor";
import WarehouseSupplierFields from "../../components/admin/WarehouseSupplierFields";
import * as XLSX from "xlsx";

const EMPTY_FORM = {
  name: "",
  description: "",
  cost: "",
  price: "",
  ivaRate: "21",
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
  // Ubicación en depósito (solo admin): módulo + estante físico del artículo
  module: "",
  shelf: "",
  // Proveedor (solo admin): id del proveedor seleccionado (string para el <select>)
  supplierId: "",
  // categoryId: "",  // Reemplazado por categoryIds (array M2M)
  categoryIds: [],
  featured: false,
  // onSale: marca el producto para la sección "Ofertas" de la home
  onSale: false,
  hotSeller: false,
  hotSellerThreshold: "",
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

// TierEditor movido a components/admin/TierEditor.jsx para compartirlo con AdminProductCreate
/* function TierEditor({ label, tiers, fieldKey, setForm }) {
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
} */

export default function AdminProducts() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "all";
  const isSinStock      = activeTab === "sinstock";
  const isQuiebreStock  = activeTab === "quiebrestock";

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  // Paginación en el cliente: se traen TODOS los productos (para que el capital y los tabs cuenten el
  // total) y se muestran de a PER_PAGE por página.
  const PER_PAGE = 50;
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportType, setExportType] = useState("MINORISTA");

  const [showPriceModal, setShowPriceModal] = useState(false);
  const [priceAdjust, setPriceAdjust] = useState({ type: "MINORISTA", direction: "aumento", percent: "" });
  const [applyingPrice, setApplyingPrice] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [suppliers, setSuppliers] = useState([]);
  const [newImages, setNewImages] = useState([]);
  const [keepImages, setKeepImages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showVariants, setShowVariants] = useState(false);
  const [search, setSearch] = useState("");

  // Tab activa via searchParams: "" = todos, "sinstock" = sin stock
  // (reemplaza el estado local activeTab que ya no se usa)

  // Mini-formulario "Crear categoría" inline dentro del modal de producto
  const [showNewCatForm, setShowNewCatForm]     = useState(false);
  const [newCatName, setNewCatName]             = useState("");
  const [newCatParentId, setNewCatParentId]     = useState("");
  const [savingCat, setSavingCat]               = useState(false);

  // IDs de productos con la sección "Edición rápida" abierta
  const [openQuickEdit, setOpenQuickEdit] = useState(new Set());
  // Valores del form de edición rápida por producto { [productId]: { price, salePrice, ... } }
  const [quickEditValues, setQuickEditValues] = useState({});
  // IDs de productos guardando en edición rápida
  const [quickEditSaving, setQuickEditSaving] = useState(new Set());
  // Variantes cargadas para quick edit { [productId]: [...variants] }
  const [quickEditVariants, setQuickEditVariants] = useState({});
  // Valores editados de variantes { [variantId]: { stock, stockUnlimited, price, sku } }
  const [variantEditValues, setVariantEditValues] = useState({});
  // IDs de variantes guardando
  const [variantSaving, setVariantSaving] = useState(new Set());
  // ID del producto con el menú de tres puntos abierto
  const [openMenuId, setOpenMenuId] = useState(null);

  const fileInputRef = useRef();
  const menuRef = useRef();
  // Guarda el precio antes de que el usuario empiece a editar el campo,
  // para calcular el ratio de ajuste proporcional sobre los tiers al salir del campo.
  const priceBeforeEditRef = useRef({});

  const fetchProducts = (searchTerm = "") => {
    setLoading(true);
    // all: true → el backend devuelve TODOS los productos (sin paginar). Antes: limit: 100, que truncaba
    // el listado a 100 y hacía que el capital y los tabs solo contaran esos 100.
    productsApi
      .getAllAdmin({ search: searchTerm, all: true })
      .then((res) => setProducts(res.data.products))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchProducts();
    categoriesApi.getAll().then((res) => setCategories(res.data));
    suppliersApi.getAll().then((res) => setSuppliers(res.data)).catch(() => {});
  }, []);

  // Crea una categoría nueva desde el mini-form inline del modal de producto.
  // Después de crearla, recarga la lista de categorías y la selecciona automáticamente.
  const handleCreateCategory = async () => {
    if (!newCatName.trim()) return;
    setSavingCat(true);
    try {
      const payload = { name: newCatName.trim() };
      if (newCatParentId) payload.parentId = parseInt(newCatParentId);
      const res = await categoriesApi.create(payload);
      const created = res.data;
      // Recargar lista para que aparezca la nueva categoría
      const catsRes = await categoriesApi.getAll();
      setCategories(catsRes.data);
      // Seleccionarla automáticamente en el form del producto
      setForm((f) => ({ ...f, categoryIds: [...f.categoryIds, created.id.toString()] }));
      // Limpiar y cerrar el mini-form
      setNewCatName("");
      setNewCatParentId("");
      setShowNewCatForm(false);
    } catch (err) {
      alert(err.response?.data?.error || "Error al crear la categoría");
    } finally {
      setSavingCat(false);
    }
  };

  // Limpiar el mini-form de "Crear categoría" cada vez que el modal se cierra
  useEffect(() => {
    if (!showModal) {
      setShowNewCatForm(false);
      setNewCatName("");
      setNewCatParentId("");
    }
  }, [showModal]);

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
    setPage(1); // volver a la primera página al hacer una búsqueda nueva
    fetchProducts(search);
  };

  // Al cambiar de tab (Todos / Sin stock / Quiebre) volvemos a la primera página
  useEffect(() => { setPage(1); }, [activeTab]);

  const openCreate = () => {
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setNewImages([]);
    setKeepImages([]);
    setShowVariants(false);
    setShowModal(true);
  };

  const openEdit = (product) => {
    setShowVariants(false);
    setEditingProduct(product);
    setForm({
      name: product.name,
      description: product.description || "",
      cost: product.cost?.toString() || "",
      price: product.price.toString(),
      ivaRate: product.ivaRate?.toString() || "21",
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
      // Depósito + proveedor (solo admin)
      module: product.module || "",
      shelf:  product.shelf  || "",
      supplierId: product.supplierId?.toString() || "",
      // categoryId: product.categoryId?.toString() || "",  // Reemplazado por M2M
      categoryIds: product.categories?.map((c) => c.id.toString()) || [],
      featured: product.featured,
      onSale: product.onSale ?? false,
      hotSeller: product.hotSeller ?? false,
      hotSellerThreshold: product.hotSellerThreshold?.toString() || "",
      active: product.active,
      visibility: product.visibility || "AMBOS",
    });
    setNewImages([]);
    setKeepImages(product.images || []);
    setShowModal(true);
  };

  const handleImageSelect = (e) => {
    const files = Array.from(e.target.files);
    e.target.value = ""; // resetea el input: permite volver a elegir (incluso el mismo archivo)
    // Acumula en vez de reemplazar. Tope total = 10 (contando las imágenes ya guardadas que se conservan)
    const maxNew = Math.max(0, 10 - keepImages.length);
    const total = newImages.length + files.length;
    setNewImages((prev) => [...prev, ...files].slice(0, maxNew));
    if (total > maxNew) toast.error("Máximo 10 imágenes en total");
  };

  const removeKeepImage = (img) => {
    setKeepImages((prev) => prev.filter((i) => i !== img));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Según la visibilidad solo se muestran/validan los precios relevantes.
    const isMin = form.visibility === "AMBOS" || form.visibility === "MINORISTA";
    const isMay = form.visibility === "AMBOS" || form.visibility === "MAYORISTA";

    if (!form.name || !form.cost) {
      toast.error("Nombre y costo son requeridos");
      return;
    }
    if (isMin && !form.price) {
      toast.error("Falta el precio minorista");
      return;
    }
    if (isMay && !form.wholesalePrice) {
      toast.error("Falta el precio mayorista");
      return;
    }
    if (isMin && form.salePrice && Number(form.salePrice) >= Number(form.price)) {
      toast.error("El precio de oferta debe ser menor al precio normal");
      return;
    }
    if (isMay && form.wholesaleSalePrice && Number(form.wholesaleSalePrice) >= Number(form.wholesalePrice)) {
      toast.error("La oferta mayorista debe ser menor al precio mayorista");
      return;
    }

    // El precio oculto se rellena con el del otro tipo (price es obligatorio en la DB).
    // || → no pisa un valor ya cargado (clave en edición para no perder el precio real).
    const effPrice     = form.price || form.wholesalePrice;
    const effWholesale = form.wholesalePrice || form.price;

    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("name", form.name.toUpperCase()); // título siempre en mayúsculas
      formData.append("description", form.description);
      formData.append("cost", form.cost);
      formData.append("price", effPrice);
      formData.append("ivaRate", form.ivaRate || "21");
      formData.append("salePrice", form.salePrice);
      formData.append("wholesalePrice", effWholesale);
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
      // Depósito + proveedor (solo admin)
      formData.append("module", form.module || "");
      formData.append("shelf", form.shelf || "");
      formData.append("supplierId", form.supplierId || "");
      // categoryId: form.categoryId — Reemplazado por M2M: enviar cada ID por separado
      form.categoryIds.forEach((id) => formData.append("categoryIds", id));
      formData.append("featured", form.featured);
      formData.append("onSale", form.onSale);
      formData.append("hotSeller", form.hotSeller ?? false);
      if (form.hotSellerThreshold) formData.append("hotSellerThreshold", form.hotSellerThreshold);
      formData.append("active", form.active);
      formData.append("visibility", form.visibility || "AMBOS");

      newImages.forEach((file) => formData.append("images", file));

      if (editingProduct) {
        if (keepImages.length > 0) {
          keepImages.forEach((img) => formData.append("keepImages", img));
        } else {
          // Array vacío: señaliza al backend que se deben borrar todas las imágenes actuales
          formData.append("keepImages", "__NONE__");
        }
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

  const handleExport = () => {
    const isMayorista = exportType === "MAYORISTA";
    const fmtPrice = (v) =>
      v != null
        ? "$ " + new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
        : "";

    // Nombre del atributo en MAYÚSCULAS para que resalte; separados por " | "
    const fmtAttrs = (p) =>
      (p.attributes || [])
        .map((a) => `${a.name.toUpperCase()}: ${(a.values || []).map((v) => v.value).join(" / ")}`)
        .join("  |  ");

    // Construir filas sin la columna Foto (se agrega como hipervínculo manualmente)
    const rows = products.map((p) => {
      const price = isMayorista
        ? (p.wholesaleSalePrice && p.wholesaleSalePrice < p.wholesalePrice ? p.wholesaleSalePrice : p.wholesalePrice) ?? p.price
        : (p.salePrice && p.salePrice < p.price ? p.salePrice : p.price);

      return {
        Foto:      p.images?.[0] ? getImageUrl(p.images[0]) : "",
        Título:    p.name,
        SKU:       p.sku || "",
        Precio:    fmtPrice(price),
        Atributos: fmtAttrs(p),
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    // Convertir celdas de la columna Foto en hipervínculos clickeables
    products.forEach((p, i) => {
      const url = p.images?.[0] ? getImageUrl(p.images[0]) : null;
      if (!url) return;
      const cellRef = `A${i + 2}`; // fila 1 = encabezado
      ws[cellRef] = { v: url, t: "s", l: { Target: url, Tooltip: "Ver imagen" } };
    });

    ws["!cols"] = [
      { wch: 65 }, // Foto
      { wch: 40 }, // Título
      { wch: 20 }, // SKU
      { wch: 18 }, // Precio
      { wch: 50 }, // Atributos
    ];

    // wrapText en columna E (Atributos) para que cada atributo se vea en su propia línea
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let R = range.s.r + 1; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: 4 })];
      if (cell) cell.s = { alignment: { wrapText: true, vertical: "top" } };
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Productos");

    const fecha = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `productos_${exportType.toLowerCase()}_${fecha}.xlsx`, { cellStyles: true });

    setShowExportModal(false);
    toast.success("Excel exportado");
  };

  const handleBulkPriceAdjust = async () => {
    const pct = parseFloat(priceAdjust.percent);
    if (!pct || pct <= 0) { toast.error("Ingresá un porcentaje válido mayor a 0"); return; }
    const finalPct = priceAdjust.direction === "reduccion" ? -pct : pct;
    const label = priceAdjust.direction === "reduccion" ? `reducción del ${pct}%` : `aumento del ${pct}%`;
    if (!confirm(`¿Aplicar ${label} a precios ${priceAdjust.type}? Esta acción modifica todos los productos.`)) return;

    setApplyingPrice(true);
    try {
      const res = await productsApi.bulkPriceAdjust({ type: priceAdjust.type, percent: finalPct });
      toast.success(`${label} aplicado a ${res.data.updated} productos`);
      setShowPriceModal(false);
      setPriceAdjust({ type: "MINORISTA", direction: "aumento", percent: "" });
      fetchProducts(search);
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al ajustar precios");
    } finally {
      setApplyingPrice(false);
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
      // 409 hasSales: el producto tiene ventas. Confirmamos el borrado forzado (se desvincula de las
      // órdenes; esos pedidos mostrarán "Producto eliminado", pero se conservan precio/cantidad/costo).
      if (err.response?.status === 409 && err.response.data?.hasSales) {
        const n = err.response.data.salesCount;
        if (!confirm(
          `"${product.name}" tiene ${n} venta(s) registrada(s).\n\n` +
          `Si lo borrás igual, esos pedidos van a mostrar "Producto eliminado" ` +
          `(se conservan precio, cantidad y costo, así que las métricas no cambian).\n\n¿Borrar de todos modos?`
        )) return;
        try {
          await productsApi.delete(product.id, true); // force
          toast.success("Producto eliminado");
          fetchProducts(search);
        } catch {
          toast.error("Error al eliminar el producto");
        }
        return;
      }
      toast.error(err.response?.data?.error || "Error al eliminar el producto");
    }
  };

  // Toggle del switch "Publicado" — actualiza el estado activo directamente.
  // Si el producto está sin stock (y no es ilimitado) no se puede publicar.
  const handleToggleActive = async (product) => {
    const { stock: es, unlimited: eu } = effectiveStock(product);
    const sinStock = !eu && es <= 0;
    if (!product.active && sinStock) {
      toast.error("No se puede publicar un producto sin stock. Primero agregá stock.");
      return;
    }
    try {
      const updated = await productsApi.quickUpdate(product.id, { active: !product.active });
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, ...updated.data, variantStockTotal: p.variantStockTotal, _count: p._count } : p)));
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
            cost: product.cost?.toString() || "",
            sku: product.sku || "",
          },
        }));
        // Si el producto tiene variantes activas, cargarlas para mostrar una fila por variante
        if ((product._count?.variants ?? 0) > 0 && !quickEditVariants[product.id]) {
          variantsApi.getVariants(product.id).then((res) => {
            const variants = res.data || [];
            setQuickEditVariants((prev) => ({ ...prev, [product.id]: variants }));
            // Inicializar valores editables por variante
            const initVals = {};
            variants.forEach((v) => {
              initVals[v.id] = {
                stock:              v.stock?.toString() || "0",
                stockUnlimited:     v.stockUnlimited || false,
                price:              v.price              != null ? v.price.toString()              : "",
                salePrice:          v.salePrice          != null ? v.salePrice.toString()          : "",
                wholesalePrice:     v.wholesalePrice     != null ? v.wholesalePrice.toString()     : "",
                wholesaleSalePrice: v.wholesaleSalePrice != null ? v.wholesaleSalePrice.toString() : "",
                cost:               v.cost?.toString() || "",
                sku:                v.sku || "",
                // Visibility leído del backend para saber qué inputs de precio mostrar (heredada del atributo)
                visibility:         v.visibility || "AMBOS",
              };
            });
            setVariantEditValues((prev) => ({ ...prev, ...initVals }));
          }).catch(() => {});
        }
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
        ...(vals.cost !== undefined && vals.cost !== "" ? { cost: vals.cost } : {}),
        ...(vals.sku !== undefined && vals.sku !== "" ? { sku: vals.sku } : {}),
      });
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, ...updated.data, variantStockTotal: p.variantStockTotal, _count: p._count } : p)));
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

  // Guardar una variante individual desde la edición rápida
  const handleVariantQuickSave = async (variantId) => {
    const vals = variantEditValues[variantId];
    if (!vals) return;

    // Encontrar el producto padre para validar precios contra el baseline del producto
    const parentProduct = products.find((p) =>
      (quickEditVariants[p.id] || []).some((v) => v.id === variantId)
    );
    const isMin = vals.visibility === "MINORISTA" || vals.visibility === "AMBOS";
    const isMay = vals.visibility === "MAYORISTA" || vals.visibility === "AMBOS";

    // Validar precios obligatorios: si la variante no tiene precio Y el producto padre tampoco → error
    if (isMin && !vals.price && !parentProduct?.price) {
      toast.error("Falta el precio minorista de la variante (o cargalo en el producto base)");
      return;
    }
    if (isMay && !vals.wholesalePrice && !parentProduct?.wholesalePrice) {
      toast.error("Falta el precio mayorista de la variante (o cargalo en el producto base)");
      return;
    }
    // Validar ofertas < precios base si están cargados
    if (vals.salePrice && vals.price && parseFloat(vals.salePrice) >= parseFloat(vals.price)) {
      toast.error("La oferta minorista debe ser menor al precio minorista");
      return;
    }
    if (vals.wholesaleSalePrice && vals.wholesalePrice && parseFloat(vals.wholesaleSalePrice) >= parseFloat(vals.wholesalePrice)) {
      toast.error("La oferta mayorista debe ser menor al precio mayorista");
      return;
    }

    setVariantSaving((prev) => new Set(prev).add(variantId));
    try {
      // El backend de variantes NO usa multer — espera JSON. Antes acá se mandaba FormData multipart
      // y el req.body quedaba vacío, por eso el stock parecía guardarse en la UI pero al refrescar
      // volvía al valor anterior. Ahora mandamos JSON directo con todos los campos relevantes.
      const payload = {
        stock: vals.stockUnlimited ? 0 : (vals.stock || 0),
        stockUnlimited: vals.stockUnlimited,
        // Precios mayorista/minorista (vacío → null para limpiar el campo en backend)
        price:              vals.price              !== undefined ? (vals.price              === "" ? null : vals.price)              : undefined,
        salePrice:          vals.salePrice          !== undefined ? (vals.salePrice          === "" ? null : vals.salePrice)          : undefined,
        wholesalePrice:     vals.wholesalePrice     !== undefined ? (vals.wholesalePrice     === "" ? null : vals.wholesalePrice)     : undefined,
        wholesaleSalePrice: vals.wholesaleSalePrice !== undefined ? (vals.wholesaleSalePrice === "" ? null : vals.wholesaleSalePrice) : undefined,
        cost:               vals.cost               !== undefined ? (vals.cost               === "" ? null : vals.cost)               : undefined,
        sku:                vals.sku ?? undefined,
      };
      // Limpiamos las claves undefined para que el backend reciba solo los campos que el admin tocó
      Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
      const res = await variantsApi.updateVariant(variantId, payload);
      // Actualizar en cache local
      setQuickEditVariants((prev) => {
        const updated = {};
        for (const pid in prev) {
          updated[pid] = prev[pid].map((v) => v.id === variantId ? res.data : v);
        }
        return updated;
      });
      toast.success("Variante actualizada");
    } catch {
      toast.error("Error al guardar la variante");
    } finally {
      setVariantSaving((prev) => { const n = new Set(prev); n.delete(variantId); return n; });
    }
  };

  const setVariantField = (variantId, field, value) =>
    setVariantEditValues((prev) => ({ ...prev, [variantId]: { ...prev[variantId], [field]: value } }));

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);

  // Stock efectivo para mostrar en la lista y decidir si está sin stock.
  // Stock físico es uno solo: para productos sin variantes es product.stock,
  // para productos con variantes es la suma de los stocks de las variantes (variantStockTotal).
  const effectiveStock = (p) => {
    const hasVariants = (p._count?.variants ?? 0) > 0 || p.variantStockTotal !== null;
    if (!hasVariants) return { stock: p.stock, unlimited: p.stockUnlimited };
    // Con variantes: usar variantStockTotal (suma de variant.stock)
    const unlimited = p.variantStockTotal === -1;
    const stock     = unlimited ? 0 : (p.variantStockTotal ?? 0);
    return { stock, unlimited };
  };

  // Lista filtrada por el tab activo (Sin stock / Quiebre) sobre TODOS los productos cargados.
  const filteredProducts = products.filter((p) => {
    const { stock: es, unlimited: eu } = effectiveStock(p);
    if (isSinStock)     return !eu && es <= 0;
    if (isQuiebreStock) return p.stockBreak !== null && !eu && es > 0 && es <= p.stockBreak;
    return true;
  });
  // Paginación en el cliente: 50 por página. Clampeamos la página actual por si el filtro achicó la lista.
  const listTotalPages = Math.max(1, Math.ceil(filteredProducts.length / PER_PAGE));
  const safePage = Math.min(page, listTotalPages);
  const pagedProducts = filteredProducts.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  return (
    <AdminLayout title="Productos">
      <div className="space-y-4">

        {/* ── Capital en stock ─────────────────────────────────────────────── */}
        {(() => {
          // Capital calculado en el backend por producto (stockCapital + capitalStatus). Ya considera
          // las variantes FINITAS: antes se usaba p.stock/p.stockUnlimited a nivel producto, así que un
          // producto con una variante ilimitada quedaba excluido completo y no se contaban las unidades
          // reales de sus otras variantes. Ver getProductsAdmin.
          // Antes:
          // const withCost     = products.filter(p => !p.stockUnlimited && p.cost != null && p.cost > 0);
          // const sinCosto     = products.filter(p => !p.stockUnlimited && (p.cost == null || p.cost <= 0)).length;
          // const capitalTotal = withCost.reduce((sum, p) => sum + p.stock * p.cost, 0);
          // const infinitos    = products.filter(p => p.stockUnlimited).length;
          const counted      = products.filter(p => p.capitalStatus === "counted");
          const sinCosto     = products.filter(p => p.capitalStatus === "noCost").length;
          const infinitos    = products.filter(p => p.capitalStatus === "unlimited").length;
          const capitalTotal = products.reduce((sum, p) => sum + (p.stockCapital || 0), 0);
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
                  <span className="font-semibold text-white">{counted.length}</span> producto{counted.length !== 1 ? "s" : ""} contabilizados
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPriceModal(true)}
              className="btn-secondary flex items-center gap-2"
              title="Ajuste masivo de precios"
            >
              💲 Ajustar precios
            </button>
            {/* Botón "Exportar Excel" movido a la vista de Generar Flyer (AdminFlyer.jsx)
                donde el admin selecciona productos específicos antes de exportar */}
            {/* <button
              onClick={() => setShowExportModal(true)}
              className="btn-secondary flex items-center gap-2"
              title="Exportar productos a Excel"
            >
              📥 Exportar Excel
            </button> */}
            <button onClick={() => navigate("/admin/productos/nuevo")} className="btn-primary">
              + Nuevo producto
            </button>
          </div>
        </div>

        {/* Pestañas de filtro */}
        {(() => {
          const tabs = [
            { key: "all",          label: "Todos" },
            { key: "sinstock",     label: "Sin stock" },
            { key: "quiebrestock", label: "Quiebre de stock" },
          ];
          // Quiebre de stock: stock entre 1 y stockBreak. Productos en 0 ya están en "Sin stock".
          const lowStockCount = products.filter(p => { const { stock: es, unlimited: eu } = effectiveStock(p); return p.stockBreak != null && !eu && es > 0 && es <= p.stockBreak; }).length;
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
          <>
          <div className="space-y-3">
            {/* Antes se filtraba+mapeaba acá mismo sobre todo `products`. Ahora el filtro por tab y la
                paginación (50/pág) se calculan arriba en `pagedProducts`, para poder mostrar controles de página. */}
            {/* {products.filter(p => {
              const { stock: es, unlimited: eu } = effectiveStock(p);
              if (isSinStock)     return !eu && es <= 0;
              if (isQuiebreStock) return p.stockBreak !== null && !eu && es > 0 && es <= p.stockBreak;
              return true;
            }).map((p) => { */}
            {pagedProducts.map((p) => {
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
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                        {p.sku && (
                          <span className="text-xs text-slate-400 font-mono">SKU: {p.sku}</span>
                        )}
                        {(() => {
                          const es = effectiveStock(p);
                          const hasVariants = (p._count?.variants ?? 0) > 0;
                          const stockNode = es.unlimited
                            ? "Ilimitado"
                            : es.stock === 0
                              ? <span className="text-red-500">Sin stock</span>
                              : es.stock <= 5
                                ? <span className="text-orange-500">{es.stock} unid.</span>
                                : <span className="text-green-600">{es.stock} unid.</span>;
                          return (
                            <span className="text-xs text-slate-500">
                              Stock: {stockNode}
                              {hasVariants && !es.unlimited && <span className="text-slate-400 ml-1">(variantes)</span>}
                            </span>
                          );
                        })()}
                        {(p._count?.variants ?? 0) > 0 && (
                          <span className="text-xs text-slate-400 hidden sm:inline">
                            {p._count.variants} variante{p._count.variants !== 1 ? "s" : ""} activa{p._count.variants !== 1 ? "s" : ""}.
                          </span>
                        )}
                        {p.totalSold > 0 && (
                          <span className="text-xs text-emerald-600 font-medium">
                            🛒 {p.totalSold} vendida{p.totalSold !== 1 ? "s" : ""}
                          </span>
                        )}
                        {p.featured && (
                          <span className="text-xs text-blue-600 font-medium hidden sm:inline">⭐ Destacado</span>
                        )}
                      </div>
                    </div>

                    {/* Controles derecha */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {/* Toggle Publicado */}
                      {(() => {
                        const { stock: es, unlimited: eu } = effectiveStock(p);
                        const sinStock = !eu && es <= 0;
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
                      <div className="hidden sm:flex flex-col gap-1">
                        <button
                          onClick={() => openEdit(p)}
                          className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-semibold transition-colors"
                        >
                          Editar producto
                        </button>
                        {/* "Guardar todo" — solo aparece cuando hay 2+ variantes y la edición rápida está abierta.
                            Guarda el producto Y todas las variantes en un único click. */}
                        {isQuickOpen && (quickEditVariants[p.id]?.length ?? 0) >= 2 && (
                          <button
                            onClick={async () => {
                              const variants = quickEditVariants[p.id] || [];
                              // Guarda el producto (precios, costo, etc.) + todas las variantes en paralelo
                              await Promise.all([
                                handleQuickSave(p),
                                ...variants.map((v) => handleVariantQuickSave(v.id)),
                              ]);
                            }}
                            disabled={isSaving}
                            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                          >
                            Guardar todo
                          </button>
                        )}
                      </div>

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
                            {/* Anchos compactos en md, más generosos desde xl — antes el botón Guardar
                                quedaba fuera de pantalla en laptops de ~1024-1366px y había que scrollear */}
                            <tr className="text-left text-xs text-slate-500 font-semibold uppercase tracking-wide border-b border-slate-200">
                              <th className="px-3 py-3 w-44 xl:w-56">Variantes</th>
                              <th className="px-2 py-3 w-24 xl:w-32">Stock</th>
                              <th className="px-2 py-3 w-24 xl:w-32">Costo</th>
                              {/* Para productos CON variantes: una sola columna "Precios" con los 4 inputs apilados según visibility.
                                  Para productos SIN variantes: 4 columnas separadas (formato original). */}
                              {(p._count?.variants ?? 0) === 0 ? <>
                                <th className="px-2 py-3 w-28 xl:w-36">Precio minorista</th>
                                <th className="px-2 py-3 w-28 xl:w-36">Oferta minorista</th>
                                <th className="px-2 py-3 w-28 xl:w-36">Precio mayorista</th>
                                <th className="px-2 py-3 w-28 xl:w-36">Oferta mayorista</th>
                              </> : (
                                <th className="px-2 py-3 w-40 xl:w-48">Precios</th>
                              )}
                              <th className="px-2 py-3 w-24 xl:w-32">SKU</th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* Si tiene variantes activas: una fila por variante */}
                            {(p._count?.variants ?? 0) > 0 ? (
                              quickEditVariants[p.id]
                                ? quickEditVariants[p.id].map((v) => {
                                    const vv = variantEditValues[v.id] || {};
                                    const vSaving = variantSaving.has(v.id);
                                    const variantImg = v.image || img;
                                    const combinationLabel = Array.isArray(v.combination)
                                      ? v.combination.map((c) => c.value).join(" / ")
                                      : "—";
                                    return (
                                      <tr key={v.id} className="border-t border-slate-100">
                                        {/* Variante: imagen + combinación + SKU */}
                                        <td className="px-5 py-3">
                                          <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg overflow-hidden bg-white border border-slate-200 flex-shrink-0">
                                              {variantImg
                                                ? <img src={getImageUrl(variantImg)} alt={combinationLabel} className="w-full h-full object-cover" />
                                                : <div className="w-full h-full flex items-center justify-center text-base">📦</div>}
                                            </div>
                                            <div>
                                              <p className="text-slate-700 font-semibold text-xs">{combinationLabel}</p>
                                              <p className="text-slate-400 text-xs">SKU: {vv.sku || "—"}</p>
                                            </div>
                                          </div>
                                        </td>

                                        {/* Stock variante */}
                                        <td className="px-4 py-3">
                                          {vv.stockUnlimited ? (
                                            <div className="flex items-center gap-1">
                                              <input type="text" value="∞" readOnly className="w-20 px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-400 text-center text-sm cursor-not-allowed" />
                                              <button type="button" onClick={() => setVariantField(v.id, "stockUnlimited", false)} className="text-xs text-blue-600 hover:underline whitespace-nowrap">Limitar</button>
                                            </div>
                                          ) : (
                                            <div className="flex items-center gap-1">
                                              <input type="number" min="0" value={vv.stock ?? ""} onChange={(e) => setVariantField(v.id, "stock", e.target.value)} className="w-20 px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-center" />
                                              <button type="button" onClick={() => setVariantField(v.id, "stockUnlimited", true)} className="text-xs text-blue-600 hover:underline whitespace-nowrap" title="Stock ilimitado">∞</button>
                                            </div>
                                          )}
                                        </td>

                                        {/* Costo variante */}
                                        <td className="px-4 py-3">
                                          <div className="flex items-center gap-1">
                                            <span className="text-slate-400 text-sm">$</span>
                                            <input type="number" step="0.01" min="0" value={vv.cost ?? ""} onChange={(e) => setVariantField(v.id, "cost", e.target.value)} placeholder="Base" className="w-24 px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm placeholder-slate-300" />
                                          </div>
                                        </td>

                                        {/* Precios — los inputs que se muestran dependen de la visibility heredada del atributo */}
                                        <td className="px-4 py-3">
                                          <div className="flex flex-col gap-1 min-w-[160px]">
                                            {/* Minorista: visible si visibility AMBOS o MINORISTA */}
                                            {(vv.visibility === "MINORISTA" || vv.visibility === "AMBOS") && (
                                              <>
                                                <div className="flex items-center gap-1">
                                                  <span className="text-[10px] text-slate-500 w-10 shrink-0">Min</span>
                                                  <span className="text-slate-400 text-xs">$</span>
                                                  <input type="number" step="0.01" min="0" value={vv.price ?? ""} onChange={(e) => setVariantField(v.id, "price", e.target.value)} placeholder="Base" className="flex-1 px-2 py-1 border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs placeholder-slate-300" />
                                                </div>
                                                <div className="flex items-center gap-1">
                                                  <span className="text-[10px] text-red-500 w-10 shrink-0">Of.Min</span>
                                                  <span className="text-slate-400 text-xs">$</span>
                                                  <input type="number" step="0.01" min="0" value={vv.salePrice ?? ""} onChange={(e) => setVariantField(v.id, "salePrice", e.target.value)} placeholder="—" className="flex-1 px-2 py-1 border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs placeholder-slate-300" />
                                                </div>
                                              </>
                                            )}
                                            {/* Mayorista: visible si visibility AMBOS o MAYORISTA */}
                                            {(vv.visibility === "MAYORISTA" || vv.visibility === "AMBOS") && (
                                              <>
                                                <div className="flex items-center gap-1">
                                                  <span className="text-[10px] text-purple-600 w-10 shrink-0">May</span>
                                                  <span className="text-slate-400 text-xs">$</span>
                                                  <input type="number" step="0.01" min="0" value={vv.wholesalePrice ?? ""} onChange={(e) => setVariantField(v.id, "wholesalePrice", e.target.value)} placeholder="—" className="flex-1 px-2 py-1 border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs placeholder-slate-300" />
                                                </div>
                                                <div className="flex items-center gap-1">
                                                  <span className="text-[10px] text-red-500 w-10 shrink-0">Of.May</span>
                                                  <span className="text-slate-400 text-xs">$</span>
                                                  <input type="number" step="0.01" min="0" value={vv.wholesaleSalePrice ?? ""} onChange={(e) => setVariantField(v.id, "wholesaleSalePrice", e.target.value)} placeholder="—" className="flex-1 px-2 py-1 border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs placeholder-slate-300" />
                                                </div>
                                              </>
                                            )}
                                          </div>
                                        </td>

                                        {/* SKU variante */}
                                        <td className="px-4 py-3">
                                          <input type="text" value={vv.sku ?? ""} onChange={(e) => setVariantField(v.id, "sku", e.target.value)} placeholder="SKU" className="w-full xl:w-28 px-2 xl:px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm placeholder-slate-300" />
                                        </td>
                                      </tr>
                                    );
                                  })
                                : (
                                  <tr>
                                    <td colSpan={8} className="px-5 py-4 text-center text-slate-400 text-sm">
                                      Cargando variantes...
                                    </td>
                                  </tr>
                                )
                            ) : (
                              /* Sin variantes: fila base del producto */
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
                              <td className="px-2 xl:px-4 py-4">
                                {qv.stockUnlimited ? (
                                  <div className="flex items-center gap-1">
                                    <input type="text" value="∞" readOnly className="w-20 px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-400 text-center text-sm cursor-not-allowed" />
                                    <button type="button" onClick={() => setQuickField(p.id, "stockUnlimited", false)} className="text-xs text-blue-600 hover:underline whitespace-nowrap">Limitar</button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <input type="number" min="0" value={qv.stock ?? ""} onChange={(e) => setQuickField(p.id, "stock", e.target.value)} className="w-20 px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-center" />
                                    <button type="button" onClick={() => setQuickField(p.id, "stockUnlimited", true)} className="text-xs text-blue-600 hover:underline whitespace-nowrap">∞</button>
                                  </div>
                                )}
                              </td>
                              {/* Costo base del producto */}
                              <td className="px-2 xl:px-4 py-4"><div className="flex items-center gap-1"><span className="text-slate-500 text-sm">$</span><input type="number" step="0.01" min="0" value={qv.cost ?? ""} onChange={(e) => setQuickField(p.id, "cost", e.target.value)} placeholder="—" className="w-full xl:w-28 px-2 xl:px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm placeholder-slate-300" /></div></td>
                              {/* Precio minorista base del producto */}
                              <td className="px-2 xl:px-4 py-4"><div className="flex items-center gap-1"><span className="text-slate-500 text-sm">$</span><input type="number" step="0.01" min="0" value={qv.price ?? ""} onChange={(e) => setQuickField(p.id, "price", e.target.value)} className="w-full xl:w-28 px-2 xl:px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" /></div></td>
                              {/* Oferta minorista */}
                              <td className="px-2 xl:px-4 py-4"><div className="flex items-center gap-1"><span className="text-slate-500 text-sm">$</span><input type="number" step="0.01" min="0" value={qv.salePrice ?? ""} onChange={(e) => setQuickField(p.id, "salePrice", e.target.value)} placeholder="—" className="w-full xl:w-28 px-2 xl:px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm placeholder-slate-300" /></div></td>
                              {/* Precio mayorista */}
                              <td className="px-2 xl:px-4 py-4"><div className="flex items-center gap-1"><span className="text-slate-500 text-sm">$</span><input type="number" step="0.01" min="0" value={qv.wholesalePrice ?? ""} onChange={(e) => setQuickField(p.id, "wholesalePrice", e.target.value)} placeholder="—" className="w-full xl:w-28 px-2 xl:px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm placeholder-slate-300" /></div></td>
                              {/* Oferta mayorista */}
                              <td className="px-2 xl:px-4 py-4"><div className="flex items-center gap-1"><span className="text-slate-500 text-sm">$</span><input type="number" step="0.01" min="0" value={qv.wholesaleSalePrice ?? ""} onChange={(e) => setQuickField(p.id, "wholesaleSalePrice", e.target.value)} placeholder="—" className="w-full xl:w-28 px-2 xl:px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm placeholder-slate-300" /></div></td>
                              {/* SKU base del producto */}
                              <td className="px-2 xl:px-4 py-4"><input type="text" value={qv.sku ?? ""} onChange={(e) => setQuickField(p.id, "sku", e.target.value)} placeholder="SKU" className="w-full xl:w-28 px-2 xl:px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm placeholder-slate-300" /></td>
                              <td className="px-2 xl:px-4 py-4">
                                <button onClick={() => handleQuickSave(p)} disabled={isSaving} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 whitespace-nowrap">
                                  {isSaving ? "..." : "Guardar"}
                                </button>
                              </td>
                            </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Si el filtro por tab no deja ningún producto en esta vista */}
          {filteredProducts.length === 0 && (
            <div className="card py-12 text-center text-slate-400">
              No hay productos en esta vista.
            </div>
          )}

          {/* ── Controles de paginación (50 productos por página) ───────────────── */}
          {listTotalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-semibold text-slate-600 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Anterior
              </button>

              {/* Números de página (compacto: muestra hasta 7 páginas centradas en la actual) */}
              {(() => {
                const pages = [];
                const maxButtons = 7;
                let start = Math.max(1, safePage - 3);
                let end = Math.min(listTotalPages, start + maxButtons - 1);
                start = Math.max(1, end - maxButtons + 1);
                for (let i = start; i <= end; i++) pages.push(i);
                return pages.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPage(n)}
                    className={`min-w-[2.25rem] px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      n === safePage
                        ? "bg-blue-600 text-white"
                        : "border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700"
                    }`}
                  >
                    {n}
                  </button>
                ));
              })()}

              <button
                type="button"
                onClick={() => setPage((p) => Math.min(listTotalPages, p + 1))}
                disabled={safePage >= listTotalPages}
                className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-semibold text-slate-600 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Siguiente →
              </button>
            </div>
          )}

          {/* Texto: "Mostrando X–Y de Z" */}
          {filteredProducts.length > 0 && (
            <p className="text-center text-xs text-slate-400 dark:text-slate-500 pt-1">
              Mostrando {(safePage - 1) * PER_PAGE + 1}–{Math.min(safePage * PER_PAGE, filteredProducts.length)} de {filteredProducts.length} productos
            </p>
          )}
          </>
        )}
      </div>

      {/* Modal ajuste masivo de precios */}
      {showPriceModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
            <h2 className="text-lg font-bold text-slate-900">Ajuste masivo de precios</h2>
            <p className="text-sm text-slate-500">Se aplicará a todos los productos, incluyendo precios de oferta y tiers.</p>

            {/* Lista de precios */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Lista de precios</p>
              <div className="flex gap-2">
                {["MINORISTA", "MAYORISTA", "AMBOS"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setPriceAdjust((p) => ({ ...p, type: t }))}
                    className={`flex-1 py-2 rounded-xl border-2 text-xs font-semibold transition-all ${
                      priceAdjust.type === t
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {t === "MINORISTA" ? "🛍 Minorista" : t === "MAYORISTA" ? "🏭 Mayorista" : "↕ Ambos"}
                  </button>
                ))}
              </div>
            </div>

            {/* Tipo de ajuste */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Tipo de ajuste</p>
              <div className="flex gap-2">
                {[{ key: "aumento", label: "📈 Aumento" }, { key: "reduccion", label: "📉 Reducción" }].map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setPriceAdjust((p) => ({ ...p, direction: d.key }))}
                    className={`flex-1 py-2 rounded-xl border-2 text-xs font-semibold transition-all ${
                      priceAdjust.direction === d.key
                        ? d.key === "aumento"
                          ? "border-green-600 bg-green-50 text-green-700"
                          : "border-red-500 bg-red-50 text-red-600"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Porcentaje */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Porcentaje</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  placeholder="Ej: 10"
                  value={priceAdjust.percent}
                  onChange={(e) => setPriceAdjust((p) => ({ ...p, percent: e.target.value }))}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <span className="text-slate-500 font-semibold">%</span>
              </div>
              {priceAdjust.percent > 0 && (
                <p className="text-xs mt-2 text-slate-500">
                  Se aplicará un{" "}
                  <span className={priceAdjust.direction === "aumento" ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                    {priceAdjust.direction} del {priceAdjust.percent}%
                  </span>{" "}
                  a todos los precios <strong>{priceAdjust.type.toLowerCase()}</strong>.
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => setShowPriceModal(false)} className="btn-secondary flex-1">
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleBulkPriceAdjust}
                disabled={applyingPrice || !priceAdjust.percent}
                className={`flex-1 py-2 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-50 ${
                  priceAdjust.direction === "aumento"
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-red-500 hover:bg-red-600"
                }`}
              >
                {applyingPrice ? "Aplicando…" : "Aplicar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal exportar Excel — movido a AdminFlyer.jsx junto con el botón de exportar.
          Ahora el admin selecciona productos específicos en la vista de Generar Flyer
          y desde ahí puede exportar a Excel o generar PDF. */}
      {/* {showExportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
            <h2 className="text-lg font-bold text-slate-900">Exportar productos a Excel</h2>
            <p className="text-sm text-slate-600">
              Seleccioná qué lista de precios querés incluir en el archivo.
            </p>

            <div className="flex gap-3">
              {["MINORISTA", "MAYORISTA"].map((tipo) => (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => setExportType(tipo)}
                  className={`flex-1 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                    exportType === tipo
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {tipo === "MINORISTA" ? "🛍 Minorista" : "🏭 Mayorista"}
                </button>
              ))}
            </div>

            <p className="text-xs text-slate-400">
              El archivo incluirá: Foto (URL), Título, SKU y Precio {exportType.toLowerCase()}.
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="btn-secondary flex-1"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExport}
                className="btn-primary flex-1"
              >
                📥 Descargar
              </button>
            </div>
          </div>
        </div>
      )} */}

      {/* Modal editar producto (crear va a /admin/productos/nuevo) */}
      {showModal && editingProduct && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
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
              {/* Nombre + SKU en la misma fila */}
              <div className="grid grid-cols-[2fr_1fr] gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Título *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => {
                      // Pasar a mayúsculas preservando la posición del cursor (si no, salta al final).
                      const el = e.target;
                      const s = el.selectionStart, en = el.selectionEnd;
                      setForm((f) => ({ ...f, name: el.value.toUpperCase() }));
                      requestAnimationFrame(() => { try { el.setSelectionRange(s, en); } catch (_) {} });
                    }}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">SKU</label>
                  <input
                    type="text"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    placeholder={form.name ? nameToSku(form.name) : "Código interno"}
                    className="input"
                  />
                </div>
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

              {/* Depósito y proveedor (solo admin) */}
              <WarehouseSupplierFields
                form={form}
                setForm={setForm}
                suppliers={suppliers}
                setSuppliers={setSuppliers}
              />

              {/* Descripción — editor rich text */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Descripción</label>
                <RichTextEditor
                  value={form.description}
                  onChange={(html) => setForm((f) => ({ ...f, description: html }))}
                />
              </div>

              {/* Visible para — MOVIDO ACÁ (encima de costo/precios) a pedido del cliente:
                  define qué precios se muestran abajo (minorista / mayorista). */}
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

              {/* Costo (interno) + Alícuota IVA en la misma fila */}
              <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
                    Costo * <span className="normal-case font-normal text-slate-400">— solo visible para el admin</span>
                  </label>
                  <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-400 h-9">
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
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">IVA</label>
                  <div className="flex gap-2">
                    {[{ value: "21", label: "21%" }, { value: "10.5", label: "10,5%" }].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setForm({ ...form, ivaRate: opt.value })}
                        className={`px-3 h-9 rounded-lg border-2 text-sm font-semibold transition-colors whitespace-nowrap ${
                          form.ivaRate === opt.value
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Precios — solo se muestran los relevantes según "Visible para" (arriba) */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Precio minorista", key: "price", required: true, group: "min" },
                  { label: "Oferta minorista", key: "salePrice", group: "min" },
                  { label: "Precio mayorista", key: "wholesalePrice", group: "may" },
                  { label: "Oferta mayorista", key: "wholesaleSalePrice", group: "may" },
                ].filter((f) =>
                  (f.group === "min" && (form.visibility === "AMBOS" || form.visibility === "MINORISTA")) ||
                  (f.group === "may" && (form.visibility === "AMBOS" || form.visibility === "MAYORISTA"))
                ).map(({ label, key, required }) => (
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
                        onFocus={() => {
                          // Guardar el precio actual antes de que el usuario empiece a escribir
                          if (key === "price" || key === "wholesalePrice") {
                            priceBeforeEditRef.current[key] = form[key];
                          }
                        }}
                        onBlur={() => {
                          // Al salir del campo, ajustar los tiers proporcionalmente al cambio de precio
                          if (key === "price") {
                            const oldPrice = parseFloat(priceBeforeEditRef.current.price);
                            const newPrice = parseFloat(form.price);
                            if (oldPrice > 0 && newPrice > 0 && !isNaN(oldPrice) && !isNaN(newPrice) && oldPrice !== newPrice && form.priceTiers.length > 0) {
                              const ratio = newPrice / oldPrice;
                              setForm((f) => ({
                                ...f,
                                priceTiers: f.priceTiers.map((t) => ({
                                  ...t,
                                  price: t.price ? String(Math.round(parseFloat(t.price) * ratio * 100) / 100) : t.price,
                                })),
                              }));
                            }
                          }
                          if (key === "wholesalePrice") {
                            const oldPrice = parseFloat(priceBeforeEditRef.current.wholesalePrice);
                            const newPrice = parseFloat(form.wholesalePrice);
                            if (oldPrice > 0 && newPrice > 0 && !isNaN(oldPrice) && !isNaN(newPrice) && oldPrice !== newPrice && form.wholesalePriceTiers.length > 0) {
                              const ratio = newPrice / oldPrice;
                              setForm((f) => ({
                                ...f,
                                wholesalePriceTiers: f.wholesalePriceTiers.map((t) => ({
                                  ...t,
                                  price: t.price ? String(Math.round(parseFloat(t.price) * ratio * 100) / 100) : t.price,
                                })),
                              }));
                            }
                          }
                        }}
                        placeholder="—"
                        required={required}
                        className="flex-1 px-2 py-2 text-sm focus:outline-none w-0"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Stock:
                  - Sin variantes → stock único editable para todos los clientes
                  - Con variantes → read-only mostrando la suma de stocks de las variantes */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Stock
                  </label>
                  {(editingProduct?._count?.variants ?? 0) > 0 ? (
                    // Producto con variantes: stock es la suma de las variantes, no editable
                    <>
                      <div className="input bg-slate-100 text-slate-500 flex items-center gap-1 cursor-not-allowed select-none" title="Calculado automáticamente como suma de las variantes">
                        {editingProduct.variantStockTotal === -1
                          ? "∞ Ilimitado"
                          : (editingProduct.variantStockTotal ?? 0)}
                        <span className="text-slate-400 text-xs ml-1">unid.</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">Suma automática de las variantes — editá el stock por variante abajo.</p>
                    </>
                  ) : form.stockUnlimited ? (
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
                  {(editingProduct?._count?.variants ?? 0) === 0 && (
                    <label className="flex items-center gap-2 mt-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.stockUnlimited}
                        onChange={(e) => setForm({ ...form, stockUnlimited: e.target.checked })}
                        className="w-4 h-4 accent-blue-600"
                      />
                      <span className="text-xs text-slate-500">Stock ilimitado</span>
                    </label>
                  )}
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

              {/* Descuentos por cantidad — solo el tipo visible según "Visible para" */}
              {(form.visibility === "AMBOS" || form.visibility === "MINORISTA") && (
                <TierEditor
                  label="Descuentos por cantidad — Minoristas"
                  tiers={form.priceTiers}
                  fieldKey="priceTiers"
                  setForm={setForm}
                />
              )}

              {(form.visibility === "AMBOS" || form.visibility === "MAYORISTA") && (
                <TierEditor
                  label="Descuentos por cantidad — Mayoristas"
                  tiers={form.wholesalePriceTiers}
                  fieldKey="wholesalePriceTiers"
                  setForm={setForm}
                />
              )}

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

                {/* Mini-form para crear una categoría nueva sin salir del modal */}
                {!showNewCatForm ? (
                  <button
                    type="button"
                    onClick={() => setShowNewCatForm(true)}
                    className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1"
                  >
                    + Crear nueva categoría
                  </button>
                ) : (
                  <div className="mt-2 border border-blue-200 rounded-lg p-3 bg-blue-50 space-y-2">
                    <p className="text-xs font-semibold text-blue-700">Nueva categoría</p>
                    <input
                      type="text"
                      placeholder="Nombre de la categoría"
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    <select
                      value={newCatParentId}
                      onChange={(e) => setNewCatParentId(e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Sin categoría padre (raíz)</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleCreateCategory}
                        disabled={savingCat || !newCatName.trim()}
                        className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-semibold"
                      >
                        {savingCat ? "Creando..." : "Crear"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowNewCatForm(false); setNewCatName(""); setNewCatParentId(""); }}
                        className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 bg-white"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Opciones */}
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.featured}
                    onChange={(e) => setForm({ ...form, featured: e.target.checked })}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-700">⭐ Destacado en Home</span>
                    {form.featured && !editingProduct && (
                      <p className="text-xs text-amber-600">Máx. 20 — si ya hay 20, el más viejo se desmarca</p>
                    )}
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.onSale}
                    onChange={(e) => setForm({ ...form, onSale: e.target.checked })}
                    className="w-4 h-4 accent-orange-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-700">🔥 Oferta en Home</span>
                    {form.onSale && !editingProduct && (
                      <p className="text-xs text-amber-600">Máx. 20 — si ya hay 20, el más viejo se desmarca</p>
                    )}
                  </div>
                </label>
                {/* Más vendido con threshold */}
                <div className={`flex flex-col gap-2 px-3 py-2.5 rounded-xl border-2 transition-colors ${form.hotSeller ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.hotSeller ?? false}
                      onChange={(e) => setForm({ ...form, hotSeller: e.target.checked })}
                      className="w-4 h-4 accent-red-500"
                    />
                    <span className="text-sm font-semibold text-slate-700">🔥 Más vendido</span>
                  </label>
                  {/* Input de threshold: si se define, el backend auto-activa hotSeller cuando totalSold >= threshold */}
                  <div className="flex items-center gap-2 pl-6">
                    <span className="text-xs text-slate-500 whitespace-nowrap">Auto-activar desde</span>
                    <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-red-400 bg-white">
                      <input
                        type="number"
                        min="1"
                        value={form.hotSellerThreshold}
                        onChange={(e) => setForm({ ...form, hotSellerThreshold: e.target.value })}
                        placeholder="—"
                        className="w-16 px-2 py-1 text-sm focus:outline-none text-center"
                      />
                      <span className="px-2 py-1 text-xs text-slate-400 border-l border-slate-200 bg-slate-50">unid.</span>
                    </div>
                    {form.hotSellerThreshold && (
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, hotSellerThreshold: "" })}
                        className="text-slate-400 hover:text-slate-600 text-sm leading-none"
                      >✕</button>
                    )}
                  </div>
                  {form.hotSellerThreshold && (
                    <p className="text-xs text-red-500 pl-6">
                      🔥 se activa al llegar a {form.hotSellerThreshold}+ unidades vendidas
                    </p>
                  )}
                </div>
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

              {/* (El bloque "Visible para" se movió arriba, encima de Costo/Precios, a pedido del cliente.) */}

              {/* TierEditors movidos arriba, junto a stock/precios */}

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
                  <>
                    <p className="text-xs text-blue-600 mt-2">
                      {newImages.length} imagen{newImages.length > 1 ? "es" : ""} seleccionada{newImages.length > 1 ? "s" : ""} (preview antes de guardar)
                    </p>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mt-2">
                      {newImages.map((file, idx) => {
                        // URL.createObjectURL crea una URL temporal del File en memoria.
                        // No es necesario revokeObjectURL acá porque el navegador la libera
                        // automáticamente al desmontar el modal/cerrar la pestaña.
                        const previewUrl = URL.createObjectURL(file);
                        return (
                          <div key={`${file.name}-${idx}`} className="relative group aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                            <img
                              src={previewUrl}
                              alt={file.name}
                              className="w-full h-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => setNewImages((prev) => prev.filter((_, i) => i !== idx))}
                              className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-red-700"
                              title="Quitar imagen"
                            >
                              ✕
                            </button>
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate">
                              {file.name}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Variantes — solo en modo edición (el producto ya tiene ID) */}
              {editingProduct && (
                <>
                  {/* Aviso "Solo para minoristas" eliminado — ahora las variantes pueden ser para minorista,
                      mayorista o ambos según la visibilidad de cada atributo. */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowVariants((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-sm font-semibold text-slate-700"
                  >
                    <span>🎨 Variantes del producto</span>
                    <span className="text-slate-400">{showVariants ? "▲" : "▼"}</span>
                  </button>
                  {showVariants && (
                    <div className="p-4 border-t border-slate-200">
                      <ProductVariantsEditor
                        productId={editingProduct.id}
                        basePrice={editingProduct.price}
                        baseWholesalePrice={editingProduct.wholesalePrice}
                        productImages={editingProduct.images || []}
                      />
                    </div>
                  )}
                </div>
                </>
              )}

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

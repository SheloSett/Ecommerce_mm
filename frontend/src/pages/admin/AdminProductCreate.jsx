import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AdminLayout from "../../components/AdminLayout";
import { productsApi, categoriesApi, suppliersApi, aiApi } from "../../services/api"; // getImageUrl no se usa en creación (sin imágenes previas)
import toast from "react-hot-toast";
import RichTextEditor from "../../components/RichTextEditor";
import ProductVariantsEditor from "../../components/admin/ProductVariantsEditor";
import TierEditor from "../../components/admin/TierEditor";
import WarehouseSupplierFields from "../../components/admin/WarehouseSupplierFields";

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
  priceTiers: [],
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
  categoryIds: [],
  featured: false,
  // onSale: marca el producto para la sección "Ofertas" de la home
  onSale: false,
  hotSeller: false,
  hotSellerThreshold: "",
  active: true,
  visibility: "AMBOS",
};

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

export default function AdminProductCreate() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_FORM);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [newImages, setNewImages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedProduct, setSavedProduct] = useState(null);
  const fileInputRef = useRef();
  const priceBeforeEditRef = useRef({});

  // Mini-formulario "Crear categoría" inline
  const [showNewCatForm, setShowNewCatForm] = useState(false);
  const [newCatName, setNewCatName]         = useState("");
  const [newCatParentId, setNewCatParentId] = useState("");
  const [savingCat, setSavingCat]           = useState(false);

  useEffect(() => {
    categoriesApi.getAll().then((res) => setCategories(res.data));
    suppliersApi.getAll().then((res) => setSuppliers(res.data)).catch(() => {});
  }, []);

  const handleImageSelect = (e) => {
    const files = Array.from(e.target.files);
    e.target.value = ""; // resetea el input: permite volver a elegir (incluso el mismo archivo)
    const total = newImages.length + files.length;
    // Acumula en vez de reemplazar; tope de 10 imágenes (lo que dice el label)
    setNewImages((prev) => [...prev, ...files].slice(0, 10));
    if (total > 10) toast.error("Máximo 10 imágenes — se agregaron hasta completar 10");
  };

  // ─── Asistente de IA (Gemini) ──────────────────────────────────────────────
  const [aiLoadingText, setAiLoadingText]     = useState(false);
  const [aiLoadingImages, setAiLoadingImages] = useState(false);
  const [aiImages, setAiImages]               = useState([]);          // dataURLs generadas
  const [aiAdded, setAiAdded]                 = useState(new Set());   // índices ya agregados

  // Previsualización de las fotos seleccionadas: object URLs que se revocan al cambiar la lista
  const [imagePreviews, setImagePreviews] = useState([]);
  useEffect(() => {
    const urls = newImages.map((f) => ({ url: URL.createObjectURL(f), name: f.name }));
    setImagePreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u.url));
  }, [newImages]);

  const removeImageAt = (idx) => {
    setNewImages((prev) => prev.filter((_, i) => i !== idx));
  };

  // Sugerir título, descripción y SKU a partir de la primera foto subida.
  const handleAiSuggestText = async () => {
    const base = newImages[0];
    if (!base) { toast.error("Subí una foto del producto primero"); return; }
    setAiLoadingText(true);
    try {
      const fd = new FormData();
      fd.append("image", base);
      const res = await aiApi.suggestText(fd);
      setForm((f) => ({
        ...f,
        name:        (res.data.name || f.name || "").toUpperCase(),
        description: res.data.description || f.description,
        sku:         res.data.sku         || f.sku,
      }));
      toast.success("Datos sugeridos por IA ✨");
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo sugerir con IA");
    } finally {
      setAiLoadingText(false);
    }
  };

  // Generar variantes de la foto (el admin elige cuáles agregar).
  const handleAiSuggestImages = async () => {
    const base = newImages[0];
    if (!base) { toast.error("Subí una foto del producto primero"); return; }
    setAiLoadingImages(true);
    setAiImages([]);
    setAiAdded(new Set());
    try {
      const fd = new FormData();
      fd.append("image", base);
      fd.append("count", "3");
      const res = await aiApi.suggestImages(fd);
      setAiImages(res.data.images || []);
      if (!(res.data.images || []).length) toast.error("La IA no devolvió imágenes");
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudieron generar imágenes");
    } finally {
      setAiLoadingImages(false);
    }
  };

  // dataURL → File, para que la foto generada se suba igual que las demás al guardar.
  const dataUrlToFile = (dataUrl, filename) => {
    const [meta, b64] = dataUrl.split(",");
    const mime = (meta.match(/data:(.*?);base64/) || [])[1] || "image/png";
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], filename, { type: mime });
  };

  const addAiImage = (idx) => {
    if (aiAdded.has(idx)) return;
    const dataUrl = aiImages[idx];
    const ext = (dataUrl.match(/data:image\/(\w+)/) || [])[1] || "png";
    const file = dataUrlToFile(dataUrl, `ia-${Date.now()}-${idx}.${ext}`);
    setNewImages((prev) => [...prev, file]);
    setAiAdded((prev) => new Set(prev).add(idx));
    toast.success("Foto agregada");
  };

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) return;
    setSavingCat(true);
    try {
      const payload = { name: newCatName.trim() };
      if (newCatParentId) payload.parentId = parseInt(newCatParentId);
      const res = await categoriesApi.create(payload);
      const created = res.data;
      const catsRes = await categoriesApi.getAll();
      setCategories(catsRes.data);
      setForm((f) => ({ ...f, categoryIds: [...f.categoryIds, created.id.toString()] }));
      setNewCatName("");
      setNewCatParentId("");
      setShowNewCatForm(false);
    } catch (err) {
      alert(err.response?.data?.error || "Error al crear la categoría");
    } finally {
      setSavingCat(false);
    }
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
    // || → no pisa un valor ya cargado.
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
      formData.append("sku", form.sku);
      formData.append("youtubeUrl", form.youtubeUrl);
      formData.append("weight", form.weight);
      formData.append("length", form.length);
      formData.append("width", form.width);
      formData.append("height", form.height);
      // Depósito + proveedor (solo admin)
      formData.append("module", form.module || "");
      formData.append("shelf", form.shelf || "");
      formData.append("supplierId", form.supplierId || "");
      formData.append("featured", form.featured);
      formData.append("onSale", form.onSale);
      formData.append("hotSeller", form.hotSeller);
      if (form.hotSellerThreshold) formData.append("hotSellerThreshold", form.hotSellerThreshold);
      formData.append("active", form.active);
      formData.append("visibility", form.visibility || "AMBOS");
      formData.append("priceTiers", JSON.stringify(form.priceTiers));
      formData.append("wholesalePriceTiers", JSON.stringify(form.wholesalePriceTiers || []));
      form.categoryIds.forEach((id) => formData.append("categoryIds", id));
      newImages.forEach((file) => formData.append("images", file));

      const res = await productsApi.create(formData);
      toast.success("Producto creado. Ahora podés agregar variantes.");
      setSavedProduct(res.data);
    } catch (err) {
      const msg = err.response?.data?.error || "Error al guardar el producto";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // Reinicia el formulario para cargar OTRO producto sin volver al listado.
  const startNewProduct = () => {
    setSavedProduct(null);
    setForm(EMPTY_FORM);
    setNewImages([]);
    setAiImages([]);
    setAiAdded(new Set());
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ─── Vista post-creación: editor de variantes ────────────────────────────
  if (savedProduct) {
    return (
      <AdminLayout>
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-800">¡Producto creado!</h1>
                <p className="text-sm text-slate-500">{savedProduct.name} — podés agregar variantes ahora o hacerlo después</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={startNewProduct}
                className="btn-secondary whitespace-nowrap"
              >
                + Nuevo producto
              </button>
              <button
                onClick={() => navigate("/admin/productos")}
                className="btn-primary whitespace-nowrap"
              >
                Ir al listado →
              </button>
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <ProductVariantsEditor productId={savedProduct.id} basePrice={savedProduct.price} baseWholesalePrice={savedProduct.wholesalePrice} productImages={savedProduct.images || []} suppliers={suppliers} />
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto">
        {/* Encabezado */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate("/admin/productos")}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Nuevo producto</h1>
            <p className="text-sm text-slate-500">Completá los datos para crear el producto</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">

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
                placeholder={form.name ? nameToSku(form.name) : "Código interno del producto"}
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
                { label: "Ancho", key: "width", unit: "cm" },
                { label: "Alto", key: "height", unit: "cm" },
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
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                { value: "AMBOS", label: "Todos", icon: "👥" },
                { value: "MINORISTA", label: "Minorista", icon: "🛒" },
                { value: "MAYORISTA", label: "Mayorista", icon: "🏭" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm({ ...form, visibility: opt.value })}
                  className={`flex items-center justify-center gap-1.5 px-2 sm:px-4 py-2 rounded-xl border-2 text-xs sm:text-sm font-medium transition-colors ${
                    form.visibility === opt.value
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <span>{opt.icon}</span>
                  <span className="truncate">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Costo + Alícuota IVA: apilados en mobile, en la misma fila desde sm */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Precio minorista", key: "price", required: true, group: "min" },
              { label: "Oferta minorista", key: "salePrice", group: "min" },
              { label: "Precio mayorista", key: "wholesalePrice", required: true, group: "may" },
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
                      if (key === "price" || key === "wholesalePrice") {
                        priceBeforeEditRef.current[key] = form[key];
                      }
                    }}
                    onBlur={() => {
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

          {/* Stock — 1 columna en mobile chico, 3 desde sm para que no queden cramped */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

          {/* Categorías */}
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

            {/* Mini-form para crear una categoría nueva sin salir del form */}
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
              <span className="text-sm font-medium text-slate-700">⭐ Destacado en Home</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.onSale}
                onChange={(e) => setForm({ ...form, onSale: e.target.checked })}
                className="w-4 h-4 accent-orange-500"
              />
              <span className="text-sm font-medium text-slate-700">🔥 Oferta en Home</span>
            </label>
            {/* Más vendido con threshold */}
            <div className={`flex flex-col gap-2 px-3 py-2.5 rounded-xl border-2 transition-colors ${form.hotSeller ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.hotSeller}
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

          {/* Imágenes */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Imágenes (máx. 10, 5MB c/u)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
            />
            {/* Miniaturas de las fotos seleccionadas (incluye las agregadas por IA) */}
            {imagePreviews.length > 0 && (
              <>
                <div className="mt-3 grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {imagePreviews.map((img, idx) => (
                    <div key={idx} className="relative group aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                      <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                      {idx === 0 && (
                        <span className="absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-600 text-white shadow">Principal</span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeImageAt(idx)}
                        title="Quitar"
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 hover:bg-red-600 text-white text-xs leading-none flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  {newImages.length} imagen{newImages.length > 1 ? "es" : ""} · la <strong>principal</strong> es la que usa la IA.
                </p>
              </>
            )}

            {/* ── Asistente de IA (Gemini) ── */}
            <div className="mt-4 rounded-2xl border border-violet-200 dark:border-violet-900/50 bg-gradient-to-br from-violet-50 to-fuchsia-50 dark:from-violet-950/40 dark:to-fuchsia-950/30 p-4 sm:p-5 shadow-sm">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-lg shadow-sm shrink-0">✨</div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight">Asistente de IA</h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">Completá los datos a partir de la foto principal</p>
                </div>
              </div>

              {newImages.length === 0 ? (
                <div className="text-xs text-slate-500 dark:text-slate-300 bg-white/70 dark:bg-slate-800/60 border border-violet-100 dark:border-violet-900/40 rounded-xl px-3 py-2.5">
                  📷 Subí una foto del producto arriba para habilitar las sugerencias.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* Autocompletar texto */}
                  <button
                    type="button"
                    onClick={handleAiSuggestText}
                    disabled={aiLoadingText}
                    className="group flex items-center gap-3 rounded-xl bg-white dark:bg-slate-800 border border-violet-200 dark:border-violet-900/50 hover:border-violet-400 hover:shadow-md disabled:opacity-60 disabled:hover:shadow-none px-3.5 py-3 text-left transition-all"
                  >
                    <span className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-300 flex items-center justify-center text-lg shrink-0">
                      {aiLoadingText
                        ? <span className="animate-spin rounded-full h-4 w-4 border-2 border-violet-500 border-t-transparent" />
                        : "📝"}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">Autocompletar datos</span>
                      <span className="block text-[11px] text-emerald-600 dark:text-emerald-400">Título, descripción y SKU · gratis</span>
                    </span>
                  </button>

                  {/* Generar fotos */}
                  <button
                    type="button"
                    onClick={handleAiSuggestImages}
                    disabled={aiLoadingImages}
                    className="group flex items-center gap-3 rounded-xl bg-white dark:bg-slate-800 border border-violet-200 dark:border-violet-900/50 hover:border-violet-400 hover:shadow-md disabled:opacity-60 disabled:hover:shadow-none px-3.5 py-3 text-left transition-all"
                  >
                    <span className="w-9 h-9 rounded-lg bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-600 dark:text-fuchsia-300 flex items-center justify-center text-lg shrink-0">
                      {aiLoadingImages
                        ? <span className="animate-spin rounded-full h-4 w-4 border-2 border-fuchsia-500 border-t-transparent" />
                        : "🖼️"}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">Generar fotos similares</span>
                      <span className="block text-[11px] text-amber-600 dark:text-amber-400">Requiere plan pago de Gemini</span>
                    </span>
                  </button>
                </div>
              )}

              {aiLoadingImages && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2.5 flex items-center gap-1.5">
                  <span className="animate-spin rounded-full h-3 w-3 border-2 border-fuchsia-500 border-t-transparent" />
                  Generando imágenes… puede tardar unos segundos.
                </p>
              )}

              {aiImages.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    Tocá las que quieras agregar (elegí solo las que se parezcan al producto real):
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {aiImages.map((src, idx) => {
                      const added = aiAdded.has(idx);
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => addAiImage(idx)}
                          disabled={added}
                          className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${added ? "border-green-500 ring-2 ring-green-200" : "border-slate-200 hover:border-violet-400"}`}
                        >
                          <img src={src} alt="" className="w-full h-full object-cover" />
                          <span className={`absolute bottom-1 right-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${added ? "bg-green-500 text-white" : "bg-black/60 text-white"}`}>
                            {added ? "✓ Agregada" : "+ Agregar"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                    ⚠️ Imágenes generadas por IA. Revisá que representen fielmente el producto antes de publicar.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Botones */}
          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => navigate("/admin/productos")}
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
              ) : (
                "Crear producto"
              )}
            </button>
          </div>
        </form>
      </div>
    </AdminLayout>
  );
}

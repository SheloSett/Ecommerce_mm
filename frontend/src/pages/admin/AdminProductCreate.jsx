import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
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
  priceTiers: [],
  wholesalePriceTiers: [],
  sku: "",
  youtubeUrl: "",
  weight: "",
  length: "",
  width: "",
  height: "",
  categoryIds: [],
  featured: false,
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
  const [newImages, setNewImages] = useState([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef();

  useEffect(() => {
    categoriesApi.getAll().then((res) => setCategories(res.data));
  }, []);

  const handleImageSelect = (e) => {
    setNewImages(Array.from(e.target.files));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.price || !form.cost) {
      toast.error("Nombre, precio y costo son requeridos");
      return;
    }
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
      formData.append("sku", form.sku);
      formData.append("youtubeUrl", form.youtubeUrl);
      formData.append("weight", form.weight);
      formData.append("length", form.length);
      formData.append("width", form.width);
      formData.append("height", form.height);
      formData.append("featured", form.featured);
      formData.append("active", form.active);
      formData.append("visibility", form.visibility || "AMBOS");
      formData.append("priceTiers", JSON.stringify(form.priceTiers));
      formData.append("wholesalePriceTiers", JSON.stringify(form.wholesalePriceTiers || []));
      form.categoryIds.forEach((id) => formData.append("categoryIds", id));
      newImages.forEach((file) => formData.append("images", file));

      await productsApi.create(formData);
      toast.success("Producto creado");
      navigate("/admin/productos");
    } catch (err) {
      const msg = err.response?.data?.error || "Error al guardar el producto";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto">
        {/* Encabezado */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate("/admin/productos")}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Nuevo producto</h1>
            <p className="text-sm text-slate-500">Completá los datos para crear el producto</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">

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

          {/* Costo */}
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

          {/* Precios */}
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

          {/* Stock */}
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

          {/* Visibilidad */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Visible para</label>
            <div className="flex gap-3">
              {[
                { value: "AMBOS", label: "Todos", icon: "👥" },
                { value: "MINORISTA", label: "Minorista", icon: "🛒" },
                { value: "MAYORISTA", label: "Mayorista", icon: "🏭" },
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

          {/* Descuentos por cantidad — Minoristas */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-700">
                Descuentos por cantidad — Minoristas
                <span className="ml-1 text-xs font-normal text-slate-400">— opcional</span>
              </label>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, priceTiers: [...f.priceTiers, { minQty: "", price: "" }] }))}
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
              >
                + Agregar nivel
              </button>
            </div>
            {form.priceTiers.length === 0 ? (
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
                    {form.priceTiers.map((tier, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <span className="text-slate-400 text-xs">+</span>
                            <input
                              type="number"
                              min="1"
                              value={tier.minQty}
                              onChange={(e) => setForm((f) => {
                                const tiers = [...f.priceTiers];
                                tiers[idx] = { ...tiers[idx], minQty: e.target.value };
                                return { ...f, priceTiers: tiers };
                              })}
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
                              onChange={(e) => setForm((f) => {
                                const tiers = [...f.priceTiers];
                                tiers[idx] = { ...tiers[idx], price: e.target.value };
                                return { ...f, priceTiers: tiers };
                              })}
                              placeholder="0.00"
                              className="w-32 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, priceTiers: f.priceTiers.filter((_, i) => i !== idx) }))}
                            className="text-red-400 hover:text-red-600 text-base leading-none"
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

          {/* Descuentos por cantidad — Mayoristas */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-700">
                Descuentos por cantidad — Mayoristas
                <span className="ml-1 text-xs font-normal text-slate-400">— opcional</span>
              </label>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, wholesalePriceTiers: [...f.wholesalePriceTiers, { minQty: "", price: "" }] }))}
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
              >
                + Agregar nivel
              </button>
            </div>
            {form.wholesalePriceTiers.length === 0 ? (
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
                    {form.wholesalePriceTiers.map((tier, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <span className="text-slate-400 text-xs">+</span>
                            <input
                              type="number"
                              min="1"
                              value={tier.minQty}
                              onChange={(e) => setForm((f) => {
                                const tiers = [...f.wholesalePriceTiers];
                                tiers[idx] = { ...tiers[idx], minQty: e.target.value };
                                return { ...f, wholesalePriceTiers: tiers };
                              })}
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
                              onChange={(e) => setForm((f) => {
                                const tiers = [...f.wholesalePriceTiers];
                                tiers[idx] = { ...tiers[idx], price: e.target.value };
                                return { ...f, wholesalePriceTiers: tiers };
                              })}
                              placeholder="0.00"
                              className="w-32 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, wholesalePriceTiers: f.wholesalePriceTiers.filter((_, i) => i !== idx) }))}
                            className="text-red-400 hover:text-red-600 text-base leading-none"
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
            {newImages.length > 0 && (
              <p className="text-xs text-blue-600 mt-1">
                {newImages.length} imagen{newImages.length > 1 ? "es" : ""} seleccionada{newImages.length > 1 ? "s" : ""}
              </p>
            )}
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

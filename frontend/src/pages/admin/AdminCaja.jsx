import { useState, useEffect, useMemo } from "react";
import AdminLayout from "../../components/AdminLayout";
import { gastosApi, productsApi } from "../../services/api";
import toast from "react-hot-toast";
import { formatPrice } from "../../utils/formatPrice";
import { localDay, formatDateOnly } from "../../utils/localDate";

const TABS = [
  { key: "NEGOCIO",  label: "Gastos del Negocio",  color: "blue" },
  { key: "PERSONAL", label: "Gastos Personales",    color: "purple" },
];

// Formulario vacío con la fecha de HOY en la computadora. Antes era una constante armada al cargar la
// página con toISOString (día en UTC): después de las 21:00 ponía el día siguiente, y si el panel quedaba
// abierto de un día para otro seguía con la fecha vieja. Ver utils/localDate.js.
// Antes: const EMPTY_FORM = { amount: "", description: "", currency: "ARS", date: new Date().toISOString().slice(0, 10) };
const emptyForm = () => ({ amount: "", description: "", currency: "ARS", date: localDay() });

// La fecha de un gasto no tiene hora (00:00 UTC del día cargado): se muestra en UTC. Antes en la zona de
// la computadora, y el gasto del 28/10 aparecía como 27/10.
const formatDate = (d) => formatDateOnly(d);

// Buscador del producto del RMA: mismas reglas que el de la venta manual (AdminOrders.jsx): por palabras
// en cualquier orden, sin importar mayúsculas ni tildes, o por SKU; primero los que EMPIEZAN con lo
// tipeado, después el resto alfabético. Antes era un desplegable sin búsqueda.
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function searchProducts(list, search) {
  const term = norm(search).trim();
  const words = term.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return list
    .map((p) => ({ p, name: norm(p.name) }))
    .filter(({ p, name }) => words.every((w) => name.includes(w)) || (p.sku && norm(p.sku).includes(term)))
    .sort((a, b) => {
      const aStarts = a.name.startsWith(term) ? 0 : 1;
      const bStarts = b.name.startsWith(term) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.name.localeCompare(b.name);
    })
    .map(({ p }) => p);
}

// Costo unitario del RMA: el de la variante si tiene uno propio, si no el del producto (como la venta
// manual). Antes era siempre el del producto padre, aunque la variante devuelta costara otra cosa.
const unitCost = (product, variant) => variant?.cost ?? product?.cost ?? 0;

export default function AdminCaja() {
  const [tab, setTab]       = useState("NEGOCIO");
  const [gastos, setGastos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState(emptyForm);
  // Tipo de gasto: "GASTO" (normal) o "RMA" (devolución de producto)
  const [subtype, setSubtype] = useState("GASTO");
  // Productos disponibles para RMA (solo los que tienen costo cargado)
  const [products, setProducts]     = useState([]);
  const [loadingProds, setLoadingProds] = useState(false);
  // Producto seleccionado para RMA
  const [rmaProductId, setRmaProductId] = useState("");
  // Texto del buscador de producto del RMA
  const [rmaSearch, setRmaSearch] = useState("");
  // Variante seleccionada (si el producto tiene variantes)
  const [rmaVariantId, setRmaVariantId] = useState("");
  const [rmaVariants, setRmaVariants]   = useState([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  // Cantidad para RMA (afecta el monto: costo × qty)
  const [rmaQty, setRmaQty] = useState(1);

  const fetchGastos = async () => {
    setLoading(true);
    try {
      const res = await gastosApi.getAll();
      setGastos(res.data);
    } catch {
      toast.error("Error al cargar gastos");
    } finally {
      setLoading(false);
    }
  };

  // Cargar productos al cambiar a RMA
  useEffect(() => {
    if (subtype !== "RMA" || products.length > 0) return;
    setLoadingProds(true);
    // Antes: { limit: 500 } — solo los 500 productos más nuevos; uno más viejo no se podía devolver.
    // all=true trae el catálogo completo (sin excludePaused: un producto pausado también se puede devolver).
    productsApi.getAllAdmin({ all: true })
      .then((res) => {
        // Solo productos con costo definido (los demás no tienen valor de RMA)
        const withCost = (res.data.products || res.data).filter((p) => p.cost > 0);
        setProducts(withCost);
      })
      .catch(() => toast.error("Error al cargar productos"))
      .finally(() => setLoadingProds(false));
  }, [subtype, products.length]);

  // Al seleccionar un producto en RMA, auto-rellenar el monto y cargar variantes si tiene
  const handleRmaProduct = async (id) => {
    setRmaProductId(id);
    setRmaVariantId("");
    setRmaVariants([]);
    const product = products.find((p) => String(p.id) === String(id));
    if (product) {
      // El monto sale del costo del producto → la moneda del gasto es la del producto, no se elige a mano.
      // (Si tiene variantes, al elegir la variante se recalcula con el costo de la variante.)
      setForm((f) => ({ ...f, amount: String(unitCost(product, null) * rmaQty), currency: product.currency || "ARS" }));
      if ((product._count?.variants ?? 0) > 0) {
        setLoadingVariants(true);
        try {
          const res = await productsApi.getById(id);
          setRmaVariants(res.data.variants || []);
        } catch { setRmaVariants([]); }
        finally { setLoadingVariants(false); }
      }
    }
  };

  // Al elegir la variante, recalcular el monto con su costo (si tiene uno propio)
  const handleRmaVariant = (id) => {
    setRmaVariantId(id);
    const product = products.find((p) => String(p.id) === String(rmaProductId));
    const variant = rmaVariants.find((v) => String(v.id) === String(id));
    if (product) {
      setForm((f) => ({ ...f, amount: String(unitCost(product, variant) * rmaQty) }));
    }
  };

  // Al cambiar cantidad en RMA, recalcular el monto
  const handleRmaQty = (qty) => {
    const q = Math.max(1, parseInt(qty) || 1);
    setRmaQty(q);
    const product = products.find((p) => String(p.id) === String(rmaProductId));
    const variant = rmaVariants.find((v) => String(v.id) === String(rmaVariantId));
    if (product) {
      // Antes: String(product.cost * q) — el costo del padre aunque hubiera una variante elegida
      setForm((f) => ({ ...f, amount: String(unitCost(product, variant) * q) }));
    }
  };

  const rmaProduct = products.find((p) => String(p.id) === String(rmaProductId));
  const rmaMatches = useMemo(() => searchProducts(products, rmaSearch), [products, rmaSearch]);

  useEffect(() => { fetchGastos(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (subtype === "RMA") {
      if (!rmaProductId) { toast.error("Seleccioná un producto"); return; }
      if (rmaVariants.length > 0 && !rmaVariantId) { toast.error("Seleccioná la variante devuelta"); return; }
      if (!form.amount)  { toast.error("El monto es requerido"); return; }
    } else {
      if (!form.amount || !form.description) {
        toast.error("Completá el monto y la descripción");
        return;
      }
    }
    // Para RMA: descripción automática con nombre, variante (si aplica) y cantidad
    const product = products.find((p) => String(p.id) === String(rmaProductId));
    const selectedVariant = rmaVariants.find((v) => String(v.id) === String(rmaVariantId));
    const variantLabel = selectedVariant
      ? (() => {
          const combo = Array.isArray(selectedVariant.combination)
            ? selectedVariant.combination
            : JSON.parse(selectedVariant.combination || "[]");
          return combo.map((c) => `${c.name}: ${c.value}`).join(" / ");
        })()
      : null;
    const description = subtype === "RMA"
      ? `RMA: ${product?.name || "Producto"}${variantLabel ? ` [${variantLabel}]` : ""}${rmaQty > 1 ? ` (x${rmaQty})` : ""}`
      : form.description;

    setSaving(true);
    try {
      await gastosApi.create({
        ...form,
        description,
        type: tab,
        subtype,
        ...(subtype === "RMA" ? {
          productId: parseInt(rmaProductId),
          variantId: rmaVariantId ? parseInt(rmaVariantId) : undefined,
          quantity:  rmaQty,
        } : {}),
      });
      toast.success(subtype === "RMA" ? "RMA registrado y stock descontado" : "Gasto registrado");
      setForm(emptyForm());
      setRmaProductId("");
      setRmaSearch("");
      setRmaVariantId("");
      setRmaVariants([]);
      setRmaQty(1);
      fetchGastos();
    } catch (err) {
      // Antes: siempre "Error al guardar". El servidor ahora explica qué falta (ej. "Elegí la variante de…").
      toast.error(err.response?.data?.error || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("¿Eliminar este gasto?")) return;
    try {
      await gastosApi.remove(id);
      setGastos((prev) => prev.filter((g) => g.id !== id));
      toast.success("Gasto eliminado");
    } catch {
      toast.error("Error al eliminar");
    }
  };

  const filtered = gastos.filter((g) => g.type === tab);
  // Los totales se separan por moneda: sin conversión automática, sumar pesos y dólares juntos
  // daría un número sin sentido.
  const totalArs = filtered.filter((g) => (g.currency || "ARS") !== "USD").reduce((acc, g) => acc + g.amount, 0);
  const totalUsd = filtered.filter((g) => g.currency === "USD").reduce((acc, g) => acc + g.amount, 0);
  const activeTab = TABS.find((t) => t.key === tab);

  return (
    <AdminLayout title="Caja">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Tabs */}
        <div className="flex gap-2 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSubtype("GASTO"); setRmaProductId(""); setRmaSearch(""); setRmaVariantId(""); setRmaVariants([]); setRmaQty(1); setForm(emptyForm()); }}
              className={`px-5 py-2.5 text-sm font-semibold rounded-t-lg transition-colors ${
                tab === t.key
                  ? t.color === "blue"
                    ? "bg-blue-600 text-white"
                    : "bg-purple-600 text-white"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Formulario nuevo gasto */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4">Registrar gasto</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">

            {/* Selector de tipo — RMA solo aplica a Gastos del Negocio, no a Personales */}
            <div className="flex gap-2">
              {(tab === "NEGOCIO" ? ["GASTO", "RMA"] : ["GASTO"]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setSubtype(s); setRmaProductId(""); setRmaSearch(""); setRmaVariantId(""); setRmaVariants([]); setRmaQty(1); setForm(emptyForm()); }}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                    subtype === s
                      ? s === "RMA"
                        ? "bg-orange-500 text-white border-orange-500"
                        : "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-600 border-slate-300 hover:border-slate-400"
                  }`}
                >
                  {s === "RMA" ? "🔄 RMA" : "💸 Gasto"}
                </button>
              ))}
            </div>

            {subtype === "GASTO" ? (
              /* ── Formulario GASTO ── */
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500">
                    Monto {form.currency === "USD" ? "USD" : "$"}
                  </label>
                  <input
                    type="number" min="0" step="0.01" placeholder="0.00"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full sm:w-36 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500">Moneda</label>
                  <select
                    value={form.currency}
                    onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                    className="w-full sm:w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="ARS">ARS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs font-medium text-slate-500">Descripción</label>
                  <input
                    type="text" placeholder="Ej: Alquiler, servicios..."
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500">Fecha</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    className="w-full sm:w-40 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div className="flex flex-col gap-1 justify-end">
                  <span className="text-xs font-medium text-transparent select-none">.</span>
                  <button
                    type="submit" disabled={saving}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    + Agregar
                  </button>
                </div>
              </div>
            ) : (
              /* ── Formulario RMA ── */
              <div className="flex flex-col gap-3">
                {/* Fila 1: buscador de producto.
                    Antes: un <select> con los 500 más nuevos y sin búsqueda. Ahora se busca por nombre o SKU
                    sobre el catálogo completo; tocar el texto de un producto elegido lo deselecciona. */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500">Producto devuelto</label>
                  <input
                    type="text"
                    value={rmaProduct ? rmaProduct.name : rmaSearch}
                    onChange={(e) => {
                      setRmaSearch(e.target.value);
                      if (rmaProductId) handleRmaProduct("");
                    }}
                    placeholder={loadingProds ? "Cargando productos..." : "Buscar producto por nombre o SKU..."}
                    className="w-full px-3 py-2 border border-orange-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-orange-50"
                    disabled={loadingProds}
                  />
                  {rmaProduct && (
                    <p className="text-xs text-slate-500">
                      Costo unitario: {formatPrice(unitCost(rmaProduct, rmaVariants.find((v) => String(v.id) === String(rmaVariantId))), rmaProduct.currency)}
                    </p>
                  )}
                  {!rmaProduct && rmaSearch.trim() && (
                    <div className="border border-slate-200 rounded-lg bg-white max-h-64 overflow-y-auto">
                      <div className="sticky top-0 bg-slate-50 border-b border-slate-200 px-3 py-1 text-[11px] text-slate-500">
                        {rmaMatches.length === 0
                          ? "Ningún producto con costo cargado coincide"
                          : `${rmaMatches.length} ${rmaMatches.length === 1 ? "resultado" : "resultados"}`}
                      </div>
                      {rmaMatches.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setRmaSearch(""); handleRmaProduct(p.id); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-orange-50 flex justify-between items-center gap-2"
                        >
                          <span className="font-medium text-slate-700 truncate">
                            {p.name}
                            {p.sku && <span className="ml-2 text-xs text-slate-400">{p.sku}</span>}
                          </span>
                          <span className="text-xs text-slate-500 shrink-0">costo: {formatPrice(p.cost, p.currency)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {/* Variante — aparece solo si el producto tiene variantes */}
                {rmaVariants.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-500">Variante devuelta *</label>
                    <select
                      value={rmaVariantId}
                      onChange={(e) => handleRmaVariant(e.target.value)}
                      className="w-full px-3 py-2 border border-orange-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-orange-50"
                      disabled={loadingVariants}
                    >
                      <option value="">{loadingVariants ? "Cargando variantes..." : "— Seleccioná la variante —"}</option>
                      {rmaVariants.map((v) => {
                        const combo = Array.isArray(v.combination) ? v.combination : JSON.parse(v.combination || "[]");
                        const label = combo.map((c) => `${c.name}: ${c.value}`).join(" / ");
                        return (
                          <option key={v.id} value={v.id}>
                            {label} (stock actual: {v.stockUnlimited ? "∞" : v.stock})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}
                {/* Fila 2: cantidad + monto + fecha + botón */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-500">Cantidad</label>
                    <input
                      type="number" min="1" step="1" placeholder="1"
                      value={rmaQty}
                      onChange={(e) => handleRmaQty(e.target.value)}
                      className="w-full sm:w-24 px-3 py-2 border border-orange-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-orange-50"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    {/* La moneda la hereda del producto (el monto sale de su costo) — no se elige acá */}
                    <label className="text-xs font-medium text-slate-500">
                      Monto total {form.currency === "USD" ? "USD" : "$"}
                    </label>
                    {/* Monto auto-calculado (costo × cantidad), editable por si hay diferencia */}
                    <input
                      type="number" min="0" step="0.01" placeholder="0.00"
                      value={form.amount}
                      onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                      className="w-full sm:w-36 px-3 py-2 border border-orange-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-orange-50"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-500">Fecha</label>
                    <input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                      className="w-full sm:w-40 px-3 py-2 border border-orange-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-orange-50"
                    />
                  </div>
                  <div className="flex flex-col gap-1 justify-end">
                    <span className="text-xs font-medium text-transparent select-none">.</span>
                    <button
                      type="submit" disabled={saving}
                      className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      + Agregar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Total */}
        <div className={`rounded-2xl p-5 flex items-center justify-between ${
          tab === "NEGOCIO" ? "bg-blue-50 border border-blue-200" : "bg-purple-50 border border-purple-200"
        }`}>
          <div>
            <p className="text-sm text-slate-500 font-medium">{activeTab.label}</p>
            <p className={`text-3xl font-extrabold ${tab === "NEGOCIO" ? "text-blue-700" : "text-purple-700"}`}>
              {formatPrice(totalArs)}
            </p>
            {totalUsd > 0 && (
              <p className={`text-xl font-extrabold ${tab === "NEGOCIO" ? "text-blue-700" : "text-purple-700"}`}>
                {formatPrice(totalUsd, "USD")}
              </p>
            )}
          </div>
          <span className="text-4xl opacity-30">{tab === "NEGOCIO" ? "🏢" : "👤"}</span>
        </div>

        {/* Lista de gastos */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="p-8 flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-slate-400">
              <p className="text-4xl mb-2">📭</p>
              <p>No hay gastos registrados</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Fecha</th>
                  <th className="px-4 py-3 text-left">Descripción</th>
                  <th className="px-4 py-3 text-right font-semibold">Monto</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((g, i) => (
                  <tr key={g.id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(g.date)}</td>
                    <td className="px-4 py-3 text-slate-800">
                      <div className="flex items-center gap-2">
                        {g.subtype === "RMA" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 border border-orange-200 whitespace-nowrap">
                            🔄 RMA
                          </span>
                        )}
                        {g.description}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatPrice(g.amount, g.currency)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDelete(g.id)}
                        className="text-red-400 hover:text-red-600 transition-colors text-base"
                        title="Eliminar"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </AdminLayout>
  );
}

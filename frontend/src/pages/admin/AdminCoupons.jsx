import { useState, useEffect } from "react";
import AdminLayout from "../../components/AdminLayout";
import { couponsApi, customersApi } from "../../services/api";
import toast from "react-hot-toast";

const EMPTY_FORM = {
  code: "",
  description: "",
  discountType: "PERCENTAGE",
  discountValue: "",
  minPurchase: "",
  maxUses: "",
  maxUsesPerCustomer: "",
  expiresAt: "",
  expiresTime: "23:59", // Hora de vencimiento — se combina con expiresAt al guardar
  customerId: "",
  active: true,
};

const formatPrice = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);

const formatDate = (d) => {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

export default function AdminCoupons() {
  const [coupons, setCoupons]     = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]     = useState(null); // null = crear, id = editar
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  // Modal de usos de un cupón
  const [usagesModal, setUsagesModal] = useState(null); // { coupon, usages }
  const [loadingUsages, setLoadingUsages] = useState(false);

  useEffect(() => {
    loadCoupons();
    loadCustomers();
  }, []);

  async function loadCoupons() {
    try {
      setLoading(true);
      const res = await couponsApi.getAll();
      setCoupons(res.data);
    } catch {
      toast.error("Error al cargar cupones");
    } finally {
      setLoading(false);
    }
  }

  async function loadCustomers() {
    try {
      const res = await customersApi.getAll({ limit: 200 });
      setCustomers(res.data?.customers || res.data || []);
    } catch {
      // ignorar — la lista de clientes es opcional para el formulario
    }
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEdit(coupon) {
    setEditing(coupon.id);
    setForm({
      code: coupon.code,
      description: coupon.description || "",
      discountType: coupon.discountType,
      discountValue: coupon.discountValue.toString(),
      minPurchase: coupon.minPurchase?.toString() || "",
      maxUses: coupon.maxUses?.toString() || "",
      maxUsesPerCustomer: coupon.maxUsesPerCustomer?.toString() || "",
      expiresAt:   coupon.expiresAt ? coupon.expiresAt.slice(0, 10) : "",
      expiresTime: coupon.expiresAt ? coupon.expiresAt.slice(11, 16) || "23:59" : "23:59",
      customerId: coupon.customerId?.toString() || "",
      active: coupon.active,
    });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.code || !form.discountValue) {
      toast.error("Código y valor de descuento son obligatorios");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: form.code.toUpperCase().trim(),
        description: form.description || null,
        discountType: form.discountType,
        discountValue: parseFloat(form.discountValue),
        minPurchase: form.minPurchase ? parseFloat(form.minPurchase) : null,
        maxUses: form.maxUses ? parseInt(form.maxUses) : null,
        maxUsesPerCustomer: form.maxUsesPerCustomer ? parseInt(form.maxUsesPerCustomer) : null,
        // Combinar fecha + hora en un ISO string completo para guardar el DateTime exacto
        expiresAt: form.expiresAt
          ? new Date(`${form.expiresAt}T${form.expiresTime || "23:59"}:00`).toISOString()
          : null,
        customerId: form.customerId ? parseInt(form.customerId) : null,
        active: form.active,
      };

      if (editing) {
        await couponsApi.update(editing, payload);
        toast.success("Cupón actualizado");
      } else {
        await couponsApi.create(payload);
        toast.success("Cupón creado");
      }
      setShowModal(false);
      loadCoupons();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(coupon) {
    try {
      await couponsApi.update(coupon.id, { active: !coupon.active });
      setCoupons((prev) =>
        prev.map((c) => (c.id === coupon.id ? { ...c, active: !c.active } : c))
      );
    } catch {
      toast.error("Error al actualizar");
    }
  }

  async function handleDelete(coupon) {
    if (!window.confirm(`¿Eliminar el cupón "${coupon.code}"? Esta acción no se puede deshacer.`)) return;
    try {
      await couponsApi.remove(coupon.id);
      setCoupons((prev) => prev.filter((c) => c.id !== coupon.id));
      toast.success("Cupón eliminado");
    } catch {
      toast.error("Error al eliminar");
    }
  }

  async function openUsages(coupon) {
    setUsagesModal({ coupon, usages: null });
    setLoadingUsages(true);
    try {
      const res = await couponsApi.getUsages(coupon.id);
      setUsagesModal({ coupon, usages: res.data });
    } catch {
      toast.error("Error al cargar usos del cupón");
      setUsagesModal(null);
    } finally {
      setLoadingUsages(false);
    }
  }

  const isExpired = (coupon) => coupon.expiresAt && new Date() > new Date(coupon.expiresAt);

  return (
    <AdminLayout title="Cupones de descuento">
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-slate-500 text-sm">
              {coupons.length} cupón{coupons.length !== 1 ? "es" : ""} registrado{coupons.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button onClick={openCreate} className="btn-primary">
            + Nuevo cupón
          </button>
        </div>

        {/* Tabla */}
        {loading ? (
          <div className="text-center py-16 text-slate-400">Cargando...</div>
        ) : coupons.length === 0 ? (
          <div className="card p-12 text-center text-slate-400">
            <p className="text-4xl mb-3">🏷️</p>
            <p className="font-medium">No hay cupones creados</p>
            <p className="text-sm mt-1">Creá el primero con el botón de arriba</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left font-semibold">Código</th>
                    <th className="px-4 py-3 text-left font-semibold">Descuento</th>
                    <th className="px-4 py-3 text-left font-semibold">Mín. compra</th>
                    <th className="px-4 py-3 text-left font-semibold">Vencimiento</th>
                    <th className="px-4 py-3 text-left font-semibold">Usos (total / por cliente)</th>
                    <th className="px-4 py-3 text-left font-semibold">Cliente</th>
                    <th className="px-4 py-3 text-left font-semibold">Estado</th>
                    <th className="px-4 py-3 w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {coupons.map((coupon, i) => {
                    const expired = isExpired(coupon);
                    return (
                      <tr key={coupon.id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                        <td className="px-4 py-3">
                          <div>
                            <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-xs tracking-widest">
                              {coupon.code}
                            </span>
                            {coupon.description && (
                              <p className="text-xs text-slate-400 mt-1">{coupon.description}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-green-700">
                          {coupon.discountType === "PERCENTAGE"
                            ? `${coupon.discountValue}%`
                            : formatPrice(coupon.discountValue)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {coupon.minPurchase ? formatPrice(coupon.minPurchase) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {coupon.expiresAt ? (
                            <span className={expired ? "text-red-600 font-medium" : "text-slate-600"}>
                              {formatDate(coupon.expiresAt)}
                              {expired && " (vencido)"}
                            </span>
                          ) : (
                            <span className="text-slate-400">Sin vencimiento</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <span className="text-blue-700 font-semibold">{coupon._count?.usages ?? 0}</span>
                          {coupon.maxUses ? ` / ${coupon.maxUses}` : " / ∞"}
                          {coupon.maxUsesPerCustomer && (
                            <span className="text-xs text-slate-400 block">
                              máx {coupon.maxUsesPerCustomer} por cliente
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {coupon.customer ? (
                            <span className="text-xs bg-purple-100 text-purple-700 font-medium px-2 py-0.5 rounded-full">
                              {coupon.customer.name}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">General</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleToggleActive(coupon)}
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                              coupon.active && !expired
                                ? "bg-green-100 text-green-700"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {coupon.active && !expired ? "Activo" : "Inactivo"}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openUsages(coupon)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-lg transition-colors"
                              title="Ver usos"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              {coupon._count?.usages ?? 0}
                            </button>
                            <button
                              onClick={() => openEdit(coupon)}
                              className="text-slate-400 hover:text-blue-600 transition-colors text-sm"
                              title="Editar"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDelete(coupon)}
                              className="text-slate-400 hover:text-red-600 transition-colors text-sm"
                              title="Eliminar"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal crear/editar ────────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">
                {editing ? "Editar cupón" : "Nuevo cupón"}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">

              {/* Código */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Código del cupón *
                </label>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="ej: VERANO20"
                  className="input font-mono tracking-widest"
                  required
                />
                <p className="text-xs text-slate-400 mt-1">Se convierte automáticamente a mayúsculas</p>
              </div>

              {/* Descripción */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Descripción <span className="text-slate-400 font-normal">— opcional</span>
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="ej: Descuento de verano"
                  className="input"
                />
              </div>

              {/* Tipo y valor de descuento */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Tipo de descuento *
                  </label>
                  <select
                    value={form.discountType}
                    onChange={(e) => setForm({ ...form, discountType: e.target.value })}
                    className="input"
                  >
                    <option value="PERCENTAGE">Porcentaje (%)</option>
                    <option value="FIXED">Monto fijo ($)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {form.discountType === "PERCENTAGE" ? "Porcentaje (%) *" : "Monto (ARS) *"}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={form.discountType === "PERCENTAGE" ? "100" : undefined}
                    step="0.01"
                    value={form.discountValue}
                    onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                    placeholder={form.discountType === "PERCENTAGE" ? "ej: 15" : "ej: 5000"}
                    className="input"
                    required
                  />
                </div>
              </div>

              {/* Compra mínima */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Compra mínima (ARS) <span className="text-slate-400 font-normal">— opcional</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.minPurchase}
                  onChange={(e) => setForm({ ...form, minPurchase: e.target.value })}
                  placeholder="ej: 10000"
                  className="input"
                />
              </div>

              {/* Vencimiento: fecha + hora */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Vencimiento <span className="text-slate-400 font-normal">— opcional</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={form.expiresAt}
                    onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                    className="input flex-1"
                  />
                  <input
                    type="time"
                    value={form.expiresTime}
                    onChange={(e) => setForm({ ...form, expiresTime: e.target.value })}
                    disabled={!form.expiresAt}
                    className="input w-32 disabled:opacity-40 disabled:cursor-not-allowed"
                  />
                </div>
                {form.expiresAt && (
                  <p className="text-xs text-slate-400 mt-1">
                    Vence el {new Date(`${form.expiresAt}T${form.expiresTime || "23:59"}:00`).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                )}
              </div>

              {/* Límites de uso */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Usos totales máx. <span className="text-slate-400 font-normal">— opcional</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={form.maxUses}
                    onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
                    placeholder="∞ ilimitado"
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Usos por cliente <span className="text-slate-400 font-normal">— opcional</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={form.maxUsesPerCustomer}
                    onChange={(e) => setForm({ ...form, maxUsesPerCustomer: e.target.value })}
                    placeholder="∞ ilimitado"
                    className="input"
                  />
                </div>
              </div>

              {/* Cliente específico */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Cupón personal para un cliente <span className="text-slate-400 font-normal">— opcional</span>
                </label>
                <select
                  value={form.customerId}
                  onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                  className="input"
                >
                  <option value="">General (para todos los clientes)</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.email}
                    </option>
                  ))}
                </select>
                {form.customerId && (
                  <p className="text-xs text-purple-600 mt-1">
                    Solo este cliente podrá usar el cupón.
                  </p>
                )}
              </div>

              {/* Activo */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="coupon-active"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="w-4 h-4 accent-blue-600"
                />
                <label htmlFor="coupon-active" className="text-sm font-medium text-slate-700">
                  Cupón activo
                </label>
              </div>

              {/* Acciones */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary flex-1"
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn-primary flex-1" disabled={saving}>
                  {saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear cupón"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ── Modal usos del cupón ─────────────────────────────────────────────── */}
      {usagesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-800">
                  Usos del cupón{" "}
                  <span className="font-mono text-base bg-slate-100 px-2 py-0.5 rounded tracking-widest">
                    {usagesModal.coupon.code}
                  </span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {usagesModal.usages ? `${usagesModal.usages.length} uso${usagesModal.usages.length !== 1 ? "s" : ""}` : "Cargando..."}
                </p>
              </div>
              <button
                onClick={() => setUsagesModal(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-6">
              {loadingUsages ? (
                <div className="text-center py-10 text-slate-400">Cargando...</div>
              ) : usagesModal.usages?.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <p className="text-3xl mb-2">📭</p>
                  <p className="font-medium">Nadie usó este cupón todavía</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {usagesModal.usages?.map((usage) => (
                    <div
                      key={usage.orderId}
                      className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {usage.customerEmail}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {new Date(usage.usedAt).toLocaleString("es-AR", {
                            day: "2-digit", month: "2-digit", year: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-slate-500">
                          Orden{" "}
                          <span className="font-semibold text-slate-700">#{usage.orderId}</span>
                        </p>
                        {usage.order?.couponDiscount > 0 && (
                          <p className="text-xs text-green-700 font-medium">
                            −{formatPrice(usage.order.couponDiscount)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

// Admin → Descuento por monto: promos del tipo "desde $100.000, 5% off; desde $200.000, 10% off" con
// fecha de inicio y de fin (pedido para Black Friday, 23/11/2026). Se aplican solas en el checkout y,
// con la casilla "Aplicar promo", en la venta manual y en "Modificar pedido".
// Backend: controllers/cartPromo.controller.js. Reglas del cálculo: utils/cartPromo.js (back y front).
import { useState, useEffect } from "react";
import AdminLayout from "../../components/AdminLayout";
import { cartPromosApi } from "../../services/api";
import toast from "react-hot-toast";
import { localDay, localTime } from "../../utils/localDate";
import { normalizePromoTiers } from "../../utils/cartPromo";

const formatPrice = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

const formatDate = (d) =>
  new Date(d).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const APPLIES_LABEL = { MINORISTA: "Minoristas", MAYORISTA: "Mayoristas", AMBOS: "Minoristas y mayoristas" };

const STATE_STYLE = {
  VIGENTE:    { label: "Vigente",    cls: "bg-green-100 text-green-700" },
  PROGRAMADA: { label: "Programada", cls: "bg-blue-100 text-blue-700" },
  TERMINADA:  { label: "Terminada",  cls: "bg-slate-100 text-slate-500" },
  PAUSADA:    { label: "Pausada",    cls: "bg-amber-100 text-amber-700" },
};

// Formulario vacío: arranca hoy a las 00:00 y termina en 7 días a las 23:59. Los escalones arrancan
// vacíos a propósito: los montos y los % los decide la clienta.
function emptyForm() {
  const hoy = new Date();
  const fin = new Date(hoy.getTime() + 7 * 86400000);
  return {
    name: "Black Friday",
    appliesTo: "AMBOS",
    startDay: localDay(hoy), startTime: "00:00",
    endDay: localDay(fin), endTime: "23:59",
    tiers: [{ minAmount: "", percent: "" }],
    active: true,
  };
}

export default function AdminCartPromos() {
  const [promos, setPromos]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]     = useState(null); // null = crear, id = editar
  const [form, setForm]           = useState(emptyForm);
  const [saving, setSaving]       = useState(false);

  useEffect(() => { loadPromos(); }, []);

  async function loadPromos() {
    try {
      setLoading(true);
      const res = await cartPromosApi.getAll();
      setPromos(res.data);
    } catch {
      toast.error("Error al cargar las promos");
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setShowModal(true);
  }

  function openEdit(promo) {
    setEditing(promo.id);
    // Fecha y hora en la zona de la computadora, que es como se vuelven a guardar (mismo criterio que
    // los cupones: cortar el texto ISO, que está en UTC, corría las fechas 3 horas en cada edición).
    const ini = new Date(promo.startsAt);
    const fin = new Date(promo.endsAt);
    setForm({
      name: promo.name,
      appliesTo: promo.appliesTo,
      startDay: localDay(ini), startTime: localTime(ini),
      endDay: localDay(fin), endTime: localTime(fin),
      tiers: normalizePromoTiers(promo.tiers).map((t) => ({ minAmount: String(t.minAmount), percent: String(t.percent) })),
      active: promo.active,
    });
    setShowModal(true);
  }

  const setTier = (idx, field, value) =>
    setForm((f) => ({ ...f, tiers: f.tiers.map((t, i) => (i === idx ? { ...t, [field]: value } : t)) }));
  const addTier = () => setForm((f) => ({ ...f, tiers: [...f.tiers, { minAmount: "", percent: "" }] }));
  const removeTier = (idx) => setForm((f) => ({ ...f, tiers: f.tiers.filter((_, i) => i !== idx) }));

  async function handleSubmit(e) {
    e.preventDefault();
    const tiers = form.tiers
      .filter((t) => t.minAmount !== "" || t.percent !== "")
      .map((t) => ({ minAmount: parseFloat(t.minAmount), percent: parseFloat(t.percent) }));
    if (tiers.length === 0) return toast.error("Agregá al menos un escalón");
    const startsAt = new Date(`${form.startDay}T${form.startTime || "00:00"}:00`);
    const endsAt   = new Date(`${form.endDay}T${form.endTime || "23:59"}:00`);
    if (isNaN(startsAt) || isNaN(endsAt)) return toast.error("Revisá las fechas");
    if (startsAt >= endsAt) return toast.error("La fecha de fin tiene que ser posterior a la de inicio");

    setSaving(true);
    try {
      // El servidor vuelve a validar todo (montos, % y que cada escalón dé más que el anterior)
      const payload = {
        name: form.name.trim(),
        appliesTo: form.appliesTo,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        tiers,
        active: form.active,
      };
      if (editing) {
        await cartPromosApi.update(editing, payload);
        toast.success("Promo actualizada");
      } else {
        await cartPromosApi.create(payload);
        toast.success("Promo creada");
      }
      setShowModal(false);
      loadPromos();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(promo) {
    try {
      const res = await cartPromosApi.update(promo.id, { active: !promo.active });
      setPromos((prev) => prev.map((p) => (p.id === promo.id ? { ...p, ...res.data } : p)));
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al actualizar");
    }
  }

  async function handleDelete(promo) {
    const usos = promo._count?.orders || 0;
    const aviso = usos > 0
      ? `¿Eliminar la promo "${promo.name}"? Los ${usos} pedido(s) que la usaron conservan su descuento. Esta acción no se puede deshacer.`
      : `¿Eliminar la promo "${promo.name}"? Esta acción no se puede deshacer.`;
    if (!window.confirm(aviso)) return;
    try {
      await cartPromosApi.remove(promo.id);
      setPromos((prev) => prev.filter((p) => p.id !== promo.id));
      toast.success("Promo eliminada");
    } catch {
      toast.error("Error al eliminar");
    }
  }

  // Vista previa de los escalones tal como los va a ver el cliente
  const previewTiers = normalizePromoTiers(
    form.tiers.map((t) => ({ minAmount: parseFloat(t.minAmount), percent: parseFloat(t.percent) }))
  );

  return (
    <AdminLayout title="Descuento por monto de compra">
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-slate-500 text-sm max-w-2xl">
            Un % de descuento sobre el total según cuánto compra el cliente (ej: desde $100.000, 5% off; desde
            $200.000, 10% off). Se aplica solo en la web y con la casilla "Aplicar promo" en las ventas manuales.
          </p>
          <button onClick={openCreate} className="btn-primary shrink-0">
            + Nueva promo
          </button>
        </div>

        {/* Lista */}
        {loading ? (
          <div className="text-center py-16 text-slate-400">Cargando...</div>
        ) : promos.length === 0 ? (
          <div className="card p-12 text-center text-slate-400">
            <p className="text-4xl mb-3">🎉</p>
            <p className="font-medium">No hay promos creadas</p>
            <p className="text-sm mt-1">Creá la primera con el botón de arriba</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left font-semibold">Promo</th>
                    <th className="px-4 py-3 text-left font-semibold">Escalones</th>
                    <th className="px-4 py-3 text-left font-semibold hidden md:table-cell">Vigencia</th>
                    <th className="px-4 py-3 text-left font-semibold hidden sm:table-cell">Pedidos</th>
                    <th className="px-4 py-3 text-left font-semibold">Estado</th>
                    <th className="px-4 py-3 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {promos.map((promo, i) => {
                    const st = STATE_STYLE[promo.state] || STATE_STYLE.TERMINADA;
                    return (
                      <tr key={promo.id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-800">{promo.name}</p>
                          <p className="text-xs text-slate-400">{APPLIES_LABEL[promo.appliesTo]}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {normalizePromoTiers(promo.tiers).map((t) => (
                              <span key={t.minAmount} className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                                desde {formatPrice(t.minAmount)} → {t.percent}%
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs hidden md:table-cell">
                          {formatDate(promo.startsAt)}<br />
                          <span className="text-slate-400">hasta {formatDate(promo.endsAt)}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">
                          <span className="text-blue-700 font-semibold">{promo._count?.orders ?? 0}</span>
                        </td>
                        <td className="px-4 py-3">
                          {/* Tocar el estado pausa o reanuda la promo sin borrarla */}
                          <button
                            onClick={() => handleToggleActive(promo)}
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.cls}`}
                            title={promo.active ? "Pausar" : "Reanudar"}
                          >
                            {st.label}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button onClick={() => openEdit(promo)} className="text-slate-400 hover:text-blue-600 transition-colors text-sm" title="Editar">
                              ✏️
                            </button>
                            <button onClick={() => handleDelete(promo)} className="text-slate-400 hover:text-red-600 transition-colors text-sm" title="Eliminar">
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
              <h2 className="text-lg font-bold text-slate-800">{editing ? "Editar promo" : "Nueva promo"}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Nombre */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre *</label>
                <input
                  type="text"
                  value={form.name}
                  maxLength={60}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="ej: Black Friday"
                  className="input"
                  required
                />
                <p className="text-xs text-slate-400 mt-1">Es lo que ve el cliente en el carrito y en su pedido.</p>
              </div>

              {/* Para quién */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Para quién *</label>
                <select value={form.appliesTo} onChange={(e) => setForm({ ...form, appliesTo: e.target.value })} className="input">
                  <option value="AMBOS">Minoristas y mayoristas</option>
                  <option value="MINORISTA">Solo minoristas</option>
                  <option value="MAYORISTA">Solo mayoristas</option>
                </select>
              </div>

              {/* Vigencia */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Empieza *</label>
                  <div className="flex gap-2">
                    <input type="date" value={form.startDay} onChange={(e) => setForm({ ...form, startDay: e.target.value })} className="input flex-1 min-w-0" required />
                    <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="input w-24" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Termina *</label>
                  <div className="flex gap-2">
                    <input type="date" value={form.endDay} onChange={(e) => setForm({ ...form, endDay: e.target.value })} className="input flex-1 min-w-0" required />
                    <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="input w-24" />
                  </div>
                </div>
              </div>

              {/* Escalones */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Escalones *</label>
                <div className="space-y-2">
                  {form.tiers.map((t, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-sm text-slate-500 shrink-0">Desde $</span>
                      <input
                        type="number" min="0" step="1"
                        value={t.minAmount}
                        onChange={(e) => setTier(idx, "minAmount", e.target.value)}
                        placeholder="100000"
                        className="input flex-1 min-w-0"
                      />
                      <input
                        type="number" min="1" max="100" step="0.5"
                        value={t.percent}
                        onChange={(e) => setTier(idx, "percent", e.target.value)}
                        placeholder="5"
                        className="input w-20"
                      />
                      <span className="text-sm text-slate-500 shrink-0">% off</span>
                      {form.tiers.length > 1 && (
                        <button type="button" onClick={() => removeTier(idx)} className="text-slate-400 hover:text-red-600 text-sm" title="Sacar escalón">✕</button>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addTier} className="mt-2 text-sm font-semibold text-blue-600 hover:text-blue-700">
                  + Agregar escalón
                </button>
                {previewTiers.length > 0 && (
                  <p className="text-xs text-slate-500 mt-2">
                    {previewTiers.map((t) => `desde ${formatPrice(t.minAmount)} → ${t.percent}% off`).join(" · ")}
                  </p>
                )}
                {/* Cómo se calcula hoy (dos puntos quedaron pendientes de confirmar con la clienta: si
                    cuentan los productos ya rebajados y si se combina con cupones — hoy sí en los dos) */}
                <p className="text-xs text-slate-400 mt-1">
                  Se mide sobre el total de productos en pesos, sin el envío. Cuentan también los productos
                  que ya tienen oferta, y se puede usar junto con un cupón.
                </p>
              </div>

              {/* Activa */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="w-4 h-4 accent-green-600" />
                <span className="text-sm text-slate-700">Activa (destildada queda pausada aunque esté en fecha)</span>
              </label>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={saving} className="btn-primary">
                  {saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear promo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

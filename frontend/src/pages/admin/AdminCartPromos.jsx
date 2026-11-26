// Admin → Descuento por monto: promos del tipo "desde $100.000, 5% off; desde $200.000, 10% off" con
// fecha de inicio y de fin (pedido para Black Friday, 23/11/2026). Se aplican solas en el checkout y,
// con la casilla "Aplicar promo", en la venta manual y en "Modificar pedido".
// Backend: controllers/cartPromo.controller.js. Reglas del cálculo: utils/cartPromo.js (back y front).
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import AdminLayout from "../../components/AdminLayout";
import { cartPromosApi, categoriesApi } from "../../services/api";
// Qué productos entran (24/11/2026): lista con "Seleccionar todos" y casillas
import PromoProductPicker from "../../components/admin/PromoProductPicker";
import { flattenTree } from "../../utils/categoryTree";
import toast from "react-hot-toast";
import { localDay, localTime } from "../../utils/localDate";
// Antes: import { normalizePromoTiers } from "../../utils/cartPromo";
import { normalizePromoTiers, cartPromoSummary } from "../../utils/cartPromo";
// Cómo se ve la promo: mismos estilos y tarjeta que las campañas (pedido del 23/11/2026)
import CampaignCard, { CampaignChip, CAMPAIGN_CARD_STYLES } from "../../components/CampaignCard";
import CartPromoNotice from "../../components/CartPromoNotice";

// Atajos para el color propio (los mismos que en Ofertas / Campañas)
const CARD_COLOR_PRESETS = ["#d81b60", "#8e24aa", "#e53935", "#ef6c00", "#f9a825", "#2e7d32", "#0288d1", "#1a237e", "#111827"];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

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
    // Escalones para mayoristas (25/11/2026), solo con "Minoristas y mayoristas": wholesaleSame = usan los
    // mismos que los minoristas; si no, los de wholesaleTiers.
    wholesaleSame: true,
    wholesaleTiers: [{ minAmount: "", percent: "" }],
    active: true,
    // Cómo se ve: tarjeta en el inicio y aviso del carrito (mismos estilos que las campañas)
    description: "",
    showCard: true,
    cardStyle: "blackfriday",
    cardColor: "#d81b60",
    showCountdown: true,
    // Avisar por email cuando empieza (25/11/2026; lo manda el servidor una vez, ver broadcast.service.js)
    emailAnnounce: false,
    // Qué productos entran: todos, o algunas categorías (ids como texto, para el selector) y productos
    scopeAll: true,
    categoryIds: [],
    productIds: [], // ids de producto elegidos (categoryIds queda solo para promos de la versión anterior)
  };
}

// "Todos los productos" o "Audio, Cables · 3 productos" para la lista
function scopeText(promo) {
  const cats = promo.scopeCategories || [];
  const prods = promo.scopeProducts || [];
  if (cats.length === 0 && prods.length === 0) return "Todos los productos";
  const parts = [];
  if (cats.length) parts.push(cats.length <= 3 ? cats.map((c) => c.name).join(", ") : `${cats.slice(0, 3).map((c) => c.name).join(", ")} y ${cats.length - 3} más`);
  if (prods.length) parts.push(`${prods.length} producto${prods.length === 1 ? "" : "s"}`);
  return `Solo: ${parts.join(" · ")}`;
}

export default function AdminCartPromos() {
  const [promos, setPromos]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]     = useState(null); // null = crear, id = editar
  const [form, setForm]           = useState(emptyForm);
  const [saving, setSaving]       = useState(false);
  const [copyOf, setCopyOf]       = useState(null); // la promo que se está duplicando (para el aviso del formulario)
  const [previewAs, setPreviewAs] = useState("MINORISTA"); // vista previa como minorista o mayorista
  // Para elegir qué productos entran
  const [categories, setCategories] = useState([]);

  useEffect(() => { loadPromos(); }, []);
  useEffect(() => { categoriesApi.getAll().then((r) => setCategories(r.data || [])).catch(() => {}); }, []);

  const flatCats = flattenTree(categories);

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
    setCopyOf(null);
    setPreviewAs("MINORISTA");
    setForm(emptyForm());
    setShowModal(true);
  }

  // Antes: openEdit armaba el formulario acá adentro; ahora lo arma formFromPromo y lo usa también Duplicar.
  function openEdit(promo) {
    setEditing(promo.id);
    setCopyOf(null);
    setPreviewAs("MINORISTA");
    setForm(formFromPromo(promo));
    setShowModal(true);
  }

  // Duplicar (pedido de la clienta, 25/11/2026: el Black Friday con otros escalones y otro % para los
  // mayoristas): una promo nueva con todo lo de esta (productos elegidos, estilo, fechas, escalones). Si era
  // solo para minoristas pasa a mayoristas y al revés, que es para lo que se duplica; se revisa y se guarda.
  function openDuplicate(promo) {
    const swap = { MINORISTA: "MAYORISTA", MAYORISTA: "MINORISTA" };
    setEditing(null);
    setCopyOf(promo);
    setPreviewAs("MINORISTA");
    // emailAnnounce: la copia no hereda el aviso programado (se decide aparte)
    setForm({ ...formFromPromo(promo), appliesTo: swap[promo.appliesTo] || promo.appliesTo, emailAnnounce: false });
    setShowModal(true);
  }

  function formFromPromo(promo) {
    // Fecha y hora en la zona de la computadora, que es como se vuelven a guardar (mismo criterio que
    // los cupones: cortar el texto ISO, que está en UTC, corría las fechas 3 horas en cada edición).
    const ini = new Date(promo.startsAt);
    const fin = new Date(promo.endsAt);
    return {
      name: promo.name,
      appliesTo: promo.appliesTo,
      startDay: localDay(ini), startTime: localTime(ini),
      endDay: localDay(fin), endTime: localTime(fin),
      tiers: normalizePromoTiers(promo.tiers).map((t) => ({ minAmount: String(t.minAmount), percent: String(t.percent) })),
      wholesaleSame: normalizePromoTiers(promo.wholesaleTiers).length === 0,
      wholesaleTiers: normalizePromoTiers(promo.wholesaleTiers).length
        ? normalizePromoTiers(promo.wholesaleTiers).map((t) => ({ minAmount: String(t.minAmount), percent: String(t.percent) }))
        : [{ minAmount: "", percent: "" }],
      active: promo.active,
      description: promo.description || "",
      showCard: promo.showCard !== false,
      cardStyle: promo.cardStyle || "blackfriday",
      cardColor: promo.cardColor || "#d81b60",
      showCountdown: promo.showCountdown !== false,
      emailAnnounce: !!promo.emailAnnounce,
      scopeAll: !(promo.categoryIds?.length || promo.productIds?.length),
      categoryIds: (promo.categoryIds || []).map(String),
      productIds: promo.productIds || [],
    };
  }

  // key: "tiers" (minoristas, o todos) o "wholesaleTiers" (mayoristas). Antes solo había "tiers".
  const setTier = (key, idx, field, value) =>
    setForm((f) => ({ ...f, [key]: f[key].map((t, i) => (i === idx ? { ...t, [field]: value } : t)) }));
  const addTier = (key) => setForm((f) => ({ ...f, [key]: [...f[key], { minAmount: "", percent: "" }] }));
  const removeTier = (key, idx) => setForm((f) => ({ ...f, [key]: f[key].filter((_, i) => i !== idx) }));

  // Cambiar "Para quién" sin perder escalones: una promo "solo mayoristas" que pasa a "los dos" lleva sus
  // escalones a la columna de mayoristas (y una copia a minoristas, para cambiarla); al revés, "solo
  // mayoristas" se queda con los de mayoristas.
  function changeAppliesTo(value) {
    setForm((f) => {
      const copy = (rows) => rows.map((t) => ({ ...t }));
      if (f.appliesTo === "MAYORISTA" && value === "AMBOS") {
        return { ...f, appliesTo: value, wholesaleSame: false, wholesaleTiers: copy(f.tiers) };
      }
      if (f.appliesTo === "AMBOS" && value === "MAYORISTA" && !f.wholesaleSame) {
        return { ...f, appliesTo: value, tiers: copy(f.wholesaleTiers), wholesaleSame: true };
      }
      return { ...f, appliesTo: value };
    });
  }

  // Las filas del formulario → escalones { minAmount, percent } (las vacías no cuentan)
  const rowsToTiers = (rows) => rows
    .filter((t) => t.minAmount !== "" || t.percent !== "")
    .map((t) => ({ minAmount: parseFloat(t.minAmount), percent: parseFloat(t.percent) }));
  const separateWholesale = form.appliesTo === "AMBOS" && !form.wholesaleSame;

  async function handleSubmit(e) {
    e.preventDefault();
    // Antes: los escalones se armaban acá (ahora rowsToTiers, para los dos juegos)
    const tiers = rowsToTiers(form.tiers);
    if (tiers.length === 0) return toast.error(separateWholesale ? "Agregá al menos un escalón para minoristas" : "Agregá al menos un escalón");
    const wholesaleTiers = separateWholesale ? rowsToTiers(form.wholesaleTiers) : [];
    if (separateWholesale && wholesaleTiers.length === 0) {
      return toast.error("Agregá al menos un escalón para mayoristas (o tildá “Igual que minoristas”)");
    }
    const startsAt = new Date(`${form.startDay}T${form.startTime || "00:00"}:00`);
    const endsAt   = new Date(`${form.endDay}T${form.endTime || "23:59"}:00`);
    if (isNaN(startsAt) || isNaN(endsAt)) return toast.error("Revisá las fechas");
    if (startsAt >= endsAt) return toast.error("La fecha de fin tiene que ser posterior a la de inicio");
    if (form.cardStyle === "color" && !HEX_COLOR.test(form.cardColor)) return toast.error("Elegí un color válido (ej: #d81b60)");
    if (!form.scopeAll && form.categoryIds.length === 0 && form.productIds.length === 0) {
      return toast.error("Elegí al menos una categoría o un producto (o marcá \"Todos los productos\")");
    }

    setSaving(true);
    try {
      // El servidor vuelve a validar todo (montos, % y que cada escalón dé más que el anterior)
      const payload = {
        name: form.name.trim(),
        appliesTo: form.appliesTo,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        // Solo si todavía no empezó: una promo en curso se avisa a mano desde Emails (si no, al guardar
        // saldría el aviso en el próximo minuto sin confirmarlo; mismo criterio que las campañas)
        emailAnnounce: form.emailAnnounce && startsAt > new Date(),
        tiers,
        wholesaleTiers, // [] = los mayoristas usan los mismos
        active: form.active,
        // Cómo se ve
        description: form.description.trim() || null,
        showCard: form.showCard,
        cardStyle: form.cardStyle,
        cardColor: HEX_COLOR.test(form.cardColor) ? form.cardColor : null,
        showCountdown: form.showCountdown,
        // Qué productos entran (vacías las dos = todos)
        categoryIds: form.scopeAll ? [] : form.categoryIds.map(Number),
        productIds: form.scopeAll ? [] : form.productIds,
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

  // Escalones tal como los va a ver el cliente: los de minoristas (o todos) y los de mayoristas
  const minTiers = normalizePromoTiers(rowsToTiers(form.tiers));
  const mayTiers = separateWholesale ? normalizePromoTiers(rowsToTiers(form.wholesaleTiers)) : [];
  // La vista previa se ve como el cliente que corresponde: con escalones distintos, se elige cuál
  // (previewAs); con "solo mayoristas", como mayorista.
  const previewType = form.appliesTo === "AMBOS" ? (separateWholesale ? previewAs : "MINORISTA") : form.appliesTo;
  // Antes: previewTiers = normalizePromoTiers(form.tiers...), siempre los de todos
  const previewTiers = previewType === "MAYORISTA" && separateWholesale ? mayTiers : minTiers;
  // Vista previa de cómo se ve: la tarjeta del inicio y el aviso del carrito con un carrito de ejemplo
  // (el 60% del primer escalón, para que se vea el "sumá $X y llevás...")
  const previewEndsAt = new Date(`${form.endDay}T${form.endTime || "23:59"}:00`);
  const previewPromo = {
    id: 0, name: form.name.trim() || "Black Friday", description: form.description.trim(),
    // Antes: appliesTo: "AMBOS" fijo. Ahora el que ve ese cliente, para que la vista previa muestre "Exclusivo
    // para mayoristas" (en una promo para los dos con escalones de mayoristas, el mayorista la ve exclusiva)
    endsAt: isNaN(previewEndsAt) ? null : previewEndsAt,
    appliesTo: previewType === "MAYORISTA" && (form.appliesTo === "MAYORISTA" || separateWholesale) ? "MAYORISTA" : form.appliesTo,
    tiers: previewTiers,
    cardStyle: form.cardStyle, cardColor: HEX_COLOR.test(form.cardColor) ? form.cardColor : null,
    showCountdown: form.showCountdown,
    // Para cuáles vale, como lo arma el servidor (services/cartPromo.service.js, resolveScope)
    scopeLabel: (() => {
      if (form.scopeAll || (form.categoryIds.length === 0 && form.productIds.length === 0)) return null;
      const names = flatCats.filter((c) => form.categoryIds.includes(String(c.id))).map((c) => c.name);
      if (names.length === 0 || names.length > 3) return "En productos seleccionados";
      const cats = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
      return form.productIds.length ? `En ${cats} y otros productos seleccionados` : `En ${cats}`;
    })(),
  };
  const previewSummary = previewTiers.length > 0
    // Antes: siempre "MINORISTA" (con una promo solo para mayoristas no se veía el aviso)
    ? cartPromoSummary([{ ...previewPromo, endsAt: null }], Math.round(previewTiers[0].minAmount * 0.6), previewType)
    : null;

  // Una lista de escalones editable: key = "tiers" o "wholesaleTiers"; clean = esos escalones ya limpios,
  // para el resumen de abajo. Antes estaba escrita una sola vez en el formulario (solo "tiers").
  const tierEditor = (key, clean) => (
    <>
      <div className="space-y-2">
        {form[key].map((t, idx) => (
          // En el celular el monto se cortaba ("100000" no entraba): ahí "Desde $" queda en "$" y "% off"
          // en "%". Antes: "Desde $" y "% off" siempre. (Se probó el % en w-16 en el celular: "12,5" no
          // entraba, así que queda en w-20.)
          <div key={idx} className="flex items-center gap-2">
            <span className="text-sm text-slate-500 shrink-0"><span className="hidden sm:inline">A partir de </span>$</span>
            <input
              type="number" min="0" step="1"
              value={t.minAmount}
              onChange={(e) => setTier(key, idx, "minAmount", e.target.value)}
              placeholder="100000"
              className="input flex-1 min-w-0"
            />
            <input
              type="number" min="1" max="100" step="0.5"
              value={t.percent}
              onChange={(e) => setTier(key, idx, "percent", e.target.value)}
              placeholder="5"
              className="input w-20"
            />
            <span className="text-sm text-slate-500 shrink-0">%<span className="hidden sm:inline"> off</span></span>
            {form[key].length > 1 && (
              <button type="button" onClick={() => removeTier(key, idx)} className="text-slate-400 hover:text-red-600 text-sm" title="Sacar escalón">✕</button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={() => addTier(key)} className="mt-2 text-sm font-semibold text-blue-600 hover:text-blue-700">
        + Agregar escalón
      </button>
      {clean.length > 0 && (
        <p className="text-xs text-slate-500 mt-2">
          {clean.map((t) => `a partir de ${formatPrice(t.minAmount)} → ${t.percent}% off`).join(" · ")}
        </p>
      )}
    </>
  );

  return (
    <AdminLayout title="Descuento por monto de compra">
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-slate-500 text-sm max-w-2xl">
            Un % de descuento según cuánto compra el cliente (ej: a partir de $100.000, 5% off; a partir de
            $200.000, 10% off), en todos los productos o solo en algunas categorías o productos. Se aplica solo
            en la web y con la casilla "Aplicar promo" en las ventas manuales.
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
                          {/* Antes: <p className="font-bold text-slate-800">{promo.name}</p>. Ahora con su estilo,
                              como se ve en la tienda (igual que el filtro de campañas del catálogo) */}
                          <CampaignChip offer={promo} />
                          <p className="text-xs text-slate-400 mt-1">
                            {APPLIES_LABEL[promo.appliesTo]}{promo.showCard !== false ? " · tarjeta en el inicio" : ""}
                            {promo.announcedAt ? " · avisada por email" : promo.emailAnnounce ? " · se avisa por email y WhatsApp al empezar" : ""}
                          </p>
                          <p className="text-xs text-slate-500">{scopeText(promo)}</p>
                        </td>
                        <td className="px-4 py-3">
                          {/* Con escalones propios para mayoristas (25/11/2026), los dos juegos, cada uno con su título */}
                          {[
                            ...(promo.appliesTo === "AMBOS" && normalizePromoTiers(promo.wholesaleTiers).length
                              ? [["Minoristas", promo.tiers], ["Mayoristas", promo.wholesaleTiers]]
                              : [[null, promo.tiers]]),
                          ].map(([quien, tiers]) => (
                            <div key={quien || "todos"} className={quien ? "mb-1 last:mb-0" : ""}>
                              {quien && <p className="text-[11px] font-semibold text-slate-500 mb-0.5">{quien}</p>}
                              <div className="flex flex-wrap gap-1">
                                {normalizePromoTiers(tiers).map((t) => (
                                  <span key={t.minAmount} className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                                    a partir de {formatPrice(t.minAmount)} → {t.percent}%
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
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
                            <button onClick={() => openDuplicate(promo)} className="text-slate-400 hover:text-blue-600 transition-colors text-sm" title="Duplicar (ej. la misma promo con otros escalones para mayoristas)">
                              📄
                            </button>
                            {/* Aviso por email (25/11/2026): se manda desde Emails → Avisos de campañas */}
                            <Link to="/admin/emails?tab=campanas" className="text-slate-400 hover:text-blue-600 transition-colors text-sm" title="Avisar por email a los clientes">
                              📧
                            </Link>
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
          {/* Antes: max-w-lg, después max-w-2xl (para la vista previa de la tarjeta del inicio). Pedido de la
              clienta (25/11/2026): "el modal de la promo hacelo más ancho" → max-w-5xl. */}
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">{editing ? "Editar promo" : copyOf ? "Duplicar promo" : "Nueva promo"}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Duplicando: qué se copió y qué falta revisar */}
              {copyOf && (
                <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">
                  Copia de “{copyOf.name}” ({APPLIES_LABEL[copyOf.appliesTo].toLowerCase()}), con los mismos productos, estilo y fechas.
                  {copyOf.appliesTo !== "AMBOS" && <> “Para quién” ya quedó en <b>{APPLIES_LABEL[form.appliesTo].toLowerCase()}</b>.</>}
                  {" "}Poné los escalones y el % de esta y guardá.
                </div>
              )}

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
                {/* Antes: onChange={(e) => setForm({ ...form, appliesTo: e.target.value })} (ver changeAppliesTo) */}
                <select value={form.appliesTo} onChange={(e) => changeAppliesTo(e.target.value)} className="input">
                  <option value="AMBOS">Minoristas y mayoristas</option>
                  <option value="MINORISTA">Solo minoristas</option>
                  <option value="MAYORISTA">Solo mayoristas</option>
                </select>
                {/* Pedido de la clienta (25/11/2026): otros escalones para mayoristas, y que diga "exclusivo" */}
                {form.appliesTo === "MAYORISTA" && (
                  <p className="text-xs text-slate-500 mt-1">La tarjeta del inicio y el aviso del carrito dicen “Exclusivo para mayoristas”.</p>
                )}
                {/* Antes: "¿Otros escalones o % para los mayoristas? Hacé dos promos, una para cada uno..." — a la
                    clienta no le cerró ("lo de los minoristas no lo veo hecho"): ahora se cargan acá mismo. */}
                {form.appliesTo === "AMBOS" && (
                  <p className="text-xs text-slate-500 mt-1">
                    Abajo, en Escalones, podés poner otros escalones y otro % para los mayoristas.
                  </p>
                )}
              </div>

              {/* Qué productos entran (pedido de la clienta, 24/11/2026). El monto se mide y el % se
                  descuenta solo sobre esos productos; las categorías incluyen sus subcategorías. */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Qué productos entran *</label>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={form.scopeAll} onChange={() => setForm({ ...form, scopeAll: true })} />
                    Todos los productos
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={!form.scopeAll} onChange={() => setForm({ ...form, scopeAll: false })} />
                    {/* Antes: "Solo algunas categorías o productos" (ahora se tildan productos; la categoría es un filtro) */}
                    Solo algunos productos
                  </label>
                </div>
                {/* Antes: un desplegable de categorías + un buscador de productos sueltos con chips. Pedido de la
                    clienta (24/11/2026): una lista con "Seleccionar todos" en el encabezado y destildar lo que
                    no va (PromoProductPicker). */}
                {!form.scopeAll && (
                  <div className="mt-3 space-y-2">
                    <PromoProductPicker
                      categories={categories}
                      selected={form.productIds}
                      onChange={(ids) => setForm((f) => ({ ...f, productIds: ids }))}
                      legacyCategoryIds={form.categoryIds}
                      onLegacyConverted={() => setForm((f) => ({ ...f, categoryIds: [] }))}
                    />
                    {/* Antes, más largo: "Filtrá por categoría o buscá, usá “Seleccionar todos” y destildá los que no
                        van. El monto se mide y el % se descuenta solo sobre los productos elegidos; lo demás del
                        carrito se cobra normal. Un producto nuevo no entra solo: hay que tildarlo." */}
                    <p className="text-xs text-slate-500">
                      El monto y el % cuentan solo los elegidos. Los productos que cargues después no entran solos.
                    </p>
                  </div>
                )}
              </div>

              {/* Vigencia. Antes: grid-cols-1 sm:grid-cols-2 (empieza y termina lado a lado) con la hora en
                  w-24: en la ventana de max-w-lg no entraban y se cortaban ("23/11/202", "00:0"). Ahora
                  una debajo de la otra, con la fecha a todo el ancho y la hora en w-36. En el celular la
                  hora va debajo de la fecha (en la misma fila tampoco entraban). */}
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Empieza *</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input type="date" value={form.startDay} onChange={(e) => setForm({ ...form, startDay: e.target.value })} className="input sm:flex-1 min-w-0" required />
                    <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="input sm:w-36 sm:shrink-0" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Termina *</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input type="date" value={form.endDay} onChange={(e) => setForm({ ...form, endDay: e.target.value })} className="input sm:flex-1 min-w-0" required />
                    <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="input sm:w-36 sm:shrink-0" />
                  </div>
                </div>
              </div>

              {/* Escalones. Con "Minoristas y mayoristas", dos columnas: los de minoristas y los de mayoristas
                  (pedido de la clienta, 25/11/2026: otros escalones y otro % para los mayoristas, en la misma
                  promo). Antes: una sola lista para todos. */}
              <div>
                {form.appliesTo === "AMBOS" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Escalones para minoristas *</label>
                      {tierEditor("tiers", minTiers)}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-1">
                        <label className="text-sm font-medium text-slate-700">Escalones para mayoristas *</label>
                        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={form.wholesaleSame}
                            onChange={(e) => setForm({ ...form, wholesaleSame: e.target.checked })}
                            className="w-3.5 h-3.5 accent-blue-600"
                          />
                          Igual que minoristas
                        </label>
                      </div>
                      {form.wholesaleSame ? (
                        <p className="text-sm text-slate-400 py-2">Los mayoristas tienen los mismos escalones y el mismo %.</p>
                      ) : (
                        <>
                          {tierEditor("wholesaleTiers", mayTiers)}
                          <p className="text-xs text-slate-500 mt-1">A los mayoristas les dice “Exclusivo para mayoristas”.</p>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Escalones *</label>
                    {tierEditor("tiers", minTiers)}
                  </>
                )}
                {/* Cómo se calcula hoy (dos puntos quedaron pendientes de confirmar con la clienta: si
                    cuentan los productos ya rebajados y si se combina con cupones — hoy sí en los dos) */}
                <p className="text-xs text-slate-400 mt-1">
                  Se mide sobre el total de productos en pesos (o solo de los productos que entran, si elegiste
                  algunos), sin el envío. Cuentan también los productos que ya tienen oferta, y se puede usar
                  junto con un cupón.
                </p>
              </div>

              {/* ── Cómo se ve ── (pedido del 23/11/2026: "algo como lo tenemos con las campañas")
                  El estilo pinta la tarjeta del inicio y el aviso del carrito. Mismos estilos que las campañas. */}
              <div className="p-4 rounded-xl border-2 border-slate-200 space-y-4">
                {/* Con escalones distintos para mayoristas, la vista previa se puede ver como cada uno */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-800">🎨 Cómo se ve</p>
                  {separateWholesale && (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      Ver como
                      <div className="flex rounded-md bg-slate-200 p-0.5">
                        {[["MINORISTA", "Minorista"], ["MAYORISTA", "Mayorista"]].map(([k, l]) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setPreviewAs(k)}
                            className={`px-2.5 py-1 rounded transition-colors ${previewAs === k ? "bg-white text-slate-800 font-semibold shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                          >
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-2">Estilo</p>
                  <div className="flex flex-wrap gap-2">
                    {CAMPAIGN_CARD_STYLES.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setForm({ ...form, cardStyle: s.key })}
                        className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                          form.cardStyle === s.key
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    {CAMPAIGN_CARD_STYLES.find((s) => s.key === form.cardStyle)?.hint}
                  </p>

                  {form.cardStyle === "color" && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={HEX_COLOR.test(form.cardColor) ? form.cardColor : "#d81b60"}
                          onChange={(e) => setForm({ ...form, cardColor: e.target.value })}
                          className="w-12 h-10 rounded-lg border border-slate-200 cursor-pointer bg-white p-0.5"
                          title="Elegir color"
                        />
                        <input
                          type="text"
                          value={form.cardColor}
                          onChange={(e) => setForm({ ...form, cardColor: e.target.value.trim() })}
                          placeholder="#d81b60"
                          maxLength={7}
                          className={`input w-28 font-mono ${HEX_COLOR.test(form.cardColor) ? "" : "border-red-400"}`}
                        />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {CARD_COLOR_PRESETS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setForm({ ...form, cardColor: c })}
                            title={c}
                            className={`w-7 h-7 rounded-full border-2 transition-transform ${form.cardColor.toLowerCase() === c ? "border-slate-800 scale-110" : "border-white shadow"}`}
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Aviso del carrito: siempre se ve mientras la promo está vigente */}
                {previewSummary && (
                  <div>
                    <p className="text-xs font-semibold text-slate-600 mb-2">
                      Vista previa del carrito
                      <span className="font-normal text-slate-400"> — con un carrito de {formatPrice(Math.round(previewTiers[0].minAmount * 0.6))}</span>
                    </p>
                    <div className="max-w-sm">
                      <CartPromoNotice summary={previewSummary} />
                    </div>
                  </div>
                )}

                {/* Tarjeta grande en el inicio */}
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.showCard}
                    onChange={(e) => setForm({ ...form, showCard: e.target.checked })}
                    className="w-5 h-5 mt-0.5 rounded border-slate-300 flex-shrink-0"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">🎴 Tarjeta en el inicio</span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      Mientras está vigente, el inicio muestra una tarjeta grande arriba de las categorías (junto a las
                      de las campañas) con los escalones. Al tocarla lleva al catálogo.
                    </span>
                  </span>
                </label>

                {form.showCard && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Subtítulo <span className="text-slate-400 font-normal">— opcional</span>
                      </label>
                      <input
                        type="text"
                        value={form.description}
                        maxLength={140}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        placeholder="ej: Solo esta semana · Envíos a todo el país"
                        className="input"
                      />
                    </div>
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.showCountdown}
                        onChange={(e) => setForm({ ...form, showCountdown: e.target.checked })}
                        className="w-4 h-4 mt-0.5 rounded border-slate-300 flex-shrink-0"
                      />
                      <span>
                        <span className="block text-sm font-medium text-slate-700">⏱️ Mostrar cuenta regresiva</span>
                        <span className="block text-xs text-slate-500 mt-0.5">
                          Hasta que termina la promo. Cuando faltan menos de 3 días se pone roja y titila.
                        </span>
                      </span>
                    </label>
                    {previewTiers.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-600 mb-2">Vista previa del inicio</p>
                        <CampaignCard
                          preview
                          offer={previewPromo}
                          badge={{ value: previewTiers[previewTiers.length - 1].percent, upTo: previewTiers.length > 1 }}
                          tiers={previewTiers}
                          cta="Ver productos"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Aviso por email (pedido de la clienta, 25/11/2026: "no llega mail"). Igual que las campañas: si
                  todavía no empezó, se puede dejar programado; si ya empezó, se avisa desde Emails. */}
              {(() => {
                const startsAt = new Date(`${form.startDay}T${form.startTime || "00:00"}:00`);
                const startsLater = !isNaN(startsAt) && startsAt > new Date();
                const announcedAt = editing ? promos.find((p) => p.id === editing)?.announcedAt : null;
                return (
                  <div className="rounded-xl border border-slate-200 p-4 space-y-1.5">
                    {/* Antes: "📧 Aviso por email" (26/11/2026: la casilla también manda el WhatsApp) */}
                    <p className="text-sm font-semibold text-slate-800">📧📱 Aviso por email y WhatsApp</p>
                    {announcedAt ? (
                      <p className="text-xs text-emerald-700">
                        ✅ Ya se avisó el {formatDate(announcedAt)}. Para mandarlo otra vez: <Link to="/admin/emails?tab=campanas" className="underline font-semibold">Emails y WhatsApp → Avisos de campañas</Link>.
                      </p>
                    ) : startsLater ? (
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.emailAnnounce}
                          onChange={(e) => setForm({ ...form, emailAnnounce: e.target.checked })}
                          className="w-4 h-4 mt-0.5 rounded border-slate-300 flex-shrink-0"
                        />
                        <span>
                          <span className="block text-sm text-slate-700">Avisarles por email y WhatsApp a los clientes cuando empiece</span>
                          <span className="block text-xs text-slate-500 mt-0.5">
                            Una sola vez, a quienes les aplica (a los mayoristas, con sus escalones). No les llega a los que se dieron de baja de las promociones. El WhatsApp sale de a uno, entre las 9 y las 21.
                          </span>
                        </span>
                      </label>
                    ) : (
                      <p className="text-xs text-slate-600">
                        {editing ? "Esta promo ya empezó." : "Esta promo empieza apenas la guardes."} Para avisarla, después de guardar andá a{" "}
                        <Link to="/admin/emails?tab=campanas" className="text-blue-600 underline font-semibold">Emails y WhatsApp → Avisos de campañas</Link> y tocá “📧 Avisar ahora” y “📱 WhatsApp”.
                      </p>
                    )}
                  </div>
                );
              })()}

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

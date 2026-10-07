import { useState, useEffect, useMemo } from "react";
import AdminLayout from "../../components/AdminLayout";
import { offersApi, productsApi, categoriesApi, getImageUrl } from "../../services/api";
import { formatPrice } from "../../utils/formatPrice";
// Aplanado recursivo del árbol de categorías para el filtro del picker de productos.
import { flattenTree, indentedLabel } from "../../utils/categoryTree";
import toast from "react-hot-toast";
import CampaignCard from "../../components/CampaignCard";
import { CARD_STYLES } from "../../components/CategoryCard";

// Campañas de oferta con vigencia: un conjunto de productos con descuento entre dos fechas.
// El backend (services/offers.service.js) escribe salePrice/wholesaleSalePrice mientras la campaña
// corre y los borra al terminar, así que acá solo se arma la campaña — los precios los mueve el cron.

const EMPTY_FORM = {
  name: "",
  description: "",
  discountType: "PERCENTAGE",
  discountValue: "",
  // Descuento para mayoristas si es distinto (solo con "Minorista y mayorista"). Vacío = el mismo.
  wholesaleDiscountValue: "",
  appliesTo: "AMBOS",
  startsAt: "",
  endsAt: "",
  showInHome: true,
  // Tarjeta grande arriba de las categorías del Home (ver components/CampaignCard.jsx)
  showCard: true,
  cardStyle: "sale",
  cardColor: "#d81b60",
  // Cuenta regresiva en vivo en la tarjeta (roja cuando faltan menos de 3 días)
  showCountdown: true,
  // Avisar por email a los clientes cuando la campaña empieza (una sola vez; ver Admin → Emails).
  // Tildado por defecto en las campañas NUEVAS: al editar se respeta lo que tenía.
  emailAnnounce: true,
  active: true,
};

// Estilos de la tarjeta de campaña: los de las categorías (con la explicación adaptada donde hace
// falta) más "Color propio".
const CAMPAIGN_CARD_STYLES = [
  ...CARD_STYLES.map((s) =>
    s.key === "sale"  ? { ...s, hint: "Rojo con el descuento en amarillo" } :
    s.key === "fresh" ? { ...s, hint: "Verde con un brillo que cruza" } : s
  ),
  { key: "color", label: "Color propio", hint: "El color que elijas; el texto sale blanco o negro según el fondo" },
];
// Atajos para el color propio
const CARD_COLOR_PRESETS = ["#d81b60", "#8e24aa", "#e53935", "#ef6c00", "#f9a825", "#2e7d32", "#0288d1", "#1a237e", "#111827"];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Cuántos resultados del buscador se dibujan. La búsqueda trae todas las coincidencias (el botón
// "Agregar todos" las necesita para no mentir), pero renderizarlas todas con imagen traba el modal.
const PICKER_VISIBLE = 50;

const STATE_STYLES = {
  ACTIVA:     "bg-green-100 text-green-700",
  PROGRAMADA: "bg-blue-100 text-blue-700",
  FINALIZADA: "bg-slate-100 text-slate-500",
  PAUSADA:    "bg-amber-100 text-amber-700",
};

const APPLIES_LABEL = {
  AMBOS:      "Minorista y mayorista",
  MINORISTA:  "Solo minorista",
  MAYORISTA:  "Solo mayorista",
};

// "15% OFF" o "- $ 5.000", según el tipo de descuento de la campaña.
const discountLabel = (type, value) =>
  type === "PERCENTAGE" ? `${value}% OFF` : `- ${formatPrice(value)}`;

const formatDateTime = (d) =>
  !d ? "—" : new Date(d).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

// ISO → valor de un <input type="datetime-local"> en hora local del navegador.
// No se puede usar toISOString(): devuelve UTC y el admin vería la fecha corrida 3 horas.
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Sugerencia de fechas al crear: desde ahora hasta dentro de 7 días.
const defaultRange = () => {
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 86400000);
  return { startsAt: toLocalInput(now), endsAt: toLocalInput(end) };
};

// ¿Guardar este formulario dispara el aviso por email ya mismo? Sí si se tildó (y antes no estaba),
// la campaña ya empezó, no está pausada y todavía no se avisó.
const announceSendsNow = (form) =>
  form.emailAnnounce && !form.emailAnnounceSaved && !form.announcedAt && form.active !== false &&
  !!form.startsAt && new Date(form.startsAt) <= new Date();

export default function AdminOffers() {
  const [offers, setOffers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]     = useState(null);   // null = crear, id = editar
  const [form, setForm]           = useState(EMPTY_FORM);

  // Productos elegidos: se guarda el objeto entero (no solo el id) para poder mostrar nombre y foto
  // aunque el filtro del buscador ya no los incluya.
  const [selected, setSelected] = useState([]);

  // Buscador de productos
  const [categories, setCategories]       = useState([]);
  const [pickerSearch, setPickerSearch]   = useState("");
  const [pickerCategory, setPickerCategory] = useState("");
  const [pickerProducts, setPickerProducts] = useState([]);
  const [pickerLoading, setPickerLoading]   = useState(false);

  // Descuento propio de cada producto en la campaña: { [productId]: { retail: "", wholesale: "" } }.
  // Vacío = el de la campaña (ej. la campaña da 10% y este producto 15%).
  const [productDiscounts, setProductDiscounts] = useState({});

  // Vista previa de precios (la calcula el backend con el mismo planificador que la aplicación real)
  const [preview, setPreview] = useState([]);

  // Modal de detalle de una campaña ya guardada
  const [detail, setDetail] = useState(null);

  const selectedIds = useMemo(() => selected.map((p) => p.id), [selected]);
  const previewById = useMemo(
    () => Object.fromEntries(preview.map((p) => [p.productId, p])),
    [preview]
  );

  // Lo que se manda al backend: { [productId]: { discountValue, wholesaleDiscountValue } }. Solo los
  // públicos a los que aplica la campaña: con "Solo mayorista" el descuento propio va como mayorista.
  const productDiscountsPayload = useMemo(() => {
    const num = (v) => (v === "" || v == null || isNaN(parseFloat(v)) ? null : parseFloat(v));
    const out = {};
    for (const id of selectedIds) {
      const d = productDiscounts[id];
      if (!d) continue;
      const retail = form.appliesTo !== "MAYORISTA" ? num(d.retail) : null;
      const wholesale = form.appliesTo !== "MINORISTA" ? num(d.wholesale) : null;
      if (retail != null || wholesale != null) out[id] = { discountValue: retail, wholesaleDiscountValue: wholesale };
    }
    return out;
  }, [productDiscounts, selectedIds, form.appliesTo]);
  // Descuento mayorista de la campaña: solo cuenta con "Minorista y mayorista".
  const wholesaleDiscountPayload =
    form.appliesTo === "AMBOS" && form.wholesaleDiscountValue !== "" ? parseFloat(form.wholesaleDiscountValue) : null;
  // Descuento de la vista previa de la tarjeta: como la ve un minorista (o un mayorista si la campaña
  // es solo mayorista). Mismo cálculo que cardBadge() en el backend: el mayor entre los productos.
  const cardPreviewBadge = useMemo(() => {
    const base = parseFloat(form.discountValue);
    if (isNaN(base) || base <= 0) return null;
    const wholesale = form.appliesTo === "MAYORISTA";
    const field = wholesale ? "wholesaleDiscountValue" : "discountValue";
    const values = selectedIds.length
      ? selectedIds.map((id) => productDiscountsPayload[id]?.[field] ?? base)
      : [base];
    const max = Math.max(...values);
    return { value: max, upTo: Math.min(...values) < max };
  }, [form.discountValue, form.appliesTo, selectedIds, productDiscountsPayload]);

  const setProductDiscount = (id, side, value) =>
    setProductDiscounts((prev) => ({ ...prev, [id]: { retail: "", wholesale: "", ...prev[id], [side]: value } }));

  useEffect(() => { loadOffers(); }, []);

  useEffect(() => {
    categoriesApi.getAll()
      .then((res) => setCategories(res.data || []))
      .catch(() => { /* el filtro por categoría es opcional */ });
  }, []);

  async function loadOffers() {
    try {
      setLoading(true);
      const res = await offersApi.getAll();
      setOffers(res.data);
    } catch {
      toast.error("Error al cargar las campañas");
    } finally {
      setLoading(false);
    }
  }

  // ── Buscador de productos (debounce para no pegarle a la API en cada tecla) ──
  useEffect(() => {
    if (!showModal) return;
    const t = setTimeout(async () => {
      try {
        setPickerLoading(true);
        // Antes: { search, category, limit: 50 }
        // Con el tope de 50, elegir una categoría de 200 productos mostraba 50 y el botón decía
        // "Agregar todos (50)": la campaña salía con 50 productos y el admin creía que estaban todos.
        // all=true trae el resultado completo del filtro (mismo criterio que el buscador de pedidos
        // manuales en AdminOrders); la lista visible se recorta abajo con PICKER_VISIBLE.
        // inStock: los productos agotados no se ofrecen. Ponerlos en una campaña no hace nada útil
        // —el descuento se escribe pero el producto no se muestra en la tienda— y encima inflaba el
        // número de "Agregar todos", que es el que el admin usa para saber cuántos entran.
        // Los que YA están en la campaña no se ven afectados: la selección vive en `selected`, que
        // se carga desde la campaña al abrir el modal y no depende de esta búsqueda.
        const res = await productsApi.getAllAdmin({
          search: pickerSearch || undefined,
          category: pickerCategory || undefined,
          all: true,
          inStock: true,
        });
        setPickerProducts(res.data?.products || []);
      } catch {
        toast.error("Error al buscar productos");
      } finally {
        setPickerLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [showModal, pickerSearch, pickerCategory]);

  // ── Vista previa: se recalcula al cambiar el descuento, el público o la selección ──
  useEffect(() => {
    if (!showModal) return;
    const value = parseFloat(form.discountValue);
    if (!selectedIds.length || isNaN(value) || value <= 0) {
      setPreview([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await offersApi.preview({
          discountType: form.discountType,
          discountValue: value,
          wholesaleDiscountValue: wholesaleDiscountPayload,
          appliesTo: form.appliesTo,
          productIds: selectedIds,
          productDiscounts: productDiscountsPayload,
          offerId: editing || undefined,
        });
        setPreview(res.data);
      } catch {
        setPreview([]);
      }
    }, 400);
    return () => clearTimeout(t);
    // selectedIds se compara por contenido a través de su join — evita recalcular por identidad de array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, form.discountType, form.discountValue, wholesaleDiscountPayload, form.appliesTo, selectedIds.join(","), JSON.stringify(productDiscountsPayload), editing]);

  // ── Alta / edición ──────────────────────────────────────────────────────────
  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, ...defaultRange() });
    setSelected([]);
    setProductDiscounts({});
    setPreview([]);
    setPickerSearch("");
    setPickerCategory("");
    setShowModal(true);
  }

  async function openEdit(offer) {
    try {
      const res = await offersApi.getById(offer.id);
      const full = res.data;
      setEditing(full.id);
      setForm({
        name: full.name,
        description: full.description || "",
        discountType: full.discountType,
        discountValue: String(full.discountValue),
        wholesaleDiscountValue: full.wholesaleDiscountValue != null ? String(full.wholesaleDiscountValue) : "",
        appliesTo: full.appliesTo,
        startsAt: toLocalInput(full.startsAt),
        endsAt: toLocalInput(full.endsAt),
        showInHome: full.showInHome,
        showCard: full.showCard !== false,
        cardStyle: full.cardStyle || "sale",
        cardColor: full.cardColor || EMPTY_FORM.cardColor,
        showCountdown: full.showCountdown !== false,
        emailAnnounce: !!full.emailAnnounce,
        emailAnnounceSaved: !!full.emailAnnounce,
        announcedAt: full.announcedAt || null,
        active: full.active,
      });
      setSelected(full.items.map((i) => i.product));
      setProductDiscounts(Object.fromEntries(full.items.map((i) => [i.productId, {
        retail:    i.discountValue != null ? String(i.discountValue) : "",
        wholesale: i.wholesaleDiscountValue != null ? String(i.wholesaleDiscountValue) : "",
      }])));
      setPreview([]);
      setPickerSearch("");
      setPickerCategory("");
      setShowModal(true);
    } catch {
      toast.error("Error al abrir la campaña");
    }
  }

  const isSelected = (id) => selectedIds.includes(id);

  function toggleProduct(product) {
    setSelected((prev) =>
      prev.some((p) => p.id === product.id)
        ? prev.filter((p) => p.id !== product.id)
        : [...prev, product]
    );
  }

  // Agrega todos los productos del filtro actual sin pisar los ya elegidos.
  function selectAllFiltered() {
    setSelected((prev) => {
      const ids = new Set(prev.map((p) => p.id));
      return [...prev, ...pickerProducts.filter((p) => !ids.has(p.id))];
    });
  }

  function clearSelection() {
    setSelected([]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim())       return toast.error("Poné un nombre para la campaña");
    if (!form.discountValue)     return toast.error("Falta el valor del descuento");
    if (!form.startsAt || !form.endsAt) return toast.error("Faltan las fechas de la campaña");
    if (new Date(form.startsAt) >= new Date(form.endsAt)) {
      return toast.error("La fecha de fin tiene que ser posterior a la de inicio");
    }
    if (selectedIds.length === 0) return toast.error("Elegí al menos un producto");
    if (form.showCard && form.cardStyle === "color" && !HEX_COLOR.test(form.cardColor)) {
      return toast.error("El color de la tarjeta tiene que ser como #d81b60");
    }
    // Con la campaña ya empezada, tildar el aviso lo manda en el próximo minuto. Antes salía sin
    // preguntar (el 7/10 el aviso del Día de la Madre les llegó a 174 clientes sin confirmación).
    if (announceSendsNow(form) && !confirm(
      "La campaña ya empezó: el aviso por email les llega a los clientes apenas guardes (en el próximo minuto).\n\n¿Mandarlo?"
    )) return;

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        discountType: form.discountType,
        discountValue: parseFloat(form.discountValue),
        wholesaleDiscountValue: wholesaleDiscountPayload,
        appliesTo: form.appliesTo,
        // datetime-local se interpreta en hora local y new Date().toISOString() lo pasa a UTC.
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt:   new Date(form.endsAt).toISOString(),
        showInHome: form.showInHome,
        showCard: form.showCard,
        cardStyle: form.cardStyle,
        cardColor: HEX_COLOR.test(form.cardColor) ? form.cardColor : null,
        showCountdown: form.showCountdown,
        emailAnnounce: form.emailAnnounce,
        active: form.active,
        productIds: selectedIds,
        productDiscounts: productDiscountsPayload,
      };

      const res = editing
        ? await offersApi.update(editing, payload)
        : await offersApi.create(payload);

      const sync = res.data?.sync;
      if (sync?.state === "ACTIVA") {
        toast.success(`Campaña activa: ${sync.applied} producto(s) con descuento aplicado`);
      } else {
        toast.success(editing ? "Campaña actualizada" : "Campaña creada");
      }
      setShowModal(false);
      loadOffers();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al guardar la campaña");
    } finally {
      setSaving(false);
    }
  }

  // ── Acciones de fila ────────────────────────────────────────────────────────
  async function handleToggleActive(offer) {
    if (!offer.active && offer.emailAnnounce && !offer.announcedAt && new Date(offer.startsAt) <= new Date() && !confirm(
      "Esta campaña tiene el aviso por email pendiente: al reanudarla, les llega a los clientes en el próximo minuto.\n\n¿Reanudar y mandar el aviso?"
    )) return;
    try {
      await offersApi.update(offer.id, { active: !offer.active });
      toast.success(offer.active ? "Campaña pausada — precios restaurados" : "Campaña reanudada");
      loadOffers();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al actualizar");
    }
  }

  async function handleSync(offer) {
    try {
      const res = await offersApi.sync(offer.id);
      const { state, applied, reverted } = res.data || {};
      if (state === "ACTIVA") toast.success(`Sincronizada: ${applied ?? 0} producto(s) con descuento`);
      else if (reverted)      toast.success(`Precios restaurados (${reverted} cambio(s))`);
      else                    toast.success(`Campaña ${String(state || "").toLowerCase()} — sin cambios`);
      loadOffers();
    } catch {
      toast.error("Error al sincronizar");
    }
  }

  async function handleDelete(offer) {
    if (!window.confirm(
      `¿Eliminar la campaña "${offer.name}"?\n\nLos precios de oferta que haya aplicado se restauran automáticamente.`
    )) return;
    try {
      await offersApi.remove(offer.id);
      toast.success("Campaña eliminada — precios restaurados");
      loadOffers();
    } catch {
      toast.error("Error al eliminar");
    }
  }

  async function openDetail(offer) {
    try {
      const res = await offersApi.getById(offer.id);
      setDetail(res.data);
    } catch {
      toast.error("Error al cargar el detalle");
    }
  }

  // Resumen del preview para el encabezado del panel de seleccionados
  const previewSummary = useMemo(() => {
    if (preview.length === 0) return null;
    return {
      afectados: preview.filter((p) => p.touched).length,
      salteados: preview.filter((p) => p.skippedReason).length,
    };
  }, [preview]);

  return (
    <AdminLayout title="Ofertas / Campañas">
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-slate-500 text-sm">
              {offers.length} campaña{offers.length !== 1 ? "s" : ""} creada{offers.length !== 1 ? "s" : ""}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              El descuento se aplica y se saca solo según las fechas. Los productos que ya tienen una
              oferta cargada a mano se respetan y quedan afuera de la campaña.
            </p>
          </div>
          <button onClick={openCreate} className="btn-primary">+ Nueva campaña</button>
        </div>

        {/* Tabla */}
        {loading ? (
          <div className="text-center py-16 text-slate-400">Cargando...</div>
        ) : offers.length === 0 ? (
          <div className="card p-12 text-center text-slate-400">
            <p className="text-4xl mb-3">🏷️</p>
            <p className="font-medium">No hay campañas creadas</p>
            <p className="text-sm mt-1">Creá la primera con el botón de arriba</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left font-semibold">Campaña</th>
                    <th className="px-4 py-3 text-left font-semibold">Descuento</th>
                    <th className="px-4 py-3 text-left font-semibold hidden md:table-cell">Público</th>
                    <th className="px-4 py-3 text-left font-semibold hidden lg:table-cell">Vigencia</th>
                    <th className="px-4 py-3 text-left font-semibold hidden sm:table-cell">Productos</th>
                    <th className="px-4 py-3 text-left font-semibold">Estado</th>
                    <th className="px-4 py-3 w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {offers.map((offer, i) => (
                    <tr key={offer.id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-800">{offer.name}</p>
                        {offer.description && (
                          <p className="text-xs text-slate-400 mt-0.5">{offer.description}</p>
                        )}
                        {offer.showInHome && (
                          <span className="text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded mt-1 inline-block">
                            Sección en el Home
                          </span>
                        )}
                        {offer.showCard && (
                          <span className="text-[10px] text-pink-700 bg-pink-50 px-1.5 py-0.5 rounded mt-1 ml-1 inline-block">
                            Tarjeta en el inicio
                          </span>
                        )}
                        {offer.announcedAt ? (
                          <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded mt-1 ml-1 inline-block">
                            📧 Avisada por email
                          </span>
                        ) : offer.emailAnnounce && (
                          <span className="text-[10px] text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded mt-1 ml-1 inline-block">
                            📧 Se avisa al empezar
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-green-700 whitespace-nowrap">
                        {/* Con descuento mayorista propio: los dos */}
                        {offer.appliesTo === "AMBOS" && offer.wholesaleDiscountValue != null ? (
                          <>
                            <span className="block">{discountLabel(offer.discountType, offer.discountValue)} min.</span>
                            <span className="block text-blue-700">{discountLabel(offer.discountType, offer.wholesaleDiscountValue)} may.</span>
                          </>
                        ) : discountLabel(offer.discountType, offer.discountValue)}
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden md:table-cell text-xs">
                        {APPLIES_LABEL[offer.appliesTo]}
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden lg:table-cell text-xs whitespace-nowrap">
                        {formatDateTime(offer.startsAt)}
                        <br />
                        <span className="text-slate-400">hasta {formatDateTime(offer.endsAt)}</span>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <button
                          onClick={() => openDetail(offer)}
                          className="text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-lg transition-colors"
                        >
                          {offer._count?.items ?? 0} productos
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATE_STYLES[offer.state] || "bg-slate-100 text-slate-500"}`}>
                          {offer.state === "ACTIVA" ? "Activa"
                            : offer.state === "PROGRAMADA" ? "Programada"
                            : offer.state === "FINALIZADA" ? "Finalizada"
                            : "Pausada"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleActive(offer)}
                            className="text-slate-400 hover:text-amber-600 transition-colors text-sm"
                            title={offer.active ? "Pausar (restaura los precios)" : "Reanudar"}
                          >
                            {offer.active ? "⏸" : "▶"}
                          </button>
                          <button
                            onClick={() => handleSync(offer)}
                            className="text-slate-400 hover:text-blue-600 transition-colors text-sm"
                            title="Sincronizar ahora (sin esperar al reloj)"
                          >
                            🔄
                          </button>
                          <button
                            onClick={() => openEdit(offer)}
                            className="text-slate-400 hover:text-blue-600 transition-colors text-sm"
                            title="Editar"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => handleDelete(offer)}
                            className="text-slate-400 hover:text-red-600 transition-colors text-sm"
                            title="Eliminar"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal crear/editar ──────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
              <h2 className="text-lg font-bold text-slate-800">
                {editing ? "Editar campaña" : "Nueva campaña de oferta"}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* ── Datos de la campaña ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nombre de la campaña *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="ej: Hot Sale Enero"
                    className="input"
                    required
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Es el título que se ve en la sección del Home
                  </p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Subtítulo <span className="text-slate-400 font-normal">— opcional</span>
                  </label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="ej: Solo por esta semana"
                    className="input"
                  />
                </div>

                {/* Orden: a quién aplica → cuánto (minoristas y mayoristas en la misma línea) → fechas →
                    sección en el Home. Antes "Aplica a" quedaba debajo de los descuentos y el campo de
                    mayoristas y el checkbox del Home sueltos en la grilla. */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Aplica a *</label>
                  <select
                    value={form.appliesTo}
                    onChange={(e) => setForm({ ...form, appliesTo: e.target.value })}
                    className="input"
                  >
                    <option value="AMBOS">Minorista y mayorista</option>
                    <option value="MINORISTA">Solo minorista</option>
                    <option value="MAYORISTA">Solo mayorista</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tipo de descuento *</label>
                  <select
                    value={form.discountType}
                    onChange={(e) => setForm({ ...form, discountType: e.target.value })}
                    className="input"
                  >
                    <option value="PERCENTAGE">Porcentaje (%)</option>
                    <option value="FIXED">Monto fijo ($)</option>
                  </select>
                  {form.discountType === "FIXED" && (
                    <p className="text-xs text-amber-600 mt-1">
                      Los productos cargados en USD quedan afuera: restarles un monto en pesos no aplica.
                    </p>
                  )}
                </div>

                {/* Descuento: con los dos públicos, uno para cada uno en la misma línea (el de mayoristas
                    vacío = el mismo que minoristas). Con un solo público, un campo a todo lo ancho. */}
                <div className={form.appliesTo === "AMBOS" ? "" : "md:col-span-2"}>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {form.appliesTo === "MAYORISTA" ? "Descuento para mayoristas" : form.appliesTo === "MINORISTA" ? "Descuento para minoristas" : "Descuento minoristas"}
                    {form.discountType === "PERCENTAGE" ? " (%)" : " ($)"} *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step={form.discountType === "PERCENTAGE" ? "1" : "0.01"}
                    max={form.discountType === "PERCENTAGE" ? "99" : undefined}
                    value={form.discountValue}
                    onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                    placeholder={form.discountType === "PERCENTAGE" ? "20" : "5000"}
                    className="input"
                    required
                  />
                </div>

                {form.appliesTo === "AMBOS" && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Descuento mayoristas{form.discountType === "PERCENTAGE" ? " (%)" : " ($)"}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step={form.discountType === "PERCENTAGE" ? "1" : "0.01"}
                      max={form.discountType === "PERCENTAGE" ? "99" : undefined}
                      value={form.wholesaleDiscountValue}
                      onChange={(e) => setForm({ ...form, wholesaleDiscountValue: e.target.value })}
                      placeholder={form.discountValue ? `Igual que minoristas (${form.discountValue})` : "Igual que minoristas"}
                      className="input"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Desde *</label>
                  <input
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                    className="input"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Hasta *</label>
                  <input
                    type="datetime-local"
                    value={form.endsAt}
                    onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                    className="input"
                    required
                  />
                </div>

                {/* Sección en el Home: recuadro a todo lo ancho (antes un checkbox suelto en media columna) */}
                <label
                  className={`md:col-span-2 flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${
                    form.showInHome ? "border-green-500 bg-green-50" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={form.showInHome}
                    onChange={(e) => setForm({ ...form, showInHome: e.target.checked })}
                    className="w-5 h-5 mt-0.5 rounded border-slate-300 flex-shrink-0"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">🏠 Mostrar como sección en el Home</span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      La campaña tiene su propia fila de productos en la página de inicio, con el nombre y el subtítulo de arriba.
                      Si lo destildás, el descuento se aplica igual y la campaña se puede filtrar en el catálogo.
                    </span>
                  </span>
                </label>

                {/* Aviso por email: recuadro a todo lo ancho, igual que el de la sección del Home */}
                <label
                  className={`md:col-span-2 flex items-start gap-3 p-4 rounded-xl border-2 transition-colors ${
                    form.announcedAt ? "border-slate-200 bg-slate-50 cursor-default" :
                    form.emailAnnounce ? "border-green-500 bg-green-50 cursor-pointer" : "border-slate-200 hover:border-slate-300 cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={form.emailAnnounce}
                    disabled={!!form.announcedAt}
                    onChange={(e) => setForm({ ...form, emailAnnounce: e.target.checked })}
                    className="w-5 h-5 mt-0.5 rounded border-slate-300 flex-shrink-0"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">📧 Avisar por email a los clientes cuando empiece</span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      {form.announcedAt
                        ? `Ya se avisó el ${formatDateTime(form.announcedAt)}. Para mandarlo de nuevo: Emails → Avisos de campañas.`
                        : "Cuando arranca la campaña, les llega un email con el descuento y los productos (a minoristas, mayoristas o los dos, según a quién aplica). Se manda una sola vez y de a poco; lo seguís en Emails → Historial."}
                    </span>
                    {!form.announcedAt && form.startsAt && new Date(form.startsAt) <= new Date() && (
                      <span className="block text-xs font-semibold text-amber-700 mt-1">
                        ⚠️ La campaña ya empezó: si lo dejás tildado, el aviso sale apenas guardes.
                      </span>
                    )}
                  </span>
                </label>

                {/* Tarjeta grande arriba de las categorías: estilo (los de las categorías o un color propio)
                    con vista previa en vivo. */}
                <div
                  className={`md:col-span-2 p-4 rounded-xl border-2 transition-colors ${
                    form.showCard ? "border-green-500 bg-green-50" : "border-slate-200"
                  }`}
                >
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.showCard}
                      onChange={(e) => setForm({ ...form, showCard: e.target.checked })}
                      className="w-5 h-5 mt-0.5 rounded border-slate-300 flex-shrink-0"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">🎴 Tarjeta grande arriba de las categorías</span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        Mientras la campaña está vigente, el inicio muestra una tarjeta grande con el nombre, el descuento y cuánto falta.
                        Al tocarla lleva al catálogo con los productos de la campaña. Si hay varias campañas, aparecen todas.
                      </span>
                    </span>
                  </label>

                  {form.showCard && (
                    <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
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

                        <label className="mt-4 flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={form.showCountdown}
                            onChange={(e) => setForm({ ...form, showCountdown: e.target.checked })}
                            className="w-4 h-4 mt-0.5 rounded border-slate-300 flex-shrink-0"
                          />
                          <span>
                            <span className="block text-sm font-medium text-slate-700">⏱️ Mostrar cuenta regresiva</span>
                            <span className="block text-xs text-slate-500 mt-0.5">
                              Días, horas, minutos y segundos hasta que termina. Cuando faltan menos de 3 días se pone roja y titila.
                              Sin tilde, muestra solo "Quedan N días".
                            </span>
                          </span>
                        </label>
                      </div>

                      <div>
                        <p className="text-xs font-semibold text-slate-600 mb-2">
                          Vista previa
                          <span className="font-normal text-slate-400">
                            {form.appliesTo === "MAYORISTA" ? " — como la ve un mayorista" : " — como la ve un minorista"}
                          </span>
                        </p>
                        <CampaignCard
                          preview
                          offer={{
                            name: form.name.trim(),
                            description: form.description.trim(),
                            endsAt: form.endsAt ? new Date(form.endsAt) : null,
                            discountType: form.discountType,
                            cardStyle: form.cardStyle,
                            cardColor: HEX_COLOR.test(form.cardColor) ? form.cardColor : null,
                            showCountdown: form.showCountdown,
                          }}
                          badge={cardPreviewBadge}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Selector de productos ── */}
              <div className="border-t border-slate-200 pt-5">
                <h3 className="text-sm font-bold text-slate-800 mb-3">
                  Productos de la campaña
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {selected.length} seleccionado{selected.length !== 1 ? "s" : ""}
                  </span>
                </h3>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                  {/* Buscador */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                    <div className="p-3 bg-slate-50 border-b border-slate-200 space-y-2">
                      <input
                        type="text"
                        value={pickerSearch}
                        onChange={(e) => setPickerSearch(e.target.value)}
                        placeholder="Buscar producto por nombre..."
                        className="input text-sm"
                      />
                      <div className="flex gap-2">
                        <select
                          value={pickerCategory}
                          onChange={(e) => setPickerCategory(e.target.value)}
                          className="input text-sm flex-1"
                        >
                          <option value="">Todas las categorías</option>
                          {/* Antes: categories.map((c) => <option value={c.slug}>{c.name}</option>)
                              categoriesApi.getAll() devuelve solo las categorías RAÍZ, con su
                              descendencia anidada en c.children. Al mapear el nivel de arriba nomás,
                              las subcategorías no aparecían y no había forma de armar una campaña
                              filtrando por una de ellas. flattenTree las trae todas, a cualquier
                              profundidad, con la sangría metida en el texto (los <option> no
                              respetan padding por CSS). */}
                          {flattenTree(categories).map((c) => (
                            <option key={c.id} value={c.slug}>{indentedLabel(c)}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={selectAllFiltered}
                          disabled={pickerProducts.length === 0}
                          className="text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg whitespace-nowrap disabled:opacity-40"
                        >
                          Agregar todos ({pickerProducts.length})
                        </button>
                      </div>
                    </div>

                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                      {pickerLoading ? (
                        <p className="p-4 text-center text-sm text-slate-400">Buscando...</p>
                      ) : pickerProducts.length === 0 ? (
                        <p className="p-4 text-center text-sm text-slate-400">Sin resultados</p>
                      ) : (
                        <>
                        {/* La búsqueda ya trae TODAS las coincidencias (para que "Agregar todos" no
                            mienta), pero solo se dibujan las primeras PICKER_VISIBLE: pintar 800
                            filas con imagen trabaría el modal. El aviso deja claro que hay más y que
                            el botón de arriba las agrega igual. */}
                        {pickerProducts.length > PICKER_VISIBLE && (
                          <p className="px-3 py-2 text-xs text-slate-500 bg-slate-50 sticky top-0">
                            Mostrando {PICKER_VISIBLE} de {pickerProducts.length} — afiná la búsqueda
                            o usá "Agregar todos ({pickerProducts.length})"
                          </p>
                        )}
                        {/* Antes: pickerProducts.map(...) sobre la lista completa */}
                        {pickerProducts.slice(0, PICKER_VISIBLE).map((p) => (
                          <label
                            key={p.id}
                            className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected(p.id)}
                              onChange={() => toggleProduct(p)}
                              className="w-4 h-4 rounded border-slate-300 flex-shrink-0"
                            />
                            {p.images?.[0] && (
                              <img
                                src={getImageUrl(p.images[0])}
                                alt=""
                                className="w-8 h-8 rounded object-cover flex-shrink-0"
                              />
                            )}
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm text-slate-700 truncate">{p.name}</span>
                              <span className="block text-xs text-slate-400">
                                {formatPrice(p.price, p.currency)}
                                {p.salePrice != null && (
                                  <span className="text-amber-600 ml-1">· ya tiene oferta</span>
                                )}
                              </span>
                            </span>
                          </label>
                        ))}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Seleccionados + preview de precios */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                    <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-700">Seleccionados</p>
                        {previewSummary ? (
                          <p className="text-xs text-slate-500">
                            {previewSummary.afectados} con descuento
                            {previewSummary.salteados > 0 && (
                              <span className="text-amber-600"> · {previewSummary.salteados} con aviso</span>
                            )}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-400">
                            Cargá el descuento para ver los precios resultantes
                          </p>
                        )}
                      </div>
                      {selected.length > 0 && (
                        <button
                          type="button"
                          onClick={clearSelection}
                          className="text-xs font-semibold text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg whitespace-nowrap"
                        >
                          Vaciar
                        </button>
                      )}
                    </div>

                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                      {selected.length === 0 ? (
                        <p className="p-4 text-center text-sm text-slate-400">
                          Todavía no elegiste productos
                        </p>
                      ) : (
                        selected.map((p) => {
                          const pv = previewById[p.id];
                          return (
                            <div key={p.id} className="flex items-start gap-3 px-3 py-2">
                              <span className="flex-1 min-w-0">
                                <span className="block text-sm text-slate-700 truncate">{p.name}</span>
                                {pv ? (
                                  <span className="block text-xs">
                                    {pv.newSalePrice != null ? (
                                      <>
                                        <span className="text-slate-400 line-through">
                                          {formatPrice(pv.price, pv.currency)}
                                        </span>
                                        <span className="text-green-700 font-semibold ml-1">
                                          {formatPrice(pv.newSalePrice, pv.currency)}
                                        </span>
                                      </>
                                    ) : (
                                      <span className="text-slate-400">
                                        {formatPrice(pv.price, pv.currency)}
                                      </span>
                                    )}
                                    {pv.newWholesaleSalePrice != null && (
                                      <span className="text-blue-600 ml-1">
                                        · may. {formatPrice(pv.newWholesaleSalePrice, pv.currency)}
                                      </span>
                                    )}
                                    {pv.variantsAffected > 0 && (
                                      <span className="text-slate-400 ml-1">
                                        · {pv.variantsAffected} variante(s)
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span className="block text-xs text-slate-400">
                                    {formatPrice(p.price, p.currency)}
                                  </span>
                                )}
                                {pv?.skippedReason && (
                                  <span className="block text-xs text-amber-600 mt-0.5">
                                    ⚠ {pv.skippedReason}
                                  </span>
                                )}
                                {/* Descuento propio de este producto (vacío = el de la campaña) */}
                                <span className="flex items-center gap-3 mt-1 flex-wrap">
                                  {[
                                    { side: "retail",    show: form.appliesTo !== "MAYORISTA", label: form.appliesTo === "AMBOS" ? "Min." : "Desc.", def: form.discountValue },
                                    { side: "wholesale", show: form.appliesTo !== "MINORISTA", label: form.appliesTo === "AMBOS" ? "May." : "Desc.",
                                      def: form.appliesTo === "AMBOS" && form.wholesaleDiscountValue !== "" ? form.wholesaleDiscountValue : form.discountValue },
                                  ].filter((o) => o.show).map((o) => (
                                    <label key={o.side} className="flex items-center gap-1 text-[11px] text-slate-500" title="Descuento propio de este producto. Vacío = el de la campaña.">
                                      {o.label}
                                      <input
                                        type="number"
                                        min="0"
                                        step={form.discountType === "PERCENTAGE" ? "1" : "0.01"}
                                        value={productDiscounts[p.id]?.[o.side] ?? ""}
                                        onChange={(e) => setProductDiscount(p.id, o.side, e.target.value)}
                                        placeholder={o.def || "—"}
                                        className={`w-16 border rounded px-1 py-0.5 text-xs ${productDiscounts[p.id]?.[o.side] ? "border-blue-400 text-blue-800 font-semibold" : "border-slate-200"}`}
                                      />
                                      {form.discountType === "PERCENTAGE" ? "%" : "$"}
                                    </label>
                                  ))}
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => toggleProduct(p)}
                                className="text-slate-300 hover:text-red-500 text-sm flex-shrink-0"
                                title="Quitar de la campaña"
                              >
                                ✕
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </form>

            {/* Footer fijo */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              <button onClick={handleSubmit} disabled={saving} className="btn-primary">
                {saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear campaña"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de detalle ────────────────────────────────────────────────── */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-800">{detail.name}</h2>
                <p className="text-xs text-slate-500">
                  {detail.items.length} producto(s) · {formatDateTime(detail.startsAt)} → {formatDateTime(detail.endsAt)}
                </p>
              </div>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {detail.items.map((item) => (
                <div key={item.id} className="flex items-start gap-3 px-6 py-3">
                  {item.product.images?.[0] && (
                    <img
                      src={getImageUrl(item.product.images[0])}
                      alt=""
                      className="w-10 h-10 rounded object-cover flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 truncate">{item.product.name}</p>
                    {(item.discountValue != null || item.wholesaleDiscountValue != null) && (
                      <p className="text-[11px] text-blue-700 font-semibold">
                        Descuento propio:
                        {item.discountValue != null && ` ${discountLabel(detail.discountType, item.discountValue)}${detail.appliesTo === "AMBOS" ? " min." : ""}`}
                        {item.wholesaleDiscountValue != null && ` ${discountLabel(detail.discountType, item.wholesaleDiscountValue)}${detail.appliesTo === "AMBOS" ? " may." : ""}`}
                      </p>
                    )}
                    <p className="text-xs">
                      {item.appliedSalePrice != null ? (
                        <>
                          <span className="text-slate-400 line-through">
                            {formatPrice(item.product.price, item.product.currency)}
                          </span>
                          <span className="text-green-700 font-semibold ml-1">
                            {formatPrice(item.appliedSalePrice, item.product.currency)}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-400">
                          {formatPrice(item.product.price, item.product.currency)} · sin cambio minorista
                        </span>
                      )}
                      {item.appliedWholesaleSalePrice != null && (
                        <span className="text-blue-600 ml-1">
                          · may. {formatPrice(item.appliedWholesaleSalePrice, item.product.currency)}
                        </span>
                      )}
                      {Array.isArray(item.appliedVariants) && item.appliedVariants.length > 0 && (
                        <span className="text-slate-400 ml-1">
                          · {item.appliedVariants.length} variante(s)
                        </span>
                      )}
                    </p>
                    {item.skippedReason && (
                      <p className="text-xs text-amber-600 mt-0.5">⚠ {item.skippedReason}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 text-right">
              <button onClick={() => setDetail(null)} className="btn-primary">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

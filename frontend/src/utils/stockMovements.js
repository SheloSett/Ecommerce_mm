// Textos del historial de stock (ver StockHistoryModal.jsx y backend/src/services/stock.service.js).
// Cada movimiento trae el motivo en código (VENTA, COMPRA...): acá se pasa a castellano para el panel.

const REASON_LABELS = {
  VENTA:          "Venta",
  VENTA_MANUAL:   "Venta manual",
  CANCELACION:    "Pedido cancelado",
  EDICION_PEDIDO: "Pedido modificado",
  AJUSTE:         "Carga a mano",
  ALTA:           "Alta del producto",
  COMPRA:         "Compra a proveedor",
  RMA:            "RMA (falla)",
  VARIANTES:      "Variantes regeneradas",
  VENTA_ML:       "Venta en Mercado Libre",
  CAMBIO_ML:      "Cambio en Mercado Libre",
  VINCULO_ML:     "Vínculo con Mercado Libre",
};

export function reasonLabel(reason) {
  return REASON_LABELS[reason] || reason || "Otro";
}

// "+5", "-3" o "0".
export function changeText(delta) {
  const n = Number(delta) || 0;
  return n > 0 ? `+${n}` : String(n);
}

// Unidades que se pidieron y no había (una venta de 5 con 2 en stock: faltaron 3). 0 si alcanzó.
export function shortfallOf(movement) {
  const { requested, delta } = movement || {};
  if (requested == null || requested >= 0) return 0;
  return Math.max(0, (Number(delta) || 0) - requested);
}

// A qué corresponde el movimiento: { text, to } (to = ruta del panel, o null si no hay pantalla).
export function refOf(movement) {
  const { refType, refId } = movement || {};
  if (!refType || refId == null) return null;
  if (refType === "order")    return { text: `Pedido #${refId}`, to: `/admin/ordenes/${refId}` };
  if (refType === "purchase") return { text: `Compra #${refId}`, to: null };
  if (refType === "gasto")    return { text: `Caja #${refId}`, to: null };
  if (refType === "ml")       return { text: "Mercado Libre", to: "/admin/productos/mercadolibre" };
  return { text: `${refType} #${refId}`, to: null };
}

// Variante del movimiento ("Color: Negro"), o null si es del producto. Una variante que ya no existe
// (se regeneraron las variantes) se muestra por su número.
export function unitLabel(movement, variantLabels = {}) {
  if (!movement?.variantId) return null;
  return variantLabels[movement.variantId] || `Variante #${movement.variantId} (ya no existe)`;
}

// Fecha y hora en hora argentina (de 0 a 23), sin importar dónde esté la computadora.
export function movementDate(createdAt) {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
}

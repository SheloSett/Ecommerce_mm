// Pedidos repetidos por doble envío (26/11/2026). La clienta vio dos cotizaciones idénticas seguidas (#280 y
// #281, mismo cliente, mismo total, misma hora). Los números seguidos lo delatan: después de cada pedido se
// saltean a propósito entre 3 y 8 ids, así que dos ids pegados son dos pedidos creados A LA VEZ: el mismo
// envío llegó dos veces (doble clic o doble toque en "Confirmar", antes de que el botón se desactivara).
//
// La "huella" de un pedido: el email, el método de pago y los productos (producto, variante y cantidad), sin
// importar el orden. Dos envíos con la misma huella en poco tiempo son el mismo pedido. Puro, para testearlo.

const DEDUP_WINDOW_MS = 2 * 60 * 1000; // 2 minutos

function fingerprint({ email, paymentMethod, items }) {
  const mail = String(email || "").trim().toLowerCase();
  if (!mail || !Array.isArray(items) || items.length === 0) return null;
  const lines = items
    .map((i) => `${Number(i.productId) || 0}:${Number(i.variantId) || 0}:${Number(i.quantity) || 0}`)
    .sort()
    .join(",");
  return `${mail}|${paymentMethod || "MERCADOPAGO"}|${lines}`;
}

module.exports = { fingerprint, DEDUP_WINDOW_MS };

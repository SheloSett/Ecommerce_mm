// Escapa texto para meterlo en HTML armado a mano (las hojas de impresión de pedidos, cotizaciones y
// compras, que se abren con window.open). Cualquier dato de un pedido tiene que pasar por acá: el
// nombre, el teléfono y la nota los escribe el cliente en el checkout, y una nota como
// <img src=x onerror="..."> se ejecutaba en el navegador del admin al imprimir y podía llevarse su
// sesión (la hoja comparte el localStorage de la tienda). Mismo criterio que escapeHtml del backend
// (services/broadcast.templates.js).
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

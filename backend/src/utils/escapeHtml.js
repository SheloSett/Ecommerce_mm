// Escapa texto para meterlo en el HTML de un email. Todo lo que escribe un cliente (nombre, teléfono,
// motivo de una devolución, nota) tiene que pasar por acá: antes services/email.service.js lo metía
// crudo y desde el formulario público de devoluciones se podían armar emails "de IGWT Store" con
// links y títulos a gusto de quien lo llenaba. Mismo criterio que escapeHtml de
// services/broadcast.templates.js (no se importa de ahí porque ese módulo carga ofertas y la base).
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

module.exports = { escapeHtml };

// Módulo SSE para notificaciones en tiempo real
// Reemplaza el polling que consumía el rate limiter con conexiones persistentes

// Map<customerId, Set<res>> — soporta múltiples pestañas del mismo cliente
const clients = new Map();

/**
 * Registra una conexión SSE para un cliente.
 * @param {number} customerId
 * @param {import("express").Response} res
 */
function addClient(customerId, res) {
  if (!clients.has(customerId)) clients.set(customerId, new Set());
  clients.get(customerId).add(res);
}

/**
 * Elimina una conexión SSE (cuando el cliente cierra la pestaña o la red cae).
 * @param {number} customerId
 * @param {import("express").Response} res
 */
function removeClient(customerId, res) {
  const set = clients.get(customerId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(customerId);
}

/**
 * Pushea datos a todas las pestañas abiertas de un cliente.
 * Si la escritura falla (conexión ya cerrada), elimina esa res.
 * @param {number} customerId
 * @param {object} data
 */
function pushToClient(customerId, data) {
  const set = clients.get(customerId);
  if (!set || set.size === 0) return;

  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      // La conexión se cerró sin que se disparara el evento "close"
      removeClient(customerId, res);
    }
  }
}

module.exports = { addClient, removeClient, pushToClient };

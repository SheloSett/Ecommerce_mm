// Acceso al almacenamiento del navegador que nunca tira. Tocar window.localStorage falla en Chrome con
// las cookies bloqueadas para el sitio (SecurityError), y setItem falla con la cuota llena o en algún modo
// privado. Los contexts que usan esto corren en todas las páginas: un throw acá dejaba toda la tienda en
// "Algo falló" para ese visitante. Si no se puede guardar, el valor queda en memoria mientras dure la
// página (la sesión sigue funcionando hasta cerrar la pestaña).
//
// Lo guardado en el navegador manda sobre lo que quedó en memoria: otra pestaña pudo haber entrado de
// nuevo. La memoria solo responde cuando el navegador no tiene nada para esa clave.
const memory = new Map();

function storage() {
  try { return window.localStorage; } catch { return null; }
}

export function storageGet(key) {
  try {
    const saved = storage()?.getItem(key);
    if (saved != null) {
      memory.delete(key);
      return saved;
    }
  } catch { /* sin almacenamiento: queda la memoria */ }
  return memory.has(key) ? memory.get(key) : null;
}

// true si quedó guardado en el navegador; false si quedó solo en memoria.
export function storageSet(key, value) {
  try {
    storage().setItem(key, value);
    memory.delete(key);
    return true;
  } catch {
    memory.set(key, value);
    return false;
  }
}

export function storageRemove(key) {
  memory.delete(key);
  try { storage()?.removeItem(key); } catch { /* sin almacenamiento: no había nada que borrar */ }
}

// Lo guardado como JSON, o null si no está, no se entiende o no pasa el control de forma (isValid).
export function storageGetJSON(key, isValid = () => true) {
  const raw = storageGet(key);
  if (raw == null) return null;
  try {
    const value = JSON.parse(raw);
    return isValid(value) ? value : null;
  } catch { return null; }
}

// Control de forma para storageGetJSON: un objeto, no una lista ni un texto.
export const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

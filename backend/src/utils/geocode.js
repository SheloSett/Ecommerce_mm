// Ubica direcciones de CABA en el mapa (latitud/longitud) con el normalizador del Gobierno de la
// Ciudad (USIG): gratuito, sin clave, y entiende direcciones como las que se cargan en los
// proveedores ("pasteur 288", "peron 2310"). Lo usa la orden de compra para ordenar a los
// proveedores según el recorrido a pie (ver frontend/src/utils/purchaseRoute.js).
//
// Solo sirve para CABA. Una misma dirección suele existir también en el conurbano ("Pasteur 288"
// está en CABA, Avellaneda y Cañuelas): se prefiere siempre la de CABA.
//
// Los resultados se guardan en memoria (se pierden al reiniciar el backend, no hace falta más):
// cada vez que se abre una orden de compra se piden las mismas direcciones.

const USIG_URL = "https://servicios.usig.buenosaires.gob.ar/normalizar/";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // una semana
const CACHE_MAX = 500;
const cache = new Map(); // dirección normalizada → { value, at }

function cacheKey(address) {
  return String(address || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// "av la plata 744 timbre 3" → "av la plata 744". USIG no encuentra la dirección si después de la
// altura hay texto de más (timbre, piso, local), así que se reintenta cortando después del número.
function trimAfterNumber(address) {
  const m = String(address).match(/^(.*?\d+)/);
  return m ? m[1].trim() : null;
}

async function queryUsig(address, fetchImpl) {
  const url = `${USIG_URL}?direccion=${encodeURIComponent(address)}&geocodificar=TRUE&srid=4326`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`USIG respondió ${res.status}`);
  const data = await res.json();
  // Algunos candidatos vienen sin coordenadas: esos no sirven para el recorrido.
  const candidates = (data.direccionesNormalizadas || [])
    .filter((c) => c.coordenadas?.x != null && c.coordenadas?.y != null);
  const best = candidates.find((c) => c.cod_partido === "caba") || candidates[0];
  if (!best) return null;
  return {
    lat:   parseFloat(best.coordenadas.y),
    lng:   parseFloat(best.coordenadas.x),
    label: best.direccion, // cómo la entendió USIG, ej. "PASTEUR 288, CABA"
  };
}

// Devuelve { lat, lng, label }, o null si no la encuentra (mal escrita o fuera de CABA). El "no la
// encontré" también se guarda, para no volver a preguntar lo mismo; corregir la dirección cambia
// la clave. Un error de red se lanza y NO se guarda, así el próximo intento vuelve a consultar.
async function geocodeAddress(address, { fetchImpl = fetch } = {}) {
  const key = cacheKey(address);
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value = await queryUsig(key, fetchImpl);
  if (!value) {
    const trimmed = trimAfterNumber(key);
    if (trimmed && trimmed !== key) value = await queryUsig(trimmed, fetchImpl);
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // sale el más viejo
  cache.set(key, { value, at: Date.now() });
  return value;
}

// Solo para los tests.
function _clearGeocodeCache() {
  cache.clear();
}

module.exports = { geocodeAddress, _clearGeocodeCache };

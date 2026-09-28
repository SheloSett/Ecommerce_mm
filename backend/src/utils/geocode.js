// Ubica direcciones de CABA en el mapa (latitud/longitud) con el normalizador del Gobierno de la
// Ciudad (USIG): gratuito, sin clave, y entiende direcciones como las que se cargan en los
// proveedores ("pasteur 288", "peron 2310"). Lo usa la orden de compra para ordenar a los
// proveedores según el recorrido a pie (ver frontend/src/utils/purchaseRoute.js).
//
// Solo sirve para CABA. Una misma dirección suele existir también en el conurbano ("Pasteur 288"
// está en CABA, Avellaneda y Cañuelas): se prefiere siempre la de CABA.
//
// Errores de tipeo: USIG no encuentra "azcuenga 179" (es Azcuénaga). Si no la encuentra, se busca
// en el listado de calles de CABA (callejero) la calle más parecida donde exista esa altura, y se
// consulta con el nombre correcto. Ver correctStreet.
//
// Los resultados se guardan en memoria (se pierden al reiniciar el backend, no hace falta más):
// cada vez que se abre una orden de compra se piden las mismas direcciones.

const USIG_URL = "https://servicios.usig.buenosaires.gob.ar/normalizar/";
const CALLEJERO_URL = "https://servicios.usig.buenosaires.gob.ar/callejero";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // una semana
const CACHE_MAX = 500;
const cache = new Map(); // dirección normalizada → { value, at }
let callejero = null;    // { at, streets } — las ~2500 calles de CABA

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

// ── Corrección de errores de tipeo en el nombre de la calle ────────────────────────────────────

// "Azcuénaga, Domingo de" → "AZCUENAGA DOMINGO DE"
function normalizeText(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Cantidad de letras a agregar, sacar, cambiar o dar vuelta (dos seguidas) para pasar de a a b
// (distancia de Damerau-Levenshtein). "AZCUENGA" → "AZCUENAGA" = 1; "SARMINETO" → "SARMIENTO" = 1.
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

// Listado de calles de CABA de USIG: [codigo, nombre, palabras de búsqueda, [[desde, hasta], ...]].
// Las alturas sirven para descartar calles donde ese número no existe.
async function loadCallejero(fetchImpl) {
  if (callejero && Date.now() - callejero.at < CACHE_TTL_MS) return callejero.streets;
  const res = await fetchImpl(CALLEJERO_URL, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`USIG callejero respondió ${res.status}`);
  const data = await res.json();
  const streets = data.map(([, name, tokens, ranges]) => ({
    name,
    full:   normalizeText(name),                            // "PUEYRREDON AV"
    words:  normalizeText(tokens || name).split(" "),       // "PUEYRREDON", "AV", "AVENIDA", ...
    ranges: Array.isArray(ranges) ? ranges : [],
  }));
  callejero = { at: Date.now(), streets };
  return streets;
}

// "azcuenga 179" → "AZCUENAGA 179" si hay UNA sola calle claramente más parecida donde exista la
// altura 179. Tolera 1 letra de diferencia (2 en nombres de 8 letras o más). Si hay dos igual de
// parecidas, no adivina (devuelve null): mejor "no encontrada" que un proveedor en otro lado.
function correctStreet(address, streets) {
  const m = String(address).match(/^(.*?)\s*(\d+)$/);
  if (!m) return null;
  const typed = normalizeText(m[1]);
  const number = parseInt(m[2], 10);
  if (typed.length < 4) return null;
  const maxDist = typed.length >= 8 ? 2 : 1;
  const singleWord = !typed.includes(" ");

  const matches = [];
  for (const s of streets) {
    if (!s.ranges.some(([from, to]) => number >= from && number <= to)) continue;
    const dFull = editDistance(typed, s.full);
    // Si escribieron una sola palabra ("pueyredon"), alcanza con que se parezca a una palabra del
    // nombre ("PUEYRREDON AV."). Con más palabras se compara el nombre entero.
    const dWord = singleWord ? Math.min(...s.words.map((w) => editDistance(typed, w))) : dFull;
    const score = Math.min(dFull, dWord);
    if (score <= maxDist) matches.push({ s, score, dFull });
  }
  if (matches.length === 0) return null;
  // Primero la más parecida; si empatan, la de nombre completo más parecido ("SARMIENTO" le gana a
  // "FRAGATA PRES. SARMIENTO" para "sarmineto").
  matches.sort((a, b) => a.score - b.score || a.dFull - b.dFull);
  const [best, second] = matches;
  if (second && second.score === best.score && second.dFull === best.dFull) return null;
  return `${best.s.name} ${number}`;
}

// ── Punto de entrada ────────────────────────────────────────────────────────────────────────────

// Devuelve { lat, lng, label, corrected }, o null si no la encuentra (mal escrita o fuera de CABA).
// corrected: true cuando se ubicó corrigiendo el nombre de la calle (label dice cómo quedó).
// El "no la encontré" también se guarda, para no volver a preguntar lo mismo; corregir la dirección
// cambia la clave. Un error de red se lanza y NO se guarda, así el próximo intento vuelve a consultar.
async function geocodeAddress(address, { fetchImpl = fetch } = {}) {
  const key = cacheKey(address);
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value = await queryUsig(key, fetchImpl);
  const trimmed = trimAfterNumber(key);
  if (!value && trimmed && trimmed !== key) value = await queryUsig(trimmed, fetchImpl);
  if (!value && trimmed) {
    const corrected = correctStreet(trimmed, await loadCallejero(fetchImpl));
    if (corrected) {
      const found = await queryUsig(corrected, fetchImpl);
      if (found) value = { ...found, corrected: true };
    }
  }
  if (value && !value.corrected) value = { ...value, corrected: false };

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // sale el más viejo
  cache.set(key, { value, at: Date.now() });
  return value;
}

// Solo para los tests.
function _clearGeocodeCache() {
  cache.clear();
  callejero = null;
}

module.exports = { geocodeAddress, _clearGeocodeCache, _internals: { correctStreet, editDistance, normalizeText } };

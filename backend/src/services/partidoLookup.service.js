// "¿De qué partido es este lugar?", para los barrios y nombres que no están en la base oficial (Nordelta, un
// barrio nuevo). Es lo mismo que buscarlo en Google, con OpenStreetMap: gratis y sin clave.
//
// Solo se manda el nombre de la localidad, nunca datos del cliente. Las reglas de uso del servicio piden no
// pasar de una consulta por segundo, así que van de a una y lo ya buscado queda guardado en memoria.

const { normalizeName } = require("../utils/placeName");
const { PARTIDOS } = require("../utils/motoLocalidades");

const URL_SEARCH = "https://nominatim.openstreetmap.org/search";
const HEADERS = { "User-Agent": "IGWTStore/1.0 (https://igwtstore.com.ar)", "Accept-Language": "es" };
const TIMEOUT_MS = 2500;
const MAX_WAITING = 3; // si hay más en la fila, no se espera: el checkout no puede quedar colgado
const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 2000;

// Lugares donde vive gente. Sin esto, una calle o un negocio con ese nombre da un partido cualquiera.
const PLACE_CATEGORIES = new Set(["place", "boundary", "landuse", "railway"]);

const KNOWN_PARTIDOS = new Map(PARTIDOS.map((p) => [normalizeName(p), p]));
const cache = new Map();
let queue = Promise.resolve();
let waiting = 0;

const gapMs = () => Number(process.env.PARTIDO_LOOKUP_GAP_MS ?? 1100);

// Nombres de partido de los resultados. OSM a veces da otra división ("Cuartel II"): esas no se toman.
function partidosFromResults(results) {
  const found = new Set();
  for (const result of Array.isArray(results) ? results : []) {
    if (!PLACE_CATEGORIES.has(result.category)) continue;
    if (!/buenos aires/i.test(result.address?.state || "")) continue;
    const county = String(result.address?.county || result.address?.state_district || "").replace(/^partido (de |del )?/i, "");
    const partido = KNOWN_PARTIDOS.get(normalizeName(county));
    if (partido) found.add(partido);
  }
  return [...found];
}

async function search(name) {
  const params = new URLSearchParams({
    q: `${name}, Buenos Aires, Argentina`, format: "jsonv2", addressdetails: "1", limit: "5", countrycodes: "ar",
  });
  const res = await fetch(`${URL_SEARCH}?${params}`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`respondió ${res.status}`);
  return partidosFromResults(await res.json());
}

// Lista de partidos del lugar: vacía si no lo encontró, null si no se pudo consultar (no se guarda).
async function lookupPartidos(city) {
  const key = normalizeName(city);
  if (key.length < 3) return [];
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < (cached.partidos.length ? FOUND_TTL_MS : NOT_FOUND_TTL_MS)) return cached.partidos;
  if (waiting >= MAX_WAITING) return null;

  waiting++;
  const run = queue.then(() => search(String(city).trim()));
  // La pausa va después de cada consulta, salga bien o mal.
  queue = run.catch(() => {}).then(() => new Promise((resolve) => setTimeout(resolve, gapMs())));
  try {
    const partidos = await run;
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(key, { partidos, at: Date.now() });
    return partidos;
  } catch (err) {
    console.error("[ENVIOS] No se pudo buscar el partido:", err.message);
    return null;
  } finally {
    waiting--;
  }
}

const clearPartidoCache = () => cache.clear();

module.exports = { lookupPartidos, partidosFromResults, clearPartidoCache };

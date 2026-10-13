// Orden por RELEVANCIA de los resultados de búsqueda del catálogo.
//
// Problema que resuelve: la búsqueda matchea cualquier producto cuyo nombre contenga la palabra
// (unaccent(name) ILIKE '%cable%'), y el listado se ordenaba por fecha de alta. Así, buscando
// "cable" aparecían primero los cargadores y power banks "CON CABLE" cargados la semana pasada, y
// los cables de verdad quedaban en la página 2 o 3. Acá se puntúa cada resultado según QUÉ TAN
// probable es que sea lo que la persona buscó, y se ordena por ese puntaje (empate → se respeta el
// orden que ya traía la consulta, que es "más nuevo primero").
//
// Criterios (se suman):
//   +30  el nombre EMPIEZA con la palabra buscada         "CABLE USB A TIPO C"
//   +15  la palabra está en la segunda posición           "20 CABLES MHL", "KIT CABLE MAS CARGADOR"
//   +25  alguna categoría del producto coincide           categoría "Cables" para "cable"
//   +10  por cada palabra buscada que aparece como palabra entera (o prefijo) del nombre
//   -20  por cada palabra buscada que SOLO aparece como accesorio: "CON CABLE", "+ CABLE",
//        "SIN CABLES", "INCLUYE CABLES", "MAS CABLE", "Y CABLE"
//
// Todo se compara sin tildes y sin mayúsculas (igual que la consulta SQL con unaccent).
// La función es pura y no toca la base: recibe los productos ya traídos (con name y categories).

// Palabras que, puestas justo antes de la buscada, indican que es un accesorio del producto y no
// el producto en sí ("CARGADOR ... CON CABLE", "CARPLAY SIN CABLES", "POWER BANK + CABLE").
const ACCESSORY_PREFIXES = new Set(["con", "sin", "incluye", "mas", "+", "y", "c/"]);

// Normaliza para comparar: minúsculas, sin tildes, y todo lo que no sea letra/número/'+'/'/' pasa a
// espacio (así "(CABLE" o "CABLE," quedan como la palabra sola). Se conserva '+' porque "+ CABLE" es
// una de las marcas de accesorio, y '/' por "c/".
function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+/]+/g, " ")
    .trim();
}

function words(s) {
  const n = normalizeText(s);
  return n ? n.split(/\s+/) : [];
}

// ¿La palabra del nombre "es" la palabra buscada? Igual o la buscada como prefijo, así
// "cables"/"cablecito" cuentan para "cable" y "cargadores" para "cargador". Mínimo 3 letras para que
// una búsqueda tipo "a" no puntúe contra todo.
function wordMatches(nameWord, searchWord) {
  if (searchWord.length < 3) return nameWord === searchWord;
  return nameWord === searchWord || nameWord.startsWith(searchWord);
}

// Puntaje de relevancia de UN producto para el término buscado. Exportada para los tests.
function searchRelevanceScore(product, term) {
  const searchWords = words(term);
  if (searchWords.length === 0) return 0;

  const nameWords = words(product && product.name);
  const categoryWords = (Array.isArray(product && product.categories) ? product.categories : [])
    .flatMap((c) => words(c && (c.name || c.slug)));

  let score = 0;

  for (const sw of searchWords) {
    // Posiciones del nombre donde aparece la palabra buscada.
    const positions = [];
    nameWords.forEach((nw, i) => { if (wordMatches(nw, sw)) positions.push(i); });

    if (positions.length > 0) {
      score += 10;
      if (positions.includes(0)) score += 30;
      else if (positions.includes(1)) score += 15;
      // Accesorio: TODAS las apariciones vienen precedidas por "con", "+", "sin", etc.
      const onlyAccessory = positions.every((i) => i > 0 && ACCESSORY_PREFIXES.has(nameWords[i - 1]));
      if (onlyAccessory) score -= 20;
    }

    // Categoría: "Cables" para "cable", "Cargadores" para "cargador", "Auriculares" para "auricular".
    if (categoryWords.some((cw) => wordMatches(cw, sw))) score += 25;
  }

  return score;
}

// Ordena (sin mutar) una lista de productos por relevancia descendente. El sort de JS es estable,
// así que a igual puntaje se conserva el orden de entrada (más nuevo primero, como viene de la DB).
function sortBySearchRelevance(products, term) {
  const list = Array.isArray(products) ? products : [];
  if (!words(term).length) return [...list];
  const scored = list.map((p, idx) => ({ p, idx, s: searchRelevanceScore(p, term) }));
  scored.sort((a, b) => (b.s - a.s) || (a.idx - b.idx));
  return scored.map((x) => x.p);
}

module.exports = { searchRelevanceScore, sortBySearchRelevance, normalizeText };

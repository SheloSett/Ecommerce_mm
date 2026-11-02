// Genera backend/src/utils/motoLocalidades.js con las localidades de la provincia de Buenos Aires y su partido,
// a partir de la base oficial Georef (datos.gob.ar). Las localidades casi no cambian: alcanza con correrlo si
// aparece algo nuevo en esa base.
//
// Uso (desde backend/): node scripts/generar-localidades-moto.js

const fs = require("fs");
const path = require("path");
const { normalizeName } = require("../src/utils/placeName");

const SOURCE = "https://infra.datos.gob.ar/georef/asentamientos.json";
const OUTPUT = path.join(__dirname, "../src/utils/motoLocalidades.js");
const BUENOS_AIRES = "06";

// Parajes del Delta y de la isla Martín García: están dentro de un partido del mapa, pero ahí no llega una moto.
const ISLAND = /\bislas?\b|^arroyo |^rio |^parana mini$|^martin garcia$|^manzano de la barca$|^la barquita$/;

async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`Georef respondió ${res.status}`);
  const rows = (await res.json()).asentamientos.filter((a) => a.provincia.id === BUENOS_AIRES);

  const partidos = [...new Set(rows.map((a) => a.departamento.nombre).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const places = new Map(); // nombre → { partidos, urban }
  for (const row of rows) {
    if (!row.departamento.nombre) continue;
    const key = normalizeName(row.nombre);
    const place = places.get(key) || { partidos: new Set(), urban: false };
    place.partidos.add(row.departamento.nombre);
    if (row.categoria !== "Paraje") place.urban = true;
    places.set(key, place);
  }
  // Escribir el partido en vez de la localidad también vale ("Tres de Febrero", "La Matanza").
  for (const partido of partidos) {
    const key = normalizeName(partido);
    const place = places.get(key) || { partidos: new Set(), urban: false };
    place.partidos.add(partido);
    place.urban = true;
    places.set(key, place);
  }

  const names = [...places.keys()].sort();
  const islands = names.filter((n) => ISLAND.test(n) && !places.get(n).urban);
  const rural = names.filter((n) => !places.get(n).urban && !islands.includes(n));
  const localities = names.filter((n) => !islands.includes(n))
    .map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify([...places.get(n).partidos].sort().join("|"))},`);

  fs.writeFileSync(OUTPUT, `// Generado por backend/scripts/generar-localidades-moto.js desde Georef (datos.gob.ar). No editar a mano.
// Localidades de la provincia de Buenos Aires con su partido: "nombre": "Partido" o "Partido A|Partido B".
// El mapa de zonas sale de los partidos de cada zona; esto dice de qué partido es lo que escribió el cliente.

const PARTIDOS = ${JSON.stringify(partidos)};

// Parajes rurales: se cotizan, pero el pedido queda marcado para revisar si la moto llega.
const RURAL = ${JSON.stringify(rural)};

// Islas del Delta y Martín García: la moto no llega.
const ISLANDS = ${JSON.stringify(islands)};

const LOCALITIES = {
${localities.join("\n")}
};

module.exports = { PARTIDOS, RURAL, ISLANDS, LOCALITIES };
`);
  console.log(`${partidos.length} partidos, ${localities.length} localidades, ${rural.length} parajes, ${islands.length} islas`);
  console.log("Islas:", islands.join(", "));
}

main().catch((err) => { console.error(err.message); process.exit(1); });

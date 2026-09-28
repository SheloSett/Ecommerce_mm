// Tests del geocodificador de direcciones (utils/geocode.js), con USIG simulado: no sale a internet.
// Correr con: npm test

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { geocodeAddress, _clearGeocodeCache, _internals } = require("../src/utils/geocode");

// Listado de calles simulado, con el formato de USIG: [codigo, nombre, palabras, alturas]
const CALLEJERO = [
  [1147, "AZCUENAGA", "AZCUENAGA", [[1, 2100]]],
  [1148, "AZCUENAGA, DOMINGO DE", "AZCUENAGA DOMINGO DE", [[2951, 3000]]],
  [20074, "SARMIENTO", "SARMIENTO", [[1, 4700]]],
  [20075, "SARMIENTO AV.", "SARMIENTO AV AVENIDA AVD AVDA", [[2601, 4800]]],
  [6049, "FRAGATA PRES. SARMIENTO", "FRAGATA PRES SARMIENTO PRESIDENTE PTE", [[401, 2500], [1, 100]]],
  [17132, "PUEYRREDON AV.", "PUEYRREDON AV AVENIDA AVD AVDA", [[1, 2700]]],
  [17133, "PUEYRREDON, HONORIO, DR. AV.", "PUEYRREDON HONORIO DR AV DOCTOR AVENIDA AVD AVDA", [[301, 2200]]],
  [90001, "PASO", "PASO", [[1, 1000]]],
  [90002, "PASCO", "PASCO", [[1, 1000]]],
];

// Arma un fetch falso: responde el callejero y, para cada dirección, lo que diga `byAddress`.
// Cuenta las consultas (calls) para ver qué se pidió y qué salió de lo guardado.
function fakeFetch(byAddress) {
  const calls = [];
  const impl = async (url) => {
    if (url.includes("/callejero")) {
      calls.push("callejero");
      return { ok: true, json: async () => CALLEJERO };
    }
    const address = decodeURIComponent(new URL(url).searchParams.get("direccion"));
    calls.push(address);
    const payload = byAddress[address];
    if (payload instanceof Error) throw payload;
    return { ok: true, json: async () => payload || { direccionesNormalizadas: [], errorMessage: "Calle inexistente" } };
  };
  return { impl, calls };
}
const caba = (direccion, y, x) => ({ direccionesNormalizadas: [{ cod_partido: "caba", direccion, coordenadas: { x, y } }] });

const PASTEUR_288 = {
  direccionesNormalizadas: [
    // El primero NO es el de CABA a propósito: se tiene que elegir el de CABA igual.
    { cod_partido: "avellaneda", direccion: "Luis Pasteur 288, Avellaneda", coordenadas: { x: -58.342, y: -34.689 } },
    { cod_partido: "canuelas",   direccion: "Pasteur 288, Cañuelas" }, // sin coordenadas
    { cod_partido: "caba",       direccion: "PASTEUR 288, CABA", coordenadas: { x: "-58.399368", y: "-34.606315" } },
  ],
};

describe("geocodeAddress", () => {
  beforeEach(() => _clearGeocodeCache());

  test("prefiere el candidato de CABA y devuelve números", async () => {
    const { impl } = fakeFetch({ "pasteur 288": PASTEUR_288 });
    const r = await geocodeAddress("Pasteur 288", { fetchImpl: impl });
    assert.deepEqual(r, { lat: -34.606315, lng: -58.399368, label: "PASTEUR 288, CABA", corrected: false });
  });

  test("con texto después del número (timbre, piso) reintenta cortando la dirección", async () => {
    const { impl, calls } = fakeFetch({ "pasteur 288": PASTEUR_288 });
    const r = await geocodeAddress("Pasteur 288 Timbre 3", { fetchImpl: impl });
    assert.equal(r.label, "PASTEUR 288, CABA");
    assert.deepEqual(calls, ["pasteur 288 timbre 3", "pasteur 288"]);
  });

  test("dirección que no existe ni se parece a ninguna calle → null, y no se vuelve a consultar", async () => {
    const { impl, calls } = fakeFetch({});
    assert.equal(await geocodeAddress("calle inventada 123", { fetchImpl: impl }), null);
    const antes = calls.length;
    assert.equal(await geocodeAddress("calle inventada 123", { fetchImpl: impl }), null);
    assert.equal(calls.length, antes);
  });

  test("lo encontrado queda guardado (mayúsculas y espacios no importan)", async () => {
    const { impl, calls } = fakeFetch({ "pasteur 288": PASTEUR_288 });
    await geocodeAddress("pasteur 288", { fetchImpl: impl });
    await geocodeAddress("  PASTEUR   288 ", { fetchImpl: impl });
    assert.equal(calls.length, 1);
  });

  test("si USIG no responde se lanza el error y no queda guardado", async () => {
    const down = fakeFetch({ "pasteur 288": new Error("sin conexión") });
    await assert.rejects(() => geocodeAddress("pasteur 288", { fetchImpl: down.impl }));
    const up = fakeFetch({ "pasteur 288": PASTEUR_288 });
    const r = await geocodeAddress("pasteur 288", { fetchImpl: up.impl });
    assert.equal(r.label, "PASTEUR 288, CABA");
  });

  test("vacío → null sin consultar", async () => {
    const { impl, calls } = fakeFetch({});
    assert.equal(await geocodeAddress("   ", { fetchImpl: impl }), null);
    assert.equal(calls.length, 0);
  });
});

describe("errores de tipeo en la calle", () => {
  beforeEach(() => _clearGeocodeCache());

  test("'azcuenga 179' se ubica como AZCUENAGA 179 y avisa que se corrigió", async () => {
    const { impl, calls } = fakeFetch({ "AZCUENAGA 179": caba("AZCUENAGA 179, CABA", "-34.607690", "-58.400572") });
    const r = await geocodeAddress("azcuenga 179", { fetchImpl: impl });
    assert.deepEqual(r, { lat: -34.60769, lng: -58.400572, label: "AZCUENAGA 179, CABA", corrected: true });
    assert.deepEqual(calls, ["azcuenga 179", "callejero", "AZCUENAGA 179"]);
  });

  test("letras dadas vuelta: 'sarmineto 2151' → SARMIENTO (no FRAGATA PRES. SARMIENTO ni la avenida)", async () => {
    const { impl } = fakeFetch({ "SARMIENTO 2151": caba("SARMIENTO 2151, CABA", "-34.605946", "-58.397251") });
    const r = await geocodeAddress("sarmineto 2151", { fetchImpl: impl });
    assert.equal(r.label, "SARMIENTO 2151, CABA");
    assert.equal(r.corrected, true);
  });

  test("la altura decide la calle: 'azcuenga 2980' solo existe en AZCUENAGA, DOMINGO DE", () => {
    const streets = CALLEJERO.map(([, name, tokens, ranges]) => ({
      name,
      full: _internals.normalizeText(name),
      words: _internals.normalizeText(tokens).split(" "),
      ranges,
    }));
    assert.equal(_internals.correctStreet("azcuenga 2980", streets), "AZCUENAGA, DOMINGO DE 2980");
    assert.equal(_internals.correctStreet("azcuenga 179", streets), "AZCUENAGA 179");
    assert.equal(_internals.correctStreet("pueyredon 100", streets), "PUEYRREDON AV. 100");
  });

  test("si dos calles se parecen igual, no adivina: 'pasto 100' (¿Paso o Pasco?) → no encontrada", async () => {
    const { impl, calls } = fakeFetch({});
    assert.equal(await geocodeAddress("pasto 100", { fetchImpl: impl }), null);
    assert.deepEqual(calls, ["pasto 100", "callejero"]);
  });

  test("el listado de calles se baja una sola vez", async () => {
    const { impl, calls } = fakeFetch({});
    await geocodeAddress("calle inventada 1", { fetchImpl: impl });
    await geocodeAddress("otra inventada 2", { fetchImpl: impl });
    assert.equal(calls.filter((c) => c === "callejero").length, 1);
  });

  test("distancia entre palabras", () => {
    assert.equal(_internals.editDistance("AZCUENGA", "AZCUENAGA"), 1);
    assert.equal(_internals.editDistance("SARMINETO", "SARMIENTO"), 1);
    assert.equal(_internals.editDistance("PUEYREDON", "PUEYRREDON"), 1);
    assert.equal(_internals.editDistance("PASTEUR", "PASTEUR"), 0);
  });
});

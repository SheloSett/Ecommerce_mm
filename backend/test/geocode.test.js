// Tests del geocodificador de direcciones (utils/geocode.js), con USIG simulado: no sale a internet.
// Correr con: npm test

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { geocodeAddress, _clearGeocodeCache } = require("../src/utils/geocode");

// Arma un fetch falso que responde según la dirección pedida y cuenta las consultas.
function fakeFetch(byAddress) {
  const calls = [];
  const impl = async (url) => {
    const address = decodeURIComponent(new URL(url).searchParams.get("direccion"));
    calls.push(address);
    const payload = byAddress[address];
    if (payload instanceof Error) throw payload;
    return { ok: true, json: async () => payload || { direccionesNormalizadas: [], errorMessage: "Calle inexistente" } };
  };
  return { impl, calls };
}

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
    assert.deepEqual(r, { lat: -34.606315, lng: -58.399368, label: "PASTEUR 288, CABA" });
  });

  test("con texto después del número (timbre, piso) reintenta cortando la dirección", async () => {
    const { impl, calls } = fakeFetch({ "pasteur 288": PASTEUR_288 });
    const r = await geocodeAddress("Pasteur 288 Timbre 3", { fetchImpl: impl });
    assert.equal(r.label, "PASTEUR 288, CABA");
    assert.deepEqual(calls, ["pasteur 288 timbre 3", "pasteur 288"]);
  });

  test("dirección que no existe → null, y no se vuelve a consultar", async () => {
    const { impl, calls } = fakeFetch({});
    assert.equal(await geocodeAddress("azcuenga 179", { fetchImpl: impl }), null);
    assert.equal(await geocodeAddress("azcuenga 179", { fetchImpl: impl }), null);
    assert.equal(calls.length, 1);
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

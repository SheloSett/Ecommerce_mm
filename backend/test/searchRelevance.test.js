// Tests del orden por relevancia de la búsqueda del catálogo (utils/searchRelevance.js).
// Correr con: npm test
//
// Caso real que motivó el cambio: buscando "cable" aparecían primero los cargadores y power banks
// "CON CABLE" (los más nuevos) y los cables de verdad quedaban atrás.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { searchRelevanceScore, sortBySearchRelevance } = require("../src/utils/searchRelevance");

const cat = (name, slug) => ({ id: 1, name, slug });
const CABLES     = cat("Cables", "cables");
const CARGADORES = cat("Cargadores", "cargadores");
const OPORTUNIDADES = cat("Oportunidades unicas", "oportunidades-unicas");

const p = (name, categories = []) => ({ name, categories });

describe("searchRelevanceScore", () => {
  test("un cable de verdad puntúa más que un cargador 'CON CABLE'", () => {
    const cable    = p("CABLE TIPO C A TIPO C 120W 1M", [CABLES]);
    const cargador = p("CARGADOR 30W SUPER TURBO PD TIPO C CON CABLE USB", [CARGADORES]);
    const powerBank = p("CARGADOR PORTÁTIL POWER BANK 30000MAH CON CABLES Y LINTERNA", [CARGADORES]);
    assert.ok(searchRelevanceScore(cable, "cable") > searchRelevanceScore(cargador, "cable"));
    assert.ok(searchRelevanceScore(cable, "cable") > searchRelevanceScore(powerBank, "cable"));
  });

  test("la mención como accesorio resta: 'CON CABLE', '+ CABLE', 'SIN CABLES', 'INCLUYE CABLES'", () => {
    const base = searchRelevanceScore(p("ZAPATILLA 6 TOMAS ENCHUFE CABLE 3M"), "cable"); // mención normal
    for (const name of [
      "CARGADOR 45W CON CABLE PD",
      "CARGADOR RÁPIDO 35W USB-C + CABLE TIPO C",
      "CARPLAY ANDROID PARA AUTO SIN CABLES",
      "POWER BANK SOLAR INCLUYE CABLES DE CARGA",
      "AURICULAR IN EAR CON CABLE Y MICRÓFONO",
    ]) {
      assert.ok(searchRelevanceScore(p(name), "cable") < base, name);
    }
  });

  test("no resta si la palabra también aparece en otra posición que no es accesorio", () => {
    // "CABLE ... CON CABLE" → la primera aparición no es accesorio, así que no se penaliza
    const s = searchRelevanceScore(p("CABLE USB A TIPO C CON CABLE DE REPUESTO"), "cable");
    assert.ok(s > searchRelevanceScore(p("CARGADOR CON CABLE"), "cable"));
  });

  test("la categoría cuenta aunque el nombre no empiece con la palabra", () => {
    const conCat = p("KIT CABLE MAS CARGADOR AUTO PARA ANTENA STARLINK", [CABLES, CARGADORES]);
    const sinCat = p("KIT CABLE MAS CARGADOR AUTO PARA ANTENA STARLINK", []);
    assert.ok(searchRelevanceScore(conCat, "cable") > searchRelevanceScore(sinCat, "cable"));
    // "Cargadores" matchea "cargador" (prefijo), "Auriculares" matchea "auricular"
    assert.ok(searchRelevanceScore(p("X", [CARGADORES]), "cargador") > 0);
    assert.ok(searchRelevanceScore(p("X", [cat("Auriculares", "auriculares")]), "auricular") > 0);
  });

  test("insensible a tildes, mayúsculas y puntuación", () => {
    assert.equal(
      searchRelevanceScore(p("CÁMARA DEPORTIVA 4K"), "camara"),
      searchRelevanceScore(p("camara deportiva 4k"), "CÁMARA"),
    );
    // "(CABLE DE RED)" → la palabra se reconoce aunque venga pegada al paréntesis
    assert.ok(searchRelevanceScore(p("CAPUCHON PARA RJ45 (CABLE DE RED)"), "cable") > 0);
  });

  test("búsqueda de varias palabras: suma por cada palabra que aparece", () => {
    const exacto  = p("CABLE USB A IPHONE 1M GOMA", [CABLES]);
    const parcial = p("CABLE USB A TIPO C 1M", [CABLES]);
    assert.ok(searchRelevanceScore(exacto, "cable iphone") > searchRelevanceScore(parcial, "cable iphone"));
  });

  test("sin término o sin nombre devuelve 0 y no rompe", () => {
    assert.equal(searchRelevanceScore(p("CABLE"), ""), 0);
    assert.equal(searchRelevanceScore(p("CABLE"), null), 0);
    assert.equal(searchRelevanceScore({}, "cable"), 0);
    assert.equal(searchRelevanceScore(null, "cable"), 0);
    assert.equal(searchRelevanceScore({ name: "CABLE", categories: null }, "cable"), 40);
  });
});

describe("sortBySearchRelevance", () => {
  test("reproduce el caso real: los cables primero, los cargadores 'CON CABLE' al final", () => {
    // Orden de entrada = más nuevo primero, como viene de la base.
    const entrada = [
      p("CARGADOR PORTÁTIL POWER BANK 60000 MAH CON CABLES Y LINTERNA", [CARGADORES]),
      p("CARGADOR SAMSUNG TRAVEL ADAPTER + CABLE TIPO C", [CARGADORES]),
      p("CABLE TIPO C A TIPO C 120W 1M", [CABLES]),
      p("CABLE USB A TIPO C 120W 1M", [CABLES]),
      p("20 CABLES MHL MICRO USB A HDMI", [OPORTUNIDADES]),
      p("ZAPATILLA ALARGUE 10 TOMAS ENCHUFE CABLE 3M", [cat("Iluminacion y Electricidad", "iluminacion")]),
      p("CABLE ADAPTADOR OTG MICRO USB V8", [cat("Adaptadores y Lectores", "adaptadores-y-lectores")]),
    ];
    const salida = sortBySearchRelevance(entrada, "cable").map((x) => x.name);
    assert.deepEqual(salida, [
      // Empiezan con CABLE y están en la categoría Cables (empate → se respeta el orden de entrada)
      "CABLE TIPO C A TIPO C 120W 1M",
      "CABLE USB A TIPO C 120W 1M",
      // Empieza con CABLE pero su categoría no es Cables
      "CABLE ADAPTADOR OTG MICRO USB V8",
      // Lote: "CABLES" en segunda posición
      "20 CABLES MHL MICRO USB A HDMI",
      // Mención suelta
      "ZAPATILLA ALARGUE 10 TOMAS ENCHUFE CABLE 3M",
      // Accesorio ("CON CABLES", "+ CABLE") → al final, conservando "más nuevo primero" entre ellos
      "CARGADOR PORTÁTIL POWER BANK 60000 MAH CON CABLES Y LINTERNA",
      "CARGADOR SAMSUNG TRAVEL ADAPTER + CABLE TIPO C",
    ]);
  });

  test("no muta la lista de entrada y sin término devuelve el mismo orden", () => {
    const entrada = [p("B"), p("A")];
    const copia = [...entrada];
    const salida = sortBySearchRelevance(entrada, "");
    assert.deepEqual(entrada, copia);
    assert.deepEqual(salida.map((x) => x.name), ["B", "A"]);
    assert.deepEqual(sortBySearchRelevance(null, "cable"), []);
  });
});

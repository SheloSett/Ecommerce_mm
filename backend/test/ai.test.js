// Tests del autocompletado de productos con IA (controllers/ai.controller.js), con Claude simulado:
// no llama a ninguna API. Correr con: npm test

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { _internals } = require("../src/controllers/ai.controller");
const { claudeSuggestText, cleanMeasures, pickImages } = _internals;

// Cliente falso: devuelve las respuestas en orden y guarda una copia de cada pedido.
function fakeClaude(responses) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(JSON.parse(JSON.stringify(params)));
        return responses[calls.length - 1];
      },
    },
  };
}
const IMG = [{ base64: "aGVsbG8=", mimeType: "image/jpeg" }, { base64: "bXVuZG8=", mimeType: "image/png" }];
const SEARCH = [
  { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "correa velcro 23 x 5 cm" } },
  { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", url: "https://ejemplo.com", title: "Ficha" }] },
];
const JSON_OK = '{"name":"CORREA VELCRO","description":"Correa de nylon.","sku":"COR-23","weightKg":0.024,"lengthCm":23,"widthCm":5,"heightCm":null,"measuresSource":"ficha del fabricante"}';

describe("claudeSuggestText", () => {
  test("manda todas las fotos y la búsqueda web; lee el JSON aunque una cita lo corte en dos bloques", async () => {
    const client = fakeClaude([{
      stop_reason: "end_turn",
      content: [
        { type: "text", text: "Busco la ficha del modelo {primero}." }, // texto previo a la búsqueda: se ignora
        ...SEARCH,
        { type: "text", text: '{"name":"CORREA VELCRO","description":"Correa de 23 cm' },
        { type: "text", text: " x 5 cm", citations: [{ type: "web_search_result_location", url: "https://ejemplo.com" }] },
        { type: "text", text: '.","sku":"COR-23","weightKg":0.024,"lengthCm":23,"widthCm":5,"heightCm":null,"measuresSource":"ficha del fabricante"}' },
      ],
    }]);
    const r = await claudeSuggestText(IMG, client);
    assert.equal(r.description, "Correa de 23 cm x 5 cm.");
    assert.equal(r.weightKg, 0.024);
    const req = client.calls[0];
    assert.equal(req.model, "claude-opus-5");
    assert.equal(req.tools[0].type, "web_search_20260209");
    assert.equal(req.messages[0].content.filter((b) => b.type === "image").length, 2);
    assert.ok(!req.output_config.format, "sin JSON forzado: la API no lo permite junto con las citas de la búsqueda");
  });

  test("pause_turn: retoma reenviando el turno, sin agregar mensajes del usuario", async () => {
    const client = fakeClaude([
      { stop_reason: "pause_turn", content: [SEARCH[0]] },
      { stop_reason: "end_turn", content: [SEARCH[1], { type: "text", text: JSON_OK }] },
    ]);
    const r = await claudeSuggestText(IMG, client);
    assert.equal(r.sku, "COR-23");
    assert.equal(client.calls.length, 2);
    const second = client.calls[1].messages;
    assert.deepEqual(second.map((m) => m.role), ["user", "assistant"]);
    assert.deepEqual(second[1].content, [SEARCH[0]]);
  });

  test("si sigue pausada después de los reintentos, devuelve null (pasa a Gemini)", async () => {
    const paused = { stop_reason: "pause_turn", content: [SEARCH[0]] };
    const client = fakeClaude([paused, paused, paused, paused]);
    assert.equal(await claudeSuggestText(IMG, client), null);
    assert.equal(client.calls.length, 3);
  });

  test("rechazo → null (pasa a Gemini)", async () => {
    const client = fakeClaude([{ stop_reason: "refusal", content: [] }]);
    assert.equal(await claudeSuggestText(IMG, client), null);
  });

  test("sin búsqueda también funciona", async () => {
    const client = fakeClaude([{ stop_reason: "end_turn", content: [{ type: "text", text: "```json\n" + JSON_OK + "\n```" }] }]);
    assert.equal((await claudeSuggestText(IMG, client)).name, "CORREA VELCRO");
  });
});

describe("cleanMeasures", () => {
  test("números, textos con coma o unidad, y la fuente", () => {
    assert.deepEqual(
      cleanMeasures({ weightKg: "0,024", lengthCm: "23 cm", widthCm: 5, heightCm: null, measuresSource: " etiqueta del empaque " }),
      { weight: 0.024, length: 23, width: 5, height: null, measuresSource: "etiqueta del empaque" }
    );
  });
  test("descarta ceros, negativos, absurdos y basura", () => {
    assert.deepEqual(
      cleanMeasures({ weightKg: 0, lengthCm: -3, widthCm: 99999, heightCm: "no sé", measuresSource: "web" }),
      { weight: null, length: null, width: null, height: null, measuresSource: null }
    );
  });
  test("redondea: peso a gramos, medidas a milímetros", () => {
    const r = cleanMeasures({ weightKg: 0.12345, lengthCm: 10.26 });
    assert.equal(r.weight, 0.123);
    assert.equal(r.length, 10.3);
  });
  test("sin datos → todo null", () => {
    assert.deepEqual(cleanMeasures({}), { weight: null, length: null, width: null, height: null, measuresSource: null });
  });
});

describe("pickImages", () => {
  const file = (bytes, mimetype = "image/jpeg") => ({ buffer: Buffer.alloc(bytes), mimetype });
  test("hasta 5 fotos", () => {
    assert.equal(pickImages(Array.from({ length: 8 }, () => file(10))).length, 5);
  });
  test("corta antes de pasarse del tamaño total, pero siempre manda la primera", () => {
    const big = 12 * 1024 * 1024; // en base64 ~16 MB cada una
    assert.equal(pickImages([file(big), file(big)]).length, 1);
    assert.equal(pickImages([file(big * 2)]).length, 1);
  });
});

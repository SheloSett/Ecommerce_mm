// Integración de IA para el alta de productos:
//  - TEXTO/VISIÓN (título, descripción, SKU desde la foto): Claude (Anthropic) como primario,
//    con Google Gemini de respaldo. Claude NO genera imágenes, por eso solo se usa para el texto.
//  - IMÁGENES (fotos similares): cadena con FALLBACK → se intenta Gemini y, si falla, OpenAI.
//    Así, si un proveedor está saturado/sin cuota, el otro responde → casi nunca falla.
// Keys: ANTHROPIC_API_KEY (texto), GEMINI_API_KEY (texto de respaldo + imágenes) y OPENAI_API_KEY
// (respaldo de imágenes). Si una falta, ese proveedor se saltea. Clientes lazy (el server arranca igual).
const { GoogleGenAI } = require("@google/genai");
// openai exporta la clase y el helper toFile; require defensivo por si cambia el shape del paquete.
const OpenAILib = require("openai");
const OpenAI  = OpenAILib.OpenAI || OpenAILib.default || OpenAILib;
const toFile  = OpenAILib.toFile || (OpenAILib.default && OpenAILib.default.toFile);
// Anthropic (Claude): visión para el texto del producto. require defensivo por el shape del paquete.
const AnthropicLib = require("@anthropic-ai/sdk");
const Anthropic = AnthropicLib.Anthropic || AnthropicLib.default || AnthropicLib;

// Modelos configurables por env. Defaults según la doc oficial (jun 2026):
//  - Gemini texto/visión: gemini-3.5-flash
//  - Gemini imágenes (Nano Banana 2): gemini-3.1-flash-image
//  - OpenAI imágenes: gpt-image-1
// Si un proveedor renombra un modelo, se sobreescribe por env sin tocar el código.
const TEXT_MODEL         = process.env.GEMINI_TEXT_MODEL  || "gemini-3.5-flash";
const IMAGE_MODEL        = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
// Claude (texto/visión). Default al modelo más capaz; overrideable por env.
const CLAUDE_MODEL       = process.env.CLAUDE_MODEL       || "claude-opus-5";

let _ai = null;
function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!_ai) _ai = new GoogleGenAI({ apiKey: key });
  return _ai;
}

let _openai = null;
function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  if (!_openai) _openai = new OpenAI({ apiKey: key });
  return _openai;
}

let _anthropic = null;
function getAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: key });
  return _anthropic;
}

// Detecta errores de cuota/límite (429 RESOURCE_EXHAUSTED). En el nivel gratuito de Gemini
// la generación de imágenes tiene cuota 0, así que estos errores son esperables ahí.
function isQuotaError(e) {
  if (!e) return false;
  if (e.status === 429 || e.code === 429) return true;
  const s = e.message || String(e);
  return /RESOURCE_EXHAUSTED|"code":\s*429|quota/i.test(s);
}

// Detecta errores TRANSITORIOS que conviene reintentar: 503 UNAVAILABLE (modelo saturado),
// 500 interno, sobrecarga. NO incluye 429 (cuota) porque eso no se arregla reintentando.
function isTransient(e) {
  if (!e) return false;
  // 529 = overloaded de Anthropic; 503/500 = Gemini/otros
  if ([500, 503, 529].includes(e.status) || [500, 503, 529].includes(e.code)) return true;
  const s = e.message || String(e);
  return /UNAVAILABLE|high demand|overloaded|"code":\s*(50[03]|529)/i.test(s);
}

// Reintenta una llamada con backoff exponencial ante errores transitorios (503/500).
// Los modelos gratuitos de Gemini se saturan seguido; un par de reintentos lo resuelven.
async function withRetry(fn, tries = 4, baseMs = 700) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isTransient(e) || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, baseMs * Math.pow(2, i))); // 0.7s, 1.4s, 2.8s...
    }
  }
  throw lastErr;
}

// ── Generadores de imagen por proveedor ───────────────────────────────────────
// Cada uno recibe (prompt, base64, mimeType) y devuelve un data URL, o null si no
// produjo imagen. Lanzan excepción si la llamada falla (la maneja la cadena de fallback).

async function geminiImageGen(prompt, base64, mimeType) {
  const ai = getClient();
  if (!ai) return null;
  const response = await withRetry(() => ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }],
  }));
  const parts = response?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((pt) => pt.inlineData);
  return img ? `data:${img.inlineData.mimeType || "image/png"};base64,${img.inlineData.data}` : null;
}

async function openaiImageGen(prompt, base64, mimeType) {
  const client = getOpenAI();
  if (!client || !toFile) return null;
  const ext = (mimeType.split("/")[1] || "png").replace("jpeg", "jpg");
  const file = await toFile(Buffer.from(base64, "base64"), `input.${ext}`, { type: mimeType });
  const result = await withRetry(() => client.images.edit({
    model: OPENAI_IMAGE_MODEL,
    image: file,
    prompt,
    size: "1024x1024",
  }));
  const b64 = result?.data?.[0]?.b64_json;
  return b64 ? `data:image/png;base64,${b64}` : null;
}

// Proveedores de imagen disponibles, en orden de preferencia (solo los que tienen key).
// Gemini primero (más barato si tenés facturación ahí); OpenAI como respaldo.
function imageProviders() {
  const list = [];
  if (process.env.GEMINI_API_KEY) list.push({ name: "gemini", gen: geminiImageGen });
  if (process.env.OPENAI_API_KEY) list.push({ name: "openai", gen: openaiImageGen });
  return list;
}

// ── Sugerencia de texto (título, descripción, SKU, peso y medidas) desde las fotos ─
// Antes era un prompt fijo que pedía solo name/description/sku y miraba una sola foto. Ahora recibe
// todas las fotos (la etiqueta del empaque suele estar en otra) y pide también peso y medidas, que
// se usan para cotizar el envío. canSearch: solo Claude tiene búsqueda web (ver claudeSuggestText).
function buildTextPrompt({ canSearch }) {
  const fuentes = canSearch
    ? `lo que se lee en las fotos (empaque, etiqueta, especificaciones impresas) o, si identificás la marca y el modelo exactos, la ficha de ese producto en la web (buscala; sirven el fabricante o una publicación del mismo modelo)`
    : `lo que se lee en las fotos (empaque, etiqueta, especificaciones impresas) o especificaciones conocidas del modelo exacto`;
  return `Sos un asistente que cataloga productos para una tienda online en Argentina.
Te paso una o varias fotos del MISMO producto (frente, dorso, empaque, etiqueta). Devolvé un JSON con:
- "name": título corto y claro del producto, en español (máx ~60 caracteres).
- "description": descripción de venta de 2 a 4 oraciones, en español, en texto plano (sin HTML ni markdown).
- "sku": un código interno corto en MAYÚSCULAS, alfanumérico, derivado del producto (sin espacios; usá guiones si hace falta).
- "weightKg": peso en kilos (número, ej. 0.024), o null.
- "lengthCm", "widthCm", "heightCm": largo, ancho y alto en centímetros (números), o null.
- "measuresSource": de dónde sacaste el peso o las medidas, en pocas palabras (ej. "etiqueta del empaque", "ficha del fabricante"), o null.

El peso y las medidas son para calcular el envío: usá los del producto tal como se vende (con su empaque) si los encontrás; si no, los del producto.
Sacalos solo de datos concretos: ${fuentes}. Si no encontrás el dato concreto, poné null: no lo estimes ni lo inventes. Cada campo va por separado (podés tener el peso y no el alto).
Respondé ÚNICAMENTE con el objeto JSON, sin markdown ni explicaciones.`;
}

// Búsqueda web de Claude (herramienta del servidor de Anthropic: no hay que ejecutar nada acá).
// max_uses acota costo y demora: alcanza para encontrar la ficha de un modelo. user_location
// orienta los resultados a publicaciones de Argentina.
const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 3,
  user_location: { type: "approximate", country: "AR" },
};
// Veces que se retoma una respuesta que el servidor pausó en medio de las búsquedas (pause_turn).
const MAX_RESUMES = 2;

// Extrae un objeto JSON de un texto (tolera fences ```json ... ``` o texto alrededor).
function parseJsonLoose(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf("{"), last = t.lastIndexOf("}");
  if (first !== -1 && last !== -1) t = t.slice(first, last + 1);
  try { return JSON.parse(t); } catch { return null; }
}

// Claude (Anthropic) — visión + búsqueda web. images: [{ base64, mimeType }].
// Devuelve el objeto del prompt, null si no hay key o no dio una respuesta usable, o lanza.
// client: se puede pasar uno falso en los tests.
async function claudeSuggestText(images, client = getAnthropic()) {
  if (!client) return null;
  const messages = [{
    role: "user",
    content: [
      ...images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.base64 } })),
      { type: "text", text: buildTextPrompt({ canSearch: true }) },
    ],
  }];

  let msg;
  for (let i = 0; i <= MAX_RESUMES; i++) {
    msg = await withRetry(() => client.messages.create({
      model: CLAUDE_MODEL,
      // Effort bajo: catalogar no necesita razonamiento profundo y así hace pocas búsquedas.
      // Antes: max_tokens 2048 sin búsqueda. En Opus 5 el razonamiento viene activado y consume
      // tokens de la respuesta; con las búsquedas de por medio se deja más margen.
      max_tokens: 4096,
      output_config: { effort: "low" },
      tools: [WEB_SEARCH_TOOL],
      // Sin output_config.format (JSON forzado) a propósito: la búsqueda web agrega citas y la API
      // no permite citas con JSON forzado. El JSON se pide en el prompt y se extrae del texto.
      messages,
    }));
    // pause_turn: el servidor cortó su ronda de búsquedas. Se retoma reenviando el turno tal cual
    // (sin agregar un "seguí"): la API ve la búsqueda pendiente y continúa.
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }
  // Rechazo o pausa sin terminar: no hay JSON confiable → null, y la cadena prueba con Gemini.
  if (msg.stop_reason === "refusal" || msg.stop_reason === "pause_turn") return null;

  // Solo el texto posterior a la última búsqueda (el JSON final). Los bloques se unen SIN separador:
  // las citas de la búsqueda cortan el texto en varios bloques, a veces en medio del JSON.
  const blocks = msg.content || [];
  const lastSearch = blocks.map((b) => b.type).lastIndexOf("web_search_tool_result");
  const text = blocks.slice(lastSearch + 1).filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseJsonLoose(text);
}

// Gemini — visión (respaldo del texto, sin búsqueda web). Devuelve el objeto del prompt, null si no
// hay key, o lanza.
async function geminiSuggestText(images) {
  const ai = getClient();
  if (!ai) return null;
  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: [
      ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })),
      { text: buildTextPrompt({ canSearch: false }) },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          name:           { type: "string" },
          description:    { type: "string" },
          sku:            { type: "string" },
          weightKg:       { type: "number", nullable: true },
          lengthCm:       { type: "number", nullable: true },
          widthCm:        { type: "number", nullable: true },
          heightCm:       { type: "number", nullable: true },
          measuresSource: { type: "string", nullable: true },
        },
        required: ["name", "description", "sku"],
      },
    },
  }));
  return parseJsonLoose(response.text);
}

// Peso y medidas de la IA → números usables o null. Acepta "0,024" o "23 cm"; descarta ceros,
// negativos y valores absurdos para un producto de la tienda.
function cleanMeasure(value, max, decimals) {
  const n = typeof value === "string" ? parseFloat(value.replace(",", ".")) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > max) return null;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
function cleanMeasures(data) {
  const out = {
    weight: cleanMeasure(data?.weightKg, 500, 3),
    length: cleanMeasure(data?.lengthCm, 500, 1),
    width:  cleanMeasure(data?.widthCm,  500, 1),
    height: cleanMeasure(data?.heightCm, 500, 1),
  };
  const any = Object.values(out).some((v) => v != null);
  const source = typeof data?.measuresSource === "string" ? data.measuresSource.trim().slice(0, 120) : "";
  return { ...out, measuresSource: any && source ? source : null };
}

// Fotos que se le mandan a la IA: hasta MAX_AI_IMAGES y sin pasarse de ~20 MB en total (la API de
// Claude acepta pedidos de hasta 32 MB y la foto va en base64, que ocupa un tercio más).
const MAX_AI_IMAGES = 5;
const MAX_AI_BYTES = 20 * 1024 * 1024;
function pickImages(files) {
  const out = [];
  let total = 0;
  for (const f of files.slice(0, MAX_AI_IMAGES)) {
    const base64 = f.buffer.toString("base64");
    if (out.length > 0 && total + base64.length > MAX_AI_BYTES) break;
    total += base64.length;
    out.push({ base64, mimeType: f.mimetype || "image/jpeg" });
  }
  return out;
}

// POST /api/ai/suggest-text — analiza las fotos y sugiere nombre, descripción, SKU, peso y medidas.
// Fotos en el campo "images" (varias) o "image" (una, como antes).
// Preferencia: Claude (primario, con búsqueda web) → Gemini (respaldo). Si uno falla, prueba el otro.
async function suggestText(req, res) {
  try {
    // Antes: if (!req.file) ... — una sola foto en el campo "image"
    const files = [...(req.files?.images || []), ...(req.files?.image || [])];
    if (files.length === 0) return res.status(400).json({ error: "Subí una imagen para analizar" });
    const images = pickImages(files);

    const providers = [];
    if (process.env.ANTHROPIC_API_KEY) providers.push({ name: "claude", fn: claudeSuggestText });
    if (process.env.GEMINI_API_KEY)    providers.push({ name: "gemini", fn: geminiSuggestText });
    if (providers.length === 0) {
      return res.status(503).json({ error: "IA no configurada: falta ANTHROPIC_API_KEY o GEMINI_API_KEY en el servidor" });
    }

    let data = null, lastErr = null;
    for (const prov of providers) {
      try {
        data = await prov.fn(images);
        if (data) break; // éxito
      } catch (e) {
        lastErr = e;
        console.error(`suggestText [${prov.name}] error:`, e.message);
      }
    }

    if (!data) {
      if (isTransient(lastErr)) {
        return res.status(503).json({ error: "El modelo de IA está saturado en este momento. Probá de nuevo en unos segundos." });
      }
      return res.status(502).json({ error: "La IA no devolvió una respuesta válida. Probá de nuevo." });
    }

    res.json({
      name:        (data.name || "").trim(),
      description: (data.description || "").trim(),
      sku:         (data.sku || "").trim(),
      // weight (kg), length/width/height (cm) y measuresSource; null lo que no se encontró
      ...cleanMeasures(data),
    });
  } catch (err) {
    console.error("suggestText error:", err);
    res.status(500).json({ error: "Error al sugerir datos con IA" });
  }
}

// POST /api/ai/suggest-images — genera variantes de la foto base del producto.
// Cada variante es una llamada al modelo de imagen (consume cuota). El admin elige
// después cuáles agregar, así nunca se publica una foto que no represente al producto.
async function suggestImages(req, res) {
  try {
    const providers = imageProviders();
    if (providers.length === 0) {
      return res.status(503).json({ error: "IA de imágenes no configurada: falta GEMINI_API_KEY u OPENAI_API_KEY en el servidor" });
    }
    if (!req.file) return res.status(400).json({ error: "Subí una imagen base para generar variantes" });

    const base64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "image/jpeg";
    // Cantidad de variantes (cap a 4 para no disparar cuota/costo sin querer)
    const count = Math.min(Math.max(parseInt(req.body.count) || 3, 1), 4);

    // Prompts pensados para mostrar EL MISMO producto, no inventar uno distinto.
    const prompts = [
      "Generá una foto del MISMO producto sobre un fondo blanco limpio de estudio, bien iluminado y centrado, calidad e-commerce. No cambies el producto.",
      "Generá una foto del MISMO producto desde un ángulo ligeramente distinto, fondo neutro claro y luz suave de estudio. Mantené el producto idéntico.",
      "Generá un primer plano (detalle) del MISMO producto sobre fondo blanco, mostrando textura y materiales. No modifiques el producto.",
      "Generá una foto del MISMO producto en un contexto de uso realista y prolijo, sin alterar el producto.",
    ].slice(0, count);

    const images = [];
    let lastErr = null;
    // Por cada foto: probar proveedores en orden (Gemini → OpenAI) hasta que uno la genere.
    // Si un proveedor falla (cuota/saturación/lo que sea), pasa al siguiente → casi nunca falla.
    for (const p of prompts) {
      let got = null;
      for (const prov of providers) {
        try {
          got = await prov.gen(p, base64, mimeType);
          if (got) break; // éxito con este proveedor; no probar el resto para esta foto
        } catch (e) {
          lastErr = e;
          console.error(`suggestImages [${prov.name}] error:`, e.message);
          // seguimos con el próximo proveedor de la cadena
        }
      }
      if (got) images.push(got);
    }

    if (images.length === 0) {
      // Caso típico: solo Gemini configurado y en free tier (cuota 0) → mensaje accionable.
      if (providers.length === 1 && providers[0].name === "gemini" && isQuotaError(lastErr)) {
        return res.status(429).json({
          error: "La generación de fotos no está incluida en el nivel gratuito de Gemini. Activá facturación en Gemini, o configurá OPENAI_API_KEY como respaldo.",
        });
      }
      return res.status(502).json({ error: "No se pudieron generar imágenes con ningún proveedor de IA. Probá de nuevo en unos segundos." });
    }

    res.json({ images });
  } catch (err) {
    console.error("suggestImages error:", err);
    res.status(500).json({ error: "Error al generar imágenes con IA" });
  }
}

module.exports = { suggestText, suggestImages, _internals: { claudeSuggestText, cleanMeasures, pickImages } };

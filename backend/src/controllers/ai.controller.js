// Integración de IA para el alta de productos:
//  - TEXTO/VISIÓN (título, descripción, SKU desde la foto): Google Gemini (gratis en free tier).
//  - IMÁGENES (fotos similares): cadena con FALLBACK → se intenta Gemini y, si falla, OpenAI.
//    Así, si un proveedor está saturado/sin cuota, el otro responde → casi nunca falla.
// Keys: GEMINI_API_KEY (texto + imágenes) y OPENAI_API_KEY (respaldo de imágenes). Si una falta,
// ese proveedor simplemente se saltea. Los clientes se crean de forma lazy (el server arranca igual).
const { GoogleGenAI } = require("@google/genai");
// openai exporta la clase y el helper toFile; require defensivo por si cambia el shape del paquete.
const OpenAILib = require("openai");
const OpenAI  = OpenAILib.OpenAI || OpenAILib.default || OpenAILib;
const toFile  = OpenAILib.toFile || (OpenAILib.default && OpenAILib.default.toFile);

// Modelos configurables por env. Defaults según la doc oficial (jun 2026):
//  - Gemini texto/visión: gemini-3.5-flash
//  - Gemini imágenes (Nano Banana 2): gemini-3.1-flash-image
//  - OpenAI imágenes: gpt-image-1
// Si un proveedor renombra un modelo, se sobreescribe por env sin tocar el código.
const TEXT_MODEL         = process.env.GEMINI_TEXT_MODEL  || "gemini-3.5-flash";
const IMAGE_MODEL        = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

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
  if (e.status === 503 || e.status === 500 || e.code === 503 || e.code === 500) return true;
  const s = e.message || String(e);
  return /UNAVAILABLE|high demand|overloaded|"code":\s*50[03]/i.test(s);
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

// POST /api/ai/suggest-text — analiza la foto del producto y sugiere nombre, descripción y SKU.
async function suggestText(req, res) {
  try {
    const ai = getClient();
    if (!ai) return res.status(503).json({ error: "IA no configurada: falta GEMINI_API_KEY en el servidor" });
    if (!req.file) return res.status(400).json({ error: "Subí una imagen para analizar" });

    const base64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "image/jpeg";

    const prompt = `Sos un asistente que cataloga productos para una tienda online en Argentina.
Analizá la imagen del producto y devolvé un JSON con:
- "name": título corto y claro del producto, en español (máx ~60 caracteres).
- "description": descripción de venta de 2 a 4 oraciones, en español, en texto plano (sin HTML ni markdown).
- "sku": un código interno corto en MAYÚSCULAS, alfanumérico, derivado del producto (sin espacios; usá guiones si hace falta).
Respondé SOLO con el JSON, sin texto adicional.`;

    const response = await withRetry(() => ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [
        { inlineData: { mimeType, data: base64 } },
        { text: prompt },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            name:        { type: "string" },
            description: { type: "string" },
            sku:         { type: "string" },
          },
          required: ["name", "description", "sku"],
        },
      },
    }));

    let data;
    try {
      data = JSON.parse(response.text);
    } catch {
      return res.status(502).json({ error: "La IA devolvió una respuesta no válida. Probá de nuevo." });
    }

    res.json({
      name:        (data.name || "").trim(),
      description: (data.description || "").trim(),
      sku:         (data.sku || "").trim(),
    });
  } catch (err) {
    console.error("suggestText error:", err);
    if (isTransient(err)) {
      return res.status(503).json({ error: "El modelo de IA está saturado en este momento. Probá de nuevo en unos segundos." });
    }
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

module.exports = { suggestText, suggestImages };

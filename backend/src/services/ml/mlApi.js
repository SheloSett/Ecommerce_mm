// Llamadas a la API de Mercado Libre. Solo a api.mercadolibre.com (y la pantalla de autorización de
// auth.mercadolibre.com.ar): las direcciones se arman acá con identificadores validados por patrón, y
// nada de lo que llega en un aviso se usa como dirección.
//
// Ninguna función lanza: devuelven { ok: true, status, data } o { ok: false, kind, status, message }.
// kind dice qué hacer:
//   transient   corte, demora o error de Mercado Libre (5xx): reintentar más tarde. En una escritura,
//               el resultado es DESCONOCIDO (puede haber entrado).
//   rate_limit  429: frenar toda la cuenta un rato.
//   auth        401: el token no sirve.
//   forbidden   403: sin permiso para ese recurso.
//   not_found   404.
//   rejected    otro 4xx: Mercado Libre dijo que no, con su motivo. No se reintenta igual.
//   bad_response respuesta que no es JSON o es demasiado grande.
// Los mensajes nunca incluyen el token.

const API_BASE = "https://api.mercadolibre.com";
const AUTH_URL = "https://auth.mercadolibre.com.ar/authorization";
const TIMEOUT_MS = 12000;
const MAX_BYTES = 2 * 1024 * 1024;

const PATTERNS = {
  item:        /^MLA\d{6,15}$/,
  userProduct: /^MLAU\d{3,20}$/,
  variation:   /^\d{1,20}$/,
  user:        /^\d{3,15}$/,
  order:       /^\d{6,20}$/,
};
function isId(kind, value) {
  return typeof value === "string" && PATTERNS[kind].test(value);
}

function classify(status) {
  if (status === 429) return "rate_limit";
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status >= 500) return "transient";
  return "rejected";
}

// Motivo legible de un error de Mercado Libre: message, error o los "cause" de tipo error.
function reasonOf(data, fallback) {
  if (!data || typeof data !== "object") return fallback;
  const causes = Array.isArray(data.cause)
    ? data.cause.filter((c) => c && typeof c === "object" && c.message && c.type !== "warning").map((c) => String(c.message))
    : [];
  const text = [data.message || data.error_description || data.error, ...causes].filter(Boolean).join(" | ");
  return (text || fallback).slice(0, 300);
}

function retryAfterMs(headers) {
  const raw = headers?.get?.("retry-after");
  const secs = raw != null ? parseInt(raw, 10) : NaN;
  return Number.isFinite(secs) && secs > 0 ? Math.min(secs, 3600) * 1000 : null;
}

// Lee el cuerpo contando los bytes a medida que llegan: corta apenas pasa MAX_BYTES (no espera a tener
// todo en memoria). Sin cuerpo legible por partes (los tests), usa text().
async function readCapped(res) {
  const reader = res.body && typeof res.body.getReader === "function" ? res.body.getReader() : null;
  if (!reader) {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw Object.assign(new Error("grande"), { code: "TOO_BIG" });
    return text;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      try { await reader.cancel(); } catch { /* ya se cortó */ }
      throw Object.assign(new Error("grande"), { code: "TOO_BIG" });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Una llamada. path empieza con "/" y ya viene armado con identificadores validados.
 * @returns {Promise<{ok:true,status:number,data:any,headers:any}|{ok:false,kind:string,status:number,message:string,retryAfterMs?:number|null,data?:any}>}
 */
async function call({ method = "GET", path, token, json, form, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS }) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    return { ok: false, kind: "rejected", status: 0, message: "Dirección inválida" };
  }
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form !== undefined) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  }

  let res;
  try {
    res = await fetchImpl(API_BASE + path, { method, headers, body, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return { ok: false, kind: "transient", status: 0, message: timedOut ? "Mercado Libre no respondió a tiempo" : "No se pudo conectar con Mercado Libre" };
  }

  const declared = parseInt(res.headers?.get?.("content-length") || "", 10);
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return { ok: false, kind: "bad_response", status: res.status, message: "Respuesta demasiado grande" };
  }
  let text = "";
  try {
    text = await readCapped(res);
  } catch (err) {
    if (err?.code === "TOO_BIG") return { ok: false, kind: "bad_response", status: res.status, message: "Respuesta demasiado grande" };
    return { ok: false, kind: "transient", status: res.status, message: "Se cortó la respuesta de Mercado Libre" };
  }
  let data = null;
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      if (res.ok) return { ok: false, kind: "bad_response", status: res.status, message: "Respuesta inesperada de Mercado Libre" };
    }
  }

  if (res.ok) return { ok: true, status: res.status, data, headers: res.headers };
  const kind = classify(res.status);
  return {
    ok: false,
    kind,
    status: res.status,
    message: reasonOf(data, `Mercado Libre respondió ${res.status}`),
    retryAfterMs: kind === "rate_limit" ? retryAfterMs(res.headers) : null,
    data: kind === "rejected" || kind === "auth" ? data : undefined,
  };
}

// ─── Recursos que usa la tienda ─────────────────────────────────────────────
const bad = (message) => ({ ok: false, kind: "rejected", status: 0, message });

function getMe(token, opts = {}) {
  return call({ path: "/users/me", token, ...opts });
}

function getItem(token, itemId, opts = {}) {
  if (!isId("item", itemId)) return Promise.resolve(bad("Publicación inválida"));
  return call({ path: `/items/${itemId}?include_attributes=all`, token, ...opts });
}

// Ids de publicaciones de la cuenta en un estado (active | paused), de a 100.
function searchItemIds(token, userId, { status, offset = 0, scrollId = null } = {}, opts = {}) {
  if (!isId("user", userId)) return Promise.resolve(bad("Usuario inválido"));
  if (status !== "active" && status !== "paused") return Promise.resolve(bad("Estado inválido"));
  const q = new URLSearchParams({ status, limit: "100" });
  if (scrollId) {
    if (!/^[A-Za-z0-9+/=_-]{1,500}$/.test(scrollId)) return Promise.resolve(bad("Paginado inválido"));
    q.set("search_type", "scan");
    q.set("scroll_id", scrollId);
  } else if (offset === "scan") {
    q.set("search_type", "scan");
  } else {
    q.set("offset", String(Math.max(0, parseInt(offset, 10) || 0)));
  }
  return call({ path: `/users/${userId}/items/search?${q}`, token, ...opts });
}

// Cambia el stock. Sin Full ni multi-origen, Mercado Libre pide PUT /items con available_quantity y
// copia el número a todas las publicaciones del mismo user_product_id. Devuelve además lo que dice la
// respuesta (stored), para compararlo con lo que se mandó.
//
// Las variaciones del modelo viejo NO se escriben: según la documentación de Mercado Libre, un PUT con
// "variations" borra de la publicación las variaciones que no van en la lista (y con ellas su historial
// de ventas). Hasta probarlo con una publicación de prueba, se rechaza acá.
async function putItemQuantity(token, itemId, variationId, quantity, opts = {}) {
  if (!isId("item", itemId)) return bad("Publicación inválida");
  if (variationId) return bad("Las publicaciones con variaciones del modelo viejo no se escriben");
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99999) return bad("Cantidad inválida");
  const r = await call({ method: "PUT", path: `/items/${itemId}`, token, json: { available_quantity: quantity }, ...opts });
  if (!r.ok) return r;
  const stored = Number.isInteger(r.data?.available_quantity) ? r.data.available_quantity : null;
  return { ...r, stored };
}

// Token: canje del código de autorización o renovación. Formulario, como pide Mercado Libre.
function oauthToken(form, opts = {}) {
  return call({ method: "POST", path: "/oauth/token", form, ...opts });
}

function authorizationUrl({ appId, redirectUri, state, codeChallenge }) {
  const q = new URLSearchParams({ response_type: "code", client_id: appId, redirect_uri: redirectUri, state });
  if (codeChallenge) {
    q.set("code_challenge", codeChallenge);
    q.set("code_challenge_method", "S256");
  }
  return `${AUTH_URL}?${q}`;
}

module.exports = {
  API_BASE, AUTH_URL, PATTERNS, isId, classify, reasonOf,
  call, getMe, getItem, searchItemIds, putItemQuantity, oauthToken, authorizationUrl,
};

// Conexión con la cuenta de Mercado Libre y el token de acceso.
//
// Conectar (solo el superadministrador):
//   1. startOAuth arma la dirección de autorización con un "state" de un solo uso (se guarda su hash,
//      atado al admin que la pidió, vence en 10 minutos) y PKCE (el verificador se guarda cifrado).
//   2. Mercado Libre vuelve a la pantalla del panel /admin/mercadolibre/conectar con ?code&state, y esa
//      pantalla llama a exchangeOAuth con la sesión del admin: no hay ninguna ruta pública que reciba el
//      código. El state se consume con una sola operación condicional (dos pestañas no lo usan dos veces).
//   3. Se canjea el código, se verifica que la cuenta sea la de la tienda (ML_EXPECTED_USER_ID) y se
//      guardan los tokens cifrados. Si es otra cuenta, no se guarda nada.
//
// Token: dura 6 horas. getAccessToken lo renueva 10 minutos antes de que venza, de a una renovación por
// vez, y guarda el par nuevo ANTES de usarlo: el refresh token es de un solo uso y Mercado Libre solo
// acepta el último. Si Mercado Libre lo revoca (invalid_grant), la cuenta queda en RECONECTAR, el panel
// lo muestra y llega un aviso por email.
const crypto = require("crypto");

const prisma = require("../../lib/prisma");
const { seal, open } = require("../../utils/secretBox");
const { reportError } = require("../errorAlerts.service");
const api = require("./mlApi");
const { mlConfig, missingForConnect } = require("./mlConfig");

const ACCOUNT_ID = 1;
const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const OAUTH_TTL_MS = 10 * 60 * 1000;

const sha256hex = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

async function getAccount() {
  return prisma.mlAccount.findUnique({ where: { id: ACCOUNT_ID } });
}

async function ensureAccount() {
  return prisma.mlAccount.upsert({ where: { id: ACCOUNT_ID }, update: {}, create: { id: ACCOUNT_ID } });
}

async function markReconnect(message, now) {
  await prisma.mlAccount.update({
    where: { id: ACCOUNT_ID },
    data:  { status: "RECONECTAR", lastError: message.slice(0, 300), lastErrorAt: now },
  });
  reportError("mercadolibre", message);
}

// ─── Conectar ───────────────────────────────────────────────────────────────

async function startOAuth({ user, now = new Date(), cfg = mlConfig() }) {
  const missing = missingForConnect(cfg);
  if (missing.length) return { ok: false, error: `Faltan datos en backend/.env: ${missing.join(", ")}` };
  if (!user?.id) return { ok: false, error: "Sesión inválida" };

  const state = crypto.randomBytes(32).toString("base64url");
  const verifier = cfg.pkce ? crypto.randomBytes(48).toString("base64url") : null;
  const challenge = verifier ? crypto.createHash("sha256").update(verifier).digest("base64url") : null;

  await ensureAccount();
  await prisma.mlAccount.update({
    where: { id: ACCOUNT_ID },
    data: {
      oauthState:     sha256hex(state),
      oauthVerifier:  verifier ? seal("ml.oauth_verifier", verifier) : null,
      oauthUserId:    user.id,
      oauthExpiresAt: new Date(now.getTime() + OAUTH_TTL_MS),
    },
  });
  return { ok: true, url: api.authorizationUrl({ appId: cfg.appId, redirectUri: cfg.redirectUri, state, codeChallenge: challenge }) };
}

function validTokenResponse(data) {
  return data && typeof data === "object"
    && typeof data.access_token === "string" && /^[\x21-\x7e]{10,500}$/.test(data.access_token)
    && typeof data.refresh_token === "string" && /^[\x21-\x7e]{10,500}$/.test(data.refresh_token)
    && Number.isFinite(Number(data.expires_in)) && Number(data.expires_in) > 0
    && data.user_id != null;
}

async function exchangeOAuth({ user, code, state, actor = null, now = new Date(), cfg = mlConfig(), fetchImpl }) {
  const missing = missingForConnect(cfg);
  if (missing.length) return { ok: false, error: `Faltan datos en backend/.env: ${missing.join(", ")}` };
  if (!user?.id) return { ok: false, error: "Sesión inválida" };
  if (typeof code !== "string" || !/^[A-Za-z0-9._-]{8,300}$/.test(code)) return { ok: false, error: "Código de Mercado Libre inválido" };
  if (typeof state !== "string" || !/^[A-Za-z0-9_-]{20,100}$/.test(state)) return { ok: false, error: "Falta el código de seguridad de la conexión" };

  const account = await getAccount();
  const hash = sha256hex(state);
  // Un solo uso: se borra el state con una operación condicional. Solo la primera la consume.
  const claim = await prisma.mlAccount.updateMany({
    where: { id: ACCOUNT_ID, oauthState: hash, oauthUserId: user.id, oauthExpiresAt: { gt: now } },
    data:  { oauthState: null, oauthVerifier: null, oauthUserId: null, oauthExpiresAt: null },
  });
  if (claim.count !== 1 || account?.oauthState !== hash) {
    return { ok: false, error: "La conexión venció o se empezó desde otra sesión. Volvé a apretar \"Conectar\"." };
  }

  let verifier = null;
  try {
    verifier = account.oauthVerifier ? open("ml.oauth_verifier", account.oauthVerifier) : null;
  } catch {
    return { ok: false, error: "No se pudo leer la conexión en curso. Volvé a apretar \"Conectar\"." };
  }

  const form = { grant_type: "authorization_code", client_id: cfg.appId, client_secret: cfg.clientSecret, code, redirect_uri: cfg.redirectUri };
  if (verifier) form.code_verifier = verifier;
  const r = await api.oauthToken(form, { fetchImpl });
  if (!r.ok) return { ok: false, error: `Mercado Libre no aceptó la conexión: ${r.message}` };
  if (!validTokenResponse(r.data)) return { ok: false, error: "Mercado Libre respondió algo inesperado al conectar" };
  if (String(r.data.user_id) !== cfg.expectedUserId) {
    return { ok: false, error: "Esa cuenta de Mercado Libre no es la de la tienda. Entrá con la cuenta de la tienda y volvé a conectar." };
  }

  const me = await api.getMe(r.data.access_token, { fetchImpl });
  if (!me.ok) return { ok: false, error: `No se pudo verificar la cuenta: ${me.message}` };
  if (String(me.data?.id) !== cfg.expectedUserId) {
    return { ok: false, error: "Esa cuenta de Mercado Libre no es la de la tienda." };
  }

  await prisma.mlAccount.update({
    where: { id: ACCOUNT_ID },
    data: {
      mlUserId:       cfg.expectedUserId,
      nickname:       typeof me.data.nickname === "string" ? me.data.nickname.slice(0, 80) : null,
      accessToken:    seal("ml.access_token", r.data.access_token),
      refreshToken:   seal("ml.refresh_token", r.data.refresh_token),
      tokenExpiresAt: new Date(now.getTime() + Number(r.data.expires_in) * 1000),
      status:         "CONECTADA",
      connectedAt:    now,
      connectedBy:    actor ? String(actor).slice(0, 120) : null,
      lastRefreshAt:  now,
      lastError:      null,
      lastErrorAt:    null,
    },
  });
  return { ok: true, nickname: me.data.nickname || null };
}

async function disconnect() {
  await ensureAccount();
  await prisma.mlAccount.update({
    where: { id: ACCOUNT_ID },
    data: {
      accessToken: null, refreshToken: null, tokenExpiresAt: null,
      status: "DESCONECTADA", mode: "APAGADO",
      oauthState: null, oauthVerifier: null, oauthUserId: null, oauthExpiresAt: null,
    },
  });
  return { ok: true };
}

// ─── Token de acceso ────────────────────────────────────────────────────────

let refreshing = null; // una sola renovación a la vez

async function doRefresh({ now, cfg, fetchImpl, force }) {
  const account = await getAccount();
  if (!account || account.status !== "CONECTADA" || !account.refreshToken) {
    return { ok: false, kind: "not_connected", message: "Mercado Libre no está conectado" };
  }
  // Otra renovación pudo terminar mientras esperábamos.
  const remaining = account.tokenExpiresAt ? account.tokenExpiresAt.getTime() - now().getTime() : -1;
  if (!force && remaining > REFRESH_MARGIN_MS) {
    return { ok: true, token: open("ml.access_token", account.accessToken) };
  }

  let refreshToken;
  try {
    refreshToken = open("ml.refresh_token", account.refreshToken);
  } catch {
    await markReconnect("No se pudo leer el acceso guardado de Mercado Libre (¿cambió SECRETS_KEY?). Hay que volver a conectar.", now());
    return { ok: false, kind: "not_connected", message: "Hay que volver a conectar Mercado Libre" };
  }

  const r = await api.oauthToken(
    { grant_type: "refresh_token", client_id: cfg.appId, client_secret: cfg.clientSecret, refresh_token: refreshToken },
    { fetchImpl },
  );
  if (!r.ok) {
    const code = String(r.data?.error || "");
    if (code === "invalid_grant" || code === "invalid_client" || r.kind === "auth") {
      await markReconnect(`Mercado Libre no renovó el acceso (${code || r.status}): hay que volver a conectar la cuenta desde Configuración.`, now());
      return { ok: false, kind: "not_connected", message: "Hay que volver a conectar Mercado Libre" };
    }
    return { ok: false, kind: r.kind, message: r.message };
  }
  if (!validTokenResponse(r.data) || String(r.data.user_id) !== String(account.mlUserId)) {
    return { ok: false, kind: "bad_response", message: "Mercado Libre respondió algo inesperado al renovar el acceso" };
  }

  // Guardar el par nuevo antes de usarlo: el refresh token viejo ya no sirve.
  await prisma.mlAccount.update({
    where: { id: ACCOUNT_ID },
    data: {
      accessToken:    seal("ml.access_token", r.data.access_token),
      refreshToken:   seal("ml.refresh_token", r.data.refresh_token),
      tokenExpiresAt: new Date(now().getTime() + Number(r.data.expires_in) * 1000),
      lastRefreshAt:  now(),
    },
  });
  return { ok: true, token: r.data.access_token };
}

/**
 * Token vigente para llamar a la API. force: renovar aunque no esté por vencer (después de un 401).
 * @returns {Promise<{ok:true,token:string}|{ok:false,kind:string,message:string}>}
 */
async function getAccessToken({ now = () => new Date(), cfg = mlConfig(), fetchImpl, force = false } = {}) {
  if (!cfg.enabled) return { ok: false, kind: "disabled", message: "Mercado Libre está desactivado en este servidor (ML_SYNC_ENABLED)" };
  const account = await getAccount();
  if (!account || account.status !== "CONECTADA" || !account.accessToken) {
    return {
      ok: false,
      kind: "not_connected",
      message: account?.status === "RECONECTAR" ? "Hay que volver a conectar Mercado Libre" : "Mercado Libre no está conectado",
    };
  }
  const remaining = account.tokenExpiresAt ? account.tokenExpiresAt.getTime() - now().getTime() : -1;
  if (!force && remaining > REFRESH_MARGIN_MS) {
    try {
      return { ok: true, token: open("ml.access_token", account.accessToken) };
    } catch {
      await markReconnect("No se pudo leer el acceso guardado de Mercado Libre (¿cambió SECRETS_KEY?). Hay que volver a conectar.", now());
      return { ok: false, kind: "not_connected", message: "Hay que volver a conectar Mercado Libre" };
    }
  }

  if (!refreshing) {
    refreshing = doRefresh({ now, cfg, fetchImpl, force }).finally(() => { refreshing = null; });
  }
  const r = await refreshing;
  if (r.ok || r.kind === "not_connected") return r;
  // Corte al renovar: si el token actual todavía sirve un rato, se sigue con ese.
  if (!force && remaining > 60 * 1000) {
    try {
      return { ok: true, token: open("ml.access_token", account.accessToken) };
    } catch { /* cae al error de abajo */ }
  }
  return r;
}

module.exports = { startOAuth, exchangeOAuth, disconnect, getAccessToken, getAccount, ensureAccount, ACCOUNT_ID };

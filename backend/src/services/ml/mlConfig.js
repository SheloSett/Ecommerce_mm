// Configuración de Mercado Libre: todo sale de backend/.env (nada de esto va a site_config, que es
// pública, ni al repo). Ver backend/.env.production.example.
//
//   ML_SYNC_ENABLED=1     este servidor habla con Mercado Libre. Sin esto no se usa el token para nada
//                         (ni se renueva): una copia de la base restaurada en otra máquina no puede
//                         sincronizar contra la cuenta real ni dejar sin acceso a producción.
//   ML_APP_ID, ML_CLIENT_SECRET   la aplicación de la tienda (una propia, no la del publicador: el
//                         refresh token es de un solo uso por aplicación).
//   ML_REDIRECT_URI       a dónde vuelve Mercado Libre después de autorizar: la pantalla del panel
//                         /admin/mercadolibre/conectar. Tiene que ser idéntica a la cargada en la aplicación.
//   ML_WEBHOOK_TOKEN      clave de la dirección de avisos (/api/ml/webhook/<clave>). Mercado Libre no
//                         firma sus avisos: sin la clave la dirección responde 404.
//   ML_EXPECTED_USER_ID   el usuario de Mercado Libre de la tienda. Conectar otra cuenta se rechaza.
//   ML_PKCE=0             solo si la aplicación NO tiene PKCE activado (por defecto se usa).

function clean(value) {
  return String(value ?? "").trim();
}

function mlConfig(env = process.env) {
  return {
    enabled:        clean(env.ML_SYNC_ENABLED) === "1",
    appId:          clean(env.ML_APP_ID),
    clientSecret:   clean(env.ML_CLIENT_SECRET),
    redirectUri:    clean(env.ML_REDIRECT_URI),
    webhookToken:   clean(env.ML_WEBHOOK_TOKEN),
    expectedUserId: clean(env.ML_EXPECTED_USER_ID),
    pkce:           clean(env.ML_PKCE) !== "0",
  };
}

// Qué falta para poder conectar la cuenta (nombres de variables, nunca valores).
function missingForConnect(cfg = mlConfig()) {
  const missing = [];
  if (!cfg.enabled) missing.push("ML_SYNC_ENABLED");
  if (!/^\d{4,25}$/.test(cfg.appId)) missing.push("ML_APP_ID");
  if (!cfg.clientSecret) missing.push("ML_CLIENT_SECRET");
  if (!/^https:\/\/[^\s]+$/.test(cfg.redirectUri)) missing.push("ML_REDIRECT_URI");
  if (!/^\d{3,15}$/.test(cfg.expectedUserId)) missing.push("ML_EXPECTED_USER_ID");
  return missing;
}

module.exports = { mlConfig, missingForConnect };

const https = require("https");
const { Buffer } = require("buffer");

const BASE_URL = process.env.MICORREO_BASE_URL || "https://apitest.correoargentino.com.ar/micorreo/v1";
const MICORREO_USER = process.env.MICORREO_USER;
const MICORREO_PASS = process.env.MICORREO_PASS;
const ORIGIN_POSTAL_CODE = process.env.MICORREO_POSTAL_CODE_ORIGIN || "1424";

// Cache en memoria: se reinicia al reiniciar el proceso
let _tokenCache = null; // { token: string, expiresAt: Date }
let _customerId = null;

function _request(path, method, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = {
      "Content-Type": "application/json",
      ...extraHeaders,
      ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
    };
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data });
          }
        });
      }
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Obtiene un JWT válido, renovando si el cache expiró o no existe
async function getToken() {
  if (_tokenCache && _tokenCache.expiresAt > new Date()) {
    return _tokenCache.token;
  }
  const basicAuth = "Basic " + Buffer.from(`${MICORREO_USER}:${MICORREO_PASS}`).toString("base64");
  console.log(`[MiCorreo] POST ${BASE_URL}/token — user: ${MICORREO_USER}`);
  const res = await _request("/token", "POST", null, { Authorization: basicAuth });
  console.log(`[MiCorreo] /token → status ${res.status}`, JSON.stringify(res.data));
  if (res.status !== 200 || !res.data?.token) {
    throw new Error(`MiCorreo auth error: ${JSON.stringify(res.data)}`);
  }
  // "expires" viene como "2022-04-26 21:16:20" (ARG time UTC-3)
  const expiresAt = new Date(res.data.expires.replace(" ", "T") + "-03:00");
  // Renovar 5 min antes para evitar expiración en vuelo
  _tokenCache = {
    token: res.data.token,
    expiresAt: new Date(expiresAt.getTime() - 5 * 60 * 1000),
  };
  return _tokenCache.token;
}

// Obtiene el customerId de MiCorreo (vinculado a la cuenta del negocio)
async function getCustomerId() {
  if (_customerId) return _customerId;
  const token = await getToken();
  const res = await _request(
    "/users/validate",
    "POST",
    { email: MICORREO_USER, password: MICORREO_PASS },
    { Authorization: `Bearer ${token}` }
  );
  if (res.status !== 200 || !res.data?.customerId) {
    throw new Error(`MiCorreo validate error: ${JSON.stringify(res.data)}`);
  }
  _customerId = res.data.customerId;
  return _customerId;
}

// Cotiza el costo de envío a un CP destino
async function getRates(postalCodeDestination, dimensions = {}) {
  const [token, customerId] = await Promise.all([getToken(), getCustomerId()]);
  const body = {
    customerId,
    postalCodeOrigin: ORIGIN_POSTAL_CODE,
    postalCodeDestination: String(postalCodeDestination),
    deliveredType: "D",
    dimensions: {
      weight: Math.round(dimensions.weight || 1000),
      height: Math.round(dimensions.height || 10),
      width: Math.round(dimensions.width || 20),
      length: Math.round(dimensions.length || 30),
    },
  };
  const res = await _request("/rates", "POST", body, { Authorization: `Bearer ${token}` });
  if (res.status !== 200) {
    throw new Error(`MiCorreo rates error: ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

// Importa un pedido a MiCorreo para generar el envío
async function importShipping(order, shippingAddress) {
  const [token, customerId] = await Promise.all([getToken(), getCustomerId()]);
  const body = {
    customerId,
    extOrderId: String(order.id),
    orderNumber: String(order.id),
    sender: {
      name: null, phone: null, cellPhone: null, email: null,
      originAddress: {
        streetName: null, streetNumber: null, floor: null,
        apartment: null, city: null, provinceCode: null, postalCode: null,
      },
    },
    recipient: {
      name: order.customerName,
      phone: order.customerPhone || "",
      cellPhone: order.customerPhone || "",
      email: order.customerEmail,
    },
    shipping: {
      deliveryType: "D",
      agency: null,
      address: {
        streetName: shippingAddress.streetName,
        streetNumber: String(shippingAddress.streetNumber),
        floor: shippingAddress.floor || "",
        apartment: shippingAddress.apartment || "",
        city: shippingAddress.city,
        provinceCode: shippingAddress.provinceCode,
        postalCode: String(shippingAddress.postalCode),
      },
      productType: "CP",
      weight: 1000,
      declaredValue: Math.round(order.total),
      height: 10,
      length: 30,
      width: 20,
    },
  };
  const res = await _request("/shipping/import", "POST", body, { Authorization: `Bearer ${token}` });
  if (res.status !== 200) {
    throw new Error(`MiCorreo import error: ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

// Consulta el estado de seguimiento de un envío usando el extOrderId
async function getTracking(extOrderId) {
  const token = await getToken();
  const res = await _request(
    "/shipping/tracking",
    "GET",
    { shippingId: String(extOrderId) },
    { Authorization: `Bearer ${token}` }
  );
  return res.data;
}

module.exports = { getRates, importShipping, getTracking };

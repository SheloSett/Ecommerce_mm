// Envíos: la configuración de la moto (guardada en SiteConfig) y lo que se le aplica a un pedido nuevo.
// Las reglas puras están en utils/motoShipping.js.

const prisma = require("../lib/prisma"); // cliente único (ver lib/prisma.js)
const { DEFAULT_MOTO_CONFIG, quoteMoto, sanitizeShippingAddress, withDefaultPartidos } = require("../utils/motoShipping");
const { lookupPartidos } = require("./partidoLookup.service");

// Fila de SiteConfig. No sale en GET /api/settings (ver HIDDEN_KEYS en settings.controller.js): la lista
// de códigos postales es larga y esa respuesta la pide cada visitante en cada entrada a la tienda.
const MOTO_CONFIG_KEY = "motoShipping";

async function loadMotoConfig() {
  const row = await prisma.siteConfig.findUnique({ where: { key: MOTO_CONFIG_KEY } });
  if (!row?.value) return DEFAULT_MOTO_CONFIG;
  try {
    return withDefaultPartidos(JSON.parse(row.value));
  } catch (err) {
    console.error("[ENVIOS] La configuración de la moto no se pudo leer:", err.message);
    return DEFAULT_MOTO_CONFIG;
  }
}

async function saveMotoConfig(config) {
  const value = JSON.stringify(config);
  await prisma.siteConfig.upsert({ where: { key: MOTO_CONFIG_KEY }, update: { value }, create: { key: MOTO_CONFIG_KEY, value } });
}

// Cotiza una dirección. Si ni las listas ni la base oficial conocen la localidad, busca de qué partido es.
async function quoteMotoOnline(config, address, now = new Date()) {
  const quote = quoteMoto(config, address, now);
  if (!quote.needsLookup) return quote;
  return quoteMoto(config, address, now, { lookedUp: await lookupPartidos(address.city) });
}

// Método, dirección y costo de envío de un pedido nuevo. Antes createOrder solo aceptaba RETIRO/ENVIO y
// tiraba la dirección y el costo que mandaba el navegador.
//
// Devuelve { method, address, cost } o { error, status }. El costo de la moto se calcula acá, con la
// dirección; expectedCost es lo que el cliente vio en pantalla: si los precios cambiaron en el medio
// se le avisa en vez de cobrarle otro número. Una cotización mayorista no promete fecha: el pedido no sale
// hasta que se aprueba y se paga.
async function resolveOrderShipping({ shippingMethod, shippingAddress, expectedCost, isQuotation = false, now = new Date() }) {
  if (shippingMethod === "ENVIO") return { method: "ENVIO", address: null, cost: 0 };
  if (shippingMethod !== "CORREO_ARGENTINO" && shippingMethod !== "MOTO") return { method: "RETIRO", address: null, cost: 0 };

  const { address, error } = sanitizeShippingAddress(shippingAddress);
  if (error) return { error, status: 400 };

  // Correo: el costo no se conoce al comprar (todavía no hay tarifas integradas): lo confirma la tienda.
  if (shippingMethod === "CORREO_ARGENTINO") return { method: "CORREO_ARGENTINO", address, cost: 0 };

  const quote = await quoteMotoOnline(await loadMotoConfig(), address, now);
  if (!quote.available) return { error: quote.message, status: 400 };
  if (expectedCost !== undefined && expectedCost !== null && Math.abs(Number(expectedCost) - quote.price) >= 0.01) {
    return { error: "El costo del envío se actualizó. Revisalo y volvé a confirmar.", status: 409 };
  }
  return {
    method: "MOTO",
    cost: quote.price,
    address: {
      ...address,
      zoneId: quote.zoneId,
      zoneName: quote.zoneName,
      deliveryDate: isQuotation ? null : quote.delivery.date,
      reviewCity: quote.reviewCity,
    },
  };
}

module.exports = { MOTO_CONFIG_KEY, loadMotoConfig, saveMotoConfig, quoteMotoOnline, resolveOrderShipping };

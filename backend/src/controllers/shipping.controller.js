const { getRates, importShipping, getTracking } = require("../services/micorreo.service");
const { loadMotoConfig, saveMotoConfig, quoteMotoOnline } = require("../services/shipping.service");
const { validateMotoConfig } = require("../utils/motoShipping");

const prisma = require("../lib/prisma"); // cliente único (ver lib/prisma.js)

// GET /api/shipping/moto/quote?postalCode=&provinceCode=&city= — público: lo usa el checkout mientras
// el cliente completa la dirección. Siempre 200: que la moto no llegue es una respuesta, no un error.
async function motoQuote(req, res) {
  try {
    const { postalCode, provinceCode, city } = req.query;
    const quote = await quoteMotoOnline(await loadMotoConfig(), { postalCode, provinceCode, city });
    // reviewCity es para el panel: al cliente no le dice nada.
    const { reviewCity, ...publicQuote } = quote;
    res.json(publicQuote);
  } catch (err) {
    console.error("motoQuote error:", err.message);
    res.status(500).json({ error: "No se pudo cotizar el envío" });
  }
}

// GET /api/shipping/moto/config — admin: precios, zonas y hora de corte
async function getMotoConfig(req, res) {
  try {
    res.json(await loadMotoConfig());
  } catch (err) {
    console.error("getMotoConfig error:", err.message);
    res.status(500).json({ error: "No se pudo leer la configuración de envíos" });
  }
}

// PUT /api/shipping/moto/config — admin
async function updateMotoConfig(req, res) {
  try {
    const { config, error } = validateMotoConfig(req.body);
    if (error) return res.status(400).json({ error });
    await saveMotoConfig(config);
    res.json(config);
  } catch (err) {
    console.error("updateMotoConfig error:", err.message);
    res.status(500).json({ error: "No se pudo guardar la configuración de envíos" });
  }
}

// POST /api/shipping/rates — público: cotizar costo de envío para un CP destino
async function shippingRates(req, res) {
  try {
    const { postalCodeDestination, dimensions } = req.body;
    if (!postalCodeDestination) {
      return res.status(400).json({ error: "postalCodeDestination requerido" });
    }
    const data = await getRates(postalCodeDestination, dimensions || {});
    // Extraer la tarifa a domicilio (deliveredType "D")
    const rates = Array.isArray(data.rates) ? data.rates : [];
    const rate = rates.find((r) => r.deliveredType === "D") || rates[0];
    if (!rate) {
      return res.status(404).json({ error: "No se encontraron tarifas para ese código postal" });
    }
    res.json({
      price: rate.price,
      deliveryTimeMin: rate.deliveryTimeMin,
      deliveryTimeMax: rate.deliveryTimeMax,
      productName: rate.productName,
    });
  } catch (err) {
    console.error("shippingRates error:", err.message);
    res.status(500).json({ error: "No se pudo cotizar el envío. Verificá el código postal." });
  }
}

// POST /api/shipping/generate/:orderId — admin: generar envío en MiCorreo
async function generateShipping(req, res) {
  try {
    const { orderId } = req.params;
    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
      select: {
        id: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        shippingMethod: true,
        shippingAddress: true,
        shippingImported: true,
        total: true,
      },
    });
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });
    if (order.shippingMethod !== "CORREO_ARGENTINO") {
      return res.status(400).json({ error: "Esta orden no tiene envío por Correo Argentino" });
    }
    if (order.shippingImported) {
      return res.status(400).json({ error: "El envío ya fue generado en MiCorreo" });
    }
    if (!order.shippingAddress) {
      return res.status(400).json({ error: "La orden no tiene dirección de envío registrada" });
    }
    // Sin la cuenta de MiCorreo cargada no hay a dónde mandarlo: antes salía un error de autenticación
    // que no decía qué hacer. El seguimiento se puede cargar a mano igual.
    if (!process.env.MICORREO_USER || !process.env.MICORREO_PASS) {
      return res.status(400).json({ error: "MiCorreo no está configurado: despachalo por tu cuenta y cargá el número de seguimiento a mano." });
    }

    await importShipping(order, order.shippingAddress);

    // Intentar obtener el tracking inmediatamente (puede no estar listo aún)
    let trackingNumber = null;
    try {
      const tracking = await getTracking(order.id);
      if (Array.isArray(tracking) && tracking[0]?.trackingNumber) {
        trackingNumber = tracking[0].trackingNumber;
      }
    } catch {
      // El tracking puede tardar en generarse — no es un error crítico
    }

    const updated = await prisma.order.update({
      where: { id: parseInt(orderId) },
      data: {
        shippingImported: true,
        ...(trackingNumber ? { trackingNumber } : {}),
      },
    });

    res.json({
      ok: true,
      shippingImported: true,
      trackingNumber: updated.trackingNumber || null,
    });
  } catch (err) {
    console.error("generateShipping error:", err.message);
    res.status(500).json({ error: err.message || "Error al generar el envío en MiCorreo" });
  }
}

// GET /api/shipping/tracking/:orderId — admin: actualizar tracking desde MiCorreo
async function refreshTracking(req, res) {
  try {
    const { orderId } = req.params;
    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
      select: { id: true, shippingImported: true },
    });
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });
    if (!order.shippingImported) {
      return res.status(400).json({ error: "El envío aún no fue generado en MiCorreo" });
    }

    const tracking = await getTracking(order.id);
    let trackingNumber = null;
    let events = [];
    if (Array.isArray(tracking) && tracking[0]) {
      trackingNumber = tracking[0].trackingNumber || null;
      events = tracking[0].events || [];
    }

    if (trackingNumber) {
      await prisma.order.update({
        where: { id: parseInt(orderId) },
        data: { trackingNumber },
      });
    }

    res.json({ trackingNumber, events });
  } catch (err) {
    console.error("refreshTracking error:", err.message);
    res.status(500).json({ error: "Error al obtener el tracking de MiCorreo" });
  }
}

// PATCH /api/shipping/tracking/:orderId — admin: ingresar tracking manualmente
async function updateTrackingManual(req, res) {
  try {
    const { orderId } = req.params;
    const { trackingNumber } = req.body;
    if (!trackingNumber?.trim()) {
      return res.status(400).json({ error: "trackingNumber requerido" });
    }
    await prisma.order.update({
      where: { id: parseInt(orderId) },
      data: { trackingNumber: trackingNumber.trim(), shippingImported: true },
    });
    res.json({ ok: true, trackingNumber: trackingNumber.trim() });
  } catch (err) {
    console.error("updateTrackingManual error:", err.message);
    res.status(500).json({ error: "Error al actualizar el tracking" });
  }
}

module.exports = { shippingRates, generateShipping, refreshTracking, updateTrackingManual, motoQuote, getMotoConfig, updateMotoConfig };

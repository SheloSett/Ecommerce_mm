const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Valores por defecto si no están en la DB
const DEFAULTS = {
  theme: "clasico",
  maintenance: "false",
  // maintenanceScheduledAt: ISO string de la fecha/hora programada (vacío = sin programar)
  maintenanceScheduledAt: "",
  // Mini banner de anuncio que aparece debajo del navbar en todas las páginas públicas
  announcementActive: "false",
  announcementText: "",
  announcementLinkText: "",
  announcementUrl: "",
  announcementBgColor: "blue",
  announcementTextColor: "white",
  // "none" = estático, "ltr" = izquierda→derecha, "rtl" = derecha→izquierda
  announcementScrollDir: "ltr",
  // Nuevo formato multi-banner: JSON array de objetos banner
  announcementBanners: "",
  // Compra mínima para clientes MAYORISTA (en ARS). "0" = sin mínimo
  mayoristaMinimoCompra: "0",
  // Campañas de email — recomendaciones semanales para MINORISTAS
  emailMinoristaFrequencyDays: "7",       // cada cuántos días enviar el email
  emailMinoristaHour: "9",               // hora de envío en horario Argentina (0-23)
  emailMinoristaProductCount: "4",       // cantidad de productos a mostrar
  emailMinoristaFeaturedProducts: "[]",  // JSON array de IDs de productos destacados por el admin
  // Footer de contacto — editables desde admin > Configuración > Contenido > Footer
  footerEmail: "info@lsmarket.com.ar",
  footerPhone: "1150395166",
  footerAddress: "Av La Plata 744 Timbre 3",
  // Páginas de contenido enriquecido — vacío = mostrar layout predeterminado (viejo enfoque RTE)
  aboutUsContent: "",
  howToBuyContent: "",
  privacyContent: "",
  termsContent: "",
  // Contenido estructurado por sección — JSON arrays/objects guardados como strings
  aboutUsHero: "",
  aboutUsHistoria: "",
  aboutUsValores: "",
  howToBuySteps: "",
  howToBuyPayments: "",
  howToBuyFaqs: "",
  privacySections: "",
  termsSections: "",
  // Meta (Facebook / Instagram): Pixel + API de conversiones. Ver services/meta.service.js y
  // frontend services/metaPixel.js. Se editan en Admin → Configuración → Meta / Instagram.
  metaPixelId: "",
  // SECRETO: nunca sale por GET (ver readSettings). Un valor vacío en el PUT no lo pisa; para
  // borrarlo se manda metaCapiTokenClear: "true".
  metaCapiToken: "",
  metaTrackWholesale: "false",
  metaTestEventCode: "",
};

// Claves que no se devuelven nunca al navegador (ni al admin: el panel solo sabe si están cargadas).
const SECRET_KEYS = ["metaCapiToken"];

// Config completa (defaults + lo guardado), con los secretos reemplazados por un "<clave>Set".
async function readSettings() {
  const rows = await prisma.siteConfig.findMany();
  const settings = { ...DEFAULTS };
  rows.forEach((r) => {
    settings[r.key] = r.value;
  });
  for (const key of SECRET_KEYS) {
    settings[`${key}Set`] = settings[key] ? "true" : "false";
    settings[key] = "";
  }
  return settings;
}

// GET /api/settings — obtener toda la configuración (público, lo necesita el frontend)
const getSettings = async (req, res) => {
  try {
    res.json(await readSettings());
  } catch (err) {
    console.error("Error al obtener configuración:", err);
    res.status(500).json({ error: "Error al obtener configuración" });
  }
};

// PUT /api/settings — actualizar configuración (solo admin)
// Body: { theme: "oscuro", maintenance: "true", ... }
const updateSettings = async (req, res) => {
  try {
    const updates = req.body;
    const allowedKeys = Object.keys(DEFAULTS);

    for (const [key, value] of Object.entries(updates)) {
      if (!allowedKeys.includes(key)) continue; // ignorar keys desconocidas
      // Los secretos nunca llegan al panel, así que al guardar el resto vuelven vacíos: vacío = no tocar.
      if (SECRET_KEYS.includes(key) && String(value).trim() === "") continue;
      await prisma.siteConfig.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
    }
    // Borrado explícito de un secreto ("Quitar token" en el panel).
    for (const key of SECRET_KEYS) {
      if (updates[`${key}Clear`] === "true") {
        await prisma.siteConfig.deleteMany({ where: { key } });
      }
    }

    // Devolver la configuración actualizada
    res.json(await readSettings());
  } catch (err) {
    console.error("Error al guardar configuración:", err);
    res.status(500).json({ error: "Error al guardar configuración" });
  }
};

// POST /api/settings/meta/test — manda un evento de prueba a Meta con el Pixel y el token guardados
// (solo admin). Si algo está mal configurado, Meta devuelve el motivo y se muestra tal cual.
const testMetaConnection = async (req, res) => {
  try {
    const { testConnection } = require("../services/meta.service");
    const result = await testConnection();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || "No se pudo conectar con Meta" });
  }
};

module.exports = { getSettings, updateSettings, testMetaConnection };

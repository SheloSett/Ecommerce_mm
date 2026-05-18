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
};

// GET /api/settings — obtener toda la configuración (público, lo necesita el frontend)
const getSettings = async (req, res) => {
  try {
    const rows = await prisma.siteConfig.findMany();
    const settings = { ...DEFAULTS };
    rows.forEach((r) => {
      settings[r.key] = r.value;
    });
    res.json(settings);
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
      await prisma.siteConfig.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
    }

    // Devolver la configuración actualizada
    const rows = await prisma.siteConfig.findMany();
    const settings = { ...DEFAULTS };
    rows.forEach((r) => {
      settings[r.key] = r.value;
    });
    res.json(settings);
  } catch (err) {
    console.error("Error al guardar configuración:", err);
    res.status(500).json({ error: "Error al guardar configuración" });
  }
};

module.exports = { getSettings, updateSettings };

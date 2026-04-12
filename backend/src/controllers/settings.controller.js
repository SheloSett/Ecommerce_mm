const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Valores por defecto si no están en la DB
const DEFAULTS = {
  theme: "clasico",
  maintenance: "false",
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

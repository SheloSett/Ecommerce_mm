// Etiquetas de envío (las que antes eran archivos .btw de BarTender, una por cliente).
// Solo admin con permiso de órdenes: tienen datos personales (DNI, dirección, teléfono).
//
//   GET    /api/shipping-labels?search=&customerId=   lista (las más recientes primero)
//   POST   /api/shipping-labels                         crear
//   PUT    /api/shipping-labels/:id                     editar
//   DELETE /api/shipping-labels/:id                     borrar
//   POST   /api/shipping-labels/import/parse            leer .btw subidos y sugerir cliente (no guarda)
//   POST   /api/shipping-labels/import                  guardar las que se confirmaron
const express = require("express");
const multer = require("multer");
const prisma = require("../lib/prisma");
const { authMiddleware, adminMiddleware, requireAnyPermission } = require("../middleware/auth.middleware");
const { parseBtwLabel } = require("../utils/btwLabel");
const { DEFAULT_SENDER, suggestCustomers, personKey } = require("../services/shippingLabels.service");

const router = express.Router();
const admin = [authMiddleware, adminMiddleware, requireAnyPermission("ordenes")];

// Los .btw se leen en memoria y no se guardan (pesan 30-40 KB; se suben de a tandas desde el panel).
const MAX_FILES = 60;
const btwUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: MAX_FILES },
});

const LABEL_SELECT = {
  id: true, customerId: true, recipientName: true, recipientDetails: true, transport: true, insurance: true,
  sender: true, sourceFile: true, sourceSize: true, createdAt: true, updatedAt: true,
  customer: { select: { id: true, name: true, email: true } },
};

const str = (v, max) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");
const optStr = (v, max) => { const s = str(v, max); return s || null; };

// Datos de una etiqueta desde el body, ya limpios. null + error si falta algo.
async function labelData(body) {
  const recipientName = str(body.recipientName, 200);
  if (!recipientName) return { error: "Falta el destinatario" };
  let customerId = null;
  if (body.customerId !== undefined && body.customerId !== null && body.customerId !== "") {
    customerId = parseInt(body.customerId, 10);
    if (isNaN(customerId)) return { error: "Cliente inválido" };
    const exists = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!exists) return { error: "El cliente elegido ya no existe" };
  }
  return {
    data: {
      customerId,
      recipientName,
      recipientDetails: str(body.recipientDetails, 2000),
      transport: optStr(body.transport, 120),
      insurance: optStr(body.insurance, 120),
      sender: str(body.sender, 500) || DEFAULT_SENDER,
    },
  };
}

router.get("/", ...admin, async (req, res) => {
  try {
    const where = {};
    if (req.query.customerId) {
      const id = parseInt(req.query.customerId, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Cliente inválido" });
      where.customerId = id;
    }
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    if (search) {
      where.OR = [
        { recipientName: { contains: search, mode: "insensitive" } },
        { recipientDetails: { contains: search, mode: "insensitive" } },
        { customer: { name: { contains: search, mode: "insensitive" } } },
      ];
    }
    const labels = await prisma.shippingLabel.findMany({
      where, select: LABEL_SELECT, orderBy: { updatedAt: "desc" }, take: search || where.customerId ? 100 : 500,
    });
    res.json({ labels, defaultSender: DEFAULT_SENDER });
  } catch (err) {
    console.error("shippingLabels list:", err);
    res.status(500).json({ error: "No se pudieron cargar las etiquetas" });
  }
});

router.post("/", ...admin, async (req, res) => {
  try {
    const { data, error } = await labelData(req.body || {});
    if (error) return res.status(400).json({ error });
    const label = await prisma.shippingLabel.create({ data, select: LABEL_SELECT });
    res.status(201).json(label);
  } catch (err) {
    console.error("shippingLabels create:", err);
    res.status(500).json({ error: "No se pudo guardar la etiqueta" });
  }
});

router.put("/:id", ...admin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.shippingLabel.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: "Etiqueta no encontrada" });
    const { data, error } = await labelData(req.body || {});
    if (error) return res.status(400).json({ error });
    const label = await prisma.shippingLabel.update({ where: { id }, data, select: LABEL_SELECT });
    res.json(label);
  } catch (err) {
    console.error("shippingLabels update:", err);
    res.status(500).json({ error: "No se pudo guardar la etiqueta" });
  }
});

router.delete("/:id", ...admin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { count } = await prisma.shippingLabel.deleteMany({ where: { id } });
    if (!count) return res.status(404).json({ error: "Etiqueta no encontrada" });
    res.json({ ok: true });
  } catch (err) {
    console.error("shippingLabels delete:", err);
    res.status(500).json({ error: "No se pudo borrar la etiqueta" });
  }
});

// Paso 1 de la importación: lee los .btw y devuelve lo que entiende de cada uno, con el cliente
// sugerido. No guarda nada. lastModified: JSON con la fecha de cada archivo (en el mismo orden), para
// quedarse con el más nuevo cuando la misma persona tiene dos (10×10 y 10×15).
router.post("/import/parse", ...admin, (req, res, next) => {
  btwUpload.array("files", MAX_FILES)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_COUNT" ? `Subí de a ${MAX_FILES} archivos como máximo` : "No se pudieron leer los archivos" });
    next();
  });
}, async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: "No llegó ningún archivo" });
    let dates = [];
    try { dates = JSON.parse(req.body.lastModified || "[]"); } catch { dates = []; }

    // multer lee el nombre como latin1: se pasa a UTF-8 para que "Río" no quede "RÃ­o"
    const names = files.map((f) => Buffer.from(f.originalname, "latin1").toString("utf8"));
    const [customers, imported] = await Promise.all([
      prisma.customer.findMany({ select: { id: true, name: true, phone: true, cuit: true, email: true } }),
      prisma.shippingLabel.findMany({ where: { sourceFile: { in: names } }, select: { sourceFile: true } }),
    ]);
    const already = new Set(imported.map((l) => l.sourceFile));

    const results = files.map((f, i) => {
      const fileName = names[i];
      const lastModified = Number(dates[i]) || null;
      let parsed = null;
      try { parsed = parseBtwLabel(f.buffer, fileName); } catch { parsed = null; }
      if (!parsed) return { fileName, lastModified, error: "No se pudo leer: no parece una etiqueta de BarTender" };
      return {
        fileName,
        lastModified,
        alreadyImported: already.has(fileName),
        // Sin remitente no es una etiqueta de envío (frágil, artículos, garantía...)
        isShipping: !!parsed.sender,
        personKey: personKey(parsed),
        label: { ...parsed },
        suggestions: suggestCustomers(parsed, customers),
      };
    });
    res.json({ results, defaultSender: DEFAULT_SENDER });
  } catch (err) {
    console.error("shippingLabels parse:", err);
    res.status(500).json({ error: "No se pudieron leer las etiquetas" });
  }
});

// Paso 2: guardar las confirmadas. Las ya importadas (mismo archivo) se saltean.
router.post("/import", ...admin, async (req, res) => {
  try {
    const list = Array.isArray(req.body?.labels) ? req.body.labels.slice(0, 1000) : [];
    if (list.length === 0) return res.status(400).json({ error: "No hay etiquetas para guardar" });
    const sourceFiles = list.map((l) => str(l.sourceFile, 255)).filter(Boolean);
    const existing = new Set((await prisma.shippingLabel.findMany({
      where: { sourceFile: { in: sourceFiles } }, select: { sourceFile: true },
    })).map((l) => l.sourceFile));

    const toCreate = [];
    let skipped = 0;
    for (const l of list) {
      const sourceFile = str(l.sourceFile, 255) || null;
      if (sourceFile && existing.has(sourceFile)) { skipped++; continue; }
      const { data, error } = await labelData(l);
      if (error) { skipped++; continue; }
      toCreate.push({ ...data, sourceFile, sourceSize: optStr(l.sourceSize, 20) });
    }
    const { count } = toCreate.length ? await prisma.shippingLabel.createMany({ data: toCreate }) : { count: 0 };
    res.json({ created: count, skipped });
  } catch (err) {
    console.error("shippingLabels import:", err);
    res.status(500).json({ error: "No se pudieron guardar las etiquetas" });
  }
});

module.exports = router;

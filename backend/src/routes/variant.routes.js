const express = require("express");
const router  = express.Router();
const { PrismaClient } = require("@prisma/client");
const { authMiddleware } = require("../middleware/auth.middleware");
const { syncProductVisibility } = require("../controllers/product.controller");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");

const prisma = new PrismaClient();

// Multer para imagen de variante
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../../uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = `variant-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── Atributos ─────────────────────────────────────────────────────────────────

// GET /api/variants/product/:productId/attributes
router.get("/product/:productId/attributes", async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    const attrs = await prisma.productAttribute.findMany({
      where:   { productId },
      include: { values: { orderBy: { position: "asc" } } },
      orderBy: { position: "asc" },
    });
    res.json(attrs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener atributos" });
  }
});

// POST /api/variants/product/:productId/attributes
router.post("/product/:productId/attributes", authMiddleware, async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    const { name, values = [] } = req.body; // values: string[]

    if (!name?.trim()) return res.status(400).json({ error: "El nombre es requerido" });

    const attr = await prisma.productAttribute.create({
      data: {
        productId,
        name: name.trim(),
        values: {
          create: values.map((v, i) => ({ value: String(v).trim(), position: i })),
        },
      },
      include: { values: { orderBy: { position: "asc" } } },
    });
    res.status(201).json(attr);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear atributo" });
  }
});

// PUT /api/variants/attributes/:id  — renombrar atributo y/o reemplazar sus valores
router.put("/attributes/:id", authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, values } = req.body;

    const data = {};
    if (name?.trim()) data.name = name.trim();

    if (Array.isArray(values)) {
      // Reemplazar todos los valores: borrar los anteriores y crear los nuevos
      await prisma.productAttributeValue.deleteMany({ where: { attributeId: id } });
      data.values = {
        create: values.map((v, i) => ({ value: String(v).trim(), position: i })),
      };
    }

    const attr = await prisma.productAttribute.update({
      where:   { id },
      data,
      include: { values: { orderBy: { position: "asc" } } },
    });
    res.json(attr);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar atributo" });
  }
});

// DELETE /api/variants/attributes/:id
router.delete("/attributes/:id", authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.productAttribute.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar atributo" });
  }
});

// ── Variantes ─────────────────────────────────────────────────────────────────

// GET /api/variants/product/:productId
router.get("/product/:productId", async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    const variants  = await prisma.productVariant.findMany({
      where:   { productId },
      orderBy: { createdAt: "asc" },
    });
    res.json(variants);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener variantes" });
  }
});

// POST /api/variants/product/:productId/generate
// Genera (o regenera) el set completo de variantes a partir del producto cartesiano de atributos.
// Las variantes existentes que coincidan en combination se mantienen (conservan stock/precio/sku).
// Las que ya no existen se eliminan; las nuevas se crean con stock 0.
router.post("/product/:productId/generate", authMiddleware, async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);

    const attrs = await prisma.productAttribute.findMany({
      where:   { productId },
      include: { values: { orderBy: { position: "asc" } } },
      orderBy: { position: "asc" },
    });

    if (attrs.length === 0) {
      return res.status(400).json({ error: "El producto no tiene atributos definidos" });
    }
    if (attrs.some((a) => a.values.length === 0)) {
      return res.status(400).json({ error: "Todos los atributos deben tener al menos un valor" });
    }

    // Producto cartesiano de todos los valores
    const combos = cartesian(attrs.map((a) => a.values.map((v) => ({ name: a.name, value: v.value }))));

    const existing = await prisma.productVariant.findMany({ where: { productId } });

    // Clave canónica para comparar combinaciones
    const comboKey = (combo) => combo.map((c) => `${c.name}::${c.value}`).sort().join("|");

    const existingMap = {};
    for (const v of existing) {
      existingMap[comboKey(v.combination)] = v;
    }

    const newKeys = new Set(combos.map(comboKey));

    // Eliminar las que ya no corresponden
    const toDelete = existing.filter((v) => !newKeys.has(comboKey(v.combination)));
    if (toDelete.length > 0) {
      await prisma.productVariant.deleteMany({ where: { id: { in: toDelete.map((v) => v.id) } } });
    }

    // Crear las que son nuevas
    const toCreate = combos.filter((c) => !existingMap[comboKey(c)]);
    if (toCreate.length > 0) {
      await prisma.productVariant.createMany({
        data: toCreate.map((combination) => ({ productId, combination })),
      });
      // Primera vez que se generan variantes: resetear product.stock a 0.
      // A partir de ahora el stock real está por variante — el campo del producto es solo la suma.
      if (existing.length === 0) {
        await prisma.product.update({ where: { id: productId }, data: { stock: 0 } });
      }
    }

    const variants = await prisma.productVariant.findMany({
      where:   { productId },
      orderBy: { createdAt: "asc" },
    });
    res.json(variants);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar variantes" });
  }
});

// PUT /api/variants/:id  — actualizar stock, precio, sku, imagen de una variante
router.put("/:id", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    const id   = parseInt(req.params.id);
    const { stock, stockUnlimited, price, cost, sku, active } = req.body;

    const data = {};
    if (stock          !== undefined) data.stock          = parseInt(stock);
    if (stockUnlimited !== undefined) data.stockUnlimited = stockUnlimited === "true" || stockUnlimited === true;
    if (price          !== undefined) data.price          = price === "" || price === null ? null : parseFloat(price);
    if (cost           !== undefined) data.cost           = cost  === "" || cost  === null ? null : parseFloat(cost);
    if (sku            !== undefined) data.sku            = sku || null;
    if (active         !== undefined) data.active         = active === "true" || active === true;
    if (req.file)                     data.image          = req.file.filename;

    const variant = await prisma.productVariant.update({ where: { id }, data });
    if (stock !== undefined || stockUnlimited !== undefined) {
      await syncProductVisibility(variant.productId);
    }
    res.json(variant);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar variante" });
  }
});

// DELETE /api/variants/product/:productId/all  — eliminar todas las variantes y atributos del producto
router.delete("/product/:productId/all", authMiddleware, async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    await prisma.productVariant.deleteMany({ where: { productId } });
    await prisma.productAttribute.deleteMany({ where: { productId } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar variantes" });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function cartesian(arrays) {
  return arrays.reduce(
    (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
    [[]]
  );
}

module.exports = router;

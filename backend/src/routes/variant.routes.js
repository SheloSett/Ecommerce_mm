const express = require("express");
const router  = express.Router();
const { PrismaClient } = require("@prisma/client");
const { authMiddleware } = require("../middleware/auth.middleware");
const { syncProductVisibility } = require("../controllers/product.controller");

const prisma = new PrismaClient();

// Nota: ya no usamos multer para variantes — las imágenes de variantes son referencias a las
// fotos del producto principal (Cloudinary URLs). El admin elige cuál de las fotos del producto
// corresponde a cada variante. Esto evita duplicar imágenes en Cloudinary y permite que el
// carrusel del producto salte a la foto correcta cuando el cliente elige una variante.

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
    const { name, values = [], visibility } = req.body; // values: string[]; visibility opcional

    if (!name?.trim()) return res.status(400).json({ error: "El nombre es requerido" });

    // Validar visibility si vino
    const allowedVis = ["AMBOS", "MAYORISTA", "MINORISTA"];
    const vis = (visibility && allowedVis.includes(visibility)) ? visibility : "AMBOS";

    const attr = await prisma.productAttribute.create({
      data: {
        productId,
        name: name.trim(),
        visibility: vis,
        values: {
          create: values.map((v, i) => ({ value: String(v).trim(), position: i })),
        },
      },
      include: { values: { orderBy: { position: "asc" } } },
    });
    // Propagar visibility a todas las variantes del producto — así las queries existentes
    // (que filtran por variant.visibility) siguen funcionando sin cambios.
    await prisma.productVariant.updateMany({
      where: { productId },
      data: { visibility: vis },
    });
    res.status(201).json(attr);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear atributo" });
  }
});

// PUT /api/variants/attributes/:id  — renombrar atributo, reemplazar valores o cambiar visibility
router.put("/attributes/:id", authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, values, visibility } = req.body;

    const data = {};
    if (name?.trim()) data.name = name.trim();

    // Validar y aceptar visibility
    const allowedVis = ["AMBOS", "MAYORISTA", "MINORISTA"];
    if (visibility && allowedVis.includes(visibility)) {
      data.visibility = visibility;
    }

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

    // Si se cambió visibility, propagar a todas las variantes del producto.
    // Las queries existentes filtran por variant.visibility, así que con esto siguen funcionando.
    if (data.visibility) {
      await prisma.productVariant.updateMany({
        where: { productId: attr.productId },
        data:  { visibility: data.visibility },
      });
    }

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

// PUT /api/variants/:id  — actualizar stock, precios, sku, imágenes y visibilidad de una variante.
// Precios:
//   - price / salePrice           → para minoristas (visibility MINORISTA o AMBOS)
//   - wholesalePrice / wholesaleSalePrice → para mayoristas (visibility MAYORISTA o AMBOS)
// La imagen es una URL (de las fotos del producto principal) o null para limpiarla.
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const id   = parseInt(req.params.id);
    const {
      stock, stockUnlimited,
      price, salePrice, wholesalePrice, wholesaleSalePrice,
      cost, sku, active, image, images, visibility,
      module, shelf, // ubicación en depósito a nivel variante (override del producto)
      supplierId,    // proveedor a nivel variante (override del producto; vacío → usa el del producto)
    } = req.body;

    // Helper para parsear precios: null/empty string → null, valor numérico → float
    const parsePrice = (v) => (v === "" || v === null || v === undefined) ? undefined : parseFloat(v);

    const data = {};
    if (stock          !== undefined) data.stock          = parseInt(stock);
    if (stockUnlimited !== undefined) data.stockUnlimited = stockUnlimited === "true" || stockUnlimited === true;
    if (price              !== undefined) data.price              = price              === "" || price              === null ? null : parseFloat(price);
    if (salePrice          !== undefined) data.salePrice          = salePrice          === "" || salePrice          === null ? null : parseFloat(salePrice);
    if (wholesalePrice     !== undefined) data.wholesalePrice     = wholesalePrice     === "" || wholesalePrice     === null ? null : parseFloat(wholesalePrice);
    if (wholesaleSalePrice !== undefined) data.wholesaleSalePrice = wholesaleSalePrice === "" || wholesaleSalePrice === null ? null : parseFloat(wholesaleSalePrice);
    if (cost           !== undefined) data.cost           = cost  === "" || cost  === null ? null : parseFloat(cost);
    if (sku            !== undefined) data.sku            = sku || null;
    if (active         !== undefined) data.active         = active === "true" || active === true;
    // Visibilidad: validar contra el enum CustomerVisibility
    if (visibility     !== undefined) {
      const allowed = ["AMBOS", "MAYORISTA", "MINORISTA"];
      if (!allowed.includes(visibility)) {
        return res.status(400).json({ error: "visibility inválida (debe ser AMBOS, MAYORISTA o MINORISTA)" });
      }
      data.visibility = visibility;
    }
    // image (legado, una sola foto) y images (array, múltiples). El admin nuevo manda images.
    if (image          !== undefined) data.image          = image || null;
    if (images         !== undefined) data.images         = Array.isArray(images) ? images.filter(Boolean) : [];
    // Ubicación en depósito: vacío → null (para que el fallback al producto funcione con ??)
    if (module         !== undefined) data.module         = module ? String(module).trim() : null;
    if (shelf          !== undefined) data.shelf          = shelf  ? String(shelf).trim()  : null;
    // Proveedor por variante: vacío → null (usa el del producto padre)
    if (supplierId     !== undefined) data.supplierId     = supplierId ? parseInt(supplierId) : null;

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

// GET /api/variants/suggestions  — sugerencias de atributos/valores ya usados en otros productos
// Devuelve { names: [...], valuesByName: { name: [valores] } } para autocomplete en el admin.
router.get("/suggestions", authMiddleware, async (_req, res) => {
  try {
    const attrs = await prisma.productAttribute.findMany({
      include: { values: { select: { value: true } } },
      orderBy: { name: "asc" },
    });
    // Deduplicar nombres (case-insensitive) y agrupar valores únicos por nombre
    const namesSet = new Set();
    const valuesByName = {};
    for (const a of attrs) {
      const key = a.name.trim();
      if (!key) continue;
      namesSet.add(key);
      if (!valuesByName[key]) valuesByName[key] = new Set();
      for (const v of a.values) {
        if (v.value?.trim()) valuesByName[key].add(v.value.trim());
      }
    }
    // Convertir Sets a arrays ordenados
    const result = {
      names: Array.from(namesSet).sort((a, b) => a.localeCompare(b)),
      valuesByName: Object.fromEntries(
        Object.entries(valuesByName).map(([k, set]) => [k, Array.from(set).sort((a, b) => a.localeCompare(b))])
      ),
    };
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener sugerencias" });
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

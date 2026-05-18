const express = require("express");
const router = express.Router();
const { PrismaClient } = require("@prisma/client");
const { authMiddleware } = require("../middleware/auth.middleware");

const prisma = new PrismaClient();

// GET /api/gastos - listar gastos con filtros opcionales: type, dateFrom, dateTo
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { type, dateFrom, dateTo } = req.query;
    const where = {};
    if (type && ["PERSONAL", "NEGOCIO"].includes(type)) where.type = type;
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }
    const gastos = await prisma.gasto.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
    res.json(gastos);
  } catch (err) {
    console.error("Error al listar gastos:", err);
    res.status(500).json({ error: "Error al listar gastos" });
  }
});

// POST /api/gastos - crear un gasto
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { amount, description, type, date, subtype, productId, variantId, quantity } = req.body;
    if (!amount || !description || !type) {
      return res.status(400).json({ error: "Monto, descripción y tipo son requeridos" });
    }
    if (!["PERSONAL", "NEGOCIO"].includes(type)) {
      return res.status(400).json({ error: "Tipo inválido. Debe ser PERSONAL o NEGOCIO" });
    }
    const validSubtype = subtype === "RMA" ? "RMA" : "GASTO";
    const parsedProductId = validSubtype === "RMA" && productId ? parseInt(productId) : null;
    const parsedVariantId = validSubtype === "RMA" && variantId ? parseInt(variantId) : null;

    const gasto = await prisma.gasto.create({
      data: {
        amount:      parseFloat(amount),
        description,
        type,
        subtype:     validSubtype,
        productId:   parsedProductId,
        variantId:   parsedVariantId,
        date:        date ? new Date(date) : new Date(),
      },
    });

    // Descontar stock al registrar un RMA
    if (validSubtype === "RMA" && quantity > 0) {
      const qty = parseInt(quantity) || 1;
      if (parsedVariantId) {
        const variant = await prisma.productVariant.findUnique({ where: { id: parsedVariantId } });
        if (variant && !variant.stockUnlimited) {
          await prisma.productVariant.update({
            where: { id: parsedVariantId },
            data:  { stock: Math.max(0, variant.stock - qty) },
          });
        }
      } else if (parsedProductId) {
        const product = await prisma.product.findUnique({ where: { id: parsedProductId } });
        if (product && !product.stockUnlimited) {
          const newStock = Math.max(0, product.stock - qty);
          await prisma.product.update({
            where: { id: parsedProductId },
            data:  { stock: newStock, ...(newStock === 0 ? { active: false } : {}) },
          });
        }
      }
    }

    res.status(201).json(gasto);
  } catch (err) {
    console.error("Error al crear gasto:", err);
    res.status(500).json({ error: "Error al crear gasto" });
  }
});

// DELETE /api/gastos/:id - eliminar un gasto
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.gasto.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("Error al eliminar gasto:", err);
    res.status(500).json({ error: "Error al eliminar gasto" });
  }
});

module.exports = router;

const express = require("express");
const router = express.Router();
const { PrismaClient } = require("@prisma/client");
const { authMiddleware } = require("../middleware/auth.middleware");

const prisma = new PrismaClient();

// GET /api/gastos - listar todos los gastos (con filtro opcional por tipo)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { type } = req.query;
    const where = type && ["PERSONAL", "NEGOCIO"].includes(type) ? { type } : {};
    const gastos = await prisma.gasto.findMany({
      where,
      orderBy: { date: "desc" },
    });
    res.json(gastos);
  } catch (err) {
    console.error("Error al listar gastos:", err);
    res.status(500).json({ error: "Error al listar gastos" });
  }
});

// POST /api/gastos - crear un gasto
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { amount, description, type, date } = req.body;
    if (!amount || !description || !type) {
      return res.status(400).json({ error: "Monto, descripción y tipo son requeridos" });
    }
    if (!["PERSONAL", "NEGOCIO"].includes(type)) {
      return res.status(400).json({ error: "Tipo inválido. Debe ser PERSONAL o NEGOCIO" });
    }
    const gasto = await prisma.gasto.create({
      data: {
        amount: parseFloat(amount),
        description,
        type,
        date: date ? new Date(date) : new Date(),
      },
    });
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

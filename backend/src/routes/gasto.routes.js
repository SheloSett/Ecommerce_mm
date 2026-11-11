const express = require("express");
const { isDay, dateOnlyStart, dateOnlyEnd } = require("../utils/arDates");
const router = express.Router();
// FIX seguridad: se agrega adminMiddleware. Antes las rutas de gastos solo tenían authMiddleware
// (token válido) → cualquier cliente logueado podía listar/crear/borrar gastos del negocio.
const { authMiddleware, adminMiddleware, requireAnyPermission } = require("../middleware/auth.middleware");
// Todo cambio de stock pasa por services/stock.service.js (ver ahí el porqué).
const { adjustStock, actorOf, REASONS } = require("../services/stock.service");

const prisma = require("../lib/prisma"); // cliente único (ver lib/prisma.js)

// GET /api/gastos - listar gastos con filtros opcionales: type, dateFrom, dateTo
router.get("/", authMiddleware, adminMiddleware, requireAnyPermission("finanzas", "caja", "metricas"), async (req, res) => {
  try {
    const { type, dateFrom, dateTo, currency } = req.query;
    const where = {};
    if (type && ["PERSONAL", "NEGOCIO"].includes(type)) where.type = type;
    // currency: filtra los gastos por moneda. Sin este parámetro devuelve TODOS (pesos + dólares),
    // que es lo que necesita la vista de Caja; el dashboard sí lo manda para no mezclar cuadros.
    if (currency && ["ARS", "USD"].includes(currency)) where.currency = currency;
    if (dateFrom || dateTo) {
      where.date = {};
      // Fecha SIN hora (se guarda a las 00:00 UTC del día tipeado): el día se corta en UTC, explícito.
      // Antes el fin del día usaba setHours, que depende de la zona del servidor. Ver utils/arDates.js.
      if (isDay(dateFrom)) where.date.gte = dateOnlyStart(dateFrom);
      if (isDay(dateTo))   where.date.lte = dateOnlyEnd(dateTo);
    }
    const gastos = await prisma.gasto.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
    res.json(gastos);
  } catch (err) {
    console.error("Error al listar gastos:", err);
    res.status(500).json({ error: "Error al listar gastos" });
  }
});

// POST /api/gastos - crear un gasto
router.post("/", authMiddleware, adminMiddleware, requireAnyPermission("caja"), async (req, res) => {
  try {
    const { amount, description, type, date, subtype, productId, variantId, quantity, currency } = req.body;
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
        currency:    ["ARS", "USD"].includes(currency) ? currency : "ARS",
        subtype:     validSubtype,
        productId:   parsedProductId,
        variantId:   parsedVariantId,
        date:        date ? new Date(date) : new Date(),
      },
    });

    // Descontar stock al registrar un RMA: de la variante si viene, si no del producto. Nunca baja de 0
    // y un producto sin variantes que se queda en 0 se despublica (como antes). Queda en el historial
    // con el número de este gasto.
    if (validSubtype === "RMA" && quantity > 0) {
      const qty = parseInt(quantity) || 1;
      if (parsedVariantId || parsedProductId) {
        await adjustStock({
          ...(parsedVariantId ? { variantId: parsedVariantId } : { productId: parsedProductId }),
          delta:      -qty,
          reason:     REASONS.RMA,
          ref:        { type: "gasto", id: gasto.id },
          actor:      actorOf(req.user),
          visibility: parsedVariantId ? "none" : "sync",
        });
      }
    }

    res.status(201).json(gasto);
  } catch (err) {
    console.error("Error al crear gasto:", err);
    res.status(500).json({ error: "Error al crear gasto" });
  }
});

// DELETE /api/gastos/:id - eliminar un gasto
router.delete("/:id", authMiddleware, adminMiddleware, requireAnyPermission("caja"), async (req, res) => {
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

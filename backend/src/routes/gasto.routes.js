const express = require("express");
const { isDay, dateOnlyStart, dateOnlyEnd } = require("../utils/arDates");
const router = express.Router();
// FIX seguridad: se agrega adminMiddleware. Antes las rutas de gastos solo tenían authMiddleware
// (token válido) → cualquier cliente logueado podía listar/crear/borrar gastos del negocio.
const { authMiddleware, adminMiddleware, requireAnyPermission } = require("../middleware/auth.middleware");

const prisma = require("../lib/prisma"); // cliente único (ver lib/prisma.js)
// Publica/despublica el producto según le quede stock (lo usan todos los que mueven stock)
const { syncProductVisibility } = require("../controllers/product.controller");

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

    // RMA: validar producto y variante ANTES de guardar nada (con un 400 no queda un gasto a medias).
    // Antes no se validaba: una variante de OTRO producto (o desactivada) descontaba stock de ese otro
    // producto, y un producto con variantes sin variante elegida guardaba el gasto sin tocar ningún stock.
    // Misma regla que la venta manual (createManualOrder en order.controller.js).
    let rmaProduct = null;
    let rmaVariant = null;
    if (validSubtype === "RMA") {
      if (parsedVariantId && !parsedProductId) {
        return res.status(400).json({ error: "Falta el producto de la variante devuelta" });
      }
      if (parsedProductId) {
        rmaProduct = await prisma.product.findUnique({ where: { id: parsedProductId } });
        if (!rmaProduct) {
          return res.status(400).json({ error: `Producto no encontrado: ${parsedProductId}` });
        }
        if (parsedVariantId) {
          rmaVariant = await prisma.productVariant.findUnique({ where: { id: parsedVariantId } });
          if (!rmaVariant || rmaVariant.productId !== rmaProduct.id || !rmaVariant.active) {
            return res.status(400).json({ error: `Variante inválida para "${rmaProduct.name}"` });
          }
        } else {
          const activeVariants = await prisma.productVariant.count({ where: { productId: rmaProduct.id, active: true } });
          if (activeVariants > 0) {
            return res.status(400).json({ error: `Elegí la variante de "${rmaProduct.name}" que se devuelve` });
          }
        }
      }
    }

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

    // Descontar stock al registrar un RMA (producto y variante ya validados arriba)
    if (validSubtype === "RMA" && quantity > 0 && rmaProduct) {
      const qty = parseInt(quantity) || 1;
      let moved = false;
      if (rmaVariant) {
        if (!rmaVariant.stockUnlimited) {
          await prisma.productVariant.update({
            where: { id: rmaVariant.id },
            data:  { stock: Math.max(0, rmaVariant.stock - qty) },
          });
          moved = true;
        }
      } else if (!rmaProduct.stockUnlimited) {
        // Antes: data: { stock: newStock, ...(newStock === 0 ? { active: false } : {}) } — el producto se
        // despublicaba a mano acá, y si se descontaba de una variante no se despublicaba nunca, aunque fuera
        // la última con stock. Ahora lo resuelve syncProductVisibility, como en los demás que mueven stock.
        await prisma.product.update({
          where: { id: rmaProduct.id },
          data:  { stock: Math.max(0, rmaProduct.stock - qty) },
        });
        moved = true;
      }
      if (moved) {
        // El gasto y el stock ya quedaron guardados: si esto falla, no se responde error (un reintento
        // registraría el RMA dos veces); la visibilidad se corrige sola con el próximo movimiento de stock.
        try { await syncProductVisibility(rmaProduct.id); } catch (err) { console.error("RMA: syncProductVisibility:", err); }
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

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────────────────────

// Calcula el monto de descuento para un subtotal dado
function calcDiscount(coupon, subtotal) {
  if (coupon.discountType === "PERCENTAGE") {
    return Math.round((subtotal * coupon.discountValue) / 100 * 100) / 100;
  }
  // FIXED: no puede superar el subtotal
  return Math.min(coupon.discountValue, subtotal);
}

// ── POST /api/coupons/validate — Validar cupón (público, desde checkout) ──────
// Body: { code, subtotal, customerEmail }
// Retorna: { valid, coupon, discountAmount, finalTotal, error? }
async function validateCoupon(req, res) {
  try {
    const { code, subtotal, customerEmail } = req.body;
    if (!code || subtotal === undefined) {
      return res.status(400).json({ valid: false, error: "Código y subtotal son requeridos" });
    }

    const coupon = await prisma.coupon.findUnique({
      where: { code: code.toUpperCase().trim() },
      include: { customer: { select: { email: true } } },
    });

    if (!coupon || !coupon.active) {
      return res.json({ valid: false, error: "Cupón inválido o inactivo" });
    }

    // Vencimiento
    if (coupon.expiresAt && new Date() > new Date(coupon.expiresAt)) {
      return res.json({ valid: false, error: "El cupón ya venció" });
    }

    // Compra mínima
    if (coupon.minPurchase && subtotal < coupon.minPurchase) {
      return res.json({
        valid: false,
        error: `El cupón requiere una compra mínima de $${coupon.minPurchase.toLocaleString("es-AR")}`,
      });
    }

    // Cupón personal: solo para el cliente asignado
    if (coupon.customerId && coupon.customer) {
      if (!customerEmail || coupon.customer.email.toLowerCase() !== customerEmail.toLowerCase()) {
        return res.json({ valid: false, error: "Este cupón no es válido para tu cuenta" });
      }
    }

    // Usos totales máximos
    if (coupon.maxUses !== null && coupon.maxUses !== undefined) {
      const totalUsages = await prisma.couponUsage.count({ where: { couponId: coupon.id } });
      if (totalUsages >= coupon.maxUses) {
        return res.json({ valid: false, error: "El cupón alcanzó su límite de usos" });
      }
    }

    // Usos por cliente/email
    if (coupon.maxUsesPerCustomer !== null && coupon.maxUsesPerCustomer !== undefined && customerEmail) {
      const customerUsages = await prisma.couponUsage.count({
        where: { couponId: coupon.id, customerEmail: customerEmail.toLowerCase() },
      });
      if (customerUsages >= coupon.maxUsesPerCustomer) {
        return res.json({ valid: false, error: "Ya usaste este cupón el máximo de veces permitido" });
      }
    }

    const discountAmount = calcDiscount(coupon, subtotal);
    const finalTotal = Math.max(0, subtotal - discountAmount);

    return res.json({
      valid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        description: coupon.description,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
      },
      discountAmount,
      finalTotal,
    });
  } catch (err) {
    console.error("validateCoupon error:", err);
    res.status(500).json({ valid: false, error: "Error al validar el cupón" });
  }
}

// ── GET /api/coupons — Listar todos (admin) ───────────────────────────────────
async function getCoupons(req, res) {
  try {
    const coupons = await prisma.coupon.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        _count: { select: { usages: true } },
      },
    });
    res.json(coupons);
  } catch (err) {
    console.error("getCoupons error:", err);
    res.status(500).json({ error: "Error al obtener cupones" });
  }
}

// ── POST /api/coupons — Crear cupón (admin) ───────────────────────────────────
async function createCoupon(req, res) {
  try {
    const {
      code, description, discountType, discountValue,
      minPurchase, maxUses, maxUsesPerCustomer,
      expiresAt, customerId, active,
    } = req.body;

    if (!code || discountValue === undefined || discountValue === null) {
      return res.status(400).json({ error: "Código y valor de descuento son requeridos" });
    }

    const coupon = await prisma.coupon.create({
      data: {
        code: code.toUpperCase().trim(),
        description: description || null,
        discountType: discountType === "FIXED" ? "FIXED" : "PERCENTAGE",
        discountValue: parseFloat(discountValue),
        minPurchase: minPurchase ? parseFloat(minPurchase) : null,
        maxUses: maxUses ? parseInt(maxUses) : null,
        maxUsesPerCustomer: maxUsesPerCustomer ? parseInt(maxUsesPerCustomer) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        customerId: customerId ? parseInt(customerId) : null,
        active: active !== false && active !== "false",
      },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        _count: { select: { usages: true } },
      },
    });

    res.status(201).json(coupon);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(400).json({ error: "Ya existe un cupón con ese código" });
    }
    console.error("createCoupon error:", err);
    res.status(500).json({ error: "Error al crear el cupón" });
  }
}

// ── PATCH /api/coupons/:id — Actualizar cupón (admin) ────────────────────────
async function updateCoupon(req, res) {
  try {
    const { id } = req.params;
    const {
      code, description, discountType, discountValue,
      minPurchase, maxUses, maxUsesPerCustomer,
      expiresAt, customerId, active,
    } = req.body;

    const existing = await prisma.coupon.findUnique({ where: { id: parseInt(id) } });
    if (!existing) return res.status(404).json({ error: "Cupón no encontrado" });

    const coupon = await prisma.coupon.update({
      where: { id: parseInt(id) },
      data: {
        code: code ? code.toUpperCase().trim() : existing.code,
        description: description !== undefined ? (description || null) : existing.description,
        discountType: discountType ? (discountType === "FIXED" ? "FIXED" : "PERCENTAGE") : existing.discountType,
        discountValue: discountValue !== undefined ? parseFloat(discountValue) : existing.discountValue,
        minPurchase: minPurchase !== undefined ? (minPurchase ? parseFloat(minPurchase) : null) : existing.minPurchase,
        maxUses: maxUses !== undefined ? (maxUses ? parseInt(maxUses) : null) : existing.maxUses,
        maxUsesPerCustomer: maxUsesPerCustomer !== undefined
          ? (maxUsesPerCustomer ? parseInt(maxUsesPerCustomer) : null)
          : existing.maxUsesPerCustomer,
        expiresAt: expiresAt !== undefined ? (expiresAt ? new Date(expiresAt) : null) : existing.expiresAt,
        customerId: customerId !== undefined ? (customerId ? parseInt(customerId) : null) : existing.customerId,
        active: active !== undefined ? (active === true || active === "true") : existing.active,
      },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        _count: { select: { usages: true } },
      },
    });

    res.json(coupon);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(400).json({ error: "Ya existe un cupón con ese código" });
    }
    console.error("updateCoupon error:", err);
    res.status(500).json({ error: "Error al actualizar el cupón" });
  }
}

// ── GET /api/coupons/:id/usages — Ver usos de un cupón (admin) ───────────────
async function getCouponUsages(req, res) {
  try {
    const { id } = req.params;
    const usages = await prisma.couponUsage.findMany({
      where: { couponId: parseInt(id) },
      orderBy: { usedAt: "desc" },
      include: {
        order: { select: { id: true, total: true, couponDiscount: true, paymentMethod: true, status: true } },
      },
    });
    res.json(usages);
  } catch (err) {
    console.error("getCouponUsages error:", err);
    res.status(500).json({ error: "Error al obtener usos del cupón" });
  }
}

// ── DELETE /api/coupons/:id — Eliminar cupón (admin) ─────────────────────────
async function deleteCoupon(req, res) {
  try {
    const { id } = req.params;
    await prisma.coupon.delete({ where: { id: parseInt(id) } });
    res.json({ ok: true });
  } catch (err) {
    console.error("deleteCoupon error:", err);
    res.status(500).json({ error: "Error al eliminar el cupón" });
  }
}

module.exports = { validateCoupon, getCoupons, createCoupon, updateCoupon, deleteCoupon, getCouponUsages };

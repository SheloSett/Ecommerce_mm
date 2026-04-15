const { PrismaClient } = require("@prisma/client");
const { sendReturnRequestConfirmation, sendReturnRequestApproved, sendReturnRequestRejected } = require("../services/email.service");

const prisma = new PrismaClient();

// ─── CLIENTE: Buscar pedidos por email (para usuarios sin cuenta) ─────────────
// GET /api/returns/lookup?email=...
// Devuelve las órdenes APPROVED del email indicado donde:
//   - Si el pedido tiene fulfillmentStatus="ENTREGADO": el updatedAt debe tener menos de 10 días.
//   - Si el pedido NO tiene fulfillmentStatus="ENTREGADO": el createdAt debe tener menos de 10 días
//     (no sabemos cuándo se entregó, así que usamos la fecha de creación como referencia conservadora).
// Esta lógica replica la ventana legal de arrepentimiento (Ley 24.240 — 10 días desde recepción).
async function lookupOrdersByEmail(req, res) {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "El email es requerido." });

  // Límite: hace 10 días calendario desde ahora
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

  try {
    // Traemos todos los pedidos APPROVED del cliente para luego filtrar en JS,
    // ya que la condición OR ("entregado + updatedAt" / "no entregado + createdAt")
    // es más clara así que con un Prisma OR anidado.
    const orders = await prisma.order.findMany({
      where: {
        customerEmail: { equals: email, mode: "insensitive" },
        status: { in: ["APPROVED"] },
        paymentMethod: { not: "COTIZACION" },
      },
      include: {
        items: { include: { product: { select: { name: true, images: true } } } },
        returnRequests: { select: { id: true, status: true, createdAt: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Filtrar: solo los que están dentro de los 10 días según su estado logístico
    const filtered = orders.filter((o) => {
      if (o.fulfillmentStatus === "ENTREGADO") {
        // Contamos los 10 días desde la última actualización (cuando se marcó ENTREGADO)
        return new Date(o.updatedAt) >= tenDaysAgo;
      }
      // Sin fecha de entrega conocida: usamos createdAt como proxy conservador
      return new Date(o.createdAt) >= tenDaysAgo;
    });

    res.json(filtered);
  } catch (err) {
    console.error("lookupOrdersByEmail:", err);
    res.status(500).json({ error: "Error al buscar pedidos." });
  }
}

// ─── CLIENTE: Crear solicitud de arrepentimiento ──────────────────────────────
// POST /api/returns
// Body: { customerName, customerEmail, customerPhone, reason }
// orderId es opcional: el cliente puede incluir el nro. de pedido en el campo reason.
async function createReturnRequest(req, res) {
  const { customerName, customerEmail, customerPhone, reason } = req.body;
  const customerId = req.user?.id || null;

  if (!customerName?.trim() || !customerEmail?.trim() || !reason?.trim()) {
    return res.status(400).json({ error: "Nombre, email y mensaje son obligatorios." });
  }
  if (reason.trim().length < 10) {
    return res.status(400).json({ error: "El mensaje debe tener al menos 10 caracteres." });
  }

  try {
    const returnRequest = await prisma.returnRequest.create({
      data: {
        customerId,
        customerName:  customerName.trim(),
        customerEmail: customerEmail.trim().toLowerCase(),
        customerPhone: customerPhone?.trim() || null,
        reason:        reason.trim(),
      },
    });

    // Enviar email de confirmación al cliente (no bloqueante)
    sendReturnRequestConfirmation(returnRequest.customerEmail, returnRequest.customerName, returnRequest)
      .catch((e) => console.error("Email confirmación devolución:", e));

    res.status(201).json(returnRequest);
  } catch (err) {
    console.error("createReturnRequest:", err);
    res.status(500).json({ error: "Error al crear la solicitud." });
  }
}

// ─── CLIENTE: Listar sus propias solicitudes ──────────────────────────────────
// GET /api/returns/my  (requiere customer auth)
async function getMyReturnRequests(req, res) {
  try {
    const requests = await prisma.returnRequest.findMany({
      where: { customerEmail: { equals: req.user.email, mode: "insensitive" } },
      include: {
        order: {
          select: { id: true, total: true, createdAt: true, customerName: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(requests);
  } catch (err) {
    console.error("getMyReturnRequests:", err);
    res.status(500).json({ error: "Error al obtener solicitudes." });
  }
}

// ─── ADMIN: Listar todas las solicitudes ─────────────────────────────────────
// GET /api/returns  (requiere admin auth)
async function getAllReturnRequests(req, res) {
  const { status } = req.query;
  try {
    const where = status ? { status } : {};
    const requests = await prisma.returnRequest.findMany({
      where,
      include: {
        order: {
          select: {
            id: true,
            total: true,
            createdAt: true,
            paymentMethod: true,
            items: { include: { product: { select: { name: true, images: true } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(requests);
  } catch (err) {
    console.error("getAllReturnRequests:", err);
    res.status(500).json({ error: "Error al obtener solicitudes." });
  }
}

// ─── ADMIN: Aprobar o rechazar solicitud ──────────────────────────────────────
// PATCH /api/returns/:id/status  (requiere admin auth)
// Body: { status: "APPROVED" | "REJECTED", adminNotes }
async function updateReturnRequestStatus(req, res) {
  const { id } = req.params;
  const { status, adminNotes } = req.body;

  if (!["APPROVED", "REJECTED"].includes(status)) {
    return res.status(400).json({ error: "Estado inválido. Debe ser APPROVED o REJECTED." });
  }
  if (status === "APPROVED" && !adminNotes?.trim()) {
    return res.status(400).json({ error: "Las instrucciones de devolución son obligatorias al aprobar." });
  }
  if (status === "REJECTED" && !adminNotes?.trim()) {
    return res.status(400).json({ error: "El motivo de rechazo es obligatorio." });
  }

  try {
    const returnRequest = await prisma.returnRequest.update({
      where: { id: parseInt(id) },
      data: {
        status,
        adminNotes: adminNotes?.trim() || null,
      },
      include: {
        order: {
          select: {
            id: true,
            total: true,
            items: { include: { product: { select: { name: true } } } },
          },
        },
      },
    });

    // Enviar email según resolución (no bloqueante)
    if (status === "APPROVED") {
      sendReturnRequestApproved(returnRequest.customerEmail, returnRequest.customerName, returnRequest)
        .catch((e) => console.error("Email aprobación devolución:", e));
    } else {
      sendReturnRequestRejected(returnRequest.customerEmail, returnRequest.customerName, returnRequest)
        .catch((e) => console.error("Email rechazo devolución:", e));
    }

    res.json(returnRequest);
  } catch (err) {
    console.error("updateReturnRequestStatus:", err);
    if (err.code === "P2025") return res.status(404).json({ error: "Solicitud no encontrada." });
    res.status(500).json({ error: "Error al actualizar la solicitud." });
  }
}

module.exports = {
  lookupOrdersByEmail,
  createReturnRequest,
  getMyReturnRequests,
  getAllReturnRequests,
  updateReturnRequestStatus,
};

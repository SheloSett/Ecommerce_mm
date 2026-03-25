const { PrismaClient } = require("@prisma/client");
const { sendMayoristaRequestEmail, sendMayoristaApprovedEmail, sendMayoristaRejectedEmail } = require("../services/email.service");

const prisma = new PrismaClient();

// POST /api/mayorista-requests - el cliente MINORISTA envía una solicitud
async function createRequest(req, res) {
  try {
    const { id: customerId } = req.user;
    const { message } = req.body;

    // Solo clientes MINORISTA pueden solicitar
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return res.status(404).json({ error: "Cliente no encontrado" });

    if (customer.type === "MAYORISTA") {
      return res.status(400).json({ error: "Ya sos cliente mayorista" });
    }

    // Verificar que no tenga una solicitud PENDIENTE activa
    const existing = await prisma.mayoristaRequest.findFirst({
      where: { customerId, status: "PENDING" },
    });
    if (existing) {
      return res.status(409).json({ error: "Ya tenés una solicitud pendiente de revisión" });
    }

    const request = await prisma.mayoristaRequest.create({
      data: { customerId, message: message?.trim() || null },
    });

    // Enviar notificación al admin por email (no bloquea si falla)
    await sendMayoristaRequestEmail({
      customerName:  customer.name,
      customerEmail: customer.email,
      message:       message?.trim() || null,
    });

    res.status(201).json(request);
  } catch (err) {
    console.error("CreateMayoristaRequest error:", err);
    res.status(500).json({ error: "Error al enviar la solicitud" });
  }
}

// GET /api/mayorista-requests/my - el cliente consulta su solicitud activa
async function getMyRequest(req, res) {
  try {
    const { id: customerId } = req.user;

    // Devuelve la solicitud más reciente (puede ser PENDING, APPROVED o REJECTED)
    const request = await prisma.mayoristaRequest.findFirst({
      where: { customerId },
      orderBy: { createdAt: "desc" },
    });

    res.json(request || null);
  } catch (err) {
    console.error("GetMyRequest error:", err);
    res.status(500).json({ error: "Error al obtener la solicitud" });
  }
}

// GET /api/mayorista-requests - admin lista todas las solicitudes
async function getAll(req, res) {
  try {
    const { status } = req.query;

    const where = {};
    if (status) where.status = status;

    const requests = await prisma.mayoristaRequest.findMany({
      where,
      include: {
        customer: {
          select: { id: true, name: true, email: true, phone: true, company: true, type: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(requests);
  } catch (err) {
    console.error("GetAllMayoristaRequests error:", err);
    res.status(500).json({ error: "Error al obtener solicitudes" });
  }
}

// PATCH /api/mayorista-requests/:id/approve - admin aprueba: cambia tipo del cliente a MAYORISTA
async function approveRequest(req, res) {
  try {
    const { id } = req.params;

    const request = await prisma.mayoristaRequest.findUnique({
      where: { id: parseInt(id) },
      include: { customer: true },
    });
    if (!request) return res.status(404).json({ error: "Solicitud no encontrada" });
    if (request.status !== "PENDING") {
      return res.status(400).json({ error: "La solicitud ya fue procesada" });
    }

    // Aprobar solicitud y actualizar tipo del cliente en una transacción
    await prisma.$transaction([
      prisma.mayoristaRequest.update({
        where: { id: parseInt(id) },
        data: { status: "APPROVED" },
      }),
      prisma.customer.update({
        where: { id: request.customerId },
        data: { type: "MAYORISTA" },
      }),
    ]);

    // Notificar al cliente por email (no bloquea si falla)
    await sendMayoristaApprovedEmail({
      customerName:  request.customer.name,
      customerEmail: request.customer.email,
    });

    res.json({ message: `${request.customer.name} ahora es cliente Mayorista` });
  } catch (err) {
    console.error("ApproveRequest error:", err);
    res.status(500).json({ error: "Error al aprobar la solicitud" });
  }
}

// PATCH /api/mayorista-requests/:id/reject - admin rechaza la solicitud
async function rejectRequest(req, res) {
  try {
    const { id } = req.params;

    const request = await prisma.mayoristaRequest.findUnique({ where: { id: parseInt(id) } });
    if (!request) return res.status(404).json({ error: "Solicitud no encontrada" });
    if (request.status !== "PENDING") {
      return res.status(400).json({ error: "La solicitud ya fue procesada" });
    }

    const updated = await prisma.mayoristaRequest.update({
      where: { id: parseInt(id) },
      data: { status: "REJECTED" },
      include: { customer: true },
    });

    // Notificar al cliente por email (no bloquea si falla)
    await sendMayoristaRejectedEmail({
      customerName:  updated.customer.name,
      customerEmail: updated.customer.email,
    });

    res.json({ message: "Solicitud rechazada" });
  } catch (err) {
    console.error("RejectRequest error:", err);
    res.status(500).json({ error: "Error al rechazar la solicitud" });
  }
}

module.exports = { createRequest, getMyRequest, getAll, approveRequest, rejectRequest };

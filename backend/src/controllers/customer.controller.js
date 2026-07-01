const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { sendPasswordResetEmail } = require("../services/email.service");

const prisma = new PrismaClient();

// Registro público: cualquier visitante puede solicitar alta
async function register(req, res) {
  try {
    const { name, email, password, phone, cuit, documentType } = req.body;

    if (!name || !email || !password || !phone || !cuit) {
      return res.status(400).json({ error: "Nombre, email, contraseña, teléfono y número de documento son requeridos" });
    }

    // Validar que el tipo de documento sea uno de los permitidos
    const validDocTypes = ["DNI", "CUIT", "CUIL"];
    if (documentType && !validDocTypes.includes(documentType)) {
      return res.status(400).json({ error: "Tipo de documento inválido" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    }

    // Verifica si ya existe una cuenta con ese email
    const existing = await prisma.customer.findUnique({ where: { email } });
    if (existing) {
      // Antes: "Ya existe una solicitud con ese email" — ahora las cuentas se crean directas
      return res.status(409).json({ error: "Ya existe una cuenta con ese email" });
    }

    // Hashear la contraseña antes de guardar
    const hashedPassword = await bcrypt.hash(password, 10);

    const customer = await prisma.customer.create({
      // Antes la cuenta quedaba PENDING (default del schema) hasta que el admin la aprobara.
      // Ahora se crea APPROVED al instante: el registro minorista no requiere aprobación.
      // La aprobación del admin queda solo para el pedido de cuenta MAYORISTA (mayoristaRequest).
      // seenByAdmin: true para que no sume al badge "Clientes" del sidebar (no hay nada que aprobar).
      data: { name, email, password: hashedPassword, phone, cuit, documentType: documentType || null, status: "APPROVED", seenByAdmin: true },
    });

    // Devolver un token igual que el login, para que el front deje al usuario logueado al instante
    // (sin pedirle que vuelva a ingresar sus credenciales).
    const token = jwt.sign(
      { id: customer.id, email: customer.email, name: customer.name, type: customer.type, role: "CUSTOMER" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      // Antes: "Solicitud enviada. El administrador revisará tu registro y te contactará."
      message: "¡Cuenta creada! Ya podés comprar.",
      token,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        type: customer.type,
      },
    });
  } catch (err) {
    console.error("Register customer error:", err);
    res.status(500).json({ error: "Error al procesar el registro" });
  }
}

// Login de cliente: solo APPROVED puede ingresar
async function customerLogin(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email y contraseña son requeridos" });
    }

    const customer = await prisma.customer.findUnique({ where: { email } });

    if (!customer || !customer.password) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const valid = await bcrypt.compare(password, customer.password);
    if (!valid) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    // Solo clientes aprobados pueden ingresar
    if (customer.status === "PENDING") {
      return res.status(403).json({ error: "Tu cuenta está pendiente de aprobación por el administrador" });
    }
    if (customer.status === "REJECTED") {
      return res.status(403).json({ error: "Tu solicitud de registro fue rechazada. Contactá al administrador." });
    }

    const token = jwt.sign(
      { id: customer.id, email: customer.email, name: customer.name, type: customer.type, role: "CUSTOMER" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        type: customer.type,
      },
    });
  } catch (err) {
    console.error("Customer login error:", err);
    res.status(500).json({ error: "Error al iniciar sesión" });
  }
}

// Listar todos los clientes (solo admin)
async function getAll(req, res) {
  try {
    const { status, type, search } = req.query;

    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { name:  { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        // company eliminado del schema — no incluir
      ];
    }

    const customers = await prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.json(customers);
  } catch (err) {
    console.error("Get customers error:", err);
    res.status(500).json({ error: "Error al obtener clientes" });
  }
}

// Actualizar estado: PENDING → APPROVED o REJECTED (solo admin)
async function updateStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ["PENDING", "APPROVED", "REJECTED"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Estado inválido" });
    }

    const customer = await prisma.customer.findUnique({ where: { id: parseInt(id) } });
    if (!customer) return res.status(404).json({ error: "Cliente no encontrado" });

    const updated = await prisma.customer.update({
      where: { id: parseInt(id) },
      data: {
        status,
        // Solo actualiza notes si viene en el body
        ...(notes !== undefined && { notes }),
      },
    });

    res.json(updated);
  } catch (err) {
    console.error("Update customer status error:", err);
    res.status(500).json({ error: "Error al actualizar estado" });
  }
}

// Cambiar tipo: MAYORISTA o MINORISTA (solo admin)
async function updateType(req, res) {
  try {
    const { id } = req.params;
    const { type } = req.body;

    const validTypes = ["MAYORISTA", "MINORISTA"];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: "Tipo inválido" });
    }

    const customer = await prisma.customer.findUnique({ where: { id: parseInt(id) } });
    if (!customer) return res.status(404).json({ error: "Cliente no encontrado" });

    const updated = await prisma.customer.update({
      where: { id: parseInt(id) },
      data: { type },
    });

    res.json(updated);
  } catch (err) {
    console.error("Update customer type error:", err);
    res.status(500).json({ error: "Error al actualizar tipo" });
  }
}

// Editar datos completos del cliente (solo admin)
async function updateCustomer(req, res) {
  try {
    const { id } = req.params;
    const { email, name, phone, /* company, */ type, status, notes, password } = req.body; // company eliminado

    const customer = await prisma.customer.findUnique({ where: { id: parseInt(id) } });
    if (!customer) return res.status(404).json({ error: "Cliente no encontrado" });

    const validTypes    = ["MAYORISTA", "MINORISTA"];
    const validStatuses = ["PENDING", "APPROVED", "REJECTED"];

    if (type   && !validTypes.includes(type))     return res.status(400).json({ error: "Tipo inválido" });
    if (status && !validStatuses.includes(status)) return res.status(400).json({ error: "Estado inválido" });

    // Si el admin cambia el email, verificar que no esté en uso por otro cliente
    if (email && email.trim() && email.trim() !== customer.email) {
      const taken = await prisma.customer.findUnique({ where: { email: email.trim() } });
      if (taken) return res.status(409).json({ error: "Ese email ya está en uso por otro cliente" });
    }

    // Hashear la nueva contraseña solo si se proporcionó y tiene al menos 6 caracteres
    let hashedPassword;
    if (password && password.trim()) {
      if (password.trim().length < 6) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
      }
      hashedPassword = await bcrypt.hash(password.trim(), 10);
    }

    const updated = await prisma.customer.update({
      where: { id: parseInt(id) },
      data: {
        ...(email            !== undefined && email.trim() && { email: email.trim() }),
        ...(name             !== undefined && { name }),
        ...(phone            !== undefined && { phone }),
        // ...(company          !== undefined && { company }),  // Eliminado
        ...(type             !== undefined && { type }),
        ...(status           !== undefined && { status }),
        ...(notes            !== undefined && { notes }),
        ...(hashedPassword   !== undefined && { password: hashedPassword }),
      },
    });

    res.json(updated);
  } catch (err) {
    console.error("Update customer error:", err);
    res.status(500).json({ error: "Error al actualizar cliente" });
  }
}

// ─── Self-service: rutas que el propio cliente puede usar ────────────────────

// GET /api/customers/me - obtener perfil propio
async function getMe(req, res) {
  try {
    const { id } = req.user;
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return res.status(404).json({ error: "Cliente no encontrado" });

    res.json({
      id:                 customer.id,
      name:               customer.name,
      email:              customer.email,
      phone:              customer.phone,
      cuit:               customer.cuit,
      documentType:       customer.documentType,
      type:               customer.type,
      unsubscribeRestock: customer.unsubscribeRestock,
    });
  } catch (err) {
    console.error("GetMe error:", err);
    res.status(500).json({ error: "Error al obtener el perfil" });
  }
}

// PUT /api/customers/me - actualizar nombre y teléfono
async function updateMe(req, res) {
  try {
    const { id } = req.user;
    const { name, phone, cuit, documentType, unsubscribeRestock } = req.body;

    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ error: "El nombre no puede estar vacío" });
    }

    const validDocTypes = ["DNI", "CUIT", "CUIL"];

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        ...(name               !== undefined && { name: name.trim() }),
        ...(phone              !== undefined && { phone }),
        ...(cuit               !== undefined && { cuit: cuit.trim() || null }),
        ...(documentType       !== undefined && validDocTypes.includes(documentType) && { documentType }),
        ...(unsubscribeRestock !== undefined && { unsubscribeRestock: Boolean(unsubscribeRestock) }),
      },
    });

    res.json({
      id:                 updated.id,
      name:               updated.name,
      email:              updated.email,
      phone:              updated.phone,
      cuit:               updated.cuit,
      documentType:       updated.documentType,
      type:               updated.type,
      unsubscribeRestock: updated.unsubscribeRestock,
    });
  } catch (err) {
    console.error("UpdateMe error:", err);
    res.status(500).json({ error: "Error al actualizar el perfil" });
  }
}

// PUT /api/customers/me/email - cambiar email con confirmación de contraseña
async function changeEmail(req, res) {
  try {
    const { id } = req.user;
    const { newEmail, password } = req.body;

    if (!newEmail || !password) {
      return res.status(400).json({ error: "El nuevo email y la contraseña son requeridos" });
    }

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer || !customer.password) {
      return res.status(400).json({ error: "No se puede verificar la identidad del cliente" });
    }

    const valid = await bcrypt.compare(password, customer.password);
    if (!valid) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    // Verificar que el nuevo email no esté en uso
    const existing = await prisma.customer.findUnique({ where: { email: newEmail } });
    if (existing) {
      return res.status(409).json({ error: "Ese email ya está registrado" });
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: { email: newEmail },
    });

    // Emitir nuevo token con el email actualizado
    const token = jwt.sign(
      { id: updated.id, email: updated.email, name: updated.name, type: updated.type, role: "CUSTOMER" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      customer: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        type: updated.type,
        avatar: updated.avatar,
      },
    });
  } catch (err) {
    console.error("ChangeEmail error:", err);
    res.status(500).json({ error: "Error al cambiar el email" });
  }
}

// Eliminar cliente (solo admin)
async function deleteCustomer(req, res) {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({ where: { id: parseInt(id) } });
    if (!customer) return res.status(404).json({ error: "Cliente no encontrado" });

    await prisma.customer.delete({ where: { id: parseInt(id) } });
    res.json({ message: "Cliente eliminado correctamente" });
  } catch (err) {
    console.error("Delete customer error:", err);
    res.status(500).json({ error: "Error al eliminar cliente" });
  }
}

// ── Solicitudes de cambio de email ───────────────────────────────────────────

// POST /api/customers/me/email-change-request
// El cliente envía una solicitud de cambio de email (requiere autenticación de cliente)
async function requestEmailChange(req, res) {
  try {
    const { id } = req.user;
    const { newEmail, reason } = req.body;

    if (!newEmail || !newEmail.trim()) {
      return res.status(400).json({ error: "El nuevo email es requerido" });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: "El motivo del cambio es requerido" });
    }

    // Verificar que el nuevo email no esté registrado por otro cliente
    const existing = await prisma.customer.findUnique({ where: { email: newEmail.trim() } });
    if (existing) {
      return res.status(409).json({ error: "Ese email ya está registrado" });
    }

    // Si ya hay una solicitud PENDING del mismo cliente, la reemplazamos
    await prisma.emailChangeRequest.deleteMany({
      where: { customerId: id, status: "PENDING" },
    });

    const request = await prisma.emailChangeRequest.create({
      data: {
        customerId: id,
        newEmail:   newEmail.trim(),
        reason:     reason.trim(),
      },
    });

    res.status(201).json(request);
  } catch (err) {
    console.error("Error al crear solicitud de email:", err);
    res.status(500).json({ error: "Error al enviar la solicitud" });
  }
}

// GET /api/customers/me/email-change-request
// El cliente consulta su solicitud activa
async function getMyEmailChangeRequest(req, res) {
  try {
    const { id } = req.user;
    const request = await prisma.emailChangeRequest.findFirst({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
    });
    res.json(request || null);
  } catch (err) {
    console.error("Error al obtener solicitud:", err);
    res.status(500).json({ error: "Error al obtener solicitud" });
  }
}

// GET /api/customers/email-change-requests — admin: listar todas
async function getAllEmailChangeRequests(req, res) {
  try {
    const requests = await prisma.emailChangeRequest.findMany({
      include: { customer: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(requests);
  } catch (err) {
    console.error("Error al listar solicitudes:", err);
    res.status(500).json({ error: "Error al listar solicitudes" });
  }
}

// PATCH /api/customers/email-change-requests/:id/approve — admin: aprobar
async function approveEmailChangeRequest(req, res) {
  try {
    const requestId = parseInt(req.params.id);
    const emailReq = await prisma.emailChangeRequest.findUnique({
      where: { id: requestId },
      include: { customer: true },
    });

    if (!emailReq) return res.status(404).json({ error: "Solicitud no encontrada" });
    if (emailReq.status !== "PENDING") {
      return res.status(400).json({ error: "La solicitud ya fue procesada" });
    }

    // Verificar que el nuevo email siga libre
    const taken = await prisma.customer.findUnique({ where: { email: emailReq.newEmail } });
    if (taken) {
      return res.status(409).json({ error: "El email solicitado ya está en uso" });
    }

    // Cambiar el email del cliente y marcar la solicitud como aprobada en una transacción
    await prisma.$transaction([
      prisma.customer.update({
        where: { id: emailReq.customerId },
        data: { email: emailReq.newEmail },
      }),
      prisma.emailChangeRequest.update({
        where: { id: requestId },
        data: { status: "APPROVED" },
      }),
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error("Error al aprobar solicitud:", err);
    res.status(500).json({ error: "Error al aprobar solicitud" });
  }
}

// PATCH /api/customers/email-change-requests/:id/reject — admin: rechazar
async function rejectEmailChangeRequest(req, res) {
  try {
    const requestId = parseInt(req.params.id);
    const { adminNotes } = req.body;

    const emailReq = await prisma.emailChangeRequest.findUnique({ where: { id: requestId } });
    if (!emailReq) return res.status(404).json({ error: "Solicitud no encontrada" });
    if (emailReq.status !== "PENDING") {
      return res.status(400).json({ error: "La solicitud ya fue procesada" });
    }

    await prisma.emailChangeRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED", adminNotes: adminNotes?.trim() || null },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Error al rechazar solicitud:", err);
    res.status(500).json({ error: "Error al rechazar solicitud" });
  }
}

// POST /api/customers/admin/create — Admin crea un cliente directamente (sin flujo de solicitud)
// A diferencia del registro público, el cliente queda APPROVED inmediatamente.
async function createCustomerAdmin(req, res) {
  try {
    const { name, email, password, phone, cuit, documentType, type } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Nombre y email son requeridos" });
    }

    // La contraseña ahora es obligatoria: el cliente debe poder loguearse desde
    // el momento que el admin lo crea (antes era opcional pero el cliente quedaba
    // sin poder ingresar hasta que pidiera reset por email).
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "La contraseña es requerida (mínimo 6 caracteres)" });
    }

    const existing = await prisma.customer.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "Ya existe un cliente con ese email" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const validTypes = ["MINORISTA", "MAYORISTA"];
    const customerType = validTypes.includes(type) ? type : "MINORISTA";

    const validDocTypes = ["DNI", "CUIT", "CUIL"];
    const customer = await prisma.customer.create({
      data: {
        name,
        email,
        password:     hashedPassword,
        phone:        phone        || null,
        cuit:         cuit         || null,
        documentType: documentType && validDocTypes.includes(documentType) ? documentType : null,
        type:         customerType,
        status:       "APPROVED", // El admin crea clientes ya aprobados
      },
    });

    res.status(201).json({
      id:        customer.id,
      name:      customer.name,
      email:     customer.email,
      phone:     customer.phone,
      type:      customer.type,
      status:    customer.status,
      createdAt: customer.createdAt,
    });
  } catch (err) {
    console.error("createCustomerAdmin error:", err);
    res.status(500).json({ error: "Error al crear el cliente" });
  }
}

// PATCH /api/customers/:id/seen — marcar cliente como visto por el admin
async function markCustomerSeen(req, res) {
  try {
    await prisma.customer.update({ where: { id: parseInt(req.params.id) }, data: { seenByAdmin: true } });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Error al marcar como visto" }); }
}

// POST /api/customers/forgot-password — solicitar reset de contraseña por email
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email requerido" });

    // Siempre responder 200 para no revelar si el email existe en el sistema
    const customer = await prisma.customer.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (customer && customer.status === "APPROVED") {
      const token = crypto.randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
      await prisma.customer.update({
        where: { id: customer.id },
        data: { resetToken: token, resetTokenExpiry: expiry },
      });
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const resetUrl = `${frontendUrl}/reset-password/${token}`;
      sendPasswordResetEmail(customer, resetUrl).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("forgotPassword error:", err);
    res.status(500).json({ error: "Error al procesar la solicitud" });
  }
}

// POST /api/customers/reset-password — establecer nueva contraseña con token del email
async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: "Datos incompletos" });
    if (newPassword.length < 6) return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });

    const customer = await prisma.customer.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: { gt: new Date() },
      },
    });
    if (!customer) return res.status(400).json({ error: "El enlace expiró o no es válido. Solicitá uno nuevo." });

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.customer.update({
      where: { id: customer.id },
      data: { password: hashed, resetToken: null, resetTokenExpiry: null },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("resetPassword error:", err);
    res.status(500).json({ error: "Error al restablecer la contraseña" });
  }
}

// PUT /api/customers/me/password — cambiar contraseña estando logueado
async function changePassword(req, res) {
  try {
    const customerId = req.user.id;
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: "Datos incompletos" });
    if (newPassword.length < 6) return res.status(400).json({ error: "La nueva contraseña debe tener al menos 6 caracteres" });

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || !customer.password) return res.status(400).json({ error: "No se pudo verificar la contraseña actual" });

    const valid = await bcrypt.compare(currentPassword, customer.password);
    if (!valid) return res.status(401).json({ error: "La contraseña actual es incorrecta" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.customer.update({ where: { id: customerId }, data: { password: hashed } });

    res.json({ ok: true });
  } catch (err) {
    console.error("changePassword error:", err);
    res.status(500).json({ error: "Error al cambiar la contraseña" });
  }
}

module.exports = {
  register, customerLogin, getAll, updateStatus, updateType, updateCustomer, deleteCustomer,
  getMe, updateMe,
  requestEmailChange, getMyEmailChangeRequest,
  getAllEmailChangeRequests, approveEmailChangeRequest, rejectEmailChangeRequest,
  createCustomerAdmin, markCustomerSeen,
  forgotPassword, resetPassword, changePassword,
};

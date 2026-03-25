const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const prisma = new PrismaClient();

// Registro público: cualquier visitante puede solicitar alta
async function register(req, res) {
  try {
    const { name, email, password, phone, company } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Nombre, email y contraseña son requeridos" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    }

    // Verifica si ya existe una solicitud con ese email
    const existing = await prisma.customer.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "Ya existe una solicitud con ese email" });
    }

    // Hashear la contraseña antes de guardar
    const hashedPassword = await bcrypt.hash(password, 10);

    const customer = await prisma.customer.create({
      data: { name, email, password: hashedPassword, phone, company },
    });

    res.status(201).json({
      message: "Solicitud enviada. El administrador revisará tu registro y te contactará.",
      customer: { id: customer.id, name: customer.name, email: customer.email },
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
        phone: customer.phone,   // incluido para que persista en localStorage al reloguearse
        avatar: customer.avatar, // incluido para que persista en localStorage al reloguearse
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
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { company: { contains: search, mode: "insensitive" } },
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
    const { name, phone, company, type, status, notes } = req.body;

    const customer = await prisma.customer.findUnique({ where: { id: parseInt(id) } });
    if (!customer) return res.status(404).json({ error: "Cliente no encontrado" });

    const validTypes    = ["MAYORISTA", "MINORISTA"];
    const validStatuses = ["PENDING", "APPROVED", "REJECTED"];

    if (type   && !validTypes.includes(type))     return res.status(400).json({ error: "Tipo inválido" });
    if (status && !validStatuses.includes(status)) return res.status(400).json({ error: "Estado inválido" });

    const updated = await prisma.customer.update({
      where: { id: parseInt(id) },
      data: {
        ...(name    !== undefined && { name }),
        ...(phone   !== undefined && { phone }),
        ...(company !== undefined && { company }),
        ...(type    !== undefined && { type }),
        ...(status  !== undefined && { status }),
        ...(notes   !== undefined && { notes }),
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
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      company: customer.company,
      type: customer.type,
      avatar: customer.avatar,
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
    const { name, phone } = req.body;

    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ error: "El nombre no puede estar vacío" });
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        ...(name  !== undefined && { name: name.trim() }),
        ...(phone !== undefined && { phone }),
      },
    });

    res.json({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      type: updated.type,
      avatar: updated.avatar,
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

// POST /api/customers/me/avatar - subir foto de perfil
async function uploadAvatar(req, res) {
  try {
    const { id } = req.user;

    if (!req.file) {
      return res.status(400).json({ error: "No se proporcionó ninguna imagen" });
    }

    const avatarUrl = `/uploads/${req.file.filename}`;

    const updated = await prisma.customer.update({
      where: { id },
      data: { avatar: avatarUrl },
    });

    res.json({ avatar: updated.avatar });
  } catch (err) {
    console.error("UploadAvatar error:", err);
    res.status(500).json({ error: "Error al subir la imagen" });
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

module.exports = { register, customerLogin, getAll, updateStatus, updateType, updateCustomer, deleteCustomer, getMe, updateMe, changeEmail, uploadAvatar };

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

// Lista todos los admins (role ADMIN, excluye SUPERADMIN)
async function listAdmins(req, res) {
  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true, email: true, name: true, permissions: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(admins);
  } catch (err) {
    console.error("listAdmins error:", err);
    res.status(500).json({ error: "Error al obtener admins" });
  }
}

// Crea un admin nuevo con permisos seleccionados
async function createAdmin(req, res) {
  try {
    const { email, password, name, permissions } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email y contraseña son requeridos" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return res.status(400).json({ error: "Ya existe un usuario con ese email" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const admin = await prisma.user.create({
      data: {
        email,
        password: hashed,
        name: name || null,
        role: "ADMIN",
        permissions: Array.isArray(permissions) ? permissions : [],
      },
      select: { id: true, email: true, name: true, permissions: true, createdAt: true },
    });

    res.status(201).json(admin);
  } catch (err) {
    console.error("createAdmin error:", err);
    res.status(500).json({ error: "Error al crear admin" });
  }
}

// Edita name, email o permisos de un admin (no puede tocar SUPERADMIN)
async function updateAdmin(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { name, email, permissions } = req.body;

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ error: "Admin no encontrado" });
    if (target.role === "SUPERADMIN") {
      return res.status(403).json({ error: "No se puede editar al SUPERADMIN desde aquí" });
    }

    if (email && email !== target.email) {
      const exists = await prisma.user.findFirst({ where: { email, NOT: { id } } });
      if (exists) return res.status(400).json({ error: "Ese email ya está en uso" });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(email && { email }),
        ...(Array.isArray(permissions) && { permissions }),
      },
      select: { id: true, email: true, name: true, permissions: true, createdAt: true },
    });

    res.json(updated);
  } catch (err) {
    console.error("updateAdmin error:", err);
    res.status(500).json({ error: "Error al actualizar admin" });
  }
}

// Elimina un admin (no puede eliminar SUPERADMIN)
async function deleteAdmin(req, res) {
  try {
    const id = parseInt(req.params.id);

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ error: "Admin no encontrado" });
    if (target.role === "SUPERADMIN") {
      return res.status(403).json({ error: "No se puede eliminar al SUPERADMIN" });
    }

    await prisma.user.delete({ where: { id } });
    res.json({ message: "Admin eliminado correctamente" });
  } catch (err) {
    console.error("deleteAdmin error:", err);
    res.status(500).json({ error: "Error al eliminar admin" });
  }
}

// Resetea la contraseña de un admin
async function resetPassword(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ error: "Admin no encontrado" });
    if (target.role === "SUPERADMIN") {
      return res.status(403).json({ error: "No se puede resetear la contraseña del SUPERADMIN desde aquí" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id }, data: { password: hashed } });

    res.json({ message: "Contraseña reseteada correctamente" });
  } catch (err) {
    console.error("resetPassword error:", err);
    res.status(500).json({ error: "Error al resetear contraseña" });
  }
}

module.exports = { listAdmins, createAdmin, updateAdmin, deleteAdmin, resetPassword };

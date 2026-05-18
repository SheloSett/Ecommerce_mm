const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { loginLimiter } = require("../middleware/loginLimiter");

const prisma = new PrismaClient();

// Login: valida credenciales y devuelve JWT
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email y contraseña son requeridos" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name, permissions: user.permissions },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Login exitoso: resetear el contador de intentos para esta IP
    loginLimiter.resetKey(req.ip);

    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role, name: user.name, permissions: user.permissions },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Error al iniciar sesión" });
  }
}

// Cambiar contraseña del admin logueado
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Todos los campos son requeridos" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return res.status(400).json({ error: "Contraseña actual incorrecta" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashed },
    });

    res.json({ message: "Contraseña actualizada correctamente" });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ error: "Error al cambiar contraseña" });
  }
}

// Devuelve info del usuario autenticado (re-fetch para datos frescos)
async function me(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ id: user.id, email: user.email, role: user.role, name: user.name, permissions: user.permissions });
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ error: "Error al obtener datos del usuario" });
  }
}

// Actualiza el perfil del admin logueado (name y/o email)
async function updateProfile(req, res) {
  try {
    const { name, email } = req.body;

    if (email) {
      const exists = await prisma.user.findFirst({
        where: { email, NOT: { id: req.user.id } },
      });
      if (exists) {
        return res.status(400).json({ error: "Ese email ya está en uso por otro usuario" });
      }
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(name !== undefined && { name }),
        ...(email && { email }),
      },
    });

    res.json({ id: updated.id, email: updated.email, role: updated.role, name: updated.name, permissions: updated.permissions });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: "Error al actualizar perfil" });
  }
}

module.exports = { login, changePassword, me, updateProfile };

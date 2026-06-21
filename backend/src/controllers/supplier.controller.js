const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// GET /api/suppliers - Listar proveedores (admin)
// Incluye el conteo de productos asociados para mostrarlo en el panel.
async function getSuppliers(req, res) {
  try {
    const suppliers = await prisma.supplier.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { name: "asc" },
    });
    res.json(suppliers);
  } catch (err) {
    console.error("getSuppliers error:", err);
    res.status(500).json({ error: "Error al obtener proveedores" });
  }
}

// POST /api/suppliers - Crear proveedor (admin)
async function createSupplier(req, res) {
  try {
    // Antes solo se recibía `name`. Ahora también `street` (calle) y `phone` (teléfono), ambos opcionales.
    const { name, street, phone } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "El nombre del proveedor es requerido" });
    }

    const supplier = await prisma.supplier.create({
      // Antes: data: { name: name.trim() }
      data: {
        name: name.trim(),
        street: street?.trim() || null, // opcional
        phone:  phone?.trim()  || null, // opcional
      },
    });

    res.status(201).json(supplier);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(400).json({ error: "Ya existe un proveedor con ese nombre" });
    }
    console.error("createSupplier error:", err);
    res.status(500).json({ error: "Error al crear el proveedor" });
  }
}

// PUT /api/suppliers/:id - Editar proveedor (admin) — antes solo renombraba
async function updateSupplier(req, res) {
  try {
    const { id } = req.params;
    // Antes solo se recibía `name`. Ahora también `street` y `phone`.
    const { name, street, phone } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "El nombre del proveedor es requerido" });
    }

    const supplier = await prisma.supplier.update({
      where: { id: parseInt(id) },
      // Antes: data: { name: name.trim() }
      data: {
        name: name.trim(),
        street: street?.trim() || null, // opcional
        phone:  phone?.trim()  || null, // opcional
      },
    });

    res.json(supplier);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(400).json({ error: "Ya existe un proveedor con ese nombre" });
    }
    console.error("updateSupplier error:", err);
    res.status(500).json({ error: "Error al actualizar el proveedor" });
  }
}

// DELETE /api/suppliers/:id - Eliminar proveedor (admin)
// Gracias a onDelete: SetNull en Product.supplier, los productos quedan sin proveedor
// (no se borran). Aun así avisamos cuántos productos se desvincularán.
async function deleteSupplier(req, res) {
  try {
    const { id } = req.params;

    const existing = await prisma.supplier.findUnique({
      where: { id: parseInt(id) },
      include: { _count: { select: { products: true } } },
    });
    if (!existing) {
      return res.status(404).json({ error: "Proveedor no encontrado" });
    }

    await prisma.supplier.delete({ where: { id: parseInt(id) } });

    res.json({
      message: "Proveedor eliminado",
      unlinkedProducts: existing._count.products,
    });
  } catch (err) {
    console.error("deleteSupplier error:", err);
    res.status(500).json({ error: "Error al eliminar el proveedor" });
  }
}

module.exports = { getSuppliers, createSupplier, updateSupplier, deleteSupplier };

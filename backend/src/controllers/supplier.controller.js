const { PrismaClient } = require("@prisma/client");
const { geocodeAddress } = require("../utils/geocode");

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

// POST /api/suppliers/geocode - Ubicar direcciones en el mapa (admin)
// Body: { addresses: ["pasteur 288", "Av La Plata 744", ...] }
// Respuesta: { results: { "pasteur 288": { lat, lng, label } | null }, failed: [...] }
//   null   → no se encontró (mal escrita o fuera de CABA): hay que corregirla en Proveedores.
//   failed → no se pudo consultar (USIG caído o sin conexión): se puede reintentar.
// Lo usa la orden de compra para ordenar a los proveedores por recorrido. Ver utils/geocode.js.
async function geocodeAddresses(req, res) {
  const list = Array.isArray(req.body?.addresses) ? req.body.addresses : null;
  if (!list) {
    return res.status(400).json({ error: "addresses tiene que ser una lista de direcciones" });
  }
  // Sin repetidas y con techo: una orden de compra trae a lo sumo un puñado de proveedores.
  const unique = [...new Set(list.map((a) => String(a || "").trim()).filter(Boolean))].slice(0, 40);

  const results = {};
  const failed = [];
  await Promise.all(unique.map(async (address) => {
    try {
      results[address] = await geocodeAddress(address);
    } catch (err) {
      console.error(`geocodeAddresses "${address}":`, err.message);
      failed.push(address);
    }
  }));
  res.json({ results, failed });
}

module.exports = { getSuppliers, createSupplier, updateSupplier, deleteSupplier, geocodeAddresses };

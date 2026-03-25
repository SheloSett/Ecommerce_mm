const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Convierte un nombre a slug (ej: "Cables USB" → "cables-usb")
function toSlug(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Quita tildes
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

// GET /api/categories
// Retorna categorías de nivel superior con sus subcategorías anidadas
async function getCategories(req, res) {
  try {
    const categories = await prisma.category.findMany({
      where: { parentId: null }, // Solo categorías raíz (sin padre)
      include: {
        // Solo contar productos activos (publicados)
        _count: { select: { products: { where: { active: true } } } },
        // Incluir subcategorías con su conteo de productos activos
        children: {
          include: {
            _count: { select: { products: { where: { active: true } } } },
          },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    });

    // Agregar totalProducts: suma de productos propios + productos en subcategorías
    const withTotals = categories.map((cat) => {
      const ownCount = cat._count.products;
      const childrenCount = cat.children.reduce((sum, child) => sum + child._count.products, 0);
      return { ...cat, totalProducts: ownCount + childrenCount };
    });

    res.json(withTotals);
  } catch (err) {
    console.error("getCategories error:", err);
    res.status(500).json({ error: "Error al obtener categorías" });
  }
}

// POST /api/categories
// Acepta parentId opcional para crear una subcategoría
async function createCategory(req, res) {
  try {
    const { name, parentId } = req.body;

    if (!name) {
      return res.status(400).json({ error: "El nombre es requerido" });
    }

    const slug = toSlug(name);

    // Si se provee parentId, verificar que la categoría padre exista
    if (parentId) {
      const parent = await prisma.category.findUnique({ where: { id: parseInt(parentId) } });
      if (!parent) {
        return res.status(400).json({ error: "La categoría padre no existe" });
      }
      // No se permite anidar más de un nivel (subcategoría no puede tener hijos)
      if (parent.parentId !== null) {
        return res.status(400).json({ error: "No se puede crear una subcategoría de una subcategoría" });
      }
    }

    const category = await prisma.category.create({
      data: {
        name,
        slug,
        // parentId puede ser null (categoría raíz) o un entero (subcategoría)
        parentId: parentId ? parseInt(parentId) : null,
      },
    });

    res.status(201).json(category);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(400).json({ error: "Ya existe una categoría con ese nombre" });
    }
    console.error("createCategory error:", err);
    res.status(500).json({ error: "Error al crear la categoría" });
  }
}

// PUT /api/categories/:id
// Permite cambiar nombre y/o categoría padre
async function updateCategory(req, res) {
  try {
    const { id } = req.params;
    const { name, parentId } = req.body;

    if (!name) {
      return res.status(400).json({ error: "El nombre es requerido" });
    }

    // Evitar que una categoría se asigne a sí misma como padre
    if (parentId && parseInt(parentId) === parseInt(id)) {
      return res.status(400).json({ error: "Una categoría no puede ser su propio padre" });
    }

    // Si se provee parentId, verificar que exista y no sea subcategoría
    if (parentId) {
      const parent = await prisma.category.findUnique({ where: { id: parseInt(parentId) } });
      if (!parent) {
        return res.status(400).json({ error: "La categoría padre no existe" });
      }
      if (parent.parentId !== null) {
        return res.status(400).json({ error: "No se puede anidar más de un nivel" });
      }
    }

    const slug = toSlug(name);

    const category = await prisma.category.update({
      where: { id: parseInt(id) },
      data: {
        name,
        slug,
        // parentId: null elimina el padre (convierte en categoría raíz); número asigna padre
        parentId: parentId ? parseInt(parentId) : null,
      },
    });

    res.json(category);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(400).json({ error: "Ya existe una categoría con ese nombre" });
    }
    console.error("updateCategory error:", err);
    res.status(500).json({ error: "Error al actualizar la categoría" });
  }
}

// DELETE /api/categories/:id
async function deleteCategory(req, res) {
  try {
    const { id } = req.params;

    // Verificar que no tenga productos asociados
    const count = await prisma.product.count({ where: { categoryId: parseInt(id) } });
    if (count > 0) {
      return res.status(400).json({
        error: `No se puede eliminar: tiene ${count} producto(s) asociado(s). Primero reasigna o elimina los productos.`,
      });
    }

    // Verificar que no tenga subcategorías
    const childCount = await prisma.category.count({ where: { parentId: parseInt(id) } });
    if (childCount > 0) {
      return res.status(400).json({
        error: `No se puede eliminar: tiene ${childCount} subcategoría(s). Primero elimínalas.`,
      });
    }

    await prisma.category.delete({ where: { id: parseInt(id) } });

    res.json({ message: "Categoría eliminada" });
  } catch (err) {
    console.error("deleteCategory error:", err);
    res.status(500).json({ error: "Error al eliminar la categoría" });
  }
}

module.exports = { getCategories, createCategory, updateCategory, deleteCategory };

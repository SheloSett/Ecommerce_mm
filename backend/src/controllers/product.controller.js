const { PrismaClient } = require("@prisma/client");
const path = require("path");
const fs = require("fs");

const prisma = new PrismaClient();

// GET /api/products - Listar productos (con filtros opcionales)
async function getProducts(req, res) {
  try {
    const { category, search, featured, page = 1, limit = 20, active } = req.query;

    const where = {};

    // Solo mostrar activos en la tienda pública (admin puede ver todos)
    if (active !== undefined) {
      where.active = active === "true";
    } else {
      where.active = true; // Por defecto solo activos
    }

    if (category) {
      // Buscar la categoría por slug e incluir sus subcategorías
      const cat = await prisma.category.findUnique({
        where: { slug: category },
        include: { children: { select: { id: true } } },
      });
      if (cat) {
        // Si la categoría tiene hijos, incluir productos de ella Y de sus subcategorías
        const categoryIds = [cat.id, ...cat.children.map((c) => c.id)];
        where.categoryId = { in: categoryIds };
      } else {
        // Si no existe la categoría, devolver resultado vacío
        where.categoryId = -1;
      }
      // Comentado: filtrado anterior solo por slug exacto, no incluía subcategorías
      // where.category = { slug: category };
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    if (featured === "true") {
      where.featured = true;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { category: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: parseInt(limit),
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      products,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("getProducts error:", err);
    res.status(500).json({ error: "Error al obtener productos" });
  }
}

// GET /api/products/admin - Listar TODOS los productos para el admin (activos e inactivos)
async function getProductsAdmin(req, res) {
  try {
    const { category, search, page = 1, limit = 50, lowStock } = req.query;

    const where = {};

    // Filtro de quiebre de stock: productos donde stock <= stockBreak (y stockBreak está definido)
    if (lowStock === "true") {
      where.stockBreak  = { not: null };
      where.stockUnlimited = false;
      // Prisma no permite comparar dos columnas directamente en where, usamos rawQuery via $queryRaw
      // Lo resolvemos en memoria después del fetch con un límite alto
    }

    if (category) {
      where.category = { slug: category };
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Para lowStock: Prisma no soporta comparar dos columnas en where,
    // se trae todos los candidatos y se filtra en memoria
    if (lowStock === "true") {
      const candidates = await prisma.product.findMany({
        where,
        include: {
          category: {
            select: { id: true, name: true, slug: true, parent: { select: { id: true, name: true } } },
          },
        },
        orderBy: { stock: "asc" },
      });
      const filtered = candidates.filter((p) => p.stockBreak !== null && p.stock <= p.stockBreak);
      return res.json({
        products: filtered,
        pagination: { total: filtered.length, page: 1, limit: filtered.length, totalPages: 1 },
      });
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              // Incluir padre para mostrar el breadcrumb de categoría en el admin
              parent: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: parseInt(limit),
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      products,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("getProductsAdmin error:", err);
    res.status(500).json({ error: "Error al obtener productos" });
  }
}

// GET /api/products/:id - Obtener un producto por ID
async function getProduct(req, res) {
  try {
    const { id } = req.params;

    const product = await prisma.product.findUnique({
      where: { id: parseInt(id) },
      include: { category: true },
    });

    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    res.json(product);
  } catch (err) {
    console.error("getProduct error:", err);
    res.status(500).json({ error: "Error al obtener el producto" });
  }
}

// POST /api/products - Crear producto (admin)
async function createProduct(req, res) {
  try {
    const { name, description, price, cost, salePrice, wholesalePrice, wholesaleSalePrice, minQuantity, stock, stockUnlimited, stockBreak, sku, youtubeUrl, categoryId, featured, weight, length, width, height } = req.body;

    if (!name || !price || !cost) {
      return res.status(400).json({ error: "Nombre, precio y costo son requeridos" });
    }

    // Validar que salePrice minorista sea menor al precio normal
    if (salePrice && parseFloat(salePrice) >= parseFloat(price)) {
      return res.status(400).json({ error: "El precio de oferta minorista debe ser menor al precio minorista" });
    }

    // Validar que wholesaleSalePrice sea menor al precio mayorista
    if (wholesaleSalePrice && wholesalePrice && parseFloat(wholesaleSalePrice) >= parseFloat(wholesalePrice)) {
      return res.status(400).json({ error: "El precio de oferta mayorista debe ser menor al precio mayorista" });
    }

    // Procesar imágenes subidas
    const images = req.files
      ? req.files.map((f) => `/uploads/${f.filename}`)
      : [];

    const product = await prisma.product.create({
      data: {
        name,
        description: description || null,
        price: parseFloat(price),
        cost: cost ? parseFloat(cost) : null,
        salePrice: salePrice ? parseFloat(salePrice) : null,
        wholesalePrice: wholesalePrice ? parseFloat(wholesalePrice) : null,
        wholesaleSalePrice: wholesaleSalePrice ? parseFloat(wholesaleSalePrice) : null,
        minQuantity: minQuantity ? parseInt(minQuantity) : 1,
        stock: parseInt(stock) || 0,
        stockUnlimited: stockUnlimited === "true" || stockUnlimited === true,
        stockBreak: stockBreak ? parseInt(stockBreak) : null,
        sku: sku || null,
        youtubeUrl: youtubeUrl || null,
        weight: weight ? parseFloat(weight) : null,
        length: length ? parseFloat(length) : null,
        width:  width  ? parseFloat(width)  : null,
        height: height ? parseFloat(height) : null,
        categoryId: categoryId ? parseInt(categoryId) : null,
        featured: featured === "true" || featured === true,
        images,
      },
      include: { category: true },
    });

    res.status(201).json(product);
  } catch (err) {
    console.error("createProduct error:", err);
    res.status(500).json({ error: "Error al crear el producto" });
  }
}

// PUT /api/products/:id - Actualizar producto (admin)
async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const { name, description, price, cost, salePrice, wholesalePrice, wholesaleSalePrice, minQuantity, stock, stockUnlimited, stockBreak, sku, youtubeUrl, categoryId, featured, active, keepImages, weight, length, width, height } = req.body;

    const existing = await prisma.product.findUnique({ where: { id: parseInt(id) } });
    if (!existing) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    // Validar que el costo no se borre si ya tenía uno (campo obligatorio)
    if (cost !== undefined && cost === "") {
      return res.status(400).json({ error: "El costo es obligatorio" });
    }

    // Validar salePrice minorista contra el precio que quedará (el nuevo o el actual)
    const finalPrice = price ? parseFloat(price) : existing.price;
    if (salePrice && parseFloat(salePrice) >= finalPrice) {
      return res.status(400).json({ error: "El precio de oferta minorista debe ser menor al precio minorista" });
    }

    // Validar wholesaleSalePrice contra el precio mayorista que quedará
    const finalWholesalePrice = wholesalePrice ? parseFloat(wholesalePrice) : existing.wholesalePrice;
    if (wholesaleSalePrice && finalWholesalePrice && parseFloat(wholesaleSalePrice) >= finalWholesalePrice) {
      return res.status(400).json({ error: "El precio de oferta mayorista debe ser menor al precio mayorista" });
    }

    // Manejo de imágenes:
    // keepImages puede ser un array de URLs de imágenes que se quieren conservar
    let images = existing.images;

    if (req.files && req.files.length > 0) {
      const newImages = req.files.map((f) => `/uploads/${f.filename}`);

      // Si keepImages se envía, combinamos las que se quieren conservar con las nuevas
      if (keepImages) {
        const toKeep = Array.isArray(keepImages) ? keepImages : [keepImages];
        images = [...toKeep, ...newImages];
      } else {
        // Si no se especifica keepImages, reemplazamos todas con las nuevas
        images = newImages;
      }
    } else if (keepImages !== undefined) {
      // Solo conservar las imágenes especificadas (sin nuevas imágenes subidas)
      images = Array.isArray(keepImages) ? keepImages : [keepImages];
    }

    const product = await prisma.product.update({
      where: { id: parseInt(id) },
      data: {
        name: name || existing.name,
        description: description !== undefined ? description : existing.description,
        price: price ? parseFloat(price) : existing.price,
        cost: cost !== undefined ? (cost ? parseFloat(cost) : null) : existing.cost,
        salePrice: salePrice !== undefined ? (salePrice ? parseFloat(salePrice) : null) : existing.salePrice,
        wholesalePrice: wholesalePrice !== undefined ? (wholesalePrice ? parseFloat(wholesalePrice) : null) : existing.wholesalePrice,
        wholesaleSalePrice: wholesaleSalePrice !== undefined ? (wholesaleSalePrice ? parseFloat(wholesaleSalePrice) : null) : existing.wholesaleSalePrice,
        minQuantity: minQuantity !== undefined ? parseInt(minQuantity) : existing.minQuantity,
        stock: stock !== undefined ? parseInt(stock) : existing.stock,
        stockUnlimited: stockUnlimited !== undefined ? (stockUnlimited === "true" || stockUnlimited === true) : existing.stockUnlimited,
        stockBreak: stockBreak !== undefined ? (stockBreak ? parseInt(stockBreak) : null) : existing.stockBreak,
        sku: sku !== undefined ? (sku || null) : existing.sku,
        youtubeUrl: youtubeUrl !== undefined ? (youtubeUrl || null) : existing.youtubeUrl,
        weight: weight !== undefined ? (weight ? parseFloat(weight) : null) : existing.weight,
        length: length !== undefined ? (length ? parseFloat(length) : null) : existing.length,
        width:  width  !== undefined ? (width  ? parseFloat(width)  : null) : existing.width,
        height: height !== undefined ? (height ? parseFloat(height) : null) : existing.height,
        categoryId: categoryId !== undefined ? (categoryId ? parseInt(categoryId) : null) : existing.categoryId,
        featured: featured !== undefined ? (featured === "true" || featured === true) : existing.featured,
        active: active !== undefined ? (active === "true" || active === true) : existing.active,
        images,
      },
      include: { category: true },
    });

    res.json(product);
  } catch (err) {
    console.error("updateProduct error:", err);
    res.status(500).json({ error: "Error al actualizar el producto" });
  }
}

// PATCH /api/products/:id/quick - Actualización rápida de campos simples sin multipart (admin)
// Usado desde la edición rápida en el listado de productos (precio, stock, precios especiales, estado)
async function quickUpdateProduct(req, res) {
  try {
    const { id } = req.params;
    const { price, salePrice, wholesalePrice, wholesaleSalePrice, minQuantity, stock, stockUnlimited, active } = req.body;

    const existing = await prisma.product.findUnique({ where: { id: parseInt(id) } });
    if (!existing) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    const updateData = {};

    // Determinar el precio efectivo (el nuevo o el existente) para validar salePrice
    const effectivePrice = price !== undefined ? parseFloat(price) : existing.price;

    // Validar que salePrice minorista sea menor al precio minorista
    if (salePrice !== undefined && salePrice) {
      const salePriceNum = parseFloat(salePrice);
      if (isNaN(salePriceNum) || salePriceNum >= effectivePrice) {
        return res.status(400).json({ error: "El precio de oferta minorista debe ser menor al precio minorista" });
      }
    }

    // Validar que wholesaleSalePrice sea menor al precio mayorista
    const effectiveWholesalePrice = wholesalePrice !== undefined ? parseFloat(wholesalePrice) : existing.wholesalePrice;
    if (wholesaleSalePrice !== undefined && wholesaleSalePrice && effectiveWholesalePrice) {
      const wsNum = parseFloat(wholesaleSalePrice);
      if (isNaN(wsNum) || wsNum >= effectiveWholesalePrice) {
        return res.status(400).json({ error: "El precio de oferta mayorista debe ser menor al precio mayorista" });
      }
    }

    // Solo actualizar los campos que vienen en el body
    if (price !== undefined) updateData.price = effectivePrice;
    if (salePrice !== undefined) updateData.salePrice = salePrice ? parseFloat(salePrice) : null;
    if (wholesalePrice !== undefined) updateData.wholesalePrice = wholesalePrice ? parseFloat(wholesalePrice) : null;
    if (wholesaleSalePrice !== undefined) updateData.wholesaleSalePrice = wholesaleSalePrice ? parseFloat(wholesaleSalePrice) : null;
    if (minQuantity !== undefined) updateData.minQuantity = parseInt(minQuantity) || 1;
    if (stock !== undefined) {
      const newStock = parseInt(stock) || 0;
      updateData.stock = newStock;
      const isUnlimited = stockUnlimited !== undefined ? Boolean(stockUnlimited) : existing.stockUnlimited;
      if (active === undefined) {
        if (newStock <= 0 && !isUnlimited) {
          // Si el admin pone stock en 0 (y no es ilimitado), despublicar automáticamente
          updateData.active = false;
        } else if (newStock > 0 && !existing.active) {
          // Si el admin agrega stock y el producto estaba despublicado, republicar automáticamente
          updateData.active = true;
        }
      }
    }
    if (stockUnlimited !== undefined) updateData.stockUnlimited = Boolean(stockUnlimited);
    if (active !== undefined) updateData.active = Boolean(active);

    const product = await prisma.product.update({
      where: { id: parseInt(id) },
      data: updateData,
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
            parent: { select: { id: true, name: true } },
          },
        },
      },
    });

    res.json(product);
  } catch (err) {
    console.error("quickUpdateProduct error:", err);
    res.status(500).json({ error: "Error al actualizar el producto" });
  }
}

// DELETE /api/products/:id - Eliminar producto (admin)
async function deleteProduct(req, res) {
  try {
    const { id } = req.params;

    const existing = await prisma.product.findUnique({ where: { id: parseInt(id) } });
    if (!existing) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    // Eliminar archivos de imagen del disco
    for (const imgPath of existing.images) {
      const fullPath = path.join(__dirname, "../../", imgPath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }

    await prisma.product.delete({ where: { id: parseInt(id) } });

    res.json({ message: "Producto eliminado correctamente" });
  } catch (err) {
    console.error("deleteProduct error:", err);
    res.status(500).json({ error: "Error al eliminar el producto" });
  }
}

module.exports = {
  getProducts,
  getProductsAdmin,
  getProduct,
  createProduct,
  updateProduct,
  quickUpdateProduct,
  deleteProduct,
};

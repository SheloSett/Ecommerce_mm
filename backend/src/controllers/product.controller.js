const { PrismaClient } = require("@prisma/client");
const path = require("path");
const fs = require("fs");

const prisma = new PrismaClient();

// GET /api/products - Listar productos (con filtros opcionales)
async function getProducts(req, res) {
  try {
    const { category, search, featured, page = 1, limit = 20, active, visibleFor, onSale, lowStock, homeOffer, attrs } = req.query;

    const where = {};

    // Solo mostrar activos en la tienda pública (admin puede ver todos)
    if (active !== undefined) {
      where.active = active === "true";
    } else {
      where.active = true; // Por defecto solo activos
    }

    // Filtrar por visibilidad según el tipo de cliente:
    // MAYORISTA → ve productos con visibility MAYORISTA o AMBOS
    // MINORISTA (o sin sesión) → ve productos con visibility MINORISTA o AMBOS
    if (visibleFor === "MAYORISTA" || visibleFor === "MINORISTA") {
      where.visibility = { in: ["AMBOS", visibleFor] };
    }
    // Si no se envía visibleFor, no se filtra (admin o legacy)

    // Filtrado automático por stock: stock físico es único — mismo filtro para ambos canales.
    // Sin variantes: requiere product.stock > 0. Con variantes: requiere alguna variante con stock.
    if (visibleFor === "MAYORISTA" || visibleFor === "MINORISTA") {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { stockUnlimited: true },
            // Sin variantes activas: verificar product.stock directo
            { AND: [{ variants: { none: { active: true } } }, { stock: { gt: 0 } }] },
            // Con variantes: al menos una variante activa con stock
            { variants: { some: { active: true, OR: [{ stockUnlimited: true }, { stock: { gt: 0 } }] } } },
          ],
        },
      ];
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
        // Antes: where.categoryId = { in: categoryIds } — ahora M2M
        where.categories = { some: { id: { in: categoryIds } } };
      } else {
        // Si no existe la categoría, devolver vacío forzando condición imposible
        // Antes: where.categoryId = -1
        where.categories = { every: { id: -1 }, some: {} };
      }
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku:  { contains: search, mode: "insensitive" } },
      ];
    }

    if (featured === "true") {
      where.featured = true;
    }

    // homeOffer=true filtra los productos marcados como "Oferta en Home" (campo onSale booleano)
    if (homeOffer === "true") {
      where.onSale = true;
    }

    // Filtrar solo productos en oferta según el tipo de cliente:
    // - MAYORISTA → solo productos con wholesaleSalePrice (oferta mayorista)
    // - MINORISTA (o sin sesión) → solo productos con salePrice (oferta minorista)
    // Antes filtraba con OR (cualquier oferta), lo que mostraba ofertas minoristas a mayoristas y viceversa.
    if (onSale === "true") {
      if (visibleFor === "MAYORISTA") {
        where.wholesaleSalePrice = { not: null };
      } else {
        where.salePrice = { not: null };
      }
    }

    // Filtrar productos con pocas unidades: stock > 0 y <= 5, no ilimitado
    if (lowStock === "true") {
      where.stockUnlimited = false;
      where.stock = { gt: 0, lte: 5 };
    }

    // Filtrar por atributos de variante: attrs = JSON { "Color": ["Negro", "Rojo"], "Longitud": ["2m"] }
    // AND entre atributos distintos, OR entre valores del mismo atributo
    if (attrs) {
      try {
        const attrsObj = JSON.parse(attrs);
        const attrConditions = Object.entries(attrsObj)
          .filter(([, values]) => Array.isArray(values) && values.length > 0)
          .map(([name, values]) => ({
            attributes: { some: { name, values: { some: { value: { in: values } } } } },
          }));
        if (attrConditions.length > 0) {
          where.AND = [...(where.AND || []), ...attrConditions];
        }
      } catch (e) {
        // JSON inválido, se ignora
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        // Antes: include: { category: { select: { id, name, slug } } }
        include: {
          categories: { select: { id: true, name: true, slug: true } },
          // _count.variants: cuántas variantes activas tiene, para que el frontend
          // muestre modal "seleccioná variantes" en lugar de agregar directo desde la card
          _count: { select: { variants: { where: { active: true } } } },
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
      // Antes: where.category = { slug: category }
      where.categories = { some: { slug: category } };
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
        // Antes: include: { category: { select: { ... } } }
        include: {
          categories: {
            include: { parent: { select: { id: true, name: true } } },
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
        // Antes: include: { category: { select: { id, name, slug, parent: ... } } }
        include: {
          categories: {
            include: { parent: { select: { id: true, name: true } } },
          },
          _count: { select: { variants: { where: { active: true } } } },
          attributes: {
            include: { values: { orderBy: { position: "asc" } } },
            orderBy: { position: "asc" },
          },
          // Variantes con SKU: solo las que tienen SKU definido, para búsqueda en registro de compras
          variants: {
            where: { sku: { not: null } },
            select: { id: true, sku: true, stock: true, stockUnlimited: true, combination: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: parseInt(limit),
      }),
      prisma.product.count({ where }),
    ]);

    // Unidades vendidas por producto (solo órdenes APPROVED)
    const productIds = products.map((p) => p.id);
    let soldMap = {};
    let variantStockMap = {};
    if (productIds.length > 0) {
      // Prisma no tiene @map en orderId/productId → columnas en DB son camelCase
      const soldStats = await prisma.$queryRaw`
        SELECT oi."productId", COALESCE(SUM(oi.quantity), 0)::int AS "totalSold"
        FROM order_items oi
        JOIN orders o ON oi."orderId" = o.id
        WHERE o.status = 'APPROVED'
          AND oi."productId" = ANY(${productIds})
        GROUP BY oi."productId"
      `;
      soldStats.forEach((r) => { soldMap[r.productId] = r.totalSold; });

      // Stock efectivo de variantes: si alguna es ilimitada → -1 (ilimitado), sino suma de stocks activos
      const variantStockStats = await prisma.$queryRaw`
        SELECT "productId",
          CASE WHEN bool_or("stockUnlimited") THEN -1
               ELSE COALESCE(SUM(stock), 0)::int
          END AS "variantStock"
        FROM product_variants
        WHERE active = true
          AND "productId" = ANY(${productIds})
        GROUP BY "productId"
      `;
      variantStockStats.forEach((r) => { variantStockMap[r.productId] = r.variantStock; });
    }

    res.json({
      products: products.map((p) => ({
        ...p,
        totalSold: soldMap[p.id] || 0,
        // variantStockTotal: -1 = ilimitado, número = suma de stocks de variantes activas, null = sin variantes
        variantStockTotal: variantStockMap[p.id] !== undefined ? variantStockMap[p.id] : null,
      })),
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
      // Antes: include: { category: true }
      include: {
        categories: { include: { parent: { select: { id: true, name: true, slug: true } } } },
        attributes: { include: { values: { orderBy: { position: "asc" } } }, orderBy: { position: "asc" } },
        variants:   { where: { active: true }, orderBy: { createdAt: "asc" } },
      },
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

// ── Helpers de módulo ─────────────────────────────────────────────────────────

// Parsea price tiers desde FormData (JSON string o array).
// allowUndefined=true → si raw es undefined devuelve undefined (para update, "no tocar").
// allowUndefined=false → si raw es undefined/vacío devuelve null (para create).
function parseTiers(raw, allowUndefined = false) {
  if (raw === undefined) return allowUndefined ? undefined : null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
        .map((t) => ({ minQty: parseInt(t.minQty), price: parseFloat(t.price) }))
        .filter((t) => t.minQty > 0 && t.price > 0)
        .sort((a, b) => a.minQty - b.minQty);
    }
  } catch (_) { /* JSON inválido → tratar como vacío */ }
  return null;
}

// Máximo de productos permitidos por cada sección del carrusel de la home.
// Si al marcar un producto ya se alcanzó el límite, el más viejo se desmarca.
const CAROUSEL_LIMIT = 20;

async function enforceCarouselLimit(field, excludeId = null) {
  const where = { [field]: true };
  if (excludeId) where.id = { not: excludeId };

  // Trae exactamente CAROUSEL_LIMIT productos ordenados del más viejo al más nuevo.
  // Si la lista tiene CAROUSEL_LIMIT elementos, significa que ya se alcanzó el tope
  // y el primero (índice 0) es el candidato a desmarcar — sin necesidad de count() separado.
  const items = await prisma.product.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: CAROUSEL_LIMIT,
    select: { id: true, name: true },
  });

  if (items.length >= CAROUSEL_LIMIT) {
    const oldest = items[0];
    await prisma.product.update({
      where: { id: oldest.id },
      data: { [field]: false },
    });
    console.log(`[carousel] Se quitó ${field} del producto ID ${oldest.id} ("${oldest.name}") por alcanzar el límite de ${CAROUSEL_LIMIT}.`);
  }
}

// POST /api/products - Crear producto (admin)
async function createProduct(req, res) {
  try {
    const { name, description, price, cost, ivaRate, salePrice, wholesalePrice, wholesaleSalePrice, minQuantity, stock, stockUnlimited, stockBreak, priceTiers: priceTiersRaw, wholesalePriceTiers: wholesalePriceTiersRaw, sku, youtubeUrl, featured, onSale, hotSeller, hotSellerThreshold, weight, length, width, height, visibility } = req.body;
    const priceTiers = parseTiers(priceTiersRaw);
    const wholesalePriceTiers = parseTiers(wholesalePriceTiersRaw);
    // categoryIds puede venir como string (1 sola) o array (varias) desde FormData
    // Antes: categoryId (single) — ahora: categoryIds (multiple)
    const rawCategoryIds = req.body.categoryIds;
    const categoryIds = rawCategoryIds
      ? (Array.isArray(rawCategoryIds) ? rawCategoryIds : [rawCategoryIds])
          .map((id) => parseInt(id)).filter(Boolean)
      : [];

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

    // Si se activa featured u onSale, verificar que no se supere el límite del carrusel.
    // Si ya hay 20, el más viejo se desmarca automáticamente antes de insertar el nuevo.
    if (featured === "true" || featured === true) await enforceCarouselLimit("featured");
    if (onSale === "true" || onSale === true)     await enforceCarouselLimit("onSale");

    const product = await prisma.product.create({
      data: {
        name,
        description: description || null,
        price: parseFloat(price),
        cost: cost ? parseFloat(cost) : null,
        ivaRate: ivaRate ? parseFloat(ivaRate) : 21,
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
        // Antes: categoryId: categoryId ? parseInt(categoryId) : null
        categories: categoryIds.length > 0 ? { connect: categoryIds.map((id) => ({ id })) } : undefined,
        featured: featured === "true" || featured === true,
        // onSale: marca el producto para la sección "Ofertas" de la home
        onSale: onSale === "true" || onSale === true,
        hotSeller: hotSeller === "true" || hotSeller === true,
        // En creación totalSold=0 → el threshold nunca se cumple de entrada
        hotSellerThreshold: hotSellerThreshold ? parseInt(hotSellerThreshold) : null,
        visibility: ["AMBOS", "MAYORISTA", "MINORISTA"].includes(visibility) ? visibility : "AMBOS",
        priceTiers: priceTiers || undefined,
        wholesalePriceTiers: wholesalePriceTiers || undefined,
        images,
      },
      include: { categories: { include: { parent: { select: { id: true, name: true } } } } },
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
    const { name, description, price, cost, ivaRate, salePrice, wholesalePrice, wholesaleSalePrice, minQuantity, stock, stockUnlimited, stockBreak, priceTiers: priceTiersRaw, wholesalePriceTiers: wholesalePriceTiersRaw, sku, youtubeUrl, featured, onSale, hotSeller, hotSellerThreshold, active, keepImages, weight, length, width, height, visibility } = req.body;
    // undefined → no tocar (allowUndefined=true); null/[] → borrar tiers
    const priceTiersUpdate = parseTiers(priceTiersRaw, true);
    const wholesalePriceTiersUpdate = parseTiers(wholesalePriceTiersRaw, true);
    // categoryIds puede venir como string (1 sola) o array (varias) desde FormData
    // Antes: categoryId (single) — ahora: categoryIds (multiple)
    const rawCategoryIds = req.body.categoryIds;
    const categoryIds = rawCategoryIds !== undefined
      ? (Array.isArray(rawCategoryIds) ? rawCategoryIds : [rawCategoryIds])
          .map((id) => parseInt(id)).filter(Boolean)
      : null; // null significa "no vino en el body, no tocar"

    const existing = await prisma.product.findUnique({ where: { id: parseInt(id) } });
    if (!existing) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    // Para productos con variantes el stock es la suma de las variantes — no se edita directamente
    const productHasActiveVariants = await prisma.productVariant.count({
      where: { productId: parseInt(id), active: true },
    }) > 0;

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

    // Si se activa featured u onSale (y antes no lo estaba), verificar límite del carrusel.
    // Se ejecutan en paralelo si ambas condiciones aplican — excludeId evita contar el producto actual.
    const isFeaturedNow = featured !== undefined ? (featured === "true" || featured === true) : existing.featured;
    const isOnSaleNow   = onSale   !== undefined ? (onSale   === "true" || onSale   === true) : existing.onSale;
    const numericId = parseInt(id);
    const carouselChecks = [];
    if (isFeaturedNow && !existing.featured) carouselChecks.push(enforceCarouselLimit("featured", numericId));
    if (isOnSaleNow   && !existing.onSale)   carouselChecks.push(enforceCarouselLimit("onSale",   numericId));
    if (carouselChecks.length) await Promise.all(carouselChecks);

    const product = await prisma.product.update({
      where: { id: parseInt(id) },
      data: {
        name: name || existing.name,
        description: description !== undefined ? description : existing.description,
        price: price ? parseFloat(price) : existing.price,
        cost: cost !== undefined ? (cost ? parseFloat(cost) : null) : existing.cost,
        ivaRate: ivaRate !== undefined ? parseFloat(ivaRate) : existing.ivaRate,
        salePrice: salePrice !== undefined ? (salePrice ? parseFloat(salePrice) : null) : existing.salePrice,
        wholesalePrice: wholesalePrice !== undefined ? (wholesalePrice ? parseFloat(wholesalePrice) : null) : existing.wholesalePrice,
        wholesaleSalePrice: wholesaleSalePrice !== undefined ? (wholesaleSalePrice ? parseFloat(wholesaleSalePrice) : null) : existing.wholesaleSalePrice,
        minQuantity: minQuantity !== undefined ? parseInt(minQuantity) : existing.minQuantity,
        // Si tiene variantes activas, el stock es la suma de las variantes — ignorar el campo stock del body
        stock: (!productHasActiveVariants && stock !== undefined) ? parseInt(stock) : existing.stock,
        stockUnlimited: (!productHasActiveVariants && stockUnlimited !== undefined) ? (stockUnlimited === "true" || stockUnlimited === true) : existing.stockUnlimited,
        stockBreak: stockBreak !== undefined ? (stockBreak ? parseInt(stockBreak) : null) : existing.stockBreak,
        sku: sku !== undefined ? (sku || null) : existing.sku,
        youtubeUrl: youtubeUrl !== undefined ? (youtubeUrl || null) : existing.youtubeUrl,
        weight: weight !== undefined ? (weight ? parseFloat(weight) : null) : existing.weight,
        length: length !== undefined ? (length ? parseFloat(length) : null) : existing.length,
        width:  width  !== undefined ? (width  ? parseFloat(width)  : null) : existing.width,
        height: height !== undefined ? (height ? parseFloat(height) : null) : existing.height,
        // Antes: categoryId: categoryId !== undefined ? (categoryId ? parseInt(categoryId) : null) : existing.categoryId
        // set: reemplaza todas las categorías por las nuevas; si no vino en el body, no tocar
        ...(categoryIds !== null ? { categories: { set: categoryIds.map((id) => ({ id })) } } : {}),
        featured: featured !== undefined ? (featured === "true" || featured === true) : existing.featured,
        // onSale: si viene en el body lo actualiza, sino conserva el valor actual
        onSale: onSale !== undefined ? (onSale === "true" || onSale === true) : existing.onSale,
        // hotSellerThreshold: umbral de unidades vendidas para activar automáticamente el badge de fuego
        hotSellerThreshold: hotSellerThreshold !== undefined
          ? (hotSellerThreshold ? parseInt(hotSellerThreshold) : null)
          : existing.hotSellerThreshold,
        // hotSeller: manual override O auto-activado si totalSold >= hotSellerThreshold al guardar
        hotSeller: await (async () => {
          const newThreshold = hotSellerThreshold !== undefined
            ? (hotSellerThreshold ? parseInt(hotSellerThreshold) : null)
            : existing.hotSellerThreshold;
          if (newThreshold != null) {
            // Calcular totalSold actual para evaluar si ya supera el umbral
            const [{ totalSold }] = await prisma.$queryRaw`
              SELECT COALESCE(SUM(oi.quantity), 0)::int AS "totalSold"
              FROM order_items oi JOIN orders o ON oi."orderId" = o.id
              WHERE o.status = 'APPROVED' AND oi."productId" = ${parseInt(id)}
            `;
            return totalSold >= newThreshold;
          }
          // Sin threshold: usar el valor manual enviado o el existente
          return hotSeller !== undefined ? (hotSeller === "true" || hotSeller === true) : existing.hotSeller;
        })(),
        active: active !== undefined ? (active === "true" || active === true) : existing.active,
        visibility: ["AMBOS", "MAYORISTA", "MINORISTA"].includes(visibility) ? visibility : existing.visibility,
        ...(priceTiersUpdate !== undefined ? { priceTiers: priceTiersUpdate } : {}),
        ...(wholesalePriceTiersUpdate !== undefined ? { wholesalePriceTiers: wholesalePriceTiersUpdate } : {}),
        images,
      },
      include: { categories: { include: { parent: { select: { id: true, name: true } } } } },
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

    // Para productos con variantes el stock es la suma de las variantes — no se edita directamente
    const qHasActiveVariants = await prisma.productVariant.count({
      where: { productId: parseInt(id), active: true },
    }) > 0;

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
    // Para productos con variantes, el stock es la suma de las variantes — no se actualiza directamente
    if (stock !== undefined && !qHasActiveVariants) {
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
    if (stockUnlimited !== undefined && !qHasActiveVariants) updateData.stockUnlimited = Boolean(stockUnlimited);
    if (active !== undefined) updateData.active = Boolean(active);

    const product = await prisma.product.update({
      where: { id: parseInt(id) },
      data: updateData,
      // Antes: include: { category: { select: { id, name, slug, parent } } }
      include: {
        categories: {
          include: { parent: { select: { id: true, name: true } } },
        },
      },
    });

    if (stock !== undefined || stockUnlimited !== undefined) {
      await syncProductVisibility(parseInt(id));
    }

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

// POST /api/products/bulk-price-adjust
// Aplica un ajuste porcentual a los precios de todos los productos activos.
// Body: { type: "MINORISTA" | "MAYORISTA" | "AMBOS", percent: number }
// percent positivo = aumento, negativo = reducción. Ej: 10 = +10%, -5 = -5%.
async function bulkPriceAdjust(req, res) {
  try {
    const { type, percent } = req.body;

    if (!["MINORISTA", "MAYORISTA", "AMBOS"].includes(type)) {
      return res.status(400).json({ error: "type debe ser MINORISTA, MAYORISTA o AMBOS" });
    }
    const pct = parseFloat(percent);
    if (isNaN(pct) || pct === 0) {
      return res.status(400).json({ error: "percent debe ser un número distinto de 0" });
    }

    const factor = 1 + pct / 100;
    const round2 = (v) => Math.round(v * factor * 100) / 100;
    const adjustTiers = (tiers) =>
      Array.isArray(tiers)
        ? tiers.map((t) => ({ ...t, price: Math.round(parseFloat(t.price) * factor * 100) / 100 }))
        : tiers;

    const products = await prisma.product.findMany({
      select: {
        id: true,
        price: true,
        salePrice: true,
        wholesalePrice: true,
        wholesaleSalePrice: true,
        priceTiers: true,
        wholesalePriceTiers: true,
      },
    });

    const updates = products.map((p) => {
      const data = {};
      const applyMinorista = type === "MINORISTA" || type === "AMBOS";
      const applyMayorista = type === "MAYORISTA" || type === "AMBOS";

      if (applyMinorista) {
        data.price     = round2(p.price);
        if (p.salePrice != null)  data.salePrice  = round2(p.salePrice);
        if (p.priceTiers)         data.priceTiers = adjustTiers(p.priceTiers);
      }
      if (applyMayorista) {
        if (p.wholesalePrice != null)     data.wholesalePrice     = round2(p.wholesalePrice);
        if (p.wholesaleSalePrice != null) data.wholesaleSalePrice = round2(p.wholesaleSalePrice);
        if (p.wholesalePriceTiers)        data.wholesalePriceTiers = adjustTiers(p.wholesalePriceTiers);
      }

      return prisma.product.update({ where: { id: p.id }, data });
    });

    await prisma.$transaction(updates);

    res.json({ ok: true, updated: products.length });
  } catch (err) {
    console.error("bulkPriceAdjust error:", err);
    res.status(500).json({ error: "Error al ajustar precios" });
  }
}

// GET /api/products/facets - Atributos únicos de los productos del conjunto actual (para filtros dinámicos)
// Acepta los mismos filtros que getProducts (category, search, visibleFor, onSale, lowStock) pero devuelve
// los atributos agregados en lugar de productos paginados.
async function getProductFacets(req, res) {
  try {
    const { category, search, visibleFor, onSale, lowStock } = req.query;

    const where = { active: true };

    if (visibleFor === "MAYORISTA" || visibleFor === "MINORISTA") {
      where.visibility = { in: ["AMBOS", visibleFor] };
    }

    if (category) {
      const cat = await prisma.category.findUnique({
        where: { slug: category },
        include: { children: { select: { id: true } } },
      });
      if (cat) {
        const categoryIds = [cat.id, ...cat.children.map((c) => c.id)];
        where.categories = { some: { id: { in: categoryIds } } };
      } else {
        where.categories = { every: { id: -1 }, some: {} };
      }
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku:  { contains: search, mode: "insensitive" } },
      ];
    }

    if (onSale === "true") {
      if (visibleFor === "MAYORISTA") {
        where.wholesaleSalePrice = { not: null };
      } else {
        where.salePrice = { not: null };
      }
    }

    if (lowStock === "true") {
      where.stockUnlimited = false;
      where.stock = { gt: 0, lte: 5 };
    }

    const products = await prisma.product.findMany({
      where,
      select: {
        attributes: {
          select: {
            name: true,
            position: true,
            values: { select: { value: true }, orderBy: { position: "asc" } },
          },
          orderBy: { position: "asc" },
        },
      },
    });

    // Agregar atributos únicos a través de todos los productos del conjunto
    const facetMap = new Map(); // name -> { values: Set, position: number }
    for (const product of products) {
      for (const attr of product.attributes) {
        if (!facetMap.has(attr.name)) {
          facetMap.set(attr.name, { values: new Set(), position: attr.position });
        }
        for (const val of attr.values) {
          facetMap.get(attr.name).values.add(val.value);
        }
      }
    }

    const facets = Array.from(facetMap.entries())
      .sort((a, b) => a[1].position - b[1].position)
      .map(([name, { values }]) => ({ name, values: Array.from(values) }));

    res.json({ facets });
  } catch (err) {
    console.error("getProductFacets error:", err);
    res.status(500).json({ error: "Error al obtener facetas" });
  }
}

// ── Visibilidad automática según stock ───────────────────────────────────────
// Para productos con variantes: activa/desactiva el producto según si hay stock en alguna variante.
// Para productos sin variantes: el active lo gestiona directamente el cambio de product.stock.
// Ya no toca el campo visibility (MAYORISTA/MINORISTA/AMBOS) — ese lo controla el admin.
async function syncProductVisibility(productId, tx = prisma) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    include: { variants: { where: { active: true }, select: { stock: true, stockUnlimited: true } } },
  });
  if (!product || product.variants.length === 0) return;

  const hasStock = product.variants.some((v) => v.stockUnlimited || v.stock > 0);
  if (!hasStock && product.active) {
    await tx.product.update({ where: { id: productId }, data: { active: false } });
  } else if (hasStock && !product.active) {
    await tx.product.update({ where: { id: productId }, data: { active: true } });
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
  bulkPriceAdjust,
  getProductFacets,
  syncProductVisibility,
};

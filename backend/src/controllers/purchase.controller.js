const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// GET /api/purchases — listar todas las compras con sus items
const getPurchases = async (req, res) => {
  try {
    const purchases = await prisma.purchase.findMany({
      include: { items: true },
      orderBy: { date: "desc" },
    });
    res.json(purchases);
  } catch (err) {
    console.error("Error al listar compras:", err);
    res.status(500).json({ error: "Error al listar compras" });
  }
};

// GET /api/purchases/:id — detalle de una compra
const getPurchaseById = async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const purchase = await prisma.purchase.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!purchase) return res.status(404).json({ error: "Compra no encontrada" });
    res.json(purchase);
  } catch (err) {
    console.error("Error al obtener compra:", err);
    res.status(500).json({ error: "Error al obtener compra" });
  }
};

// POST /api/purchases — registrar una nueva compra
// Body: { supplier, date, items: [{ sku?, productName, cost, quantity }] }
const createPurchase = async (req, res) => {
  const { supplier, date, items } = req.body;

  if (!supplier || !supplier.trim()) {
    return res.status(400).json({ error: "El proveedor es requerido" });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Debe incluir al menos un producto" });
  }

  try {
    const purchaseItems = [];

    for (const item of items) {
      const { sku, productName, cost, quantity } = item;
      const itemCost = parseFloat(cost);
      const itemQty  = parseInt(quantity);

      if (!productName || !productName.trim()) {
        return res.status(400).json({ error: "Todos los productos deben tener nombre" });
      }
      if (isNaN(itemCost) || itemCost < 0) {
        return res.status(400).json({ error: `Costo inválido en "${productName}"` });
      }
      if (isNaN(itemQty) || itemQty <= 0) {
        return res.status(400).json({ error: `Cantidad inválida en "${productName}"` });
      }

      let productId = null;

      // Si se ingresó un SKU, buscar primero en productos y luego en variantes
      if (sku && sku.trim()) {
        const skuTrim = sku.trim();

        // 1. Buscar por SKU de producto
        const existingProduct = await prisma.product.findFirst({
          where: { sku: skuTrim },
        });

        if (existingProduct) {
          // Sumar el stock del producto y recalcular costo promedio ponderado
          const oldStock = existingProduct.stock;
          const newStock = oldStock + itemQty;
          const oldCost  = existingProduct.cost || 0;
          const rawCost  = newStock > 0 ? (oldCost * oldStock + itemCost * itemQty) / newStock : itemCost;
          const newCost  = Math.ceil(rawCost * 100) / 100;

          await prisma.product.update({
            where: { id: existingProduct.id },
            data: { stock: newStock, cost: newCost },
          });

          productId = existingProduct.id;
        } else {
          // 2. Buscar por SKU de variante
          const existingVariant = await prisma.productVariant.findFirst({
            where: { sku: skuTrim },
            include: { product: { select: { id: true, cost: true } } },
          });

          if (existingVariant) {
            // Sumar stock a la variante específica
            const oldVariantStock = existingVariant.stock;
            const newVariantStock = oldVariantStock + itemQty;

            await prisma.productVariant.update({
              where: { id: existingVariant.id },
              data: { stock: newVariantStock },
            });

            // Actualizar costo promedio ponderado del producto padre
            const oldCost = existingVariant.product.cost || 0;
            const rawCost = newVariantStock > 0
              ? (oldCost * oldVariantStock + itemCost * itemQty) / newVariantStock
              : itemCost;
            const newCost = Math.ceil(rawCost * 100) / 100;

            await prisma.product.update({
              where: { id: existingVariant.product.id },
              data: { cost: newCost },
            });

            productId = existingVariant.product.id;
          }
        }
      }

      // Si no se encontró producto existente por SKU → crear producto nuevo inactivo
      // El admin deberá completar los datos (precio, categoría, etc.) y publicarlo
      if (productId === null) {
        const newProduct = await prisma.product.create({
          data: {
            name:   productName.trim(),
            price:  0,              // El admin lo completará antes de publicar
            cost:   itemCost,
            stock:  itemQty,
            active: false,          // Inactivo hasta que el admin lo configure
            sku:    sku?.trim() || null,
          },
        });
        productId = newProduct.id;
      }

      purchaseItems.push({
        sku:         sku?.trim() || null,
        productName: productName.trim(),
        cost:        itemCost,
        quantity:    itemQty,
        productId,
      });
    }

    // Crear el registro de compra con todos sus items
    const purchase = await prisma.purchase.create({
      data: {
        supplier: supplier.trim(),
        date:     date ? new Date(date) : new Date(),
        items: {
          create: purchaseItems,
        },
      },
      include: { items: true },
    });

    res.status(201).json(purchase);
  } catch (err) {
    console.error("Error al crear compra:", err);
    res.status(500).json({ error: "Error al crear compra" });
  }
};

module.exports = { getPurchases, getPurchaseById, createPurchase };

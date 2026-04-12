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

      // Si se ingresó un SKU, buscar si ya existe un producto con ese SKU
      if (sku && sku.trim()) {
        const existing = await prisma.product.findFirst({
          where: { sku: sku.trim() },
        });

        if (existing) {
          // Sumar el stock ingresado al stock actual
          const oldStock = existing.stock;
          const newStock = oldStock + itemQty;

          // Costo promedio ponderado:
          // nuevoCosto = (costoAnterior * stockAnterior + costoNuevo * cantidadNueva) / stockTotal
          const oldCost = existing.cost || 0;
          const rawCost = newStock > 0
            ? (oldCost * oldStock + itemCost * itemQty) / newStock
            : itemCost;
          // Redondear hacia arriba con 2 decimales
          const newCost = Math.ceil(rawCost * 100) / 100;

          await prisma.product.update({
            where: { id: existing.id },
            data: {
              stock: newStock,
              cost:  newCost,
            },
          });

          productId = existing.id;
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

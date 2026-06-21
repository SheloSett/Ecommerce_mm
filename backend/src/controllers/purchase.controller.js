const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
// Helper reutilizado para limpiar imágenes al auto-borrar productos creados por una compra.
const { deleteProductImages } = require("./product.controller");

// ──────────────────────────────────────────────────────────────────────────────
// Helpers compartidos para APLICAR / REVERTIR el efecto de un item de compra.
// Operan sobre un cliente de transacción (tx) para garantizar atomicidad y se
// reutilizan en createPurchase, updatePurchase y deletePurchase.
// ──────────────────────────────────────────────────────────────────────────────

// Redondeo del costo promedio ponderado — mismo criterio que la versión original (ceil a 2 decimales).
function roundCost(raw) {
  return Math.ceil(raw * 100) / 100;
}

// Aplica un item: busca por SKU (producto y luego variante), suma stock y recalcula el costo
// promedio ponderado; si el SKU no existe crea un producto nuevo inactivo. Devuelve el objeto a
// persistir como PurchaseItem, incluyendo el SNAPSHOT (prevCost/prevStock/variantId/
// prevVariantStock/createdProduct) que permite revertir la compra después.
//
// NOTA: esta es la misma lógica que antes estaba inline dentro de createPurchase; se extrajo a este
// helper para poder reutilizarla en la edición de compras y no duplicar el cálculo del promedio.
// `item` debe traer { sku, productName, cost (number), quantity (number), productId? }.
// `productId` es una PISTA opcional: en la EDICIÓN, una fila ya ligada a un producto la trae para
// reusar ese producto (y no crear un duplicado cuando no tiene SKU).
async function applyItemTx(tx, item) {
  const { sku, productName, cost: itemCost, quantity: itemQty } = item;
  const hintId = item.productId ? parseInt(item.productId) : null;

  let productId = null;
  let prevCost = null;
  let prevStock = null;
  let variantId = null;
  let prevVariantStock = null;
  let createdProduct = false;

  // Si se ingresó un SKU, buscar primero en productos y luego en variantes
  if (sku && sku.trim()) {
    const skuTrim = sku.trim();

    // 1. Buscar por SKU de producto
    const existingProduct = await tx.product.findFirst({ where: { sku: skuTrim } });

    if (existingProduct) {
      // Snapshot ANTES de modificar (para poder revertir)
      prevStock = existingProduct.stock;
      prevCost  = existingProduct.cost ?? null;

      // Sumar el stock del producto y recalcular costo promedio ponderado
      const oldStock = existingProduct.stock;
      const newStock = oldStock + itemQty;
      const oldCost  = existingProduct.cost || 0;
      const rawCost  = newStock > 0 ? (oldCost * oldStock + itemCost * itemQty) / newStock : itemCost;
      const newCost  = roundCost(rawCost);

      await tx.product.update({
        where: { id: existingProduct.id },
        data: { stock: newStock, cost: newCost },
      });

      productId = existingProduct.id;
    } else {
      // 2. Buscar por SKU de variante
      const existingVariant = await tx.productVariant.findFirst({
        where: { sku: skuTrim },
        include: { product: { select: { id: true, cost: true } } },
      });

      if (existingVariant) {
        // Snapshot ANTES de modificar
        variantId        = existingVariant.id;
        prevVariantStock = existingVariant.stock;
        prevCost         = existingVariant.product.cost ?? null;

        // Sumar stock a la variante específica
        const oldVariantStock = existingVariant.stock;
        const newVariantStock = oldVariantStock + itemQty;

        await tx.productVariant.update({
          where: { id: existingVariant.id },
          data: { stock: newVariantStock },
        });

        // Actualizar costo promedio ponderado del producto padre
        const oldCost = existingVariant.product.cost || 0;
        const rawCost = newVariantStock > 0
          ? (oldCost * oldVariantStock + itemCost * itemQty) / newVariantStock
          : itemCost;
        const newCost = roundCost(rawCost);

        await tx.product.update({
          where: { id: existingVariant.product.id },
          data: { cost: newCost },
        });

        productId = existingVariant.product.id;
      }
    }
  }

  // Si no hubo match por SKU pero la fila trae una pista de productId (edición de una línea ya ligada
  // a un producto, p.ej. un producto creado sin SKU) → reusar ese producto en vez de crear otro.
  if (productId === null && hintId) {
    const hinted = await tx.product.findUnique({ where: { id: hintId } });
    if (hinted) {
      prevStock = hinted.stock;
      prevCost  = hinted.cost ?? null;

      const oldStock = hinted.stock;
      const newStock = oldStock + itemQty;
      const oldCost  = hinted.cost || 0;
      const rawCost  = newStock > 0 ? (oldCost * oldStock + itemCost * itemQty) / newStock : itemCost;

      await tx.product.update({
        where: { id: hintId },
        data: { stock: newStock, cost: roundCost(rawCost) },
      });
      productId = hintId;
    }
  }

  // Si no se encontró producto existente por SKU → crear producto nuevo inactivo
  // El admin deberá completar los datos (precio, categoría, etc.) y publicarlo
  if (productId === null) {
    const newProduct = await tx.product.create({
      data: {
        name:   productName.trim(),
        price:  0,              // El admin lo completará antes de publicar
        cost:   itemCost,
        stock:  itemQty,
        active: false,          // Inactivo hasta que el admin lo configure
        sku:    sku?.trim() || null,
      },
    });
    productId      = newProduct.id;
    createdProduct = true; // marcado para la confirmación de auto-borrado al revertir
    prevStock      = 0;
    prevCost       = null;
  }

  return {
    sku:         sku?.trim() || null,
    productName: productName.trim(),
    cost:        itemCost,
    quantity:    itemQty,
    productId,
    prevCost,
    prevStock,
    variantId,
    prevVariantStock,
    createdProduct,
  };
}

// Revierte el efecto de un PurchaseItem ya guardado: resta el stock que agregó y restaura el costo
// previo (producto o variante). NO borra productos creados — esa decisión la toma el admin y la
// ejecuta deleteCreatedProductsTx. Si el producto ya no existe, no hace nada.
async function revertItemTx(tx, item) {
  if (!item.productId) return;

  const product = await tx.product.findUnique({ where: { id: item.productId } });
  if (!product) return; // el producto ya no existe (borrado a mano): nada que revertir

  if (item.variantId) {
    // Revertir stock de la variante
    const variant = await tx.productVariant.findUnique({ where: { id: item.variantId } });
    if (variant) {
      const newStock = Math.max(0, variant.stock - item.quantity);
      await tx.productVariant.update({ where: { id: item.variantId }, data: { stock: newStock } });
    }
    // Restaurar el costo del producto padre (si tenemos snapshot)
    if (item.prevCost !== null && item.prevCost !== undefined) {
      await tx.product.update({ where: { id: item.productId }, data: { cost: item.prevCost } });
    }
  } else {
    // Restar el stock agregado y restaurar el costo previo
    const newStock = Math.max(0, product.stock - item.quantity);
    const data = { stock: newStock };
    if (item.prevCost !== null && item.prevCost !== undefined) {
      data.cost = item.prevCost; // "el costo debería quedar como el de antes"
    }
    await tx.product.update({ where: { id: item.productId }, data });
  }
}

// Borra (dentro de tx) los productos CREADOS por la compra cuya decisión del admin sea "delete".
// Un producto con ventas (OrderItem) NO se puede borrar (FK restrictiva) → se mantiene y se reporta.
// Devuelve { deleted: [{ id, images }], skippedDueToSales: [name...] }.
async function deleteCreatedProductsTx(tx, createdItems, productDecisions) {
  const deleted = [];
  const skippedDueToSales = [];

  for (const item of createdItems) {
    // El admin debe haber elegido "delete" explícitamente; por defecto se mantiene.
    const decision = productDecisions[item.productId] ?? productDecisions[String(item.productId)];
    if (decision !== "delete") continue;

    const product = await tx.product.findUnique({ where: { id: item.productId } });
    if (!product) continue; // ya no existe

    // OrderItem.product es relación requerida sin onDelete → un producto vendido no se puede borrar.
    const sales = await tx.orderItem.count({ where: { productId: item.productId } });
    if (sales > 0) {
      skippedDueToSales.push(product.name);
      continue;
    }

    // cartItems / wishlist / variantes / atributos se borran en cascada (onDelete: Cascade en el schema)
    await tx.product.delete({ where: { id: item.productId } });
    deleted.push({ id: item.productId, images: product.images });
  }

  return { deleted, skippedDueToSales };
}

// Valida y normaliza los items entrantes. Lanza { status, error } si algo es inválido.
function parseItems(items) {
  const parsed = [];
  for (const item of items) {
    const { sku, productName, cost, quantity } = item;
    const itemCost = parseFloat(cost);
    const itemQty  = parseInt(quantity);

    if (!productName || !productName.trim()) {
      throw { status: 400, error: "Todos los productos deben tener nombre" };
    }
    if (isNaN(itemCost) || itemCost < 0) {
      throw { status: 400, error: `Costo inválido en "${productName}"` };
    }
    if (isNaN(itemQty) || itemQty <= 0) {
      throw { status: 400, error: `Cantidad inválida en "${productName}"` };
    }
    // productId: pista opcional usada solo en la edición (ver applyItemTx).
    parsed.push({ sku, productName, cost: itemCost, quantity: itemQty, productId: item.productId ?? null });
  }
  return parsed;
}

// Resuelve el nombre del proveedor a guardar como snapshot. Si viene supplierId usa el nombre real
// de la entidad; si no, cae al texto libre `supplier` (compatibilidad hacia atrás).
async function resolveSupplierName(tx, supplierId, supplierText) {
  if (supplierId) {
    const sup = await tx.supplier.findUnique({ where: { id: parseInt(supplierId) } });
    if (sup) return sup.name;
  }
  return supplierText ? supplierText.trim() : "";
}

// Opciones de transacción: damos margen porque cada item hace varias queries.
const TX_OPTS = { timeout: 20000, maxWait: 10000 };

// ──────────────────────────────────────────────────────────────────────────────
// Endpoints
// ──────────────────────────────────────────────────────────────────────────────

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
// Body: { supplier?, supplierId?, date, items: [{ sku?, productName, cost, quantity }] }
const createPurchase = async (req, res) => {
  const { supplier, supplierId, date, items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Debe incluir al menos un producto" });
  }

  let parsedItems;
  try {
    parsedItems = parseItems(items);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.error || "Datos inválidos" });
  }

  try {
    const purchase = await prisma.$transaction(async (tx) => {
      const supplierName = await resolveSupplierName(tx, supplierId, supplier);
      if (!supplierName) {
        throw { status: 400, error: "El proveedor es requerido" };
      }

      // La lógica por-item (buscar SKU producto/variante, sumar stock, recalcular costo promedio
      // ponderado o crear producto inactivo) ahora vive en applyItemTx() — ver nota en el helper.
      const purchaseItems = [];
      for (const it of parsedItems) {
        purchaseItems.push(await applyItemTx(tx, it));
      }

      return tx.purchase.create({
        data: {
          supplier:   supplierName,
          supplierId: supplierId ? parseInt(supplierId) : null,
          date:       date ? new Date(date) : new Date(),
          items: { create: purchaseItems },
        },
        include: { items: true },
      });
    }, TX_OPTS);

    res.status(201).json(purchase);
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.error });
    console.error("Error al crear compra:", err);
    res.status(500).json({ error: "Error al crear compra" });
  }
};

// PUT /api/purchases/:id — editar una compra (edición completa: revierte el efecto original y
// reaplica los nuevos items). Body: { supplier?, supplierId?, date, items: [...],
// productDecisions: { [productId]: "delete" | "keep" } } — decisiones para productos creados por la
// compra original que el admin quiera auto-borrar.
const updatePurchase = async (req, res) => {
  const id = parseInt(req.params.id);
  const { supplier, supplierId, date, items, productDecisions = {} } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Debe incluir al menos un producto" });
  }

  let parsedItems;
  try {
    parsedItems = parseItems(items);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.error || "Datos inválidos" });
  }

  try {
    const original = await prisma.purchase.findUnique({ where: { id }, include: { items: true } });
    if (!original) return res.status(404).json({ error: "Compra no encontrada" });

    const result = await prisma.$transaction(async (tx) => {
      const supplierName = await resolveSupplierName(tx, supplierId, supplier);
      if (!supplierName) {
        throw { status: 400, error: "El proveedor es requerido" };
      }

      // 1. Revertir el efecto de TODOS los items originales (restaura costo, resta stock)
      for (const item of original.items) {
        await revertItemTx(tx, item);
      }

      // 2. Productos creados por la compra original → aplicar decisión del admin (borrar/mantener)
      const createdItems = original.items.filter((it) => it.createdProduct && it.productId);
      const { deleted, skippedDueToSales } = await deleteCreatedProductsTx(tx, createdItems, productDecisions);

      // 3. Borrar los items originales
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });

      // 4. Aplicar los items nuevos (snapshots frescos sobre el estado ya revertido)
      const newItems = [];
      for (const it of parsedItems) {
        newItems.push(await applyItemTx(tx, it));
      }

      // 5. Actualizar la compra con los nuevos datos + items
      const updated = await tx.purchase.update({
        where: { id },
        data: {
          supplier:   supplierName,
          supplierId: supplierId ? parseInt(supplierId) : null,
          date:       date ? new Date(date) : original.date,
          items: { create: newItems },
        },
        include: { items: true },
      });

      return { updated, deleted, skippedDueToSales };
    }, TX_OPTS);

    // Limpiar imágenes de los productos borrados (efecto de filesystem, fuera de la transacción)
    for (const p of result.deleted) {
      await deleteProductImages(p.images);
    }

    res.json({
      ...result.updated,
      _deletedProducts: result.deleted.map((p) => p.id),
      _skippedDueToSales: result.skippedDueToSales,
    });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.error });
    console.error("Error al editar compra:", err);
    res.status(500).json({ error: "Error al editar compra" });
  }
};

// DELETE /api/purchases/:id — eliminar una compra revirtiendo su efecto.
// Body: { productDecisions: { [productId]: "delete" | "keep" } } para los productos creados por la compra.
const deletePurchase = async (req, res) => {
  const id = parseInt(req.params.id);
  const { productDecisions = {} } = req.body || {};

  try {
    const purchase = await prisma.purchase.findUnique({ where: { id }, include: { items: true } });
    if (!purchase) return res.status(404).json({ error: "Compra no encontrada" });

    const result = await prisma.$transaction(async (tx) => {
      // 1. Revertir cada item (resta stock, restaura costo)
      for (const item of purchase.items) {
        await revertItemTx(tx, item);
      }

      // 2. Borrar productos creados según la decisión del admin
      const createdItems = purchase.items.filter((it) => it.createdProduct && it.productId);
      const { deleted, skippedDueToSales } = await deleteCreatedProductsTx(tx, createdItems, productDecisions);

      // 3. Borrar la compra (cascade borra los PurchaseItem)
      await tx.purchase.delete({ where: { id } });

      return { deleted, skippedDueToSales };
    }, TX_OPTS);

    // 4. Limpiar imágenes de los productos borrados (fuera de la transacción)
    for (const p of result.deleted) {
      await deleteProductImages(p.images);
    }

    res.json({
      message: "Compra eliminada",
      deletedProducts: result.deleted.map((p) => p.id),
      skippedDueToSales: result.skippedDueToSales,
    });
  } catch (err) {
    console.error("Error al eliminar compra:", err);
    res.status(500).json({ error: "Error al eliminar compra" });
  }
};

module.exports = {
  getPurchases,
  getPurchaseById,
  createPurchase,
  updatePurchase,
  deletePurchase,
};

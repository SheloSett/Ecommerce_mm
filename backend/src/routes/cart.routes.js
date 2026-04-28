const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { authMiddleware, adminMiddleware, customerMiddleware } = require("../middleware/auth.middleware");
const { sendAbandonedCartEmail } = require("../services/email.service");

const prisma = new PrismaClient();

// Mapa de conexiones SSE activas: customerId → res
// Permite notificar al cliente en tiempo real cuando el admin hace cambios
const sseClients = new Map();

// GET /api/carts/sse - cliente se suscribe a eventos en tiempo real
// EventSource no soporta headers, por eso el token va como query param
router.get("/sse", (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).end();

  let customerId;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "CUSTOMER") return res.status(403).end();
    customerId = decoded.id;
  } catch {
    return res.status(401).end();
  }

  // Configurar SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Registrar la conexión del cliente
  sseClients.set(customerId, res);
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  // Heartbeat cada 25s para mantener la conexión viva
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: "ping" })}\n\n`);
  }, 25000);

  // Limpiar al desconectar
  req.on("close", () => {
    sseClients.delete(customerId);
    clearInterval(heartbeat);
  });
});

// PUT /api/carts/sync - el cliente autenticado sincroniza su carrito con la BD
// Se llama cada vez que el carrito cambia en el frontend
router.put("/sync", authMiddleware, customerMiddleware, async (req, res) => {
  try {
    const customerId = req.user.id;
    const { items } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "items debe ser un array" });
    }

    // Si el carrito quedó vacío, eliminamos el registro de la BD
    if (items.length === 0) {
      await prisma.cart.deleteMany({ where: { customerId } });
      return res.json({ ok: true });
    }

    // Upsert: si existe el carrito lo actualiza, si no lo crea
    // Primero eliminamos los items anteriores y luego insertamos los nuevos
    await prisma.cart.upsert({
      where: { customerId },
      update: {
        updatedAt: new Date(),
        items: {
          deleteMany: {},
          create: items.map((item) => ({
            productId: item.id,
            name:      item.name,
            price:     item.price,
            quantity:  item.quantity,
            image:     item.images?.[0] || null,
          })),
        },
      },
      create: {
        customerId,
        items: {
          create: items.map((item) => ({
            productId: item.id,
            name:      item.name,
            price:     item.price,
            quantity:  item.quantity,
            image:     item.images?.[0] || null,
          })),
        },
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Error al sincronizar carrito:", err);
    res.status(500).json({ error: "Error al sincronizar carrito" });
  }
});

// GET /api/carts/me - cliente: obtiene su carrito con items y stock del producto
router.get("/me", authMiddleware, customerMiddleware, async (req, res) => {
  try {
    const customerId = req.user.id;
    const cart = await prisma.cart.findUnique({
      where: { customerId },
      include: {
        items: {
          include: { product: { select: { stock: true, ivaRate: true } } },
        },
      },
    });
    res.json(cart || null);
  } catch (err) {
    console.error("Error al obtener carrito propio:", err);
    res.status(500).json({ error: "Error al obtener carrito" });
  }
});

// POST /api/carts/my/items - cliente: agrega un item al carrito (crea el carrito si no existe)
router.post("/my/items", authMiddleware, customerMiddleware, async (req, res) => {
  try {
    const customerId = req.user.id;
    const { productId, name, price, image, variantId, variantLabel } = req.body;
    const quantity = parseInt(req.body.quantity) || 1;

    // Upsert del carrito: crea si no existe, actualiza updatedAt si ya existe
    const cart = await prisma.cart.upsert({
      where:  { customerId },
      create: { customerId },
      update: { updatedAt: new Date() },
    });

    // Deduplicación: mismo producto + misma variante = mismo ítem (incrementar cantidad).
    // Prioridad: variantId (más preciso) → variantLabel (para órdenes sin variantId guardado) → solo productId.
    const dedupWhere = { cartId: cart.id, productId };
    if (variantId) {
      dedupWhere.variantId = parseInt(variantId);
    } else if (variantLabel) {
      dedupWhere.variantLabel = variantLabel;
    } else {
      dedupWhere.variantId = null;
    }
    const existing = await prisma.cartItem.findFirst({ where: dedupWhere });

    if (existing) {
      const newQty = existing.quantity + quantity;
      // Recalcular precio según el nuevo total de cantidad y los tiers del producto
      const productData = await prisma.product.findUnique({
        where:  { id: productId },
        select: { price: true, salePrice: true, wholesalePrice: true, wholesaleSalePrice: true, priceTiers: true, wholesalePriceTiers: true },
      });
      const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { type: true } });
      const isMayorista = customer?.type === "MAYORISTA";
      const basePrice = isMayorista && productData?.wholesalePrice
        ? (productData.wholesaleSalePrice ?? productData.wholesalePrice)
        : (productData?.salePrice ?? productData?.price ?? existing.price);
      let newPrice = basePrice;
      // Mayoristas usan wholesalePriceTiers; minoristas usan priceTiers
      const activeTiers = isMayorista ? productData?.wholesalePriceTiers : productData?.priceTiers;
      if (Array.isArray(activeTiers) && activeTiers.length > 0) {
        const applicableTier = [...activeTiers]
          .sort((a, b) => b.minQty - a.minQty)
          .find((t) => newQty >= t.minQty);
        if (applicableTier) newPrice = parseFloat(applicableTier.price);
      }
      await prisma.cartItem.update({
        where: { id: existing.id },
        data:  { quantity: newQty, price: parseFloat(newPrice) },
      });
    } else {
      await prisma.cartItem.create({
        data: {
          cartId: cart.id, productId, quantity, name,
          price:        parseFloat(price),
          image:        image || null,
          variantId:    variantId    ? parseInt(variantId)    : null,
          variantLabel: variantLabel || null,
        },
      });
    }

    // Retornar carrito completo con stock e ivaRate del producto para validaciones en el frontend
    const updatedCart = await prisma.cart.findUnique({
      where:   { customerId },
      include: { items: { orderBy: { id: "asc" }, include: { product: { select: { stock: true, ivaRate: true } } } } },
    });

    res.json(updatedCart);
  } catch (err) {
    console.error("Error al agregar item:", err);
    res.status(500).json({ error: "Error al agregar item al carrito" });
  }
});

// PATCH /api/carts/my/items/:itemId - cliente: cambia la cantidad de un item propio
router.patch("/my/items/:itemId", authMiddleware, customerMiddleware, async (req, res) => {
  try {
    const customerId = req.user.id;
    const itemId     = parseInt(req.params.itemId);
    const { quantity } = req.body;

    // Verificar que el item pertenece al carrito de este cliente
    const item = await prisma.cartItem.findFirst({
      where:   { id: itemId, cart: { customerId } },
      include: { product: { select: { price: true, salePrice: true, wholesalePrice: true, wholesaleSalePrice: true, priceTiers: true, wholesalePriceTiers: true } } },
    });
    if (!item) return res.status(404).json({ error: "Item no encontrado" });

    if (quantity <= 0) {
      // Si la cantidad baja a 0 o menos, eliminar el item directamente
      await prisma.cartItem.delete({ where: { id: itemId } });
    } else {
      // Recalcular el precio según la nueva cantidad y los tiers del producto
      // El precio base depende del tipo de cliente (mayorista o minorista)
      const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { type: true } });
      const isMayorista = customer?.type === "MAYORISTA";
      const product = item.product;
      const basePrice = isMayorista && product?.wholesalePrice
        ? (product.wholesaleSalePrice ?? product.wholesalePrice)
        : (product?.salePrice ?? product?.price ?? item.price);

      // Mayoristas usan wholesalePriceTiers; minoristas usan priceTiers
      // Aplicar el tier con mayor minQty que no supere la nueva cantidad
      let newPrice = basePrice;
      const activeTiers = isMayorista ? product?.wholesalePriceTiers : product?.priceTiers;
      if (Array.isArray(activeTiers) && activeTiers.length > 0) {
        const applicableTier = [...activeTiers]
          .sort((a, b) => b.minQty - a.minQty)
          .find((t) => quantity >= t.minQty);
        if (applicableTier) newPrice = parseFloat(applicableTier.price);
      }

      await prisma.cartItem.update({ where: { id: itemId }, data: { quantity: parseInt(quantity), price: parseFloat(newPrice) } });
    }

    await prisma.cart.update({ where: { customerId }, data: { updatedAt: new Date() } });

    const cart = await prisma.cart.findUnique({
      where:   { customerId },
      include: { items: { orderBy: { id: "asc" }, include: { product: { select: { stock: true } } } } },
    });

    res.json(cart);
  } catch (err) {
    console.error("Error al actualizar item propio:", err);
    res.status(500).json({ error: "Error al actualizar item" });
  }
});

// DELETE /api/carts/my/items/:itemId - cliente: elimina un item de su propio carrito
router.delete("/my/items/:itemId", authMiddleware, customerMiddleware, async (req, res) => {
  try {
    const customerId = req.user.id;
    const itemId     = parseInt(req.params.itemId);

    const item = await prisma.cartItem.findFirst({
      where: { id: itemId, cart: { customerId } },
    });
    if (!item) return res.status(404).json({ error: "Item no encontrado" });

    await prisma.cartItem.delete({ where: { id: itemId } });
    await prisma.cart.update({ where: { customerId }, data: { updatedAt: new Date() } });

    const cart = await prisma.cart.findUnique({
      where:   { customerId },
      include: { items: { orderBy: { id: "asc" }, include: { product: { select: { stock: true } } } } },
    });

    res.json(cart);
  } catch (err) {
    console.error("Error al eliminar item propio:", err);
    res.status(500).json({ error: "Error al eliminar item" });
  }
});

// DELETE /api/carts/my - cliente: limpia su propio carrito (usado en checkout/pago)
router.delete("/my", authMiddleware, customerMiddleware, async (req, res) => {
  try {
    const customerId = req.user.id;
    await prisma.cart.deleteMany({ where: { customerId } });
    res.json({ ok: true });
  } catch (err) {
    console.error("Error al limpiar carrito propio:", err);
    res.status(500).json({ error: "Error al limpiar carrito" });
  }
});

// POST /api/carts/:customerId/remind - admin: enviar email de carrito abandonado
// Body: { couponCode?, couponDescription? }
// IMPORTANTE: va ANTES de GET "/" y de DELETE "/:customerId" para que Express no confunda rutas
router.post("/:customerId/remind", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId);
    const { couponCode, couponDescription } = req.body;

    const cart = await prisma.cart.findUnique({
      where: { customerId },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        items: true,
      },
    });

    if (!cart || cart.items.length === 0) {
      return res.status(404).json({ error: "Carrito no encontrado o vacío" });
    }

    const storeUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    await sendAbandonedCartEmail(cart.customer, cart.items, { couponCode, couponDescription, storeUrl });

    res.json({ ok: true });
  } catch (err) {
    console.error("Error al enviar recordatorio de carrito:", err);
    res.status(500).json({ error: "Error al enviar recordatorio" });
  }
});

// GET /api/carts - admin: obtener todos los carritos activos (con items)
router.get("/", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const carts = await prisma.cart.findMany({
      where: {
        items: { some: {} }, // Solo carritos que tengan al menos un item
      },
      include: {
        customer: {
          select: { id: true, name: true, email: true, type: true, phone: true },
        },
        items: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    res.json(carts);
  } catch (err) {
    console.error("Error al obtener carritos:", err);
    res.status(500).json({ error: "Error al obtener carritos" });
  }
});

// PATCH /api/carts/items/:itemId - admin: cambiar cantidad de un item individual
// IMPORTANTE: esta ruta va ANTES de /:customerId para que Express no confunda "items" con un id
router.patch("/items/:itemId", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const itemId   = parseInt(req.params.itemId);
    const { quantity } = req.body;

    if (!quantity || quantity < 1) {
      return res.status(400).json({ error: "La cantidad debe ser al menos 1" });
    }

    const updated = await prisma.cartItem.update({
      where: { id: itemId },
      data:  { quantity },
    });

    // También actualizamos updatedAt del carrito padre para reflejar el cambio
    const cart = await prisma.cart.update({
      where: { id: updated.cartId },
      data:  { updatedAt: new Date() },
      include: { items: true },
    });

    // Notificar al cliente vía SSE si está conectado
    const conn = sseClients.get(cart.customerId);
    if (conn) conn.write(`data: ${JSON.stringify({ type: "cart_updated", items: cart.items })}\n\n`);

    res.json({ ok: true });
  } catch (err) {
    console.error("Error al actualizar item:", err);
    res.status(500).json({ error: "Error al actualizar item" });
  }
});

// DELETE /api/carts/items/:itemId - admin: eliminar un item individual del carrito
router.delete("/items/:itemId", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId);

    const item = await prisma.cartItem.delete({ where: { id: itemId } });

    // Actualizamos updatedAt del carrito padre y obtenemos items restantes
    const cart = await prisma.cart.update({
      where: { id: item.cartId },
      data:  { updatedAt: new Date() },
      include: { items: true },
    });

    // Notificar al cliente vía SSE si está conectado
    const conn = sseClients.get(cart.customerId);
    if (conn) {
      if (cart.items.length === 0) {
        // Si no quedan items, avisar que el carrito quedó vacío
        conn.write(`data: ${JSON.stringify({ type: "cart_cleared" })}\n\n`);
      } else {
        conn.write(`data: ${JSON.stringify({ type: "cart_updated", items: cart.items })}\n\n`);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Error al eliminar item:", err);
    res.status(500).json({ error: "Error al eliminar item" });
  }
});

// DELETE /api/carts/:customerId - admin: limpiar todo el carrito de un cliente
router.delete("/:customerId", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId);
    if (isNaN(customerId)) {
      return res.status(400).json({ error: "customerId inválido" });
    }
    await prisma.cart.deleteMany({ where: { customerId } });

    // Notificar al cliente vía SSE al instante si está conectado
    const conn = sseClients.get(customerId);
    if (conn) conn.write(`data: ${JSON.stringify({ type: "cart_cleared" })}\n\n`);

    res.json({ ok: true });
  } catch (err) {
    console.error("Error al limpiar carrito:", err);
    res.status(500).json({ error: "Error al limpiar carrito" });
  }
});

module.exports = router;

const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { authMiddleware, adminMiddleware, customerMiddleware, requireAnyPermission } = require("../middleware/auth.middleware");
const { sendAbandonedCartEmail } = require("../services/email.service");
// Precio efectivo (variante > producto por grupo + tiers), compartido con el checkout.
const { effectiveUnitPrice, effectiveCurrency } = require("../utils/pricing");

const prisma = require("../lib/prisma"); // cliente único (ver lib/prisma.js)

// Mapa de conexiones SSE activas: customerId → res
// Permite notificar al cliente en tiempo real cuando el admin hace cambios
const sseClients = new Map();

// ── Precio vigente de los items ───────────────────────────────────────────────
//
// POR QUÉ EXISTE: CartItem.price es un SNAPSHOT del precio al momento de agregar el producto, y solo
// se refrescaba al cambiar la cantidad (PATCH) o al volver a agregar el mismo item (POST). Cuando una
// campaña de ofertas terminaba, offers.service revertía salePrice a null en productos y variantes,
// pero los carritos ya cargados seguían mostrando el precio con descuento indefinidamente. Como el
// checkout SIEMPRE recalcula server-side (ver order.controller.js), el cliente veía un total en el
// carrito y le llegaba un pedido con otro. No se cobraba de menos, pero era un reclamo asegurado.
//
// SOLUCIÓN: el precio se recalcula EN CADA LECTURA con effectiveUnitPrice — el mismo helper del
// checkout — así carrito, checkout y panel admin leen de la misma fuente de verdad.
//
// A PROPÓSITO NO SE PERSISTE: CartItem.price queda como el snapshot "precio al agregar", y es contra
// ese valor que se detecta el cambio para avisarle al cliente (previousPrice / priceChanged). Si lo
// pisáramos, el aviso se perdería en la primera lectura — incluso en una lectura del panel admin,
// antes de que el cliente llegue a ver que su precio cambió.

// Campos que necesita effectiveUnitPrice. Son los mismos para producto y variante.
const PRICE_SELECT = {
  price:          true, salePrice:          true,
  wholesalePrice: true, wholesaleSalePrice: true,
  priceTiers:     true, wholesalePriceTiers: true,
};

// Diferencia de precio real, no ruido de punto flotante (medio centavo).
// Mismo criterio que sameMoney() en offers.service.js.
const priceDiffers = (a, b) => Math.abs(a - b) >= 0.005;

// Etiqueta de una variante, con el mismo formato que la tienda y el checkout ("Color: Negro / Talle: M").
const variantLabelOf = (variant) => {
  const combo = variant && Array.isArray(variant.combination) ? variant.combination : [];
  return combo.map((c) => `${c.name}: ${c.value}`).join(" / ") || null;
};

// Puede ver (y comprar) esta variante quien compra: "AMBOS" o su mismo tipo de cliente. Misma regla que
// el catálogo (visibleFor) y que el carrito sin cuenta.
const variantVisibleFor = (variant, isMayorista) =>
  variant.visibility === "AMBOS" || variant.visibility === (isMayorista ? "MAYORISTA" : "MINORISTA");

// Línea SIN variante de un producto que SÍ tiene variantes activas. Pasa a propósito con los mayoristas
// que no ven ninguna de las variantes (ProductCard la agrega sin variante): el pedido entra como
// cotización y el admin asigna la variante al aprobarla. El stock del producto padre no sirve para
// decidir (con variantes queda en 0): se usa la misma regla que createOrder (order.controller.js):
//  - quien compra directo (minorista o sin cuenta) y PUEDE elegir una variante: el checkout le pide que
//    la elija, así que la línea, tal como está, no se puede comprar;
//  - si no, alcanza con que haya stock en la suma de las variantes activas (alguna ilimitada = sin tope).
// Antes se miraba product.stock, así que la línea quedaba "sin stock" y Checkout.jsx rebotaba al
// mayorista con "Tenés productos sin stock" aunque el checkout la hubiera aceptado.
function variantlessLineOutOfStock(activeVariants, isMayorista) {
  if (!isMayorista && activeVariants.some((v) => variantVisibleFor(v, false))) return true;
  if (activeVariants.some((v) => v.stockUnlimited)) return false;
  return activeVariants.reduce((sum, v) => sum + v.stock, 0) <= 0;
}

// Variantes activas de los productos que tienen alguna línea sin variante: productId → [variantes].
// Una sola consulta para todas las líneas.
async function activeVariantsByProduct(productIds) {
  if (productIds.length === 0) return {};
  const rows = await prisma.productVariant.findMany({
    where:  { productId: { in: productIds }, active: true },
    select: { productId: true, stock: true, stockUnlimited: true, visibility: true },
  });
  const byProduct = {};
  for (const v of rows) (byProduct[v.productId] ||= []).push(v);
  return byProduct;
}

// Enriquece los items de una lista de carritos con outOfStock, currency y precio vigente.
// Hace a lo sumo 3 consultas en total (productos + variantes de las líneas + variantes activas de los
// productos con líneas sin variante) sin importar cuántos carritos vengan, para que el listado del
// admin no dispare una consulta por item. Antes eran 2: la tercera es para la regla de stock de
// variantlessLineOutOfStock.
//
// Cada cart debe traer `items` y, si se quiere el precio mayorista correcto, `customer.type`.
//
// La misma regla de stock y de precio está en buildGuestCart (carrito sin cuenta, más abajo): si cambia
// acá, hay que cambiarla allá.
async function enrichCarts(carts) {
  const productIds = [...new Set(carts.flatMap((c) => c.items.map((i) => i.productId)))];
  const variantIds = [...new Set(carts.flatMap((c) => c.items.map((i) => i.variantId).filter(Boolean)))];

  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        // active y stockUnlimited son necesarios para distinguir "sin stock" de "stock ilimitado"
        // o "producto despublicado" (regla de negocio: productos sin stock se ocultan en la web,
        // PERO en el carrito mostramos un aviso porque el item ya estaba agregado).
        select: { id: true, stock: true, stockUnlimited: true, active: true, ivaRate: true, currency: true, ...PRICE_SELECT },
      })
    : [];

  const variants = variantIds.length
    ? await prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        // Sin filtro por active: una variante desactivada igual tiene que resolverse para marcar
        // el item como outOfStock. La moneda NO se trae: es propiedad del producto (ver pricing.js).
        select: { id: true, stock: true, stockUnlimited: true, active: true, ...PRICE_SELECT },
      })
    : [];

  const productMap = Object.fromEntries(products.map((p) => [p.id, p]));
  const variantMap = Object.fromEntries(variants.map((v) => [v.id, v]));
  const variantsOfProduct = await activeVariantsByProduct(
    [...new Set(carts.flatMap((c) => c.items.filter((i) => !i.variantId).map((i) => i.productId)))]
  );

  return carts.map((cart) => {
    const isMayorista = cart.customer?.type === "MAYORISTA";

    const items = cart.items.map((item) => {
      const product = productMap[item.productId] || null;
      const variant = item.variantId ? (variantMap[item.variantId] || null) : null;

      let outOfStock = false;
      if (!product || !product.active) {
        outOfStock = true; // producto eliminado o despublicado
      } else if (item.variantId) {
        if (!variant || !variant.active) outOfStock = true;
        else if (!variant.stockUnlimited && variant.stock <= 0) outOfStock = true;
      } else if (variantsOfProduct[product.id]?.length) {
        // Sin variante, de un producto con variantes. Antes caía en la rama de abajo (stock del padre).
        outOfStock = variantlessLineOutOfStock(variantsOfProduct[product.id], isMayorista);
      } else if (!product.stockUnlimited && product.stock <= 0) {
        outOfStock = true;
      }

      // Precio vigente. Si el producto ya no existe no hay contra qué recalcular: se deja el
      // snapshot (el item igual está marcado outOfStock y el checkout lo va a rechazar).
      let price = item.price;
      let previousPrice = null;
      if (product) {
        const current = effectiveUnitPrice({ product, variant, isMayorista, quantity: item.quantity });
        if (current > 0 && priceDiffers(current, item.price)) {
          previousPrice = item.price;
          price = current;
        }
      }

      return {
        ...item,
        price,
        previousPrice,               // precio al que se agregó, solo si cambió (null si no)
        priceChanged: previousPrice !== null,
        outOfStock,
        // currency: moneda del ítem (la del producto), para que el checkout sepa si este ítem obliga
        // a ir por "A convenir" (ver PaymentMethod.A_CONVENIR).
        currency: product ? effectiveCurrency({ product }) : "ARS",
        // Subconjunto que consume el frontend. No se manda el producto entero a propósito: traería
        // wholesalePrice y los tramos de precio mayorista a un cliente minorista.
        product: product && {
          stock:          product.stock,
          stockUnlimited: product.stockUnlimited,
          active:         product.active,
          ivaRate:        product.ivaRate,
          currency:       product.currency,
        },
      };
    });

    return { ...cart, items };
  });
}

// Carrito de un cliente listo para responder (o null si no tiene). Lo usan GET /me y también el
// POST/PATCH/DELETE de items, para que TODAS las respuestas tengan la misma forma: antes esas tres
// devolvían el carrito crudo, sin outOfStock ni currency ni precio recalculado, y el frontend perdía
// los avisos hasta el siguiente fetch.
async function buildCartResponse(customerId) {
  const cart = await prisma.cart.findUnique({
    where:   { customerId },
    include: {
      items:    { orderBy: { id: "asc" } },
      customer: { select: { type: true } }, // define si los precios se resuelven como mayorista
    },
  });
  if (!cart) return null;

  const [enriched] = await enrichCarts([cart]);
  return enriched;
}

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

// ── Carrito sin cuenta ─────────────────────────────────────────────────────────
//
// Quien todavía no inició sesión guarda su carrito en el navegador (qué producto, qué variante, cuántos y a
// qué precio lo agregó: ver frontend utils/guestCart.js) y le pide acá lo que hace falta para mostrarlo:
// nombre, foto, precio de hoy y si se puede comprar. No se guarda nada en la base.
//
// Antes, sin cuenta no se podía agregar nada al carrito: el botón mandaba a iniciar sesión. El pedido sin
// cuenta ya se aceptaba (createOrder le cobra precio minorista y vuelve a validar todo); faltaba el carrito.
//
// Sin cuenta siempre es precio minorista, y lo que se vende solo a mayoristas queda marcado como no
// disponible. La respuesta tiene la misma forma que la del carrito de una cuenta (enrichCarts), así el
// frontend usa un solo camino; nunca viaja un precio mayorista.
// Misma regla de stock y de precio que enrichCarts (arriba), más los controles de quien compra sin cuenta: si
// cambia allá, hay que cambiarla acá. Los topes son los mismos que en frontend utils/guestCart.js.
const GUEST_MAX_LINES = 60;
const GUEST_MAX_QUANTITY = 9999;
const guestCartLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });

async function buildGuestCart(rawItems) {
  // Líneas válidas, sin repetidas (mismo producto y variante se suman) y con tope
  const lines = new Map();
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    const productId = parseInt(raw?.productId);
    const variantId = raw?.variantId ? parseInt(raw.variantId) : null;
    if (!(productId > 0) || (variantId !== null && !(variantId > 0))) continue;
    const quantity = Math.min(Math.max(parseInt(raw?.quantity) || 1, 1), GUEST_MAX_QUANTITY);
    const key = `g-${productId}-${variantId || 0}`;
    const prev = lines.get(key);
    if (prev) {
      prev.quantity = Math.min(prev.quantity + quantity, GUEST_MAX_QUANTITY);
    } else if (lines.size < GUEST_MAX_LINES) {
      const addedPrice = Number(raw?.price);
      lines.set(key, { key, productId, variantId, quantity, addedPrice: Number.isFinite(addedPrice) && addedPrice > 0 ? addedPrice : null });
    }
  }
  const list = [...lines.values()];
  if (list.length === 0) return [];

  const variantIds = list.map((l) => l.variantId).filter(Boolean);
  const [products, variants, variantsOfProduct] = await Promise.all([
    prisma.product.findMany({
      where:  { id: { in: [...new Set(list.map((l) => l.productId))] } },
      select: { id: true, name: true, images: true, active: true, visibility: true, stock: true, stockUnlimited: true, ivaRate: true, currency: true, ...PRICE_SELECT },
    }),
    variantIds.length
      ? prisma.productVariant.findMany({
          where:  { id: { in: variantIds } },
          select: { id: true, productId: true, active: true, visibility: true, combination: true, stock: true, stockUnlimited: true, ...PRICE_SELECT },
        })
      : [],
    // Para las líneas sin variante de productos con variantes (ver variantlessLineOutOfStock)
    activeVariantsByProduct([...new Set(list.filter((l) => l.variantId === null).map((l) => l.productId))]),
  ]);
  const productMap = Object.fromEntries(products.map((p) => [p.id, p]));
  const variantMap = Object.fromEntries(variants.map((v) => [v.id, v]));

  return list.flatMap((line) => {
    const product = productMap[line.productId];
    if (!product) return []; // producto borrado: sale del carrito
    const found = line.variantId ? variantMap[line.variantId] : null;
    // La variante tiene que ser de ese producto, estar activa y poder vendérsele a un minorista
    const variant = found && found.productId === product.id && found.active && variantVisibleFor(found, false) ? found : null;

    let outOfStock = !product.active || product.visibility === "MAYORISTA" || (line.variantId !== null && !variant);
    if (!outOfStock) {
      // Antes, sin variante siempre se miraba el stock del producto padre (0 si tiene variantes):
      // outOfStock = variant ? ... : !product.stockUnlimited && product.stock <= 0;
      if (variant) outOfStock = !variant.stockUnlimited && variant.stock <= 0;
      else if (variantsOfProduct[product.id]?.length) outOfStock = variantlessLineOutOfStock(variantsOfProduct[product.id], false);
      else outOfStock = !product.stockUnlimited && product.stock <= 0;
    }

    const current = effectiveUnitPrice({ product, variant, isMayorista: false, quantity: line.quantity });
    const price = current > 0 ? current : (line.addedPrice ?? 0);
    const previousPrice = line.addedPrice !== null && current > 0 && priceDiffers(current, line.addedPrice) ? line.addedPrice : null;

    return [{
      id:           line.key,
      productId:    product.id,
      variantId:    line.variantId,
      variantLabel: variantLabelOf(variant),
      name:         product.name,
      image:        product.images?.[0] || null,
      quantity:     line.quantity,
      price,
      previousPrice,
      priceChanged: previousPrice !== null,
      outOfStock,
      currency:     effectiveCurrency({ product }),
      product: {
        stock:          product.stock,
        stockUnlimited: product.stockUnlimited,
        active:         product.active,
        ivaRate:        product.ivaRate,
        currency:       product.currency,
      },
    }];
  });
}

// POST /api/carts/guest — pública: datos para mostrar el carrito de quien no inició sesión
router.post("/guest", guestCartLimiter, async (req, res) => {
  try {
    res.json({ items: await buildGuestCart(req.body?.items) });
  } catch (err) {
    console.error("Error al armar el carrito sin cuenta:", err);
    res.status(500).json({ error: "Error al obtener carrito" });
  }
});

// GET /api/carts/me - cliente: obtiene su carrito con items, stock y PRECIO VIGENTE
// Por item devuelve además:
//  - outOfStock: producto inactivo, stock 0 sin ilimitado, o variante sin stock
//  - priceChanged / previousPrice: el precio cambió desde que lo agregó (típicamente porque
//    terminó una campaña de ofertas). Ver el bloque de helpers arriba.
router.get("/me", authMiddleware, customerMiddleware, async (req, res) => {
  try {
    const cart = await buildCartResponse(req.user.id);
    if (!cart) return res.json(null);
    res.json(cart);
  } catch (err) {
    console.error("Error al obtener carrito propio:", err);
    res.status(500).json({ error: "Error al obtener carrito" });
  }
});

// POST /api/carts/my/items - cliente: agrega un item al carrito (crea el carrito si no existe)
router.post("/my/items", authMiddleware, customerMiddleware, async (req, res) => {
  try {
    const customerId = req.user.id;
    // variantLabel ya no se lee del body: la etiqueta se arma acá (ver más abajo).
    // Antes: const { productId, name, price, image, variantId, variantLabel } = req.body;
    const { productId, name, price, image, variantId } = req.body;
    const quantity = parseInt(req.body.quantity) || 1;

    // El producto (y su variante, si aplica) deben seguir activos al momento de agregar.
    // Sin esto, un cliente con la página de detalle abierta desde antes podía agregar al
    // carrito un producto que el admin ya despublicó, mostrando "agregado" como si nada.
    const product = await prisma.product.findUnique({
      where:  { id: parseInt(productId) },
      select: { id: true, active: true, visibility: true },
    });
    if (!product || !product.active) {
      return res.status(404).json({ error: "Este producto ya no está disponible" });
    }
    // Tipo de cliente: decide qué productos y variantes puede comprar y a qué precio. Antes se consultaba
    // dos veces (acá solo para los productos de mayoristas, y otra vez más abajo para el precio).
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { type: true } });
    const isMayorista = customer?.type === "MAYORISTA";
    // Un producto que se vende SOLO a mayoristas no entra al carrito de otro cliente: la ficha ya no
    // le muestra el botón, y esto cierra el mismo camino por la API (el checkout también lo valida).
    if (product.visibility === "MAYORISTA" && !isMayorista) {
      return res.status(403).json({ error: "Este producto es exclusivo para clientes mayoristas" });
    }
    // La variante tiene que ser de este producto, estar activa y ser visible para este tipo de cliente
    // (mismo criterio que el carrito sin cuenta y el checkout). La etiqueta se arma acá con su
    // combinación, igual que en buildGuestCart y createOrder.
    // Antes: se guardaba el variantLabel que mandaba el navegador (texto libre), no se miraba la
    // visibilidad (por la API, un minorista cargaba una variante de mayoristas y recién lo frenaba el
    // checkout) y una variante que no correspondía respondía 404; ahora 400, como el checkout.
    let serverVariantLabel = null;
    if (variantId) {
      const variant = await prisma.productVariant.findUnique({
        where:  { id: parseInt(variantId) },
        select: { id: true, active: true, productId: true, visibility: true, combination: true },
      });
      if (!variant || !variant.active || variant.productId !== product.id || !variantVisibleFor(variant, isMayorista)) {
        return res.status(400).json({ error: "Esta variante ya no está disponible" });
      }
      serverVariantLabel = variantLabelOf(variant);
    }

    // Upsert del carrito: crea si no existe, actualiza updatedAt si ya existe
    const cart = await prisma.cart.upsert({
      where:  { customerId },
      create: { customerId },
      update: { updatedAt: new Date() },
    });

    // Deduplicación: mismo producto + misma variante = mismo ítem (incrementar cantidad).
    // Antes, sin variantId se buscaba por el variantLabel del navegador ("para órdenes sin variantId
    // guardado"): esa etiqueta no la valida nadie y el checkout la ignora (sin variante, el pedido sale
    // sin variante), así que una línea sin variante es una sola, se llame como se llame.
    // if (variantId) { ... } else if (variantLabel) { dedupWhere.variantLabel = variantLabel; } else { ... }
    const dedupWhere = { cartId: cart.id, productId };
    dedupWhere.variantId = variantId ? parseInt(variantId) : null;
    const existing = await prisma.cartItem.findFirst({ where: dedupWhere });

    // Datos para calcular el precio. Antes se traían SOLO dentro de la rama `existing`: el item nuevo
    // se guardaba con el precio que mandaba el cliente. No era un agujero de seguridad (el checkout
    // recalcula igual), pero el número podía no coincidir con el del servidor — el frontend, por
    // ejemplo, no mira los tramos por cantidad — y desde que GET /me compara contra este snapshot
    // para avisar "cambió de precio", esa diferencia salía como un aviso falso apenas agregaba algo.
    // Ahora las dos ramas guardan el precio calculado server-side, igual que el checkout.
    const effectiveVariantId = existing ? existing.variantId : (variantId ? parseInt(variantId) : null);
    const newQty = existing ? existing.quantity + quantity : quantity;

    const productData = await prisma.product.findUnique({
      where:  { id: parseInt(productId) },
      select: PRICE_SELECT,
    });
    const variantData = effectiveVariantId
      ? await prisma.productVariant.findUnique({
          where:  { id: effectiveVariantId },
          select: PRICE_SELECT,
        })
      : null;
    // customer / isMayorista: se consultan una sola vez, arriba (antes se volvía a pedir acá).

    // Precio efectivo con la variante y la cantidad final (variante > producto + tramos por cantidad).
    // null si no da un precio usable — ahí se cae al valor anterior (o al del cliente, si es alta).
    const calculated = productData
      ? effectiveUnitPrice({ product: productData, variant: variantData, isMayorista, quantity: newQty })
      : null;
    const computedPrice = calculated > 0 ? calculated : null;

    if (existing) {
      await prisma.cartItem.update({
        where: { id: existing.id },
        data:  { quantity: newQty, price: parseFloat(computedPrice ?? existing.price) },
      });
    } else {
      // Fallback al precio del cliente solo si el producto no devolvió datos de precio (no debería
      // pasar: más arriba ya se validó que existe y está activo).
      const finalPrice = computedPrice ?? parseFloat(price);
      if (isNaN(finalPrice)) {
        return res.status(400).json({ error: "Precio inválido" });
      }
      await prisma.cartItem.create({
        data: {
          cart:         { connect: { id: cart.id } },
          product:      { connect: { id: parseInt(productId) } },
          variantId:    effectiveVariantId,
          quantity, name,
          price:        finalPrice,
          image:        image || null,
          // Antes: variantLabel || null (el texto que mandaba el navegador)
          variantLabel: serverVariantLabel,
        },
      });
    }

    // Misma forma que GET /me (stock, ivaRate, moneda y precio vigente): antes esta respuesta traía
    // el carrito crudo y el frontend perdía outOfStock/priceChanged hasta el siguiente fetch.
    res.json(await buildCartResponse(customerId));
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
      // Recalcular el precio según la nueva cantidad. Antes solo miraba el producto (precio + tiers),
      // ignorando la variante → precios mal en productos con variantes. Ahora usa el helper: variante > producto.
      const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { type: true } });
      const isMayorista = customer?.type === "MAYORISTA";
      const product = item.product;
      const variantData = item.variantId
        ? await prisma.productVariant.findUnique({
            where:  { id: item.variantId },
            select: { price: true, salePrice: true, wholesalePrice: true, wholesaleSalePrice: true, priceTiers: true, wholesalePriceTiers: true },
          })
        : null;
      const newPrice = product
        ? effectiveUnitPrice({ product, variant: variantData, isMayorista, quantity })
        : item.price;

      await prisma.cartItem.update({ where: { id: itemId }, data: { quantity: parseInt(quantity), price: parseFloat(newPrice) } });
    }

    await prisma.cart.update({ where: { customerId }, data: { updatedAt: new Date() } });

    res.json(await buildCartResponse(customerId));
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

    res.json(await buildCartResponse(customerId));
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
router.post("/:customerId/remind", authMiddleware, adminMiddleware, requireAnyPermission("clientes"), async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId);
    const { couponCode, couponDescription } = req.body;

    const cart = await prisma.cart.findUnique({
      where: { customerId },
      include: {
        // type: hace falta para resolver el precio mayorista al recalcular (ver enrichCarts)
        customer: { select: { id: true, name: true, email: true, type: true } },
        items: { orderBy: { id: "asc" } },
      },
    });

    if (!cart || cart.items.length === 0) {
      return res.status(404).json({ error: "Carrito no encontrado o vacío" });
    }

    // Precios VIGENTES: el email tiene que decir lo que el cliente va a pagar hoy. Con el snapshot
    // guardado, un recordatorio enviado después de terminada una campaña le prometía el precio con
    // descuento y al entrar se encontraba con otro.
    const [enriched] = await enrichCarts([cart]);

    const storeUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    await sendAbandonedCartEmail(cart.customer, enriched.items, { couponCode, couponDescription, storeUrl });

    res.json({ ok: true });
  } catch (err) {
    console.error("Error al enviar recordatorio de carrito:", err);
    res.status(500).json({ error: "Error al enviar recordatorio" });
  }
});

// GET /api/carts - admin: obtener todos los carritos activos (con items)
// Los precios salen recalculados al valor VIGENTE (con previousPrice si cambiaron), no al snapshot
// guardado: si no, terminada una campaña de ofertas el panel mostraba totales que ya no eran reales.
router.get("/", authMiddleware, adminMiddleware, requireAnyPermission("clientes"), async (req, res) => {
  try {
    const carts = await prisma.cart.findMany({
      where: {
        items: { some: {} }, // Solo carritos que tengan al menos un item
      },
      include: {
        customer: {
          // type: además de mostrarse, define si los precios se resuelven como mayorista
          select: { id: true, name: true, email: true, type: true, phone: true },
        },
        items: { orderBy: { id: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    });

    res.json(await enrichCarts(carts));
  } catch (err) {
    console.error("Error al obtener carritos:", err);
    res.status(500).json({ error: "Error al obtener carritos" });
  }
});

// PATCH /api/carts/items/:itemId - admin: cambiar cantidad de un item individual
// IMPORTANTE: esta ruta va ANTES de /:customerId para que Express no confunda "items" con un id
router.patch("/items/:itemId", authMiddleware, adminMiddleware, requireAnyPermission("clientes"), async (req, res) => {
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
router.delete("/items/:itemId", authMiddleware, adminMiddleware, requireAnyPermission("clientes"), async (req, res) => {
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
router.delete("/:customerId", authMiddleware, adminMiddleware, requireAnyPermission("clientes"), async (req, res) => {
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
// Precios vigentes y agotados del carrito: también los usa el recordatorio automático
// (services/cartReminder.service.js), para que el email diga lo que el cliente va a pagar hoy.
module.exports.enrichCarts = enrichCarts;

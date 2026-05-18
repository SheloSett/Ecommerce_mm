const cron = require("node-cron");
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const { sendMayoristaRestockEmail, sendMinoristaRecommendationEmail } = require("./email.service");

const prisma = new PrismaClient();

// Filtro Prisma para "productos disponibles": activos y con stock real.
// Mismo patrón que se usa en getProducts() del controller — un producto está disponible si:
// - stockUnlimited: true, o
// - no tiene variantes activas y stock > 0, o
// - tiene al menos una variante activa con stock disponible
const AVAILABLE_STOCK_FILTER = {
  OR: [
    { stockUnlimited: true },
    { AND: [{ variants: { none: { active: true } } }, { stock: { gt: 0 } }] },
    { variants: { some: { active: true, OR: [{ stockUnlimited: true }, { stock: { gt: 0 } }] } } },
  ],
};

// Días de espera entre emails de restock según cuántos ya se enviaron desde el último pedido
const RESTOCK_INTERVALS = { 0: 20, 1: 5, 2: 7 }; // count >= 3 → 14 días

function getRestockInterval(count) {
  return RESTOCK_INTERVALS[count] ?? 14;
}

// HMAC determinístico del ID del cliente — no necesita guardarse en DB
function buildUnsubscribeToken(customerId) {
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(`unsubscribe-restock-${customerId}`)
    .digest("hex");
}

// Leer configuración de campañas de email desde la DB
async function getEmailCampaignSettings() {
  const keys = [
    "emailMinoristaFrequencyDays",
    "emailMinoristaHour",
    "emailMinoristaProductCount",
    "emailMinoristaFeaturedProducts",
  ];
  const rows = await prisma.siteConfig.findMany({ where: { key: { in: keys } } });
  const map = {};
  rows.forEach((r) => (map[r.key] = r.value));

  let featuredProductIds = [];
  try {
    const raw = JSON.parse(map.emailMinoristaFeaturedProducts || "[]");
    // Soporta formato [{id, name, images}] (nuevo) y [id, id] (legado)
    featuredProductIds = raw.map((item) => (typeof item === "object" ? item.id : item));
  } catch {}

  return {
    frequencyDays:      parseInt(map.emailMinoristaFrequencyDays)  || 7,
    hour:               parseInt(map.emailMinoristaHour)            || 9,
    productCount:       parseInt(map.emailMinoristaProductCount)    || 4,
    featuredProductIds: Array.isArray(featuredProductIds) ? featuredProductIds : [],
  };
}

// ---------------------------------------------------------------------------
// JOB 1: Recordatorios de restock para MAYORISTAS
// Corre diariamente a las 12:00 UTC (09:00 Argentina UTC-3)
// ---------------------------------------------------------------------------
async function runMayoristaRestock() {
  console.log("[CRON] runMayoristaRestock iniciado");
  try {
    const customers = await prisma.customer.findMany({
      where: { type: "MAYORISTA", status: "APPROVED", unsubscribeRestock: false },
      include: {
        orders: {
          where: { status: "APPROVED" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    for (const customer of customers) {
      const lastOrder = customer.orders[0];
      if (!lastOrder) continue;

      const now = new Date();
      const count = customer.restockEmailCount;
      const sentAt = customer.restockEmailSentAt;

      let shouldSend = false;

      if (count === 0) {
        const daysSinceOrder = (now - lastOrder.createdAt) / 86400000;
        shouldSend = daysSinceOrder >= 20;
      } else {
        // Si hubo un nuevo pedido aprobado después del último email → resetear y saltar
        if (lastOrder.createdAt > sentAt) {
          await prisma.customer.update({
            where: { id: customer.id },
            data: { restockEmailCount: 0, restockEmailSentAt: null },
          });
          continue;
        }
        const interval = getRestockInterval(count);
        const daysSinceEmail = (now - sentAt) / 86400000;
        shouldSend = daysSinceEmail >= interval;
      }

      if (!shouldSend) continue;

      const token = buildUnsubscribeToken(customer.id);
      const unsubscribeUrl = `${process.env.FRONTEND_URL}/unsubscribe/restock?token=${token}&id=${customer.id}`;

      await sendMayoristaRestockEmail(customer, unsubscribeUrl).catch((e) =>
        console.error(`[CRON] Error enviando restock email a customer ${customer.id}:`, e.message)
      );

      await prisma.customer.update({
        where: { id: customer.id },
        data: { restockEmailCount: count + 1, restockEmailSentAt: now },
      });

      console.log(`[CRON] Restock email #${count + 1} enviado a ${customer.email}`);
    }
  } catch (err) {
    console.error("[CRON] Error en runMayoristaRestock:", err.message);
  }
}

// ---------------------------------------------------------------------------
// JOB 2: Recomendaciones para MINORISTAS
// Corre cada hora — la lógica interna verifica si corresponde enviar según
// la hora configurada y la frecuencia en días.
// ---------------------------------------------------------------------------
async function runMinoristaRecommendations() {
  const settings = await getEmailCampaignSettings();
  const { frequencyDays, hour, productCount, featuredProductIds } = settings;

  // Verificar si la hora actual en Argentina coincide con la hora configurada
  const currentArHour = (new Date().getUTCHours() - 3 + 24) % 24;
  if (currentArHour !== hour) return;

  console.log("[CRON] runMinoristaRecommendations iniciado");
  try {
    const minIntervalMs = (frequencyDays - 0.5) * 24 * 60 * 60 * 1000; // margen de medio día

    const customers = await prisma.customer.findMany({
      where: { type: "MINORISTA", status: "APPROVED" },
      include: {
        orders: {
          where: { status: "APPROVED" },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            items: {
              // Product usa relación M2M `categories`, no `categoryId` directo
              include: { product: { select: { id: true, categories: { select: { id: true } } } } },
            },
          },
        },
      },
    });

    // Cargar productos destacados configurados por el admin (una sola vez)
    // Filtramos por stock disponible — si un destacado se quedó sin stock, no se envía
    let adminFeaturedProducts = [];
    if (featuredProductIds.length > 0) {
      adminFeaturedProducts = await prisma.product.findMany({
        where: { active: true, id: { in: featuredProductIds }, ...AVAILABLE_STOCK_FILTER },
      });
    }

    for (const customer of customers) {
      const lastOrder = customer.orders[0];
      if (!lastOrder) continue;

      // Evitar envíos duplicados si el container se reinicia el mismo día
      if (
        customer.lastRecommendationEmail &&
        new Date() - customer.lastRecommendationEmail < minIntervalMs
      ) continue;

      // Aplanar las categorías de todos los productos del pedido (M2M → cada producto puede tener varias)
      const categoryIds = [
        ...new Set(
          lastOrder.items
            .flatMap((i) => i.product?.categories?.map((c) => c.id) || [])
            .filter(Boolean)
        ),
      ];
      const purchasedProductIds = lastOrder.items.map((i) => i.product?.id).filter(Boolean);

      // Productos de la misma categoría del último pedido (filtro M2M con `some`)
      // Solo productos con stock disponible — no recomendar nada que el cliente no pueda comprar
      const categoryProducts = await prisma.product.findMany({
        where: {
          active: true,
          categories: { some: { id: { in: categoryIds } } },
          id: { notIn: purchasedProductIds },
          ...AVAILABLE_STOCK_FILTER,
        },
        take: productCount,
        orderBy: { createdAt: "desc" },
      });

      // Combinar: destacados del admin primero, luego los de la categoría, sin duplicados
      const seen = new Set();
      const products = [];
      for (const p of [...adminFeaturedProducts, ...categoryProducts]) {
        if (!seen.has(p.id) && products.length < productCount) {
          seen.add(p.id);
          products.push(p);
        }
      }

      // Completar con otros productos activos y con stock si no alcanza el cupo
      if (products.length < productCount) {
        const extra = await prisma.product.findMany({
          where: {
            active: true,
            id: { notIn: [...purchasedProductIds, ...Array.from(seen)] },
            ...AVAILABLE_STOCK_FILTER,
          },
          take: productCount - products.length,
          orderBy: { createdAt: "desc" },
        });
        products.push(...extra);
      }

      if (products.length === 0) continue;

      await sendMinoristaRecommendationEmail(customer, products).catch((e) =>
        console.error(`[CRON] Error enviando recomendaciones a customer ${customer.id}:`, e.message)
      );

      await prisma.customer.update({
        where: { id: customer.id },
        data: { lastRecommendationEmail: new Date() },
      });

      console.log(`[CRON] Recomendaciones enviadas a ${customer.email} (${products.length} productos)`);
    }
  } catch (err) {
    console.error("[CRON] Error en runMinoristaRecommendations:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Inicializar los cron jobs
// ---------------------------------------------------------------------------
function startCronJobs() {
  // Mayoristas: diario a las 12:00 UTC (09:00 Argentina)
  cron.schedule("0 12 * * *", runMayoristaRestock);

  // Minoristas: cada hora — la función interna verifica si coincide la hora configurada
  cron.schedule("0 * * * *", runMinoristaRecommendations);

  console.log("✅ Cron jobs iniciados (restock mayoristas + recomendaciones minoristas)");
}

// ---------------------------------------------------------------------------
// VERSIONES "FORCE" PARA TESTING — bypassean checks de tiempo/hora.
// Solo se ejecutan para UN cliente específico (recibido por email) y siempre
// envían el email, ignorando si pasó el threshold de días o si es la hora correcta.
// No actualizan los campos restockEmailCount / lastRecommendationEmail para
// no afectar al ciclo normal del cron al usarlo en prueba.
// ---------------------------------------------------------------------------
async function forceRestockEmailForEmail(targetEmail) {
  const customer = await prisma.customer.findUnique({
    where: { email: targetEmail },
    include: {
      orders: {
        where: { status: "APPROVED" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!customer) throw new Error("Cliente no encontrado");
  if (customer.type !== "MAYORISTA") throw new Error("El cliente no es mayorista");
  if (customer.orders.length === 0) throw new Error("El cliente no tiene pedidos aprobados");

  const token = buildUnsubscribeToken(customer.id);
  const unsubscribeUrl = `${process.env.FRONTEND_URL}/unsubscribe/restock?token=${token}&id=${customer.id}`;
  await sendMayoristaRestockEmail(customer, unsubscribeUrl);
  return { sentTo: customer.email };
}

async function forceRecommendationEmailForEmail(targetEmail) {
  const settings = await getEmailCampaignSettings();
  const { productCount, featuredProductIds } = settings;

  const customer = await prisma.customer.findUnique({
    where: { email: targetEmail },
    include: {
      orders: {
        where: { status: "APPROVED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        // Product usa relación M2M `categories`, no `categoryId` directo
        include: { items: { include: { product: { select: { id: true, categories: { select: { id: true } } } } } } },
      },
    },
  });
  if (!customer) throw new Error("Cliente no encontrado");
  if (customer.type !== "MINORISTA") throw new Error("El cliente no es minorista");
  if (customer.orders.length === 0) throw new Error("El cliente no tiene pedidos aprobados");

  const lastOrder = customer.orders[0];
  // Aplanar las categorías de todos los items (M2M → cada producto puede tener varias)
  const categoryIds = [
    ...new Set(
      lastOrder.items
        .flatMap((i) => i.product?.categories?.map((c) => c.id) || [])
        .filter(Boolean)
    ),
  ];
  const purchasedProductIds = lastOrder.items.map((i) => i.product?.id).filter(Boolean);

  let adminFeaturedProducts = [];
  if (featuredProductIds.length > 0) {
    adminFeaturedProducts = await prisma.product.findMany({
      where: { active: true, id: { in: featuredProductIds }, ...AVAILABLE_STOCK_FILTER },
    });
  }

  const categoryProducts = await prisma.product.findMany({
    // Filtro M2M con `some` + filtro de stock disponible
    where: {
      active: true,
      categories: { some: { id: { in: categoryIds } } },
      id: { notIn: purchasedProductIds },
      ...AVAILABLE_STOCK_FILTER,
    },
    take: productCount,
    orderBy: { createdAt: "desc" },
  });

  const seen = new Set();
  const products = [];
  for (const p of [...adminFeaturedProducts, ...categoryProducts]) {
    if (!seen.has(p.id) && products.length < productCount) {
      seen.add(p.id);
      products.push(p);
    }
  }
  if (products.length < productCount) {
    const extra = await prisma.product.findMany({
      where: {
        active: true,
        id: { notIn: [...purchasedProductIds, ...Array.from(seen)] },
        ...AVAILABLE_STOCK_FILTER,
      },
      take: productCount - products.length,
      orderBy: { createdAt: "desc" },
    });
    products.push(...extra);
  }

  if (products.length === 0) throw new Error("No hay productos para recomendar");

  await sendMinoristaRecommendationEmail(customer, products);
  return { sentTo: customer.email, productsCount: products.length };
}

module.exports = {
  startCronJobs,
  buildUnsubscribeToken,
  runMayoristaRestock,
  runMinoristaRecommendations,
  forceRestockEmailForEmail,
  forceRecommendationEmailForEmail,
};

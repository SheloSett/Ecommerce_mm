// CRUD de campañas de oferta. Toda la lógica de precios vive en services/offers.service.js —
// acá solo se validan los datos y se dispara la sincronización.
//
// PATRÓN DE ESCRITURA: cualquier cambio que afecte qué productos entran o cuánto descuentan hace
// revertOffer() → guardar → syncOffer(). Revertir primero es lo que garantiza que un producto sacado
// de la campaña recupere su precio: si solo borráramos el OfferItem, su precio de oferta quedaría
// escrito para siempre sin que nadie sepa de dónde salió.

// CANDADO: el cron sincroniza las campañas cada minuto. Toda secuencia que escriba precios va
// envuelta ENTERA en withOfferLock() — no alcanza con proteger cada paso por separado, porque el
// cron podría meterse entre "revertir" y "guardar" y re-aplicar con la lista de productos vieja,
// dejando precios escritos en productos que justo salían de la campaña.

const { PrismaClient } = require("@prisma/client");
const {
  withOfferLock,
  revertOffer,
  syncOffer,
  previewOffer,
  offerState,
} = require("../services/offers.service");

const prisma = new PrismaClient();

// ── Validación ────────────────────────────────────────────────────────────────

// Devuelve un string con el error, o null si está todo bien.
function validateOfferPayload(body, { partial = false } = {}) {
  const { name, discountType, discountValue, appliesTo, startsAt, endsAt } = body;

  if (!partial || name !== undefined) {
    if (!name || !String(name).trim()) return "El nombre de la campaña es obligatorio";
  }
  if (!partial || discountType !== undefined) {
    if (discountType && !["PERCENTAGE", "FIXED"].includes(discountType)) {
      return "discountType debe ser PERCENTAGE o FIXED";
    }
  }
  if (!partial || discountValue !== undefined) {
    const v = parseFloat(discountValue);
    if (isNaN(v) || v <= 0) return "El descuento debe ser un número mayor a 0";
    const type = discountType || "PERCENTAGE";
    if (type === "PERCENTAGE" && v >= 100) return "Un descuento por porcentaje debe ser menor a 100";
  }
  if (!partial || appliesTo !== undefined) {
    if (appliesTo && !["MINORISTA", "MAYORISTA", "AMBOS"].includes(appliesTo)) {
      return "appliesTo debe ser MINORISTA, MAYORISTA o AMBOS";
    }
  }
  if (!partial || startsAt !== undefined || endsAt !== undefined) {
    // Al crear (partial=false) las fechas son obligatorias. Antes solo se validaban si venían, así
    // que un POST sin fechas pasaba la validación y explotaba más adelante en `new Date(undefined)`
    // → Invalid Date → error de Prisma → 500 genérico en vez de un 400 que explique qué falta.
    if (!partial) {
      if (!startsAt) return "Falta la fecha de inicio de la campaña";
      if (!endsAt)   return "Falta la fecha de fin de la campaña";
    }
    if (startsAt !== undefined && isNaN(new Date(startsAt).getTime())) return "Fecha de inicio inválida";
    if (endsAt !== undefined && isNaN(new Date(endsAt).getTime())) return "Fecha de fin inválida";
    if (startsAt !== undefined && endsAt !== undefined && new Date(startsAt) >= new Date(endsAt)) {
      return "La fecha de fin debe ser posterior a la de inicio";
    }
  }
  return null;
}

// Normaliza y deduplica la lista de productos que manda el frontend.
function parseProductIds(productIds) {
  if (!Array.isArray(productIds)) return null;
  return [...new Set(productIds.map((id) => parseInt(id)).filter((id) => !isNaN(id)))];
}

// Agrega el estado derivado (ACTIVA / PROGRAMADA / FINALIZADA / PAUSADA) a la respuesta.
const withState = (offer) => ({ ...offer, state: offerState(offer) });

// ── GET /api/offers/active — público ──────────────────────────────────────────
// TODAS las campañas vigentes. Solo metadatos: los productos los pide el front con
// GET /api/products?offerId=N, que ya resuelve visibilidad, stock y precios de variante.
//
// showInHome viaja en la respuesta pero NO se filtra acá: ese flag decide si la campaña arma su
// sección en el Home, no si existe. El catálogo ofrece filtrar por cualquier campaña vigente, y es
// el Home el que descarta las que no quieren sección. Filtrarlo acá dejaba al catálogo sin poder
// mostrar campañas que el admin no quiso publicar en la portada.
async function getActiveOffers(req, res) {
  try {
    const now = new Date();
    const offers = await prisma.offer.findMany({
      where: {
        active: true,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      select: { id: true, name: true, description: true, endsAt: true, appliesTo: true, showInHome: true },
      orderBy: { startsAt: "desc" },
    });
    res.json(offers);
  } catch (err) {
    console.error("getActiveOffers error:", err);
    res.status(500).json({ error: "Error al obtener las campañas activas" });
  }
}

// ── GET /api/offers — admin ───────────────────────────────────────────────────
async function getOffers(req, res) {
  try {
    const offers = await prisma.offer.findMany({
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(offers.map(withState));
  } catch (err) {
    console.error("getOffers error:", err);
    res.status(500).json({ error: "Error al obtener las campañas" });
  }
}

// ── GET /api/offers/:id — admin ───────────────────────────────────────────────
// Incluye, por producto, qué escribió la campaña y por qué quedó (total o parcialmente) afuera.
async function getOffer(req, res) {
  try {
    const offer = await prisma.offer.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true, name: true, images: true, currency: true,
                price: true, salePrice: true,
                wholesalePrice: true, wholesaleSalePrice: true,
              },
            },
          },
        },
      },
    });
    if (!offer) return res.status(404).json({ error: "Campaña no encontrada" });
    res.json(withState(offer));
  } catch (err) {
    console.error("getOffer error:", err);
    res.status(500).json({ error: "Error al obtener la campaña" });
  }
}

// ── POST /api/offers — admin ──────────────────────────────────────────────────
async function createOffer(req, res) {
  try {
    const error = validateOfferPayload(req.body);
    if (error) return res.status(400).json({ error });

    const productIds = parseProductIds(req.body.productIds) || [];
    if (productIds.length === 0) {
      return res.status(400).json({ error: "Elegí al menos un producto para la campaña" });
    }

    const offer = await prisma.offer.create({
      data: {
        name:          String(req.body.name).trim(),
        description:   req.body.description?.trim() || null,
        discountType:  req.body.discountType || "PERCENTAGE",
        discountValue: parseFloat(req.body.discountValue),
        appliesTo:     req.body.appliesTo || "AMBOS",
        startsAt:      new Date(req.body.startsAt),
        endsAt:        new Date(req.body.endsAt),
        showInHome:    req.body.showInHome !== false,
        active:        req.body.active !== false,
        items: { create: productIds.map((productId) => ({ productId })) },
      },
    });

    // Si el rango ya está abierto, los precios se escriben ahora mismo (sin esperar al cron).
    // Bajo candado: si el tick del cron agarra la campaña recién creada, uno espera al otro en vez
    // de escribir los mismos precios en paralelo.
    const sync = await withOfferLock(offer.id, () => syncOffer(offer.id));

    res.status(201).json({ ...withState(offer), sync });
  } catch (err) {
    console.error("createOffer error:", err);
    res.status(500).json({ error: "Error al crear la campaña" });
  }
}

// ── PATCH /api/offers/:id — admin ─────────────────────────────────────────────
// Sirve tanto para editar como para pausar/reanudar (active: false/true).
async function updateOffer(req, res) {
  try {
    const id = parseInt(req.params.id);

    // TODO el bloque va adentro del candado, incluida la lectura de `existing`: si leyéramos afuera,
    // el cron podría cambiar `applied` entre la lectura y el revert, y decidiríamos si hay que
    // revertir mirando un dato viejo. Las respuestas HTTP se arman después, con lo que devuelve.
    const outcome = await withOfferLock(id, async () => {
      const existing = await prisma.offer.findUnique({ where: { id } });
      if (!existing) return { notFound: true };

      // Para validar el rango hace falta comparar contra los valores que van a quedar, no solo
      // contra los que vienen en el body (se puede mandar solo uno de los dos).
      const merged = {
        discountType:  req.body.discountType  ?? existing.discountType,
        discountValue: req.body.discountValue ?? existing.discountValue,
        appliesTo:     req.body.appliesTo     ?? existing.appliesTo,
        startsAt:      req.body.startsAt      ?? existing.startsAt,
        endsAt:        req.body.endsAt        ?? existing.endsAt,
        name:          req.body.name          ?? existing.name,
      };
      const error = validateOfferPayload(merged);
      if (error) return { error };

      const productIds = parseProductIds(req.body.productIds);
      if (productIds && productIds.length === 0) {
        return { error: "La campaña tiene que tener al menos un producto" };
      }

      // Revertir ANTES de tocar nada: devuelve su precio a los productos que salen de la campaña y
      // limpia lo escrito con los parámetros viejos. Después syncOffer() vuelve a aplicar lo que
      // corresponda con los nuevos.
      if (existing.applied) await revertOffer(id);

      const data = {
        name:          String(merged.name).trim(),
        discountType:  merged.discountType,
        discountValue: parseFloat(merged.discountValue),
        appliesTo:     merged.appliesTo,
        startsAt:      new Date(merged.startsAt),
        endsAt:        new Date(merged.endsAt),
      };
      if (req.body.description !== undefined) data.description = req.body.description?.trim() || null;
      if (req.body.showInHome !== undefined)  data.showInHome  = !!req.body.showInHome;
      if (req.body.active !== undefined)      data.active      = !!req.body.active;

      // Reemplazo de la lista de productos: se borran los que ya no están y se crean los nuevos,
      // conservando los OfferItem que siguen (no hace falta tocarlos, ya vienen revertidos).
      if (productIds) {
        data.items = {
          deleteMany: { productId: { notIn: productIds } },
          connectOrCreate: productIds.map((productId) => ({
            where:  { offerId_productId: { offerId: id, productId } },
            create: { productId },
          })),
        };
      }

      const offer = await prisma.offer.update({ where: { id }, data });
      const sync = await syncOffer(id);
      return { offer, sync };
    });

    if (outcome.notFound) return res.status(404).json({ error: "Campaña no encontrada" });
    if (outcome.error)    return res.status(400).json({ error: outcome.error });

    res.json({ ...withState(outcome.offer), sync: outcome.sync });
  } catch (err) {
    console.error("updateOffer error:", err);
    res.status(500).json({ error: "Error al actualizar la campaña" });
  }
}

// ── DELETE /api/offers/:id — admin ────────────────────────────────────────────
async function deleteOffer(req, res) {
  try {
    const id = parseInt(req.params.id);

    // Bajo candado y con la lectura adentro: si el cron re-aplicara la campaña entre el revert y el
    // delete, los precios quedarían escritos y los OfferItem que los identifican se irían en cascada
    // con el borrado — descuento pegado y sin forma de saber de dónde salió.
    const outcome = await withOfferLock(id, async () => {
      const offer = await prisma.offer.findUnique({ where: { id } });
      if (!offer) return { notFound: true };

      // Sin esto los precios de oferta quedarían escritos y sin dueño (los OfferItem se van en cascada).
      if (offer.applied) await revertOffer(id);

      await prisma.offer.delete({ where: { id } });
      return { ok: true };
    });

    if (outcome.notFound) return res.status(404).json({ error: "Campaña no encontrada" });
    res.json({ ok: true });
  } catch (err) {
    console.error("deleteOffer error:", err);
    res.status(500).json({ error: "Error al eliminar la campaña" });
  }
}

// ── POST /api/offers/:id/sync — admin ─────────────────────────────────────────
// "Sincronizar ahora": aplica o revierte según el reloj, sin esperar el tick del cron. Útil para
// probar y para forzar la entrada de variantes creadas después de arrancar la campaña.
async function syncOfferNow(req, res) {
  try {
    const id = parseInt(req.params.id);
    // Antes: await syncOffer(id) — sin candado, podía cruzarse con el tick del cron.
    const result = await withOfferLock(id, () => syncOffer(id));
    if (!result) return res.status(404).json({ error: "Campaña no encontrada" });
    res.json(result);
  } catch (err) {
    console.error("syncOfferNow error:", err);
    res.status(500).json({ error: "Error al sincronizar la campaña" });
  }
}

// ── POST /api/offers/preview — admin ──────────────────────────────────────────
// Qué le pasaría a cada producto con estos parámetros. Usa el mismo planificador que la aplicación
// real, así lo que el admin ve antes de guardar es exactamente lo que va a ocurrir.
async function previewOfferPrices(req, res) {
  try {
    const error = validateOfferPayload(req.body, { partial: true });
    if (error) return res.status(400).json({ error });

    const productIds = parseProductIds(req.body.productIds) || [];
    const offerLike = {
      discountType:  req.body.discountType || "PERCENTAGE",
      discountValue: parseFloat(req.body.discountValue),
      appliesTo:     req.body.appliesTo || "AMBOS",
    };
    const offerId = req.body.offerId ? parseInt(req.body.offerId) : null;

    res.json(await previewOffer(offerLike, productIds, offerId));
  } catch (err) {
    console.error("previewOfferPrices error:", err);
    res.status(500).json({ error: "Error al calcular la vista previa" });
  }
}

module.exports = {
  getActiveOffers,
  getOffers,
  getOffer,
  createOffer,
  updateOffer,
  deleteOffer,
  syncOfferNow,
  previewOfferPrices,
};

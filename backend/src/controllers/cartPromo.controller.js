// Descuento por monto de compra (model CartPromo): alta, edición y baja desde Admin → Descuento por monto,
// y la consulta pública que usa el carrito para mostrar "Te faltan $X para el 10%".
// Las reglas del cálculo están en utils/cartPromo.js y la elección de la promo de un pedido en
// services/cartPromo.service.js.

const prisma = require("../lib/prisma"); // cliente único (ver lib/prisma.js)
const { resolvePriceViewer } = require("../utils/productPrivacy");
const { normalizePromoTiers } = require("../utils/cartPromo");
const { livePromos } = require("../services/cartPromo.service");

const APPLIES_TO = ["MINORISTA", "MAYORISTA", "AMBOS"];
const MAX_TIERS = 10;
const MAX_SCOPE_CATEGORIES = 100;
const MAX_SCOPE_PRODUCTS = 1000;
// Estilos de la tarjeta y del aviso del carrito: los mismos que las campañas (misma lista que
// CARD_STYLE_KEYS en offer.controller.js; se dibujan con CampaignCard.jsx / category-cards.css).
const CARD_STYLE_KEYS = ["normal", "fire", "sale", "fresh", "premium", "bolt", "neon", "ice", "blackfriday", "cybermonday", "color"];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Estado para el listado del panel, calculado con la fecha de hoy (no se guarda).
function withState(promo, now = new Date()) {
  let state = "VIGENTE";
  if (!promo.active) state = "PAUSADA";
  else if (new Date(promo.startsAt) > now) state = "PROGRAMADA";
  else if (new Date(promo.endsAt) <= now) state = "TERMINADA";
  return { ...promo, state };
}

// Valida lo que manda el panel. Devuelve { data } listo para Prisma o { error } con el motivo.
// En una edición (existing) los campos que no vienen se toman de la promo guardada.
function parsePromoBody(body, existing = null) {
  const pick = (k) => (body[k] !== undefined ? body[k] : existing?.[k]);

  const name = String(pick("name") ?? "").trim();
  if (!name) return { error: "Poné un nombre para la promo (es lo que ve el cliente, ej: Black Friday)" };
  if (name.length > 60) return { error: "El nombre puede tener hasta 60 letras" };

  const rawTiers = pick("tiers");
  if (!Array.isArray(rawTiers) || rawTiers.length === 0) return { error: "Agregá al menos un escalón (a partir de cuánto y qué %)" };
  if (rawTiers.length > MAX_TIERS) return { error: `Hasta ${MAX_TIERS} escalones` };
  const tiers = normalizePromoTiers(rawTiers);
  // normalizePromoTiers descarta lo inválido: si se perdió alguno, había un monto o un % mal escrito.
  if (tiers.length !== rawTiers.length) return { error: "Revisá los escalones: cada uno necesita un monto (de $0 en adelante) y un % entre 1 y 100" };
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].minAmount === tiers[i - 1].minAmount) return { error: "Hay dos escalones con el mismo monto" };
    // Un escalón más alto que dé menos % no tiene sentido y casi siempre es un error de tipeo.
    if (tiers[i].percent <= tiers[i - 1].percent) return { error: "Cada escalón tiene que dar más % que el anterior" };
  }

  const appliesTo = pick("appliesTo") || "AMBOS";
  if (!APPLIES_TO.includes(appliesTo)) return { error: "Elegí para quién es la promo" };

  const startsAt = new Date(pick("startsAt"));
  const endsAt   = new Date(pick("endsAt"));
  if (isNaN(startsAt.getTime())) return { error: "Falta la fecha de inicio" };
  if (isNaN(endsAt.getTime()))   return { error: "Falta la fecha de fin" };
  if (startsAt >= endsAt)        return { error: "La fecha de fin tiene que ser posterior a la de inicio" };

  const active = pick("active");

  // Cómo se ve (tarjeta del inicio y aviso del carrito)
  const description = String(pick("description") ?? "").trim();
  if (description.length > 140) return { error: "El subtítulo puede tener hasta 140 letras" };
  const cardStyle = pick("cardStyle") || "blackfriday";
  if (!CARD_STYLE_KEYS.includes(cardStyle)) return { error: "Estilo inválido" };
  const rawColor = pick("cardColor");
  const cardColor = rawColor ? String(rawColor).trim().toLowerCase() : null;
  if (cardColor && !HEX_COLOR.test(cardColor)) return { error: "El color tiene que ser del tipo #d81b60" };
  if (cardStyle === "color" && !cardColor) return { error: "Elegí el color de la promo" };
  const showCard = pick("showCard");
  const showCountdown = pick("showCountdown");

  // Qué productos entran (24/11/2026): ids de categoría y de producto; vacías las dos = todos.
  const idList = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0))];
  const categoryIds = idList(pick("categoryIds"));
  const productIds = idList(pick("productIds"));
  if (categoryIds.length > MAX_SCOPE_CATEGORIES) return { error: `Hasta ${MAX_SCOPE_CATEGORIES} categorías` };
  if (productIds.length > MAX_SCOPE_PRODUCTS) return { error: `Hasta ${MAX_SCOPE_PRODUCTS} productos sueltos (para más, elegí la categoría)` };

  // Antes: return { data: { name, tiers, appliesTo, startsAt, endsAt, active: active === undefined ? true : !!active } };
  return {
    data: {
      name, tiers, appliesTo, startsAt, endsAt, active: active === undefined ? true : !!active,
      description: description || null,
      cardStyle,
      cardColor,
      showCard: showCard === undefined ? true : !!showCard,
      showCountdown: showCountdown === undefined ? true : !!showCountdown,
      categoryIds,
      productIds,
    },
  };
}

// ── GET /api/cart-promos/active — pública ─────────────────────────────────────
// Las promos vigentes que le corresponden a quien pregunta: un minorista o invitado ve las de
// MINORISTA/AMBOS y un mayorista las de MAYORISTA/AMBOS. El panel (admin) las ve todas, con appliesTo,
// para la casilla "Aplicar promo" de la venta manual, que puede ser para cualquiera de los dos.
async function getActivePromos(req, res) {
  try {
    const [promos, viewer] = await Promise.all([livePromos(), resolvePriceViewer(req, prisma)]);
    const tipo = viewer.isMayorista ? "MAYORISTA" : "MINORISTA";
    const visibles = viewer.isAdmin ? promos : promos.filter((p) => p.appliesTo === "AMBOS" || p.appliesTo === tipo);
    // Antes: { id, name, tiers, appliesTo, endsAt }. Ahora también cómo se ve, para la tarjeta del inicio y
    // el aviso del carrito.
    // productIds: los ids de producto que entran (null = todos), para que el carrito mida y descuente solo
    // esos; scopeLabel: "En Audio y Cables" para la tarjeta del inicio y el aviso del carrito.
    res.json(visibles.map((p) => ({
      id: p.id, name: p.name, tiers: normalizePromoTiers(p.tiers), appliesTo: p.appliesTo, endsAt: p.endsAt,
      description: p.description, showCard: p.showCard, cardStyle: p.cardStyle, cardColor: p.cardColor,
      showCountdown: p.showCountdown,
      productIds: p.eligibleProductIds ?? null, scopeLabel: p.scopeLabel ?? null,
    })));
  } catch (err) {
    console.error("getActivePromos error:", err);
    res.status(500).json({ error: "Error al obtener las promos" });
  }
}

// ── GET /api/cart-promos — admin ──────────────────────────────────────────────
async function getPromos(req, res) {
  try {
    const promos = await prisma.cartPromo.findMany({
      // _count.orders: cuántos pedidos la usaron (incluye los que todavía no se pagaron)
      include: { _count: { select: { orders: true } } },
      orderBy: { startsAt: "desc" },
    });
    // Nombres de las categorías y productos elegidos, para mostrarlos en el panel
    const catIds = [...new Set(promos.flatMap((p) => p.categoryIds || []))];
    const prodIds = [...new Set(promos.flatMap((p) => p.productIds || []))];
    const [cats, prods] = await Promise.all([
      catIds.length ? prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } }) : [],
      prodIds.length ? prisma.product.findMany({ where: { id: { in: prodIds } }, select: { id: true, name: true } }) : [],
    ]);
    const catName = new Map(cats.map((c) => [c.id, c.name]));
    const prodName = new Map(prods.map((p) => [p.id, p.name]));
    res.json(promos.map((p) => ({
      ...withState(p),
      scopeCategories: (p.categoryIds || []).filter((id) => catName.has(id)).map((id) => ({ id, name: catName.get(id) })),
      scopeProducts: (p.productIds || []).filter((id) => prodName.has(id)).map((id) => ({ id, name: prodName.get(id) })),
    })));
  } catch (err) {
    console.error("getPromos error:", err);
    res.status(500).json({ error: "Error al obtener las promos" });
  }
}

// ── POST /api/cart-promos — admin ─────────────────────────────────────────────
async function createPromo(req, res) {
  try {
    const { data, error } = parsePromoBody(req.body || {});
    if (error) return res.status(400).json({ error });
    const promo = await prisma.cartPromo.create({ data });
    res.status(201).json(withState(promo));
  } catch (err) {
    console.error("createPromo error:", err);
    res.status(500).json({ error: "Error al crear la promo" });
  }
}

// ── PATCH /api/cart-promos/:id — admin ────────────────────────────────────────
// Cambiar la promo no toca los pedidos que ya la usaron: cada uno guardó sus escalones (Order.promoRule).
async function updatePromo(req, res) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.cartPromo.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Promo no encontrada" });
    const { data, error } = parsePromoBody(req.body || {}, existing);
    if (error) return res.status(400).json({ error });
    const promo = await prisma.cartPromo.update({ where: { id }, data });
    res.json(withState(promo));
  } catch (err) {
    console.error("updatePromo error:", err);
    res.status(500).json({ error: "Error al guardar la promo" });
  }
}

// ── DELETE /api/cart-promos/:id — admin ───────────────────────────────────────
// Los pedidos que la usaron quedan igual: conservan el nombre, el % y el monto descontado (promoRule,
// promoPercent, promoDiscount); solo se les vacía promoId.
async function deletePromo(req, res) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.cartPromo.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Promo no encontrada" });
    await prisma.cartPromo.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("deletePromo error:", err);
    res.status(500).json({ error: "Error al borrar la promo" });
  }
}

module.exports = { getActivePromos, getPromos, createPromo, updatePromo, deletePromo, parsePromoBody, withState };

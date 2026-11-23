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
  if (!Array.isArray(rawTiers) || rawTiers.length === 0) return { error: "Agregá al menos un escalón (desde cuánto y qué %)" };
  if (rawTiers.length > MAX_TIERS) return { error: `Hasta ${MAX_TIERS} escalones` };
  const tiers = normalizePromoTiers(rawTiers);
  // normalizePromoTiers descarta lo inválido: si se perdió alguno, había un monto o un % mal escrito.
  if (tiers.length !== rawTiers.length) return { error: "Revisá los escalones: cada uno necesita un monto (desde $0) y un % entre 1 y 100" };
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
  return { data: { name, tiers, appliesTo, startsAt, endsAt, active: active === undefined ? true : !!active } };
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
    res.json(visibles.map((p) => ({
      id: p.id, name: p.name, tiers: normalizePromoTiers(p.tiers), appliesTo: p.appliesTo, endsAt: p.endsAt,
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
    res.json(promos.map((p) => withState(p)));
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

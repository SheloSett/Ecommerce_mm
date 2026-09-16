// ─── Categorías inteligentes (con regla) ──────────────────────────────────────
// Una categoría puede tener, además de los productos asignados a mano, una REGLA que se evalúa
// al momento de consultar: "stock bajo hasta X", "en oferta", "novedades de los últimos X días",
// "más vendidos", "precio hasta $X". No se asigna nada en la base ni corre ningún job: la categoría
// muestra la unión de lo asignado a mano + lo que cumple la regla, siempre al día.
//
// La regla se guarda en Category.rule (JSON): { type, max?, days? }.

const RULE_TYPES = ["lowStock", "onSale", "newDays", "hotSeller", "priceMax"];

// Valida lo que manda el admin. Devuelve la regla normalizada o null (sin regla).
function normalizeRule(input) {
  if (!input || typeof input !== "object" || !RULE_TYPES.includes(input.type)) return null;
  const num = (v, def, min = 1, max = 100000000) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : def;
  };
  switch (input.type) {
    case "lowStock": return { type: "lowStock", max: num(input.max, 5, 1, 100000) };
    case "newDays":  return { type: "newDays", days: num(input.days, 30, 1, 3650) };
    case "priceMax": return { type: "priceMax", max: num(input.max, 10000, 1) };
    case "onSale":   return { type: "onSale" };
    case "hotSeller": return { type: "hotSeller" };
    default: return null;
  }
}

// Texto para mostrar la regla en el admin y en los avisos.
function describeRule(rule) {
  const r = normalizeRule(rule);
  if (!r) return null;
  switch (r.type) {
    case "lowStock": return `Stock bajo: hasta ${r.max} unidad${r.max === 1 ? "" : "es"}`;
    case "onSale":   return "En oferta";
    case "newDays":  return `Novedades: últimos ${r.days} días`;
    case "hotSeller": return "Más vendidos";
    case "priceMax": return `Precio hasta $${r.max.toLocaleString("es-AR")}`;
    default: return null;
  }
}

// IDs de los productos ACTIVOS que cumplen la regla. visibleFor (MINORISTA/MAYORISTA) decide qué
// precio de oferta / mayorista se mira; sin visibleFor se usa el criterio minorista.
async function ruleProductIds(prisma, rule, { visibleFor } = {}) {
  const r = normalizeRule(rule);
  if (!r) return [];
  const mayorista = visibleFor === "MAYORISTA";

  if (r.type === "lowStock") {
    // El stock de un producto con variantes vive en las variantes: se suma el de las finitas.
    // Si el producto o alguna variante es ilimitada, queda afuera (no tiene "pocas unidades").
    const rows = await prisma.$queryRaw`
      SELECT p.id
      FROM products p
      LEFT JOIN product_variants v ON v."productId" = p.id
      WHERE p.active = true AND p."stockUnlimited" = false
      GROUP BY p.id, p.stock
      HAVING COALESCE(BOOL_OR(v."stockUnlimited"), false) = false
         AND (CASE WHEN COUNT(v.id) > 0 THEN COALESCE(SUM(v.stock), 0) ELSE p.stock END) BETWEEN 1 AND ${r.max}
    `;
    return rows.map((x) => x.id);
  }

  let where;
  if (r.type === "onSale") {
    where = mayorista ? { wholesaleSalePrice: { not: null } } : { salePrice: { not: null } };
  } else if (r.type === "newDays") {
    where = { createdAt: { gte: new Date(Date.now() - r.days * 24 * 60 * 60 * 1000) } };
  } else if (r.type === "hotSeller") {
    where = { hotSeller: true };
  } else if (r.type === "priceMax") {
    // Solo productos en pesos: comparar USD 25 contra $25.000 no tiene sentido.
    where = mayorista
      ? { currency: "ARS", OR: [{ wholesalePrice: { lte: r.max } }, { wholesalePrice: null, price: { lte: r.max } }] }
      : { currency: "ARS", price: { lte: r.max } };
  }
  const rows = await prisma.product.findMany({ where: { active: true, ...where }, select: { id: true } });
  return rows.map((x) => x.id);
}

// Condición Prisma para "filtrar por estas categorías" (slugs), contemplando las reglas.
// Devuelve un objeto para meter dentro de where.AND. Si ningún slug existe, una condición que no
// matchea nada (comportamiento anterior).
async function categoryFilterWhere(prisma, slugs, { visibleFor, descendantIdsBySlugs } = {}) {
  const parts = [];
  const categoryIds = await descendantIdsBySlugs(prisma, slugs);
  if (categoryIds) parts.push({ categories: { some: { id: { in: categoryIds } } } });

  const withRule = await prisma.category.findMany({
    where: { slug: { in: slugs }, rule: { not: null } },
    select: { id: true, rule: true },
  });
  for (const c of withRule) {
    const ids = await ruleProductIds(prisma, c.rule, { visibleFor });
    if (ids.length > 0) parts.push({ id: { in: ids } });
  }

  if (parts.length === 0) return { categories: { every: { id: -1 }, some: {} } };
  return parts.length === 1 ? parts[0] : { OR: parts };
}

module.exports = { RULE_TYPES, normalizeRule, describeRule, ruleProductIds, categoryFilterWhere };

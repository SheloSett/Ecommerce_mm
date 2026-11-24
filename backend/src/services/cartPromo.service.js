// Qué descuento por monto (model CartPromo) le toca a un pedido. Las reglas del cálculo están en
// utils/cartPromo.js; acá se leen las promos vigentes de la base y se resuelve qué productos entran.
//
// Lo usan el checkout (createOrder, siempre), la venta manual (si el vendedor tildó "Aplicar promo") y
// "Modificar pedido" (si se la agrega a un pedido que no la tenía).

const prisma = require("../lib/prisma"); // cliente único (ver lib/prisma.js)
const { promoAppliesTo, bestPromoForItems, promoSnapshot } = require("../utils/cartPromo");
const { loadFlatCategories, collectDescendantIds } = require("../utils/categoryTree");

// Qué productos entran en una promo (24/11/2026): los elegidos sueltos más los de las categorías elegidas
// y sus subcategorías. Devuelve { ids, label }: ids = lista de ids de producto, o null si la promo es para
// todos (sin categorías ni productos elegidos); label = cómo se le cuenta al cliente ("En Audio y Cables",
// "En productos seleccionados"), null si es para todos. flat: la tabla de categorías (una sola lectura
// para todas las promos).
async function resolveScope(promo, flat) {
  const catIds = (promo.categoryIds || []).map(Number).filter(Number.isInteger);
  const prodIds = (promo.productIds || []).map(Number).filter(Number.isInteger);
  if (catIds.length === 0 && prodIds.length === 0) return { ids: null, label: null };

  const allCatIds = catIds.length ? collectDescendantIds(flat, catIds) : [];
  const rows = await prisma.product.findMany({
    where: {
      OR: [
        ...(prodIds.length ? [{ id: { in: prodIds } }] : []),
        ...(allCatIds.length ? [{ categories: { some: { id: { in: allCatIds } } } }] : []),
      ],
    },
    select: { id: true },
  });

  const names = flat.filter((c) => catIds.includes(c.id)).map((c) => c.name);
  let label = "En productos seleccionados";
  if (names.length > 0 && names.length <= 3) {
    const cats = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
    label = prodIds.length ? `En ${cats} y otros productos seleccionados` : `En ${cats}`;
  }
  return { ids: rows.map((r) => r.id), label };
}

// Promos prendidas y dentro de su rango de fechas, cada una con eligibleProductIds (null = todos) y
// scopeLabel.
// Si la consulta falla, se sigue SIN promo: un problema con la promo nunca puede frenar una venta. El
// total lo calcula siempre el servidor, así que el cliente paga lo que dice su pedido (sin el descuento),
// no lo que había visto en el carrito. Queda el error en el log. Por lo mismo, una promo cuyos productos
// no se pudieron resolver se deja afuera: nunca se descuenta de más.
async function livePromos(now = new Date()) {
  let promos;
  try {
    promos = await prisma.cartPromo.findMany({
      where:   { active: true, startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: { startsAt: "desc" },
    });
  } catch (err) {
    console.error("[promo] no se pudieron leer las promos vigentes:", err.message);
    return [];
  }
  const scoped = promos.some((p) => (p.categoryIds || []).length || (p.productIds || []).length);
  let flat = [];
  if (scoped) {
    try { flat = await loadFlatCategories(prisma); } catch (err) {
      console.error("[promo] no se pudieron leer las categorías:", err.message);
      return promos.filter((p) => !(p.categoryIds || []).length && !(p.productIds || []).length)
        .map((p) => ({ ...p, eligibleProductIds: null, scopeLabel: null }));
    }
  }
  const out = [];
  for (const p of promos) {
    try {
      const { ids, label } = await resolveScope(p, flat);
      out.push({ ...p, eligibleProductIds: ids, scopeLabel: label });
    } catch (err) {
      console.error(`[promo] no se pudieron resolver los productos de la promo ${p.id}:`, err.message);
    }
  }
  return out;
}

// La promo de un pedido: entre las vigentes para ese tipo de cliente, la que más % da con lo que el pedido
// tiene de los productos de cada una (en pesos). Devuelve { id, rule } para guardar en promoId /
// promoRule, o null si ninguna llega a su primer escalón (así un pedido chico no queda marcado con una
// promo del 0%). Antes: bestPromoFor(promos, sumItems(items, "ARS")), con todo el pedido.
async function promoForOrder({ customerType, items, now = new Date() }) {
  const promos = (await livePromos(now)).filter((p) => promoAppliesTo(p, customerType));
  const best = bestPromoForItems(promos, items);
  return best ? { id: best.promo.id, rule: promoSnapshot(best.promo) } : null;
}

module.exports = { livePromos, promoForOrder, resolveScope };

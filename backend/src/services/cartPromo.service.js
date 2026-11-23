// Qué descuento por monto (model CartPromo) le toca a un pedido. Las reglas del cálculo están en
// utils/cartPromo.js; acá solo se leen las promos vigentes de la base.
//
// Lo usan el checkout (createOrder, siempre), la venta manual (si el vendedor tildó "Aplicar promo") y
// "Modificar pedido" (si se la agrega a un pedido que no la tenía).

const prisma = require("../lib/prisma"); // cliente único (ver lib/prisma.js)
const { sumItems } = require("../utils/orderTotals");
const { promoAppliesTo, bestPromoFor, promoSnapshot } = require("../utils/cartPromo");

// Promos prendidas y dentro de su rango de fechas.
// Si la consulta falla, se sigue SIN promo: un problema con la promo nunca puede frenar una venta. El
// total lo calcula siempre el servidor, así que el cliente paga lo que dice su pedido (sin el descuento),
// no lo que había visto en el carrito. Queda el error en el log.
async function livePromos(now = new Date()) {
  try {
    return await prisma.cartPromo.findMany({
      where:   { active: true, startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: { startsAt: "desc" },
    });
  } catch (err) {
    console.error("[promo] no se pudieron leer las promos vigentes:", err.message);
    return [];
  }
}

// La promo de un pedido: entre las vigentes para ese tipo de cliente, la que más % da con el subtotal de
// productos en pesos. Devuelve { id, rule } para guardar en promoId / promoRule, o null si ninguna llega
// a su primer escalón (así un pedido chico no queda marcado con una promo del 0%).
async function promoForOrder({ customerType, items, now = new Date() }) {
  const promos = (await livePromos(now)).filter((p) => promoAppliesTo(p, customerType));
  const best = bestPromoFor(promos, sumItems(items, "ARS"));
  return best ? { id: best.promo.id, rule: promoSnapshot(best.promo) } : null;
}

module.exports = { livePromos, promoForOrder };

// Filtro Prisma para "productos disponibles": activos y con stock real. Lo usan el cron de
// recomendaciones (services/cron.service.js) y los avisos de campañas (services/broadcast.service.js).
// Mismo patrón que getProducts() del controller — un producto está disponible si:
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

module.exports = { AVAILABLE_STOCK_FILTER };

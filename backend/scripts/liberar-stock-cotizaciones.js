// Devuelve el stock que las cotizaciones en curso tienen reservado.
//
// POR QUÉ EXISTE: hasta este cambio, una cotización descontaba el stock apenas se creaba. Como una
// cotización es un presupuesto y puede estar días en negociación, esa mercadería quedaba bloqueada
// para el resto de la tienda, y si un producto llegaba a cero se despublicaba solo del catálogo.
// Ahora el stock se descuenta recién cuando la orden pasa a APPROVED (abonada).
//
// Esto es de una sola vez: devuelve lo que las cotizaciones vivas todavía tienen retenido y las deja
// marcadas como "sin stock descontado", para que todo el circuito quede con el criterio nuevo.
//
// NO toca las cotizaciones que el cliente ya pagó (esas pasan a PAYMENT_REVIEW y dejan de tener
// paymentMethod COTIZACION): ahí el stock descontado está bien y tiene que quedarse así.
//
// Uso (en el VPS, una sola línea):
//   docker compose -f /home/shelo/Ecommerce_mm/deploy/docker-compose.vps.yml exec -T backend node scripts/liberar-stock-cotizaciones.js --dry-run
//
// Sin --dry-run aplica los cambios. Es idempotente: una vez liberada, la cotización queda con
// stockDeducted en false y no se vuelve a tocar.

const { PrismaClient } = require("@prisma/client");
const { syncProductVisibility } = require("../src/controllers/product.controller");

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

// Cotizaciones que todavía se están negociando. Las APPROVED ya se cobraron.
const EN_CURSO = ["PENDING", "QUOTE_APPROVED"];

(async () => {
  const cotizaciones = await prisma.order.findMany({
    where:   { paymentMethod: "COTIZACION", status: { in: EN_CURSO }, stockDeducted: true },
    include: { items: true },
    orderBy: { id: "asc" },
  });

  console.log(`${cotizaciones.length} cotizacion(es) con stock reservado${dryRun ? "  [DRY RUN — no se escribe nada]" : ""}\n`);

  const tocados = new Set();
  let devueltas = 0;

  for (const orden of cotizaciones) {
    const lineas = [];

    for (const item of orden.items) {
      if (!item.productId) continue; // ítem libre: no existe en el catálogo

      // Mismo criterio que usa el resto del circuito para saber dónde quedó reservado el stock:
      //  · con variante asignada  → en esa variante
      //  · sin variante, de un producto CON variantes → nunca se reservó nada
      //  · sin variante, de un producto SIN variantes → en el producto
      if (item.variantId) {
        const v = await prisma.productVariant.findUnique({ where: { id: item.variantId } });
        if (!v || v.stockUnlimited) continue;
        lineas.push({ que: `variante ${v.id}`, de: v.stock, a: v.stock + item.quantity });
        if (!dryRun) {
          await prisma.productVariant.update({ where: { id: v.id }, data: { stock: v.stock + item.quantity } });
        }
        tocados.add(item.productId);
        continue;
      }

      const conVariantes = await prisma.productVariant.count({ where: { productId: item.productId, active: true } });
      if (conVariantes > 0) continue; // nunca se reservó: la variante se elige al aprobar

      const p = await prisma.product.findUnique({ where: { id: item.productId } });
      if (!p || p.stockUnlimited) continue;
      lineas.push({ que: p.name, de: p.stock, a: p.stock + item.quantity });
      if (!dryRun) {
        await prisma.product.update({
          where: { id: p.id },
          // active: true — si el producto se había despublicado porque esta cotización lo dejó en
          // cero, vuelve al catálogo. syncProductVisibility corrige después si igual no corresponde.
          data:  { stock: p.stock + item.quantity, active: true },
        });
      }
      tocados.add(item.productId);
    }

    console.log(`  #${orden.id} (${orden.status}): devuelve stock a ${lineas.length} de ${orden.items.length} línea(s)`);
    for (const l of lineas) console.log(`      ${String(l.que).slice(0, 50).padEnd(52)} ${l.de} → ${l.a}`);

    if (!dryRun) {
      await prisma.order.update({ where: { id: orden.id }, data: { stockDeducted: false } });
    }
    devueltas++;
  }

  if (!dryRun) {
    for (const pid of tocados) {
      try { await syncProductVisibility(pid); } catch (_) { /* no frenar por esto */ }
    }
  }

  console.log(
    devueltas === 0
      ? "\nNo había ninguna cotización reteniendo stock."
      : `\n${devueltas} cotizacion(es) ${dryRun ? "liberarían" : "liberadas"}, ${tocados.size} producto(s) afectado(s).`
  );
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("ERROR:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});

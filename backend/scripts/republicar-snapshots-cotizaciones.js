// Republica el clientSnapshot de las cotizaciones que siguen vivas.
//
// POR QUÉ EXISTE: el cliente solo ve clientSnapshot, nunca los OrderItem. Hasta este arreglo, editar
// una línea desde el panel (cantidad, precio o descuento) solo republicaba el snapshot si la orden
// estaba APPROVED — pero el total SÍ se recalculaba siempre. Resultado: en una cotización el cliente
// veía el total ya con el descuento, pero cada producto al precio de lista y sin ningún desglose.
//
// El código ya quedó arreglado (order.controller.js -> publicarSnapshot), así que esto es de una sola
// vez: pone al día las cotizaciones que quedaron con el snapshot viejo. No toca precios, cantidades,
// totales ni stock: solo vuelve a publicar lo que ya está guardado en los items.
//
// Uso (en el VPS, una sola línea):
//   docker compose -f /home/shelo/Ecommerce_mm/deploy/docker-compose.vps.yml exec backend node scripts/republicar-snapshots-cotizaciones.js
//
// Con --dry-run solo muestra cuáles cambiarían, sin escribir nada.

const { PrismaClient } = require("@prisma/client");
const { buildSnapshot } = require("../src/controllers/order.controller");

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

// Estados en los que la cotización todavía se está negociando. Las APPROVED ya pasaron a ser pedidos
// y su snapshot es la foto de lo que se aprobó: no se tocan.
const ESTADOS_VIVOS = ["PENDING", "QUOTE_APPROVED", "PAYMENT_REVIEW"];

// Postgres guarda el snapshot como jsonb y jsonb NO conserva el orden de las claves, así que
// comparar con JSON.stringify a secas daba distinto siempre y el script reescribía todo en cada
// corrida. Esto serializa ordenando las claves, para que la comparación sea por contenido.
const norm = (v) =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]]))
      : val
  );

(async () => {
  const cotizaciones = await prisma.order.findMany({
    where:  { paymentMethod: "COTIZACION", status: { in: ESTADOS_VIVOS } },
    select: { id: true, status: true, clientSnapshot: true },
    orderBy: { id: "asc" },
  });

  console.log(`${cotizaciones.length} cotizacion(es) en estado ${ESTADOS_VIVOS.join(" / ")}${dryRun ? "  [DRY RUN]" : ""}\n`);

  let actualizadas = 0;
  for (const c of cotizaciones) {
    const nuevo = await buildSnapshot(c.id);
    if (norm(c.clientSnapshot) === norm(nuevo)) continue; // ya está al día

    const conDescuento = nuevo.filter((i) => i.listPrice && i.listPrice > i.price).length;
    console.log(`  #${c.id} (${c.status}): ${nuevo.length} ítem(s), ${conDescuento} con descuento por producto`);
    if (!dryRun) await prisma.order.update({ where: { id: c.id }, data: { clientSnapshot: nuevo } });
    actualizadas++;
  }

  console.log(`\n${actualizadas === 0 ? "No había ninguna desactualizada." : `${actualizadas} ${dryRun ? "cambiarían" : "actualizada(s)"}.`}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("ERROR:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});

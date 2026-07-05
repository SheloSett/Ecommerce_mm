// Backfill de slugs para productos que ya existían antes de la feature de URLs amigables.
// Genera un slug único por producto a partir del nombre (misma lógica que product.controller > toSlug).
// Es IDEMPOTENTE: solo toca productos con slug NULL o vacío, así se puede correr varias veces sin riesgo.
//
// Uso (desde backend/, con DATABASE_URL apuntando a la DB destino):
//   node prisma/backfill-product-slugs.js
//
// En producción (VPS): correr una sola vez después de deployar, apuntando al Postgres local.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function toSlug(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita tildes/diacriticos
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 80)
    .replace(/-+$/g, "");
}

async function main() {
  // Slugs ya usados (para no colisionar con los que ya tengan alguno).
  const withSlug = await prisma.product.findMany({
    where: { NOT: [{ slug: null }] },
    select: { slug: true },
  });
  const used = new Set(withSlug.map((p) => p.slug).filter(Boolean));

  // Productos sin slug, en orden estable por id.
  const pending = await prisma.product.findMany({
    where: { OR: [{ slug: null }, { slug: "" }] },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });

  let count = 0;
  for (const p of pending) {
    const base = toSlug(p.name) || "producto";
    let slug = base;
    let n = 2;
    while (used.has(slug)) { slug = `${base}-${n}`; n += 1; }
    used.add(slug);
    await prisma.product.update({ where: { id: p.id }, data: { slug } });
    count += 1;
    console.log(`  #${p.id}  ${JSON.stringify(p.name)}  ->  ${slug}`);
  }
  console.log(`\nBackfill completo: ${count} producto(s) actualizados.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Backfill FALLÓ:", e);
  await prisma.$disconnect();
  process.exit(1);
});

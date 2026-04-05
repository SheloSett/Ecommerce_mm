/**
 * post-migrate.js — Se ejecuta DESPUÉS de prisma db push.
 * Si existe la tabla _cat_backup (creada por pre-migrate.js), restaura
 * las asignaciones de categoría en la nueva tabla M2M _CategoryToProduct.
 * Luego elimina _cat_backup para no dejar residuos.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  try {
    // Verificar si existe la tabla de respaldo
    const [backup] = await prisma.$queryRawUnsafe(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = '_cat_backup'
    `);

    if (!backup) {
      console.log("[POST-MIGRATE] No hay tabla de respaldo — nada que restaurar.");
      return;
    }

    // Verificar que la tabla M2M ya fue creada por db push
    const [m2m] = await prisma.$queryRawUnsafe(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = '_CategoryToProduct'
    `);

    if (!m2m) {
      console.warn("[POST-MIGRATE] La tabla _CategoryToProduct no existe todavía — saltando restauración.");
      return;
    }

    const rows = await prisma.$queryRawUnsafe(`SELECT product_id, category_id FROM _cat_backup`);

    let restored = 0;
    for (const row of rows) {
      try {
        // Columna A = Category.id, Columna B = Product.id (orden alfabético de Prisma)
        await prisma.$executeRawUnsafe(
          `INSERT INTO "_CategoryToProduct" ("A", "B") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          row.category_id,
          row.product_id
        );
        restored++;
      } catch (_) {
        // Ignorar conflictos o referencias inválidas (categoría eliminada, etc.)
      }
    }

    // Eliminar la tabla temporal
    await prisma.$executeRawUnsafe(`DROP TABLE _cat_backup`);

    console.log(`[POST-MIGRATE] ✅ Restauradas ${restored} de ${rows.length} asignaciones de categoría.`);
  } catch (err) {
    console.error("[POST-MIGRATE] Error:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();

/**
 * pre-migrate.js — Se ejecuta ANTES de prisma db push.
 * Si el producto aún tiene la columna categoryId (schema anterior, single category),
 * guarda todos los pares (productId, categoryId) en la tabla _cat_backup
 * para que post-migrate.js los pueda restaurar en la nueva tabla M2M.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  try {
    // Verificar si la columna categoryId todavía existe en la DB
    const cols = await prisma.$queryRawUnsafe(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'products'
        AND column_name = 'categoryId'
    `);

    if (!cols || cols.length === 0) {
      console.log("[PRE-MIGRATE] La columna categoryId no existe — no hay nada que respaldar.");
      return;
    }

    // Limpiar cualquier backup anterior por si quedó de una corrida fallida
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS _cat_backup`);

    // Crear tabla de respaldo con todos los pares productId → categoryId
    await prisma.$executeRawUnsafe(`
      CREATE TABLE _cat_backup AS
        SELECT id AS product_id, "categoryId" AS category_id
        FROM products
        WHERE "categoryId" IS NOT NULL
    `);

    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM _cat_backup`);
    console.log(`[PRE-MIGRATE] ✅ Respaldadas ${n} asignaciones de categoría. db push puede continuar.`);
  } catch (err) {
    // No abortar el startup si algo falla — el backup es best-effort
    console.error("[PRE-MIGRATE] Error:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();

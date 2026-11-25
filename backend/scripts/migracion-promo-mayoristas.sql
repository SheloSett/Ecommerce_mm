-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: escalones propios para mayoristas en el descuento por monto
-- Fecha: 2026-11-25
--
-- Va DESPUÉS de migracion-promo-productos.sql (necesita la tabla cart_promos).
-- 100 % aditiva e idempotente: una columna en cart_promos, vacía (NULL) por defecto. NULL = los mayoristas
-- usan los mismos escalones que los minoristas, así que las promos que ya existen siguen funcionando igual.
-- Correrla ANTES de desplegar el backend: sin la columna, el carrito y el checkout no leen las promos.
--
-- En el VPS (desde ~/Ecommerce_mm):
--   docker exec -i igwtstore_db psql -U ecommerce_user -d ecommerce_db \
--     --single-transaction -v ON_ERROR_STOP=1 < backend/scripts/migracion-promo-mayoristas.sql
--
-- Mismo SQL que `prisma migrate diff` (con IF NOT EXISTS): después el paso 0 del deploy tiene que dar
-- "This is an empty migration.".
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "cart_promos" ADD COLUMN IF NOT EXISTS "wholesaleTiers" JSONB;

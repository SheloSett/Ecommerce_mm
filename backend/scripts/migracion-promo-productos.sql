-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: qué productos entran en el descuento por monto (categorías y/o productos sueltos)
-- Fecha: 2026-11-24
--
-- Va DESPUÉS de migracion-descuento-por-monto.sql (necesita la tabla cart_promos).
-- 100 % aditiva e idempotente: dos columnas en cart_promos, vacías por defecto. Vacías = la promo vale
-- para todos los productos, así que las promos que ya existen siguen funcionando igual.
-- Correrla ANTES de desplegar el backend: sin las columnas, el carrito y el checkout no leen las promos.
--
-- En el VPS (desde ~/Ecommerce_mm):
--   docker exec -i igwtstore_db psql -U ecommerce_user -d ecommerce_db \
--     --single-transaction -v ON_ERROR_STOP=1 < backend/scripts/migracion-promo-productos.sql
--
-- Mismo SQL que `prisma migrate diff` (con IF NOT EXISTS): después el paso 0 del deploy tiene que dar
-- "This is an empty migration.".
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "cart_promos" ADD COLUMN IF NOT EXISTS "categoryIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "cart_promos" ADD COLUMN IF NOT EXISTS "productIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

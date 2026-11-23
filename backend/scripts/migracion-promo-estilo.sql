-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: estilo y tarjeta del inicio para el descuento por monto (cart_promos)
-- Fecha: 2026-11-23
--
-- 100 % aditiva e idempotente: cinco columnas en cart_promos, todas con valor por defecto u opcionales.
-- La promo que ya existe queda con estilo Black Friday, con tarjeta en el inicio y cuenta regresiva
-- (se cambia desde Productos → Descuento por monto). Va DESPUÉS de migracion-descuento-por-monto.sql.
-- Correrla ANTES de desplegar el backend: sin las columnas, las promos dan error al leerse.
--
-- En el VPS (desde ~/Ecommerce_mm):
--   docker exec -i igwtstore_db psql -U ecommerce_user -d ecommerce_db \
--     --single-transaction -v ON_ERROR_STOP=1 < backend/scripts/migracion-promo-estilo.sql
--
-- Es el mismo SQL que genera `prisma migrate diff` para este cambio del schema, así que después el
-- paso 0 del deploy tiene que dar "This is an empty migration.".
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "cart_promos" ADD COLUMN IF NOT EXISTS "cardColor" TEXT;
ALTER TABLE "cart_promos" ADD COLUMN IF NOT EXISTS "cardStyle" TEXT NOT NULL DEFAULT 'blackfriday';
ALTER TABLE "cart_promos" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "cart_promos" ADD COLUMN IF NOT EXISTS "showCard" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "cart_promos" ADD COLUMN IF NOT EXISTS "showCountdown" BOOLEAN NOT NULL DEFAULT true;

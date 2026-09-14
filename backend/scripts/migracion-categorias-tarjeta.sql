-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: apariencia de la tarjeta de categoría en el Home (estilo, destacada, textos)
-- Fecha: 2026-09-14
--
-- 100 % aditiva e idempotente: agrega cuatro columnas a categories con valores por defecto.
-- Ninguna categoría cambia de aspecto hasta que se le elija un estilo desde Admin → Categorías.
--
-- Cómo aplicarla en el VPS (ver DEPLOY.md → "Aplicar cambios de schema a mano"):
--   ~/Ecommerce_mm/backend/scripts/backup-db.sh
--   psql -U ecommerce_user -d ecommerce_db -h localhost -1 -f ~/Ecommerce_mm/backend/scripts/migracion-categorias-tarjeta.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "cardStyle" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "featured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "badgeText" TEXT;
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "ribbonText" TEXT;

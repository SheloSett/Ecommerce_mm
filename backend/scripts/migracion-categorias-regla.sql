-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: categorías inteligentes (regla automática)
-- Fecha: 2026-09-16
--
-- 100 % aditiva e idempotente: agrega la columna "rule" (JSON, nula por defecto) a categories.
-- Ninguna categoría cambia hasta que se le elija una regla desde Admin → Categorías.
--
--   ~/Ecommerce_mm/backend/scripts/backup-db.sh
--   psql -U ecommerce_user -d ecommerce_db -h localhost -1 -f ~/Ecommerce_mm/backend/scripts/migracion-categorias-regla.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "rule" JSONB;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: ícono elegible por categoría (Material Symbols)
-- Fecha: 2026-09-16
-- 100 % aditiva e idempotente. Null = ícono automático según el nombre (comportamiento anterior).
--
--   ~/Ecommerce_mm/backend/scripts/backup-db.sh
--   psql -U ecommerce_user -d ecommerce_db -h localhost -1 -f ~/Ecommerce_mm/backend/scripts/migracion-categorias-icono.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "icon" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: versión para celular de los banners del carrusel
-- Fecha: 2026-09-18
--
-- 100 % aditiva e idempotente: tres columnas opcionales en slides. Ningún slide cambia hasta que se
-- le cargue una imagen de celular desde Admin → Configuración → Carrusel.
--
--   ~/Ecommerce_mm/backend/scripts/backup-db.sh
--   psql -U ecommerce_user -d ecommerce_db -h localhost -1 -f ~/Ecommerce_mm/backend/scripts/migracion-slides-celular.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "slides" ADD COLUMN IF NOT EXISTS "mobileImage" TEXT;
ALTER TABLE "slides" ADD COLUMN IF NOT EXISTS "mobileWidth" INTEGER;
ALTER TABLE "slides" ADD COLUMN IF NOT EXISTS "mobileHeight" INTEGER;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: visibilidad de los slides del carrusel por tipo de cliente
-- Fecha: 2026-11-02
--
-- 100 % aditiva e idempotente: una columna en slides, con AMBOS por defecto. Todos los slides se
-- siguen viendo igual hasta que se elija otra cosa en Admin → Configuración → Carrusel.
-- Correrla ANTES de desplegar el backend: sin la columna, el carrusel del inicio da error.
--
--   ~/Ecommerce_mm/backend/scripts/backup-db.sh
--   psql -U ecommerce_user -d ecommerce_db -h localhost -1 -f ~/Ecommerce_mm/backend/scripts/migracion-slides-visibilidad.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "slides" ADD COLUMN IF NOT EXISTS "visibility" "CustomerVisibility" NOT NULL DEFAULT 'AMBOS';

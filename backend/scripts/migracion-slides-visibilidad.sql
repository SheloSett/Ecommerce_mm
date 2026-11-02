-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: visibilidad de los slides del carrusel por tipo de cliente
-- Fecha: 2026-11-02
--
-- 100 % aditiva e idempotente: una columna en slides, con AMBOS por defecto. Todos los slides se
-- siguen viendo igual hasta que se elija otra cosa en Admin → Configuración → Carrusel.
-- Correrla ANTES de desplegar el backend: sin la columna, el carrusel del inicio da error.
--
-- En el VPS (desde ~/Ecommerce_mm):
--   docker exec -i igwtstore_db psql -U ecommerce_user -d ecommerce_db \
--     --single-transaction -v ON_ERROR_STOP=1 < backend/scripts/migracion-slides-visibilidad.sql
--
-- Es el mismo SQL que genera `prisma migrate diff` para este cambio del schema, así que después el
-- paso 0 del deploy tiene que dar "This is an empty migration.".
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "slides" ADD COLUMN IF NOT EXISTS "visibility" "CustomerVisibility" NOT NULL DEFAULT 'AMBOS';

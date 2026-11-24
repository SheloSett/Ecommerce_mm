-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: etiquetas de envío pendientes de revisar
-- Fecha: 2026-11-18
--
-- Va DESPUÉS de migracion-etiquetas-envio.sql (necesita la tabla shipping_labels).
-- 100 % aditiva e idempotente: dos columnas nuevas en shipping_labels, con valores por defecto que dejan
-- las etiquetas que ya existan como confirmadas.
--   status     → 'PENDING' (importada de BarTender, sin revisar), 'CONFIRMED' (en uso) o 'DISCARDED'
--                (descartada: no se muestra, pero se recuerda para no volver a importarla)
--   sourceDate → fecha del .btw, para saber cuál es la más nueva de una misma persona y distinguir dos
--                archivos con el mismo nombre en carpetas distintas
-- Correrla ANTES de desplegar el backend: sin las columnas, la pantalla de etiquetas da error.
--
-- En el VPS (desde ~/Ecommerce_mm):
--   docker exec -i igwtstore_db psql -U ecommerce_user -d ecommerce_db \
--     --single-transaction -v ON_ERROR_STOP=1 < backend/scripts/migracion-etiquetas-pendientes.sql
--
-- Mismo SQL que `prisma migrate diff` (con IF NOT EXISTS): después el paso 0 del deploy tiene que dar
-- "This is an empty migration.".
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "shipping_labels" ADD COLUMN IF NOT EXISTS "sourceDate" TIMESTAMP(3);
ALTER TABLE "shipping_labels" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'CONFIRMED';

CREATE INDEX IF NOT EXISTS "shipping_labels_status_idx" ON "shipping_labels"("status");

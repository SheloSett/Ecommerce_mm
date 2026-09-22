-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: cotizaciones desde venta manual + el cliente puede modificarlas
-- Fecha: 2026-09-22
--
-- Aditiva e idempotente: dos columnas nuevas en orders.
--   · stockDeducted      → si el stock de esa orden ya se descontó del catálogo
--   · customerModifiedAt → cuándo el cliente modificó su cotización por última vez
--
-- Los UPDATE del final NO cambian datos de negocio: solo marcan el estado real del stock de las
-- órdenes que ya existen, para que a partir de ahora no se descuente dos veces.
--
--   ~/Ecommerce_mm/backend/scripts/backup-db.sh
--   psql -U ecommerce_user -d ecommerce_db -h localhost --single-transaction -v ON_ERROR_STOP=1 \
--     -f ~/Ecommerce_mm/backend/scripts/migracion-cotizaciones-cliente.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "stockDeducted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customerModifiedAt" TIMESTAMP(3);

-- Cotizaciones todavía vivas: su stock YA fue reservado al crearse (productos sin variantes) y al
-- aprobarse (variantes asignadas). Marcarlas evita que se vuelva a descontar cuando el cliente pague.
UPDATE "orders"
   SET "stockDeducted" = true
 WHERE "paymentMethod" = 'COTIZACION'
   AND "status" IN ('PENDING', 'QUOTE_APPROVED')
   AND "stockDeducted" = false;

-- Ventas manuales pendientes: createManualOrder descuenta stock al crear la venta, así que marcarlas
-- evita el mismo doble descuento cuando se pasan a "Abonada".
UPDATE "orders"
   SET "stockDeducted" = true
 WHERE "salesChannel" <> 'WEB'
   AND "status" = 'PENDING'
   AND "stockDeducted" = false;

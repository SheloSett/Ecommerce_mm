-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: facturación ARCA (rama facturacion-arca)
-- Fecha: 2026-11-11
--
-- Qué hace (100 % aditivo, no borra ni modifica datos existentes):
--   orders.customerDocType / customerDocNumber → el documento que el cliente carga en el checkout
--                                                (DNI, CUIT o CUIL), para poder facturarle
--   orders.arcaLockedAt                         → el pedido tiene una factura vigente (se bloquea su
--                                                edición hasta anularla)
-- Las tablas de facturas, certificados y configuración se suman a este mismo archivo en los pasos
-- siguientes, antes de desplegar.
--
-- Correrla ANTES de desplegar el backend que la usa. Desde ~/Ecommerce_mm en el VPS:
--   ~/Ecommerce_mm/backend/scripts/backup-db.sh
--   docker exec -i igwtstore_db psql -U ecommerce_user -d ecommerce_db \
--     --single-transaction -v ON_ERROR_STOP=1 < backend/scripts/migracion-arca.sql
--
-- Después, el paso 0 de DEPLOY.md (prisma migrate diff) tiene que dar "-- This is an empty migration."
-- Es idempotente: si ya se aplicó, no hace nada (IF NOT EXISTS en todo).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customerDocType" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customerDocNumber" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "arcaLockedAt" TIMESTAMP(3);

-- Migración: montos separados por moneda en los pedidos
--
-- QUÉ HACE: agrega tres columnas a la tabla "orders" para guardar la parte en DÓLARES de cada
-- pedido. Hasta ahora `total`, `couponDiscount` e `ivaAmount` guardaban un solo número que en los
-- pedidos mixtos sumaba pesos y dólares como si fueran la misma unidad.
--
-- ES SEGURA:
--  - Solo AGREGA columnas. No borra, no renombra y no modifica ninguna fila existente.
--  - Las tres son NULL (sin NOT NULL ni DEFAULT), así que los pedidos que ya existen quedan
--    exactamente como están, con NULL en las columnas nuevas.
--  - El código trata "totalUsd IS NULL" como "pedido viejo" y recalcula esos totales desde las
--    líneas, igual que hacía antes. Ningún pedido histórico cambia de valor.
--  - Es idempotente: IF NOT EXISTS permite correrla dos veces sin error.
--
-- CÓMO CORRERLA en el VPS (hacer backup primero, como indica DEPLOY.md):
--   psql -U <usuario> -d <base> -f backend/scripts/migracion-monedas-separadas.sql
--
-- Después hay que reiniciar el backend para que Prisma vea las columnas nuevas:
--   docker compose -f deploy/docker-compose.vps.yml restart backend

BEGIN;

-- Total en dólares del pedido (neto de cupón y con IVA). NULL = pedido sin dólares o anterior a esto.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "totalUsd" DOUBLE PRECISION;

-- Parte del descuento del cupón aplicada sobre las líneas en dólares.
-- Solo los cupones de PORCENTAJE descuentan en dólares: los de monto fijo están expresados en pesos.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "couponDiscountUsd" DOUBLE PRECISION;

-- IVA de las líneas en dólares, separado del IVA en pesos.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ivaAmountUsd" DOUBLE PRECISION;

COMMIT;

-- Verificación: las tres tienen que aparecer con is_nullable = YES
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--  WHERE table_name = 'orders' AND column_name IN ('totalUsd','couponDiscountUsd','ivaAmountUsd');

-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: historial de stock (stock_movements)
-- Fecha: 2026-11-11
--
-- Qué hace (100 % aditivo, no borra ni modifica datos existentes):
--   stock_movements → una fila por cada cambio de stock de un producto o variante, con el motivo y
--                     el pedido, compra o gasto que lo causó. La escribe services/stock.service.js.
--
-- Correrla ANTES de desplegar el backend que la usa. Desde ~/Ecommerce_mm en el VPS:
--   ~/Ecommerce_mm/backend/scripts/backup-db.sh
--   docker exec -i igwtstore_db psql -U ecommerce_user -d ecommerce_db \
--     --single-transaction -v ON_ERROR_STOP=1 < backend/scripts/migracion-stock-movimientos.sql
--
-- Después, el paso 0 de DEPLOY.md (prisma migrate diff) tiene que dar "-- This is an empty migration."
-- Es idempotente: si ya se aplicó, no hace nada (IF NOT EXISTS en todo).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "stock_movements" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "variantId" INTEGER,
    "requested" INTEGER,
    "delta" INTEGER NOT NULL,
    "before" INTEGER NOT NULL,
    "after" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "actor" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "stock_movements_productId_createdAt_idx" ON "stock_movements"("productId", "createdAt");
CREATE INDEX IF NOT EXISTS "stock_movements_refType_refId_idx" ON "stock_movements"("refType", "refId");

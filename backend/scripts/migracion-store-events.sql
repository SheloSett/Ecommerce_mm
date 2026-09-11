-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: eventos de la tienda (Analíticas → Búsquedas y vistas / En vivo)
-- Fecha: 2026-09-10
--
-- Qué hace (100 % aditivo, no borra ni modifica datos existentes):
--   1. orders.sessionId  → id anónimo del navegador que hizo el pedido (para medir conversión)
--   2. store_events      → búsquedas y vistas de producto que registra el storefront
--
-- Cómo aplicarla en el VPS (ver DEPLOY.md → "Aplicar cambios de schema a mano"):
--   ~/Ecommerce_mm/backend/scripts/backup-db.sh
--   psql -U ecommerce_user -d ecommerce_db -h localhost -1 -f ~/Ecommerce_mm/backend/scripts/migracion-store-events.sql
--
-- El -1 ejecuta todo en una transacción: si algo falla, no queda nada a medias.
-- Es idempotente: si ya se aplicó, no hace nada (IF NOT EXISTS en todo).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;

CREATE TABLE IF NOT EXISTS "store_events" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "customerId" INTEGER,
    "productId" INTEGER,
    "term" TEXT,
    "results" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "store_events_type_createdAt_idx" ON "store_events"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "store_events_productId_createdAt_idx" ON "store_events"("productId", "createdAt");
CREATE INDEX IF NOT EXISTS "store_events_sessionId_idx" ON "store_events"("sessionId");

-- 2026-09-11: recorrido por visitante (vistas de página y dispositivo)
ALTER TABLE "store_events" ADD COLUMN IF NOT EXISTS "path" TEXT;
ALTER TABLE "store_events" ADD COLUMN IF NOT EXISTS "device" TEXT;

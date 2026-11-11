-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: Mercado Libre, stock compartido (ml_account, ml_pools, ml_listings, ml_cycles)
-- Fecha: 2026-11-11
--
-- Qué hace (100 % aditivo, no borra ni modifica datos existentes):
--   ml_account  → la cuenta conectada (una fila): tokens cifrados, modo y estado
--   ml_pools    → cada "pozo" de stock de Mercado Libre (publicaciones con el mismo user_product_id)
--                 y su vínculo con un producto o variante de la página
--   ml_listings → las publicaciones de la cuenta, vinculadas o no
--   ml_cycles   → bitácora del motor (lo que leyó, aplicó y escribió)
-- Ver backend/src/services/ml/.
--
-- Requiere la migración del historial de stock (migracion-stock-movimientos.sql) ya aplicada.
-- Correrla ANTES de desplegar el backend que la usa. Desde ~/Ecommerce_mm en el VPS:
--   ~/Ecommerce_mm/backend/scripts/backup-db.sh
--   docker exec -i igwtstore_db psql -U ecommerce_user -d ecommerce_db --     --single-transaction -v ON_ERROR_STOP=1 < backend/scripts/migracion-mercadolibre.sql
--
-- Después, el paso 0 de DEPLOY.md (prisma migrate diff) tiene que dar "-- This is an empty migration."
-- Es idempotente: si ya se aplicó, no hace nada (IF NOT EXISTS en todo).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ml_account" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "mlUserId" TEXT,
    "nickname" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DESCONECTADA',
    "mode" TEXT NOT NULL DEFAULT 'APAGADO',
    "pausedUntil" TIMESTAMP(3),
    "pauseLevel" INTEGER NOT NULL DEFAULT 0,
    "oauthState" TEXT,
    "oauthVerifier" TEXT,
    "oauthUserId" INTEGER,
    "oauthExpiresAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "connectedBy" TEXT,
    "lastRefreshAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "lastSweepAt" TIMESTAMP(3),
    "lastPassAt" TIMESTAMP(3),
    "listingsAt" TIMESTAMP(3),
    "listingsResult" TEXT,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ml_account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ml_pools" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "userProductId" TEXT,
    "productId" INTEGER,
    "variantId" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "agreed" INTEGER,
    "agreedSold" JSONB,
    "writeTarget" INTEGER,
    "writeBase" JSONB,
    "writeStartedAt" TIMESTAMP(3),
    "writeOutcome" TEXT,
    "writeWantedAt" TIMESTAMP(3),
    "heldQty" INTEGER,
    "heldAt" TIMESTAMP(3),
    "lastRead" JSONB,
    "lastReadAt" TIMESTAMP(3),
    "lastChangeAt" TIMESTAMP(3),
    "dirty" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "review" JSONB,
    "linkedAt" TIMESTAMP(3),
    "linkedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ml_pools_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ml_listings" (
    "id" SERIAL NOT NULL,
    "itemId" TEXT NOT NULL,
    "variationId" TEXT NOT NULL DEFAULT '',
    "userProductId" TEXT,
    "poolId" INTEGER,
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "permalink" TEXT,
    "thumbnail" TEXT,
    "status" TEXT NOT NULL,
    "quantity" INTEGER,
    "sold" INTEGER,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ml_listings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ml_cycles" (
    "id" SERIAL NOT NULL,
    "poolId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "readQty" INTEGER,
    "readSold" INTEGER,
    "webBefore" INTEGER,
    "webAfter" INTEGER,
    "delta" INTEGER,
    "writeQty" INTEGER,
    "storedQty" INTEGER,
    "result" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ml_cycles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ml_pools_key_key" ON "ml_pools"("key");

CREATE INDEX IF NOT EXISTS "ml_pools_productId_variantId_idx" ON "ml_pools"("productId", "variantId");

CREATE INDEX IF NOT EXISTS "ml_pools_dirty_idx" ON "ml_pools"("dirty");

CREATE INDEX IF NOT EXISTS "ml_listings_poolId_idx" ON "ml_listings"("poolId");

CREATE UNIQUE INDEX IF NOT EXISTS "ml_listings_itemId_variationId_key" ON "ml_listings"("itemId", "variationId");

CREATE INDEX IF NOT EXISTS "ml_cycles_poolId_createdAt_idx" ON "ml_cycles"("poolId", "createdAt");

CREATE INDEX IF NOT EXISTS "ml_cycles_createdAt_idx" ON "ml_cycles"("createdAt");

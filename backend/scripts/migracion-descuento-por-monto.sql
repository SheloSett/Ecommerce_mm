-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: descuento por monto de compra (Black Friday: desde $X, Y% off sobre el total)
-- Fecha: 2026-11-23
--
-- 100 % aditiva e idempotente: una tabla nueva (cart_promos) y cuatro columnas en orders, todas
-- opcionales. No borra ni cambia nada de lo que ya está: los pedidos existentes quedan igual, con
-- las columnas nuevas en null. Se puede correr dos veces sin problema.
-- Correrla ANTES de desplegar el backend: sin las columnas, crear un pedido da error.
--
-- En el VPS (desde ~/Ecommerce_mm):
--   docker exec -i igwtstore_db psql -U ecommerce_user -d ecommerce_db \
--     --single-transaction -v ON_ERROR_STOP=1 < backend/scripts/migracion-descuento-por-monto.sql
--
-- Es el mismo SQL que genera `prisma migrate diff` para este cambio del schema, así que después el
-- paso 0 del deploy tiene que dar "This is an empty migration.".
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "cart_promos" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "tiers" JSONB NOT NULL,
    "appliesTo" "CustomerVisibility" NOT NULL DEFAULT 'AMBOS',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_promos_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "promoDiscount" DOUBLE PRECISION;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "promoId" INTEGER;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "promoPercent" DOUBLE PRECISION;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "promoRule" JSONB;

-- La FK no tiene "IF NOT EXISTS" en Postgres: se crea solo si todavía no está.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_promoId_fkey') THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_promoId_fkey" FOREIGN KEY ("promoId")
      REFERENCES "cart_promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: etiquetas de envío (las que antes eran archivos .btw de BarTender, una por cliente)
-- Fecha: 2026-11-18
--
-- 100 % aditiva e idempotente: una tabla nueva, shipping_labels. No toca ninguna tabla existente
-- (la relación con customers es solo una clave foránea opcional en la tabla nueva).
-- Correrla ANTES de desplegar el backend: sin la tabla, la pantalla de etiquetas da error.
--
-- En el VPS (desde ~/Ecommerce_mm):
--   docker exec -i igwtstore_db psql -U ecommerce_user -d ecommerce_db \
--     --single-transaction -v ON_ERROR_STOP=1 < backend/scripts/migracion-etiquetas-envio.sql
--
-- Es el mismo SQL que genera `prisma migrate diff` para este cambio del schema (con IF NOT EXISTS
-- para poder correrla dos veces), así que después el paso 0 del deploy tiene que dar
-- "This is an empty migration.".
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "shipping_labels" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER,
    "recipientName" TEXT NOT NULL,
    "recipientDetails" TEXT NOT NULL DEFAULT '',
    "transport" TEXT,
    "insurance" TEXT,
    "sender" TEXT NOT NULL,
    "sourceFile" TEXT,
    "sourceSize" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_labels_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "shipping_labels_customerId_idx" ON "shipping_labels"("customerId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipping_labels_customerId_fkey') THEN
    ALTER TABLE "shipping_labels" ADD CONSTRAINT "shipping_labels_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

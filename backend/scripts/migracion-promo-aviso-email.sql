-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: aviso por email del descuento por monto (como las campañas de Ofertas)
-- Fecha: 2026-11-25
--
-- Va DESPUÉS de migracion-promo-mayoristas.sql (las dos tocan cart_promos; si no corriste esa, corré
-- primero esa y después esta).
-- 100 % aditiva e idempotente:
--   cart_promos.emailAnnounce (false) / announcedAt (vacío) → ninguna promo se avisa sola hasta tildarlo
--   email_broadcasts.cartPromoId (vacío) → los envíos que ya existen quedan igual
-- Correrla ANTES de desplegar el backend: sin las columnas, el carrito, el checkout y Emails fallan.
--
-- En el VPS (desde ~/Ecommerce_mm):
--   docker exec -i igwtstore_db psql -U ecommerce_user -d ecommerce_db \
--     --single-transaction -v ON_ERROR_STOP=1 < backend/scripts/migracion-promo-aviso-email.sql
--
-- Mismo SQL que `prisma migrate diff` (con IF NOT EXISTS): después el paso 0 del deploy tiene que dar
-- "This is an empty migration.".
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "cart_promos" ADD COLUMN IF NOT EXISTS "announcedAt" TIMESTAMP(3);
ALTER TABLE "cart_promos" ADD COLUMN IF NOT EXISTS "emailAnnounce" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "email_broadcasts" ADD COLUMN IF NOT EXISTS "cartPromoId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_broadcasts_cartPromoId_fkey') THEN
    ALTER TABLE "email_broadcasts" ADD CONSTRAINT "email_broadcasts_cartPromoId_fkey"
      FOREIGN KEY ("cartPromoId") REFERENCES "cart_promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

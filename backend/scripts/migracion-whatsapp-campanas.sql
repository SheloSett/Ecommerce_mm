-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: avisos de campañas por WhatsApp (Evolution)
-- Fecha: 2026-11-25
--
-- Va DESPUÉS de migracion-promo-aviso-email.sql.
-- 100 % aditiva e idempotente:
--   email_broadcasts.channel ('EMAIL' por defecto) → los envíos que ya existen siguen siendo por email
--   email_recipients.phone (vacío)                 → solo lo usan los envíos por WhatsApp
--   email_recipients.message (vacío)               → el texto del WhatsApp de carrito abandonado y restock
--                                                    (agregada después; si ya corriste este archivo, correlo
--                                                    de nuevo: lo demás no cambia nada)
-- Correrla ANTES de desplegar el backend: sin las columnas, Emails y su cola fallan.
--
-- En el VPS (desde ~/Ecommerce_mm):
--   docker exec -i igwtstore_db psql -U ecommerce_user -d ecommerce_db \
--     --single-transaction -v ON_ERROR_STOP=1 < backend/scripts/migracion-whatsapp-campanas.sql
--
-- Mismo SQL que `prisma migrate diff` (con IF NOT EXISTS): después el paso 0 del deploy tiene que dar
-- "This is an empty migration.".
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "email_broadcasts" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'EMAIL';
ALTER TABLE "email_recipients" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "email_recipients" ADD COLUMN IF NOT EXISTS "message" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: Meta (Facebook / Instagram) — Pixel + API de conversiones
-- Fecha: 2026-10-09
--
-- Aditiva e idempotente: una columna nueva en orders.
--   · metaBrowser → datos del navegador del cliente al comprar ({ fbp, fbc, ip, ua }), para que el
--                   evento de compra que manda el servidor a Meta se atribuya al anuncio.
--
-- No toca datos existentes. La configuración (ID del Pixel, token) se guarda en site_config desde
-- Admin → Configuración → Meta / Instagram, sin migración.
--
--   ~/Ecommerce_mm/backend/scripts/backup-db.sh
--   psql -U ecommerce_user -d ecommerce_db -h localhost --single-transaction -v ON_ERROR_STOP=1 \
--     -f ~/Ecommerce_mm/backend/scripts/migracion-meta-pixel.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "metaBrowser" JSONB;

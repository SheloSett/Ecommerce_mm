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
-- En el VPS nuevo (desde el 08/10/2026, Postgres en el contenedor igwtstore_db — ver DEPLOY.md):
--   ~/Ecommerce_mm/backend/scripts/backup-db.sh
--   docker exec -i igwtstore_db psql -U ecommerce_user -d ecommerce_db \
--     --single-transaction -v ON_ERROR_STOP=1 < ~/Ecommerce_mm/backend/scripts/migracion-meta-pixel.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "metaBrowser" JSONB;

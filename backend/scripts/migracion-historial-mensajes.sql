-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: historial de todo lo que sale de a uno (emails y WhatsApp)
-- Fecha: 2026-11-26
--
-- Pedido de la clienta: "en Emails → Historial debería aparecer al 100% todo lo que se manda". Una tabla
-- nueva (message_logs), vacía; no toca nada de lo que ya existe.
-- Correrla ANTES de desplegar el backend. (Si no está, los emails y WhatsApp salen igual: solo no se
-- guardan en el historial y queda un aviso en el log.)
--
-- En el VPS (desde ~/Ecommerce_mm):
--   docker exec -i igwtstore_db psql -U ecommerce_user -d ecommerce_db \
--     --single-transaction -v ON_ERROR_STOP=1 < backend/scripts/migracion-historial-mensajes.sql
--
-- Mismo SQL que `prisma migrate diff` (con IF NOT EXISTS): después el paso 0 del deploy tiene que dar
-- "This is an empty migration.".
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "message_logs" (
    "id" SERIAL NOT NULL,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "message_logs_createdAt_idx" ON "message_logs"("createdAt");

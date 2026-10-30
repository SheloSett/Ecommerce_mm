-- Migración del 30/10/2026: contador de sesión (A5) + índices (M12) + producto oculto a mano (B12) +
-- recordatorio de carrito (M5) de la auditoría.
--
-- CORRER ANTES de desplegar el código nuevo: el backend nuevo lee "tokenVersion" en cada pedido con
-- sesión, y si la columna no existe falla el login y todo el panel.
--
-- En el VPS (desde ~/Ecommerce_mm):
--   docker exec -i igwtstore_db psql -U ecommerce_user -d ecommerce_db \
--     --single-transaction -v ON_ERROR_STOP=1 < backend/scripts/migracion-sesiones-indices.sql
--
-- Es el mismo SQL que genera `prisma migrate diff` para este cambio del schema (mismos nombres de
-- índices), así que después el paso 0 del deploy tiene que dar "This is an empty migration.".
-- IF NOT EXISTS: se puede correr dos veces sin problema.
-- Las tablas son chicas: cada CREATE INDEX tarda menos de un segundo.

-- A5: contador de sesión. Arranca en 0 para todos: las sesiones abiertas siguen andando.
ALTER TABLE "users"     ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- M12: índices de las consultas más frecuentes
CREATE INDEX IF NOT EXISTS "orders_customerId_createdAt_idx"        ON "orders"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "orders_status_createdAt_idx"            ON "orders"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "notifications_customerId_createdAt_idx" ON "notifications"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "order_items_orderId_idx"                ON "order_items"("orderId");
CREATE INDEX IF NOT EXISTS "order_items_productId_idx"              ON "order_items"("productId");
CREATE INDEX IF NOT EXISTS "cart_items_cartId_idx"                  ON "cart_items"("cartId");
CREATE INDEX IF NOT EXISTS "offer_items_productId_idx"              ON "offer_items"("productId");
CREATE INDEX IF NOT EXISTS "product_attributes_productId_idx"       ON "product_attributes"("productId");
CREATE INDEX IF NOT EXISTS "product_variants_productId_idx"         ON "product_variants"("productId");

-- B12: "lo despublicó el admin a mano" (la republicación automática por stock ya no lo vuelve a mostrar).
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "hiddenByAdmin" BOOLEAN NOT NULL DEFAULT false;
-- Los que hoy están despublicados CON stock los ocultó el admin (el sistema solo oculta por falta de
-- stock): se marcan para que el próximo movimiento de pedidos no los vuelva a publicar.
UPDATE "products" p SET "hiddenByAdmin" = true
WHERE p.active = false AND (
  (NOT EXISTS (SELECT 1 FROM "product_variants" v WHERE v."productId" = p.id AND v.active)
     AND (p.stock > 0 OR p."stockUnlimited"))
  OR EXISTS (SELECT 1 FROM "product_variants" v WHERE v."productId" = p.id AND v.active AND (v.stock > 0 OR v."stockUnlimited"))
);

-- M5: último recordatorio automático de carrito abandonado (vacío = nunca se avisó)
ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3);

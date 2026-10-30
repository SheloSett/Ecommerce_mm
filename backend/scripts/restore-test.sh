#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# ENSAYO DE RESTAURACIÓN (M11 de la auditoría, 30/10/2026)
# Un backup que nunca se probó restaurar no se sabe si sirve. Esto levanta un Postgres TEMPORAL (un
# contenedor aparte, que se borra al terminar), le carga el último backup de ~/backups y compara
# cuántos pedidos, clientes y productos tiene contra la base real. NO toca la base real ni la tienda.
#
# Correrlo una vez por mes (o después de cambiar algo de los backups):
#   bash ~/Ecommerce_mm/backend/scripts/restore-test.sh
# o por cron, el día 2 de cada mes a las 5:00:
#   0 5 2 * * bash /home/shelo/Ecommerce_mm/backend/scripts/restore-test.sh >> /home/shelo/backups/restore-test.log 2>&1
#
# La primera vez descarga la imagen postgres:16-alpine (~100 MB).
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

DB_NAME="ecommerce_db"
DB_USER="ecommerce_user"
CONTAINER="igwtstore_db"       # la base real (solo se le cuentan filas)
TEST_CONTAINER="restore_test"  # la temporal
BACKUP_DIR="/home/$(whoami)/backups"

LATEST=$(ls -1t "$BACKUP_DIR"/${DB_NAME}_*.sql.gz 2>/dev/null | head -1 || true)
if [ -z "$LATEST" ]; then
  echo "[$(date)] ERROR: no hay backups en $BACKUP_DIR"
  exit 1
fi
echo "[$(date)] Ensayando la restauración de $(basename "$LATEST")..."

docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
docker run --rm -d --name "$TEST_CONTAINER" \
  -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD=ensayo -e POSTGRES_DB="$DB_NAME" \
  postgres:16-alpine >/dev/null
trap 'docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true' EXIT

# El contenedor de Postgres arranca, se inicializa y se reinicia: hay que esperar al final de la
# inicialización, no a la primera vez que responde.
for _ in $(seq 1 90); do
  if docker logs "$TEST_CONTAINER" 2>&1 | grep -q "PostgreSQL init process complete" \
     && docker exec "$TEST_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# ON_ERROR_STOP + una sola transacción: si algo del backup no carga, falla todo (y se nota),
# en vez de quedar restaurado a medias.
gunzip -c "$LATEST" | docker exec -i "$TEST_CONTAINER" \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 --single-transaction -q >/dev/null

for table in orders customers products; do
  real=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -At -c "SELECT count(*) FROM $table")
  copia=$(docker exec "$TEST_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -At -c "SELECT count(*) FROM $table")
  echo "[$(date)]   $table: base real $real · backup $copia"
  if [ "$copia" -eq 0 ] && [ "$real" -gt 0 ]; then
    echo "[$(date)] ERROR: el backup no tiene $table"
    exit 1
  fi
done
# (la base real puede tener algunas filas más: lo que entró desde las 3:00, cuando se hizo el backup)

echo "[$(date)] OK: el backup se restaura completo"

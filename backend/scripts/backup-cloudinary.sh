#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# COPIA DE LAS FOTOS Y VIDEOS DE CLOUDINARY (M11 de la auditoría, 30/10/2026)
# Las fotos de los productos viven solo en Cloudinary: el backup de la base guarda los LINKS, no las
# fotos. Si se pierde la cuenta (o se borra algo por error), el catálogo queda sin imágenes.
#
# Esto saca de la base todos los links de Cloudinary que se usan (productos, variantes y fotos de los
# ítems libres de los pedidos), baja a ~/backups/cloudinary SOLO los que todavía no tenía (la primera
# vez tarda; después, segundos) y sube la carpeta a B2.
#
# Por cron, el día 1 de cada mes a las 4:00:
#   0 4 1 * * bash /home/shelo/Ecommerce_mm/backend/scripts/backup-cloudinary.sh >> /home/shelo/backups/cloudinary.log 2>&1
#
# Requisitos: wget, y rclone con el remote "backblaze" (igual que backup-db.sh).
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

DB_NAME="ecommerce_db"
DB_USER="ecommerce_user"
CONTAINER="igwtstore_db"
MIRROR_DIR="/home/$(whoami)/backups/cloudinary"
B2_REMOTE="backblaze:igwtstore-backups/cloudinary"

mkdir -p "$MIRROR_DIR/files"
echo "[$(date)] Buscando los links de Cloudinary en la base..."

# Si la consulta falla (contenedor renombrado, base caída), set -e corta acá con error.
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -At -c "
  SELECT unnest(images || videos) FROM products
  UNION SELECT unnest(images || videos) FROM product_variants
  UNION SELECT image FROM product_variants WHERE image IS NOT NULL
  UNION SELECT \"productImage\" FROM order_items WHERE \"productImage\" IS NOT NULL
" > "$MIRROR_DIR/all-links.txt"
grep '^https://res\.cloudinary\.com/' "$MIRROR_DIR/all-links.txt" | sort -u > "$MIRROR_DIR/urls.txt" || true

TOTAL=$(wc -l < "$MIRROR_DIR/urls.txt")
echo "[$(date)] $TOTAL archivos en uso"

# -nc: no vuelve a bajar lo que ya está · -x -nH: guarda con la ruta de Cloudinary (sin pisarse nombres)
# Un link roto (algo que Cloudinary ya no tiene) no corta el resto: se cuenta y se sigue.
if ! wget -q -nc -x -nH -P "$MIRROR_DIR/files" -i "$MIRROR_DIR/urls.txt"; then
  echo "[$(date)] AVISO: algunos archivos no se pudieron bajar (links rotos o Cloudinary no respondió)"
fi
echo "[$(date)] En la copia local: $(find "$MIRROR_DIR/files" -type f | wc -l) archivos ($(du -sh "$MIRROR_DIR/files" | cut -f1))"

if ! command -v rclone &> /dev/null; then
  echo "[$(date)] ERROR: rclone no instalado — la copia quedó solo en este disco"
  exit 1
fi
rclone copy "$MIRROR_DIR/files" "$B2_REMOTE" --quiet
echo "[$(date)] Subido a B2: $B2_REMOTE"

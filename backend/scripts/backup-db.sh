#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# BACKUP AUTOMÁTICO DE BASE DE DATOS
# Hace pg_dump + lo sube a Backblaze B2 (storage barato) o lo deja local.
# Programar con cron para correr cada noche a las 3 AM:
#   0 3 * * * /home/USER/Eccomerce_mm/backend/scripts/backup-db.sh
#
# Requisitos en el VPS:
#   Comentado (migración 08/10/2026): en el VPS nuevo no hay pg_dump en el host; se usa el
#   pg_dump que trae el propio contenedor de la base (igwtstore_db) vía `docker exec`.
#   # - pg_dump (viene con postgresql-client)
#   - Docker con el contenedor igwtstore_db corriendo (deploy/docker-compose.vps.yml)
#   - rclone configurado con un remote "backblaze" apuntando a tu bucket
#     (instalar con: curl https://rclone.org/install.sh | sudo bash)
#     (configurar con: rclone config — elegir "Backblaze B2")
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ──── Configuración ───────────────────────────────────────────────────────────
DB_NAME="ecommerce_db"
DB_USER="ecommerce_user"
BACKUP_DIR="/home/$(whoami)/backups"
RETENTION_DAYS_LOCAL=7    # Backups locales que se conservan
RETENTION_DAYS_REMOTE=30  # Backups en B2 que se conservan
B2_REMOTE="backblaze:igwtstore-backups"  # Cambiar por tu remote y bucket
CONTAINER="igwtstore_db"  # Contenedor de la base en el VPS nuevo (deploy/docker-compose.vps.yml)
# Imágenes subidas al servidor (las de Cloudinary no pasan por acá). Se calcula desde la
# ubicación del script, así no depende de la carpeta desde donde lo llame el cron.
UPLOADS_DIR="$(cd "$(dirname "$0")/.." && pwd)/uploads"
# ──────────────────────────────────────────────────────────────────────────────

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"
# Se escribe a .tmp y se renombra al final: si el dump se corta a mitad, queda un .tmp
# descartable en vez de un .sql.gz truncado que parece válido.
TMP_FILE="${BACKUP_FILE}.tmp"
trap 'rm -f "$TMP_FILE"' ERR

echo "[$(date)] Iniciando backup de $DB_NAME..."

# pg_dump comprimido con gzip — más chico, sube más rápido
# Comentado (migración 08/10/2026): esto era para el Postgres bare-metal del VPS viejo,
# con la contraseña en ~/.pgpass. En el VPS nuevo la base vive en el contenedor igwtstore_db.
# # -h localhost fuerza conexión por TCP/IP (en vez del socket Unix), así Postgres
# # usa autenticación md5 (con password de ~/.pgpass) en lugar de peer (que matchearía
# # el usuario del SO contra el de la DB y fallaría porque corremos como 'shelo').
# pg_dump -h localhost -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl | gzip > "$BACKUP_FILE"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl | gzip > "$TMP_FILE"
gzip -t "$TMP_FILE"   # si el archivo quedó corrupto, set -e corta acá y el trap borra el .tmp
mv "$TMP_FILE" "$BACKUP_FILE"
echo "[$(date)] Backup local creado: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# Imágenes subidas (backend/uploads): hasta la migración solo se respaldaba la base, y si se
# perdía el disco se perdían estos archivos aunque la base —con los links— estuviera a salvo.
UPLOADS_FILE="$BACKUP_DIR/igwtstore_uploads_${TIMESTAMP}.tar.gz"
if [ -d "$UPLOADS_DIR" ]; then
  tar czf "${UPLOADS_FILE}.tmp" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
  gzip -t "${UPLOADS_FILE}.tmp"
  mv "${UPLOADS_FILE}.tmp" "$UPLOADS_FILE"
  echo "[$(date)] Backup de uploads creado: $UPLOADS_FILE ($(du -h "$UPLOADS_FILE" | cut -f1), $(find "$UPLOADS_DIR" -type f | wc -l) archivos)"
else
  echo "[$(date)] AVISO: no existe $UPLOADS_DIR — no se respaldan uploads"
  UPLOADS_FILE=""
fi

# Subir a Backblaze B2 (si rclone está configurado)
if command -v rclone &> /dev/null; then
  rclone copy "$BACKUP_FILE" "$B2_REMOTE/" --quiet
  echo "[$(date)] Backup subido a B2: $B2_REMOTE/$(basename "$BACKUP_FILE")"
  if [ -n "$UPLOADS_FILE" ]; then
    rclone copy "$UPLOADS_FILE" "$B2_REMOTE/" --quiet
    echo "[$(date)] Uploads subidos a B2: $B2_REMOTE/$(basename "$UPLOADS_FILE")"
  fi

  # Limpiar backups viejos remotos (>RETENTION_DAYS_REMOTE días)
  rclone delete --min-age "${RETENTION_DAYS_REMOTE}d" "$B2_REMOTE/" --quiet
else
  echo "[$(date)] rclone no instalado — backup queda solo local"
fi

# Limpiar backups locales viejos (>RETENTION_DAYS_LOCAL días)
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime "+${RETENTION_DAYS_LOCAL}" -delete
find "$BACKUP_DIR" -name "igwtstore_uploads_*.tar.gz" -mtime "+${RETENTION_DAYS_LOCAL}" -delete

echo "[$(date)] Backup completado OK"

#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# BACKUP AUTOMÁTICO DE BASE DE DATOS
# Hace pg_dump + lo sube a Backblaze B2 (storage barato) o lo deja local.
# Programar con cron para correr cada noche a las 3 AM:
#   0 3 * * * /home/USER/Eccomerce_mm/backend/scripts/backup-db.sh
#
# Requisitos en el VPS:
#   - pg_dump (viene con postgresql-client)
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
# ──────────────────────────────────────────────────────────────────────────────

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

echo "[$(date)] Iniciando backup de $DB_NAME..."

# pg_dump comprimido con gzip — más chico, sube más rápido
# -h localhost fuerza conexión por TCP/IP (en vez del socket Unix), así Postgres
# usa autenticación md5 (con password de ~/.pgpass) en lugar de peer (que matchearía
# el usuario del SO contra el de la DB y fallaría porque corremos como 'shelo').
pg_dump -h localhost -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl | gzip > "$BACKUP_FILE"
echo "[$(date)] Backup local creado: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# Subir a Backblaze B2 (si rclone está configurado)
if command -v rclone &> /dev/null; then
  rclone copy "$BACKUP_FILE" "$B2_REMOTE/" --quiet
  echo "[$(date)] Backup subido a B2: $B2_REMOTE/$(basename "$BACKUP_FILE")"

  # Limpiar backups viejos remotos (>RETENTION_DAYS_REMOTE días)
  rclone delete --min-age "${RETENTION_DAYS_REMOTE}d" "$B2_REMOTE/" --quiet
else
  echo "[$(date)] rclone no instalado — backup queda solo local"
fi

# Limpiar backups locales viejos (>RETENTION_DAYS_LOCAL días)
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime "+${RETENTION_DAYS_LOCAL}" -delete

echo "[$(date)] Backup completado OK"

#!/usr/bin/env bash
# Restore a SeasonKart backup.   Usage:
#   bash scripts/restore.sh backups/db-20261024-021501.sql.gz [target_db_name] [--yes]
#   bash scripts/restore.sh backups/uploads-20261024-021501.tar.gz            (photos)
# TIP: first restore into a scratch database (e.g. seasonkart_test) to check the backup is good.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
FILE="${1:-}"; TARGET="${2:-}"; YES=""
for a in "$@"; do [ "$a" = "--yes" ] && YES=1; done
[ "$TARGET" = "--yes" ] && TARGET=""
[ -f "$FILE" ] || { echo "Usage: bash scripts/restore.sh <backup-file> [target_db] [--yes]"; exit 1; }
ENV_FILE="${ENV_FILE:-.env}"
get(){ grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/[[:space:]]\+#.*$//' -e 's/^["'\'']//' -e 's/["'\'']$//' || true; }
DB_HOST="${DB_HOST:-$(get DB_HOST)}"; DB_HOST="${DB_HOST:-localhost}"; DB_USER="${DB_USER:-$(get DB_USER)}"; DB_PASS="${DB_PASS:-$(get DB_PASS)}"; DB_NAME="${DB_NAME:-$(get DB_NAME)}"
PASSPHRASE="${BACKUP_PASSPHRASE:-$(get BACKUP_PASSPHRASE)}"; export PASSPHRASE

if [[ "$FILE" == *uploads-*.tar.gz ]]; then
  UPLOAD_DIR="${UPLOAD_DIR:-$(get UPLOAD_DIR)}"; UPLOAD_DIR="${UPLOAD_DIR:-$PWD/public/uploads}"
  echo "This will extract photos into $UPLOAD_DIR (existing files with the same name are overwritten)."
  [ -n "$YES" ] || { read -r -p "Continue? [y/N] " a; [[ "$a" =~ ^[Yy]$ ]] || exit 1; }
  mkdir -p "$UPLOAD_DIR"
  tar -xzf "$FILE" --strip-components=1 -C "$UPLOAD_DIR" && echo "Photos restored."; exit 0
fi

TARGET="${TARGET:-$DB_NAME}"
echo "Restoring $(basename "$FILE") into database '$TARGET' on $DB_HOST."
[ "$TARGET" = "$DB_NAME" ] && echo "WARNING: '$TARGET' is your LIVE database - all current data in it will be replaced. Stop the app first (pm2 stop seasonkart)."
[ -n "$YES" ] || { read -r -p "Type YES to continue: " a; [ "$a" = "YES" ] || { echo "Cancelled."; exit 1; }; }
export MYSQL_PWD="$DB_PASS"
mysql -h "$DB_HOST" -u "$DB_USER" -e "CREATE DATABASE IF NOT EXISTS \`$TARGET\` CHARACTER SET utf8mb4" 2>/dev/null || echo "(could not create database - assuming it already exists)"
if [[ "$FILE" == *.enc ]]; then openssl enc -d -aes-256-cbc -pbkdf2 -pass env:PASSPHRASE -in "$FILE" | gunzip -c | mysql -h "$DB_HOST" -u "$DB_USER" "$TARGET"
else gunzip -c "$FILE" | mysql -h "$DB_HOST" -u "$DB_USER" "$TARGET"; fi
echo "Database restored into '$TARGET'."

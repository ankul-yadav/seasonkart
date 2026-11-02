#!/usr/bin/env bash
# SeasonKart backup: MySQL dump (gzip, optionally encrypted) + weekly photo archive, old-file cleanup,
# optional off-site copy (rclone) and a "I am alive" ping (healthchecks.io). Run daily from cron - see DEPLOY.md.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-.env}"
# read single values from .env without sourcing it (values may contain spaces or < >)
get(){ grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/[[:space:]]\+#.*$//' -e 's/^["'\'']//' -e 's/["'\'']$//' || true; }
DB_HOST="${DB_HOST:-$(get DB_HOST)}"; DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-$(get DB_USER)}"; DB_PASS="${DB_PASS:-$(get DB_PASS)}"; DB_NAME="${DB_NAME:-$(get DB_NAME)}"
BACKUP_DIR="${BACKUP_DIR:-$(get BACKUP_DIR)}"; BACKUP_DIR="${BACKUP_DIR:-$PWD/backups}"
UPLOAD_DIR="${UPLOAD_DIR:-$(get UPLOAD_DIR)}"; UPLOAD_DIR="${UPLOAD_DIR:-$PWD/public/uploads}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-$(get BACKUP_KEEP_DAYS)}"; KEEP_DAYS="${KEEP_DAYS:-14}"
REMOTE="${BACKUP_RCLONE_REMOTE:-$(get BACKUP_RCLONE_REMOTE)}"; REMOTE_KEEP="${BACKUP_REMOTE_KEEP_DAYS:-$(get BACKUP_REMOTE_KEEP_DAYS)}"; REMOTE_KEEP="${REMOTE_KEEP:-60}"
PING="${HC_PING_URL:-$(get HC_PING_URL)}"
PASSPHRASE="${BACKUP_PASSPHRASE:-$(get BACKUP_PASSPHRASE)}"; export PASSPHRASE
[ -n "$DB_USER" ] && [ -n "$DB_NAME" ] || { echo "DB_USER / DB_NAME missing in $ENV_FILE"; exit 1; }

log(){ echo "[$(date '+%F %T')] $*"; }
ping(){ [ -n "$PING" ] && command -v curl >/dev/null && curl -fsS -m 10 --retry 2 -o /dev/null "$PING$1" || true; }
trap 'code=$?; rm -f "${TMP:-}"; log "BACKUP FAILED (exit $code)"; ping /fail; exit $code' ERR

umask 077
mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
EXT=".sql.gz"; [ -n "$PASSPHRASE" ] && EXT=".sql.gz.enc"
OUT="$BACKUP_DIR/db-$TS$EXT"; TMP="$OUT.partial"

read_db(){ if [[ "$1" == *.enc ]]; then openssl enc -d -aes-256-cbc -pbkdf2 -pass env:PASSPHRASE -in "$1" | gunzip -c; else gunzip -c "$1"; fi; }

log "dumping database $DB_NAME"
if [ -n "$PASSPHRASE" ]; then
  MYSQL_PWD="$DB_PASS" mysqldump -h "$DB_HOST" -u "$DB_USER" --single-transaction --skip-lock-tables --no-tablespaces --quick "$DB_NAME" | gzip -9 | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:PASSPHRASE > "$TMP"
else
  MYSQL_PWD="$DB_PASS" mysqldump -h "$DB_HOST" -u "$DB_USER" --single-transaction --skip-lock-tables --no-tablespaces --quick "$DB_NAME" | gzip -9 > "$TMP"
fi
mv "$TMP" "$OUT"
# verify: the file must decompress and really contain the tables
TABLES="$(read_db "$OUT" | grep -c '^CREATE TABLE' || true)"
if [ "${TABLES:-0}" -lt 1 ]; then rm -f "$OUT"; log "dump looks empty - removed"; false; fi
log "database backup ok: $(basename "$OUT") ($(du -h "$OUT" | cut -f1), $TABLES tables)"

# photos: once a week (or if there is no photo archive yet)
if [ -d "$UPLOAD_DIR" ] && [ -z "$(find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime -7 2>/dev/null | head -1)" ]; then
  tar -czf "$BACKUP_DIR/uploads-$TS.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
  log "photo archive ok: uploads-$TS.tar.gz ($(du -h "$BACKUP_DIR/uploads-$TS.tar.gz" | cut -f1))"
fi

# remove old files only AFTER a good new backup exists
find "$BACKUP_DIR" -name 'db-*' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +28 -delete
find "$BACKUP_DIR" -name '*.partial' -mtime +1 -delete
touch "$BACKUP_DIR/.last_ok"   # the admin dashboard reads this to show "Last backup"

if [ -n "$REMOTE" ]; then
  command -v rclone >/dev/null || { log "BACKUP_RCLONE_REMOTE is set but rclone is not installed"; false; }
  rclone copy "$BACKUP_DIR" "$REMOTE" --include 'db-*' --include 'uploads-*.tar.gz' --max-age 8d
  rclone delete "$REMOTE" --min-age "${REMOTE_KEEP}d" --include 'db-*' --include 'uploads-*.tar.gz' || true
  log "off-site copy ok -> $REMOTE"
else
  log "note: no off-site copy configured (BACKUP_RCLONE_REMOTE) - backups only exist on this server"
fi
ping ""
log "done"

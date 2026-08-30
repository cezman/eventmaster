#!/usr/bin/env bash
# Ежедневный бэкап SQLite (запускается systemd-таймером eventmaster-backup.timer).
# sqlite3 .backup делает согласованную копию даже при работающем сервере (WAL не страшен).
set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/eventmaster}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/eventmaster}"
KEEP_DAYS=14
DB="$DATA_DIR/app.db"

[ -f "$DB" ] || { echo "Нет файла $DB — бэкап не делаем"; exit 1; }
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d_%H%M)"
OUT="$BACKUP_DIR/app-$STAMP.db"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" ".backup '$OUT'"
else
  # sqlite3 не установлен — простая копия (чуть менее надёжно при активной записи)
  cp "$DB" "$OUT"
fi
find "$BACKUP_DIR" -name 'app-*.db' -mtime "+$KEEP_DAYS" -delete

echo "Бэкап готов: $OUT ($(du -h "$OUT" | cut -f1))"

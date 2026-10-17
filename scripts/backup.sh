#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
[[ -f .env ]] || { printf 'Falta .env.\n' >&2; exit 1; }
set -a
# shellcheck disable=SC1091
. ./.env
set +a
[[ -n "${BACKUP_ENCRYPTION_KEY:-}" ]] || { printf 'Falta BACKUP_ENCRYPTION_KEY en .env.\n' >&2; exit 1; }
[[ -n "${POSTGRES_USER:-}" && -n "${POSTGRES_DB:-}" ]] || { printf 'Falta configuración de PostgreSQL en .env.\n' >&2; exit 1; }

backup_root="${BACKUP_DIR:-$ROOT_DIR/backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="$backup_root/$stamp"
temporary="$(mktemp -d)"
umask 077
mkdir -p "$destination"
chmod 700 "$backup_root" "$destination"
trap 'rm -rf "$temporary"' EXIT

docker compose exec -T db pg_dump \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --format=custom > "$temporary/database.dump"
docker compose exec -T api sh -c 'tar -C "$DATA_DIR" -czf - .' > "$temporary/documents.tar.gz"

openssl enc -aes-256-cbc -salt -pbkdf2 -iter 310000 -md sha256 \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in "$temporary/database.dump" -out "$destination/database.dump.enc"
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 310000 -md sha256 \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in "$temporary/documents.tar.gz" -out "$destination/documents.tar.gz.enc"
(cd "$destination" && sha256sum database.dump.enc documents.tar.gz.enc > SHA256SUMS)
printf 'Copia cifrada creada: %s\n' "$destination"
printf 'Conserva la clave de cifrado en un gestor seguro; no se incluye en la copia.\n'

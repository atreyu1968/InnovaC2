#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

backup_path="${1:-}"
[[ -n "$backup_path" && -d "$backup_path" ]] || {
  printf 'Uso: %s backups/AAAAMMDDTHHMMSSZ\n' "$0" >&2
  exit 2
}
backup_path="$(cd "$backup_path" && pwd)"
[[ -f .env ]] || { printf 'Falta .env.\n' >&2; exit 1; }
set -a
# shellcheck disable=SC1091
. ./.env
set +a
[[ -n "${BACKUP_ENCRYPTION_KEY:-}" ]] || { printf 'Falta BACKUP_ENCRYPTION_KEY en .env.\n' >&2; exit 1; }
[[ -f "$backup_path/SHA256SUMS" ]] || { printf 'Falta SHA256SUMS en la copia.\n' >&2; exit 1; }
(cd "$backup_path" && sha256sum --check SHA256SUMS)

printf 'ADVERTENCIA: se sustituirán la base de datos y los documentos actuales.\n'
printf 'Crea una copia de seguridad del estado actual antes de continuar.\n'
read -r -p "Escribe RESTAURAR para confirmar: " confirmation
[[ "$confirmation" == "RESTAURAR" ]] || { printf 'Restauración cancelada.\n'; exit 1; }

temporary="$(mktemp -d)"
umask 077
trap 'rm -rf "$temporary"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 310000 -md sha256 \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in "$backup_path/database.dump.enc" -out "$temporary/database.dump"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 310000 -md sha256 \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in "$backup_path/documents.tar.gz.enc" -out "$temporary/documents.tar.gz"
docker compose exec -T db pg_restore --list \
  < "$temporary/database.dump" >/dev/null

docker compose stop api
docker compose exec -T db pg_restore \
  --clean --if-exists --no-owner --exit-on-error --single-transaction \
  --username="${POSTGRES_USER:-innova}" \
  --dbname="${POSTGRES_DB:-innova_c2}" \
  < "$temporary/database.dump"
docker compose run --rm --no-deps --entrypoint node api -e \
  'const fs=require("node:fs/promises"),path=require("node:path");(async()=>{for(const entry of await fs.readdir(process.env.DATA_DIR))await fs.rm(path.join(process.env.DATA_DIR,entry),{recursive:true,force:true})})().catch(e=>{console.error(e.message);process.exit(1)})'
docker compose run --rm --no-deps --entrypoint tar api \
  -C /var/lib/innova/documents -xzf - \
  < "$temporary/documents.tar.gz"
docker compose start api
printf 'Restauración completada. Comprueba el estado con scripts/health.sh.\n'

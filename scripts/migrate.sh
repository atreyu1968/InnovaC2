#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
mode="${1:---preflight}"
baseline="${2:-}"
repair="${3:-}"
if [[ "$mode" != "--preflight" && "$mode" != "--apply" ]] ||
   [[ -n "$baseline" && ( "$mode" != "--apply" || "$baseline" != "--baseline" ) ]] ||
   [[ -n "$repair" && ( "$baseline" != "--baseline" || "$repair" != "--repair-guards" ) ]] ||
   (( $# > 3 )); then
  printf 'Uso: %s [--preflight | --apply [--baseline [--repair-guards]]]\n' "$0" >&2
  exit 2
fi
runner=(docker compose run --rm --no-deps -T --entrypoint node)
if [[ "$mode" == "--preflight" ]]; then
  "${runner[@]}" api scripts/migrate-database.mjs --preflight
  exit
fi
[[ -f .env ]] || { printf 'Falta .env.\n' >&2; exit 1; }
set -a
# shellcheck disable=SC1091
. ./.env
set +a
[[ -n "${BACKUP_ENCRYPTION_KEY:-}" ]] || { printf 'Falta BACKUP_ENCRYPTION_KEY.\n' >&2; exit 1; }
printf 'Se detiene la API. No se reiniciará si falla la comprobación o la actualización.\n'
docker compose stop api
if ! "${runner[@]}" api scripts/migrate-database.mjs --preflight; then
  [[ "$repair" == "--repair-guards" ]] || exit 1
  printf 'Se solicita reparar únicamente protecciones ausentes; la validación definitiva se repetirá en transacción.\n'
fi
# A unique directory avoids overwriting an earlier backup in the same second.
backup_root="${BACKUP_DIR:-$ROOT_DIR/backups}/migration-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$backup_root"
chmod 700 "$backup_root"
./scripts/backup.sh --offline "$backup_root"
shopt -s nullglob
copies=("$backup_root"/*/SHA256SUMS)
[[ ${#copies[@]} == 1 ]] || { printf 'No se localizó una copia única.\n' >&2; exit 1; }
backup_dir="$(cd "$(dirname "${copies[0]}")" && pwd)"
(cd "$backup_dir" && sha256sum --check SHA256SUMS)
printf 'Se conserva el respaldo en %s\n' "$backup_dir"
arguments=(--apply --backup-dir /migration-backup)
if [[ "$baseline" == "--baseline" ]]; then
  arguments+=(--baseline)
fi
if [[ "$repair" == "--repair-guards" ]]; then
  arguments+=(--repair-guards)
fi
"${runner[@]}" -v "$backup_dir:/migration-backup:ro" api \
  scripts/migrate-database.mjs "${arguments[@]}" | tee "$backup_dir/migration-result.json"
printf 'Actualización terminada. Revisa el informe y arranca con docker compose up -d api.\n'

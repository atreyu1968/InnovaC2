#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

OS_ID=""
OS_VERSION=""
OS_CODENAME=""
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-}"
  OS_VERSION="${VERSION_ID:-}"
  OS_CODENAME="${VERSION_CODENAME:-}"
fi
[[ "$OS_ID" == "ubuntu" ]] || fail "El instalador requiere Ubuntu; sistema detectado: ${OS_ID:-desconocido}."
[[ -n "$OS_CODENAME" ]] || fail "No se pudo detectar el nombre de versión de Ubuntu."
if command -v dpkg >/dev/null 2>&1; then
  dpkg --compare-versions "${OS_VERSION:-0}" ge "22.04" \
    || fail "Se requiere Ubuntu 22.04 o posterior."
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  if [[ "$EUID" -ne 0 ]] && ! command -v sudo >/dev/null 2>&1; then
    fail "Para instalar Docker se requieren permisos de root o sudo."
  fi
  if [[ "$EUID" -eq 0 ]]; then SUDO=(); else SUDO=(sudo); fi
  command -v apt-get >/dev/null 2>&1 || fail "Este Ubuntu no dispone de apt-get."
  "${SUDO[@]}" apt-get update
  "${SUDO[@]}" apt-get install -y ca-certificates curl
  "${SUDO[@]}" install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | "${SUDO[@]}" tee /etc/apt/keyrings/docker.asc >/dev/null
  "${SUDO[@]}" chmod a+r /etc/apt/keyrings/docker.asc
  architecture="$(dpkg --print-architecture)"
  "${SUDO[@]}" tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${OS_CODENAME}
Components: stable
Architectures: ${architecture}
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  "${SUDO[@]}" apt-get update
  "${SUDO[@]}" apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin openssl
  "${SUDO[@]}" systemctl enable --now docker
fi

if ! docker info >/dev/null 2>&1; then
  if [[ "$EUID" -ne 0 ]] && command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    DOCKER=(sudo docker)
  else
    fail "Docker está instalado, pero el usuario actual no puede acceder al daemon. Inicia sesión con permisos Docker y vuelve a ejecutar el instalador."
  fi
else
  DOCKER=(docker)
fi

command -v openssl >/dev/null 2>&1 || fail "No se encontró OpenSSL; instálalo antes de continuar."
if [[ ! -f .env ]]; then
  umask 077
  {
    printf 'POSTGRES_DB=innova_c2\n'
    printf 'POSTGRES_USER=innova\n'
    printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 48)"
    printf 'BACKUP_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 48)"
    printf 'APP_PORT=8080\n'
    printf 'COOKIE_SECURE=false\n'
    printf 'TRUST_PROXY=0\n'
    printf 'LOG_LEVEL=info\n'
  } > .env
  chmod 600 .env
  printf 'Se creó .env con secretos aleatorios. No lo compartas ni lo añadas al repositorio.\n'
else
  for variable in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD SESSION_SECRET BACKUP_ENCRYPTION_KEY APP_PORT; do
    if ! grep -Eq "^${variable}=.+" .env; then
      fail ".env ya existe, pero ${variable} no está definido. Completa el archivo manualmente; el instalador no sobrescribe configuración existente."
    fi
  done
  chmod 600 .env
fi

"${DOCKER[@]}" compose config --quiet
"${DOCKER[@]}" compose up -d --build
printf '\nINNOVA-C2 está en marcha en el puerto configurado en .env.\n'
printf 'Completa la configuración inicial desde la página web. Activa COOKIE_SECURE=true al publicar detrás de HTTPS.\n'

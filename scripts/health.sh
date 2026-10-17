#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
docker compose exec -T api node -e \
  "fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{const body=await r.text();console.log(body);process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})"

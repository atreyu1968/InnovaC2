#!/usr/bin/env sh
set -eu

pnpm --filter @workspace/db run migrate
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs

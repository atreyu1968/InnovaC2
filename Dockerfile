FROM node:24-bookworm-slim

WORKDIR /app
ENV BASE_PATH=/
ENV PORT=3000
ENV NODE_ENV=production
ENV WEB_DIST_DIR=/app/artifacts/innova-c2/dist
ENV DATA_DIR=/var/lib/innova/documents

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tar \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @workspace/api-spec run codegen \
  && pnpm -w run typecheck \
  && pnpm --filter @workspace/innova-c2 run build \
  && pnpm --filter @workspace/api-server run build

RUN groupadd --system innova \
  && useradd --system --gid innova --home-dir /app --shell /usr/sbin/nologin innova \
  && mkdir -p /var/lib/innova/documents \
  && chown -R innova:innova /app /var/lib/innova

USER innova:innova
EXPOSE 3000
ENTRYPOINT ["/app/scripts/container-entrypoint.sh"]

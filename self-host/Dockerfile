# Self-hosted Spoonjoy: the production Worker build in Cloudflare's workerd, through Miniflare.
# Build context: the repository root, after `pnpm run build` (the .github/workflows/self-host-image.yml
# build job). One volume (/data: database, photos, cook sessions, session secret), one port (8080).
FROM node:22.23.5-trixie-slim@sha256:68c76cfad89921b927eae28ba21407475e29d0ce450afcdbe70c1532db042b64

ARG SPOONJOY_VERSION=dev
WORKDIR /app/self-host
COPY self-host/package.json self-host/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

WORKDIR /app
COPY build ./build
COPY migrations ./migrations
COPY self-host/*.mjs ./self-host/
RUN echo '{"type":"module"}' > build/server/package.json \
  && mkdir -p /data && chown node:node /data

ENV NODE_ENV=production DATA_DIR=/data PORT=8080 SPOONJOY_VERSION=${SPOONJOY_VERSION}
LABEL org.opencontainers.image.title="Spoonjoy" \
  org.opencontainers.image.description="Self-hosted Spoonjoy: your recipes, cookbooks and shopping list on your own server." \
  org.opencontainers.image.source="https://github.com/spoonjoy/spoonjoy-v2" \
  org.opencontainers.image.version="${SPOONJOY_VERSION}"

USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/app/self-host/healthcheck.mjs"]
CMD ["node", "/app/self-host/server.mjs"]

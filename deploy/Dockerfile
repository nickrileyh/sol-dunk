# SOL DUNK server: the game page and the API in one image. Build from the repo root:
#   docker build -f deploy/Dockerfile -t sol-dunk .
# deploy/docker-compose.yml runs it with Postgres and Caddy (automatic HTTPS); docs/LAUNCH.md has the steps.

FROM node:22-slim AS page
WORKDIR /app
COPY build.cjs ./
COPY src ./src
# the server sets the page's network and limits when it serves it
RUN SERVER_URL=/ node build.cjs

FROM node:22-slim
ENV NODE_ENV=production DATA_DIR=/app/data PORT=8787
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY server/server.mjs ./server/
COPY server/lib ./server/lib
COPY server/scripts ./server/scripts
COPY --from=page /app/dist/index.server.html ./dist/index.server.html
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8787/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/server.mjs"]

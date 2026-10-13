# API image for a small VM (Oracle Cloud Ampere is arm64; this base is multi-arch).
# The Next.js app is a separate Cloudflare Pages build. This image does not include it.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api apps/api
COPY apps/web/package.json apps/web/package.json
COPY packages packages
COPY ops/backup-sqlite.mjs ops/backup-sqlite.mjs

RUN npm ci

ENV HOST=0.0.0.0 \
    PORT=8787 \
    DATABASE_PATH=/data/tastedraft.sqlite \
    RUNS_PATH=/data/runs.sqlite \
    QLOO_BUDGET_PATH=/data/qloo-budget.sqlite \
    QLOO_CACHE_DIR=/data/qloo-cache \
    RECORDINGS_DIR=/data/recordings \
    NODE_ENV=production

EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "--import", "tsx", "apps/api/src/index.ts"]

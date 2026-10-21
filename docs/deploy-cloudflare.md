# Deploy TasteDraft to Cloudflare

API: Hono on **Workers**. A single Durable Object (`TasteDraftApi`, SQLite-backed) holds
projects/versions/simulations, agent runs/steps, pending proposals and the daily Qloo
budget. The repositories use a synchronous SQLite API, so they run on Durable Object
SQLite through `src/worker/sqlite-shim.ts` instead of the asynchronous D1 API.
Schema: `apps/api/migrations/*.sql`, applied by the Durable Object on boot. The SQL is
also valid for D1. Qloo response cache: **KV** (`QLOO_CACHE`). Web: static Next export on **Pages**.

## One-time setup
```bash
export CLOUDFLARE_API_TOKEN=...  CLOUDFLARE_ACCOUNT_ID=...
cd apps/api
npx wrangler kv namespace create QLOO_CACHE      # put the id in wrangler.toml
printenv QLOO_API_KEY | npx wrangler secret put QLOO_API_KEY   # optional: without it, mock Qloo + recorded runs
printenv LLM_API_KEY  | npx wrangler secret put LLM_API_KEY    # optional: without it, the offline interpreter
npx wrangler pages project create tastedraft --production-branch main
```

## Deploy (or run `./scripts/deploy-cloudflare.sh`)
```bash
cd apps/api && npx wrangler deploy                # prints https://tastedraft-api.<sub>.workers.dev
cd ../web && NEXT_OUTPUT=export NEXT_PUBLIC_API_URL=https://tastedraft-api.<sub>.workers.dev npm run build
npx wrangler pages deploy out --project-name tastedraft --branch main
```
Set `CORS_ORIGINS` in `apps/api/wrangler.toml` to the Pages origin.

## Local
```bash
cd apps/api && npx wrangler dev --port 8787      # keyless fallback; CLOUDFLARE_INCLUDE_PROCESS_ENV=true to pass keys from env
API_BASE=http://127.0.0.1:8787 npm run smoke -w @tastedraft/api
```

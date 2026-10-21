#!/usr/bin/env bash
# Deploy the API Worker, then build and deploy the web app to Pages against it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
cd "$ROOT/apps/api"
URL=$(npx wrangler deploy 2>&1 | tee /dev/stderr | grep -o 'https://[a-z0-9.-]*workers.dev' | head -1)
cd "$ROOT/apps/web"
rm -rf out
NEXT_OUTPUT=export NEXT_PUBLIC_API_URL="$URL" npm run build
npx wrangler pages deploy out --project-name "${PAGES_PROJECT:-tastedraft}" --branch main --commit-dirty=true
API_BASE="$URL" SKIP_PROJECTS="${SKIP_PROJECTS:-0}" npm run smoke -w @tastedraft/api

# Deploy TasteDraft

The API runs on a Linux VM. The Next.js app is a Cloudflare Pages build. This document prepares both. It does not deploy them.

Keys stay in the server environment and in the Pages build environment. They are not committed, and they are not baked into the image.

## What you need

- An Oracle Cloud VM (Ampere or x86). The API image is `node:22-bookworm-slim`, which is published for both.
- Docker and the Docker Compose plugin on that VM.
- A domain whose A or AAAA record points at the VM, if you want HTTPS. A raw IP can serve HTTP on port 80.
- A Cloudflare Pages project for `apps/web`.
- `QLOO_API_KEY` and `LLM_API_KEY` set only on the API host.

## API on the VM

1. Install Docker Engine and the Compose plugin.
2. Clone the public repo and check out the release you want to run.
3. Copy the example env and fill the two keys on the server. Do not commit that file.

   ```bash
   cp .env.example .env
   ```

   Set `QLOO_API_KEY`, `LLM_API_KEY`, and `CORS_ORIGINS` to the Pages origin (for example `https://tastedraft.pages.dev`). Add a custom domain origin on the same line if you have one. There is no wildcard.
4. Set `SITE_ADDRESS` in `.env`.
   - A hostname, such as `api.example.com`, makes Caddy request a certificate.
   - `:80` serves HTTP only. Use that when the VM has a public IP and no domain yet.
5. Open ports 80 and 443 in the Oracle security list and on the VM firewall. Leave 8787 closed. Caddy is the only public listener.
6. Start the stack.

   ```bash
   docker compose up -d --build
   ```

7. Check health from the VM.

   ```bash
   docker compose exec api node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j))).catch(()=>process.exit(1))"
   ```

   A healthy body has `ok: true`, `service: "tastedraft"`, `qloo: "configured"` once the key is set, `llm` set to `openrouter` (or `off` when `LLM_API_KEY` is empty), and `qlooBudget.fallback` of `live` or `recorded`. The body never includes a key.

The API binds `0.0.0.0:8787` inside the container. Compose does not publish that port.

### What the volume holds

The named volume `tastedraft-data` is mounted at `/data`.

| Path | Contents |
|---|---|
| `/data/tastedraft.sqlite` | Projects. WAL mode. |
| `/data/runs.sqlite` | Agent runs. WAL mode. |
| `/data/qloo-budget.sqlite` | UTC-day call counter. WAL mode. |
| `/data/qloo-cache` | Live 200 response cache. Gitignored on a checkout. |
| `/data/recordings` | Derived playback used when a live call does not land. |
| `/data/backups` | Nightly copies. About 14 days. |

The VM filesystem is the durable store. Do not rely on the container writable layer.

### Budget, rate limit, and recorded fallback

`QLOO_DAILY_BUDGET` defaults to 400 live Qloo calls per UTC day. Cache hits do not count. When the counter is full, the client refuses the call before the network, and the agent runner plays the derived recording and labels the run **Recorded run**.

`RATE_LIMIT_PER_MINUTE` defaults to 60 requests per address. The address is the first hop of `X-Forwarded-For`, which Caddy sets. `GET /api/health` is exempt. A limited client receives HTTP 429 and `{ "error": { "code": "rate_limited" } }`. Set the variable to `0` to turn the limit off.

### Nightly backup

The `backup` service waits until the API is healthy, then checkpoints each SQLite file (`PRAGMA wal_checkpoint(TRUNCATE)`) and copies it to `/data/backups`. It repeats every 24 hours and deletes copies older than `BACKUP_KEEP_DAYS` (14). Run one copy by hand with:

```bash
docker compose exec backup node ops/backup-sqlite.mjs --once
```

Copy a backup off the VM if you need it to survive a volume delete. The script does not print database contents.

### Logs

```bash
docker compose logs -f api
docker compose logs -f caddy
```

## Cloudflare Pages

The web app is not in the API image.

| Setting | Value |
|---|---|
| Root directory | repository root |
| Build command | `npm ci && npm run build -w @tastedraft/web` |
| Output directory | `apps/web/.next` (Next.js runtime, not a static export) |
| Node | 22 |

Set `NEXT_PUBLIC_API_URL` to the public API origin, including `https://`, at **build** time. `apps/web/next.config.ts` copies that value onto `NEXT_PUBLIC_API_BASE_URL`. A trailing slash is stripped. If the variable is empty, the app calls `http://127.0.0.1:8787`.

Do not set `QLOO_API_KEY` or `LLM_API_KEY` on Pages. The browser talks to the API. The API talks to Qloo and OpenRouter.

After the first Pages URL exists, put that origin in the API `CORS_ORIGINS` and recreate the API container (`docker compose up -d`) so the allowlist reloads.

## Local check of the image

From the repo root, with a `.env` that has the keys:

```bash
docker compose up -d --build
```

Then request health as above. Stop with `docker compose down`. The volume remains until `docker compose down -v`.

# TasteDraft

**Test the taste before you spend.** TasteDraft is an agent that scores a launch idea (a tour, a café, a product drop) against what a real audience already loves, proposes the change that would help most, and re-scores after you approve it.

**Live demo:** https://tastedraft.pages.dev (no sign-up needed)

## What a judge can try in 60 seconds
1. Press **Test this idea** (or type `test` in the agent chat).
2. The agent builds four personas from Qloo, collects taste evidence and a district heatmap, then scores the idea from 0 to 100.
3. It proposes a change, for example a lower price level, with a predicted gain. Press **Approve** in the chat card to re-score; the sample Tokyo launch goes from 52 to 79.
4. Ask `why is this score?`, `try Osaka`, `compare Shibuya vs Ginza`, or `cheaper merch`. Answers come from the run's own data, not free text.
5. Open the **Benchmark**: on the same 9 launches × 4 personas, 36 of 36 reasons cite Qloo-resolved entities with Qloo, and 0 of 36 without it.

## How Qloo is used
- **Entity and tag search** resolves the brief's references (artists, places, brands, films) to Qloo entities.
- **Insights: demographics** shapes personas by age and gender.
- **Insights: recommendations / cross-domain** gives each persona real taste anchors with affinity scores.
- **Insights: heatmap** ranks neighbourhoods by taste heat for the audience.
- The engine turns these signals into a scored ledger (anchor, cross-domain, local, audience, friction). A signal Qloo didn't measure is treated as unknown, never as zero, and the evidence strength drops to LIMITED instead of the app guessing.

## Architecture
```
apps/web            Next.js 15 UI (static export → Cloudflare Pages)
apps/api            Hono API + agent runner (Cloudflare Worker + Durable Object SQLite, KV cache for Qloo)
packages/engine-rs  Rust scoring engine → WebAssembly
packages/engine-wasm  WASM bindings used by the API
packages/contracts  Shared zod schemas
```
The agent loop: brief → resolve entities → personas → interviews → friction hypotheses → Qloo evidence → evidence gate → simulate options on the engine → rank → propose → human approval → re-score. The LLM (OpenRouter by default) writes the persona voice and parses briefs, with a time budget and an offline fallback. The numbers always come from the engine.

## Run locally
Requires Node 22+ (Rust and wasm-pack only if you rebuild the engine).
```bash
npm install
cp .env.example .env.local   # optional: add keys; without keys it runs the calibrated sample
npm run dev                  # API on :8787, web on :3000
npm test
```

## Deploy to Cloudflare
See `docs/deploy-cloudflare.md` and `scripts/deploy-cloudflare.sh`:
- `apps/api`: `npm run build:worker && npx wrangler deploy`. Create a KV namespace and put its id in `wrangler.toml`.
- Set secrets: `npx wrangler secret put QLOO_API_KEY` (and `LLM_API_KEY`).
- `apps/web`: `NEXT_OUTPUT=export NEXT_PUBLIC_API_URL=<worker url> npm run build`, then `npx wrangler pages deploy out`.

## Environment variables (names only)
`QLOO_API_KEY`, `LLM_API_KEY`, `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_FALLBACK_MODEL`, `EVIDENCE_PROVIDER`, `ENGINE`, `QLOO_DAILY_BUDGET`, `RATE_LIMIT_PER_MINUTE`, `CORS_ORIGINS`, `NEXT_PUBLIC_API_URL`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (deploy only). See `.env.example`.

## Honest limits
Scores are a taste-fit estimate, not a sales forecast. Personas are simulated from Qloo signals. When Qloo returns no measurement for a brief's references, the app shows no score rather than inventing one.

## License
MIT. See [LICENSE](LICENSE).

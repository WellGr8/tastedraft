# TasteDraft

TasteDraft tests whether a brand, product, or campaign concept resonates with an audience in a city. An interpreter reads the brief, an evidence provider supplies affinities, deterministic code calculates the score, an agent proposes a Qloo parameter change, and a person approves it. The model never writes a number.

The scorer is a Rust crate compiled to WebAssembly. The API and the browser load that same build, so a what-if preview uses the ledger the server will store.

## Setup

Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

`npm install && npm run dev` works in Windows cmd and POSIX shells. Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The API listens on [http://127.0.0.1:8787](http://127.0.0.1:8787).

| Command | What it does |
|---|---|
| `npm run dev` | API and Next.js app together |
| `npm run build` | Production build of `apps/web`, then a typecheck of `apps/api` |
| `npm test` | API tests, Rust/WASM parity, and the web label/spellcheck tests |
| `npm run screenshots` | Playwright shots of input, results, and demo at 390×844 and 1440×900 |

With no keys, the sample provider scores the default brief at **71**. Approving the top agent diff (lower price level 3 → 2) re-scores to **80**. The browser shows that delta as a live preview before Apply. The older accessible-premium plus pre-order path inside the engine still scores **82**; the agent no longer offers that pair.

## Environment

The API reads the process environment, and a root `.env` file when you start it. Leave the keys empty to stay on sample data.

| Variable | Role |
|---|---|
| `ENGINE` | `wasm` (default) runs the Rust engine. `ts` keeps the TypeScript fallback. |
| `QLOO_API_KEY` | Live Qloo search, insights, and heatmap. Unset means mock search and the sample score. |
| `LLM_API_KEY` | OpenAI-compatible key for the score-free interpreter. Unset keeps `parseBrief`, `explain`, and `critique` deterministic. Ledger numbers are not sent to the model. |
| `LLM_BASE_URL` | Chat completions base URL. Default `https://api.openai.com/v1`. |
| `LLM_MODEL` | Model name. Default `gpt-4o-mini`. |
| `EVIDENCE_PROVIDER` | `sample`, `fallback` (Wikidata, MusicBrainz, OpenStreetMap), or `qloo`. |
| `HOST` / `PORT` | API bind address. Default `0.0.0.0:8787`. |
| `DATABASE_PATH` | SQLite file. Local scratch; swap the repository for Postgres when storage must survive a restart. |
| `NEXT_PUBLIC_API_BASE_URL` | Origin the browser calls. Default `http://127.0.0.1:8787` (`apps/web/.env`). |

## Architecture

```
apps/web                 Next.js App Router, TypeScript, Tailwind CSS v4, shadcn/ui, MapLibre
apps/api                 Hono on Node. Evidence providers, agent, SQLite, engine switch
packages/contracts       Zod schemas shared by the API and the typed web client
packages/engine-rs       Rust scoring engine
packages/engine-wasm     TypeScript wrapper and the committed Node and browser builds
split/                   Legacy single-file prototype. Not the production UI.
```

The web client in `apps/web/lib/api.ts` imports `BriefV2`, `SearchResult`, `MapLayer`, and the other schemas from `@tastedraft/contracts`. The screen flow is:

1. **Input.** Reference and location cards with thumbnails, image autocomplete, interest tag chips, and spellcheck on the idea and interest fields.
2. **Analysis.** A five-step progress list while the project is created and scored.
3. **Results.** Score, a provenance ledger on every row, the agent's top three proposals as sentences (`Lower price level 3 → 2`), a live browser preview of each proposal's delta before Apply, a Version 1 / Version 2 diff, a version timeline, and an embedded district map. The provenance panel carries an **Engine: Rust/WASM** badge. Demo mode walks the captions and approves the top diff.

Cards use one column on a phone, two from a small tablet, and three on a wide desktop. Result panels stack below 768px.

## Rust / WebAssembly engine

`packages/engine-rs` is the deterministic scorer: `deriveSubs`, `ledgerPoints` (anchor 30, cross 25, local 20, audience 25, friction factor 0.4), per-row rounding, evidence strength, LIMITED display rounding to the nearest 5, null measurements left as gaps, and counterfactual re-scoring of Qloo parameter diffs.

`packages/engine-wasm/pkg/nodejs` is what the API loads. `packages/engine-wasm/pkg/web` is what the browser loads for the live preview. Both builds are committed, so a checkout can score without a Rust toolchain. Rebuild them with `packages/engine-rs/scripts/build-wasm.sh` (the script installs rustup and wasm-pack when they are missing).

`apps/api/src/engine/wasm-adapter.ts` is the switch. Unset `ENGINE` selects wasm. `ENGINE=ts` uses the TypeScript engine.

Parity (default brief **71** with ledger 24/20/15/17/−5, price diff **80**, Bangkok **69**, Tokyo **65**, Berlin **37**):

```bash
npm test -w @tastedraft/engine-wasm
```

## Legacy prototype

`split/` is the previous screen. Rebuild it with `node split/build.mjs` (writes `dist/TasteDraft.dc.html`). The API still serves that file at port 8787 so the old loop can be opened beside the Next.js app. Do not delete `split/`.

Scoring weights, provider wiring, and the HTTP routes are documented in [apps/api/README.md](apps/api/README.md). Contract fields are documented in [packages/contracts/README.md](packages/contracts/README.md).

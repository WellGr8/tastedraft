# TasteDraft server

HTTP API for the audience simulator. The score is deterministic: an evidence provider returns affinities, `deriveSubs()` turns them into five sub-scores, and `ledgerPoints()` applies fixed weights. The model never writes a number. `ENGINE=wasm` (the default) runs that math in `packages/engine-rs` through `src/engine/wasm-adapter.ts`. `ENGINE=ts` keeps the TypeScript fallback.

`createApp({ provider, llm })` wires `createEvidenceProvider({ env })` and `server/src/llm` (`parseBrief`, `explain`, `critique`). The sample provider stays selectable so the calibrated demo still scores 71, then 82.

## Run the full loop

One command builds the screen, serves it, and starts the API:

```bash
cd apps/api
npm install
npm start
```

Then open `http://127.0.0.1:8787/?autostart=1`. The page is served with `apiBase` set to the same origin. `npm test` and `npm run typecheck` cover the engine, persistence, providers, interpreter, and the 71 → 82 loop.

The process binds `0.0.0.0:$PORT` (default port `8787`). The SQLite file defaults to `data/tastedraft.sqlite` (`DATABASE_PATH` overrides it). The file is local scratch space. Swap `ProjectRepository` for Supabase/Postgres when the deploy needs durable storage; routes do not import the driver.

`node:sqlite` (`DatabaseSync`) is the driver. Node 22 still marks it experimental, so `start`, `dev`, and `test` disable that warning.

### Evidence provider

`EVIDENCE_PROVIDER=sample|fallback|qloo`.

| Value | What runs |
|---|---|
| unset, no `QLOO_API_KEY` | `sample`, the calibrated demo (71 → 82) |
| unset, `QLOO_API_KEY` set | Qloo via `createEvidenceProvider({ env })` |
| `sample` | sample, even if a Qloo key is present |
| `fallback` | Wikidata + MusicBrainz + OpenStreetMap, even if a Qloo key is present |
| `qloo` | Qloo. Requires `QLOO_API_KEY` |

Null signals from open data are gaps. Missing dimensions are left out of the ledger (`null`, not `0`) and `evidenceStrength` is `LIMITED`. The server does not invent affinities. `sourceId: "open-data"` is the provider label the screen renders as **Open data**.

`LLM_API_KEY` turns on the live interpreter (`LLM_BASE_URL`, `LLM_MODEL`). Without it, `parseBrief`, `explain`, and `critique` stay deterministic and do not call the network. Ledger numbers are not sent to the model. A change set is mapped onto `{ kind: "posture", posture: "accessible" }` or `{ kind: "scarcity", scarcity: "preorder" }` before Apply. Apply writes the next concept version and re-simulates.

## Pipeline

1. `parseBrief` extracts terms and conflict hypotheses. No numbers.
2. `EvidenceProvider.getEvidence(brief)` returns an affinity packet. `sample` calls `provideEvidence()` from the engine, the same calibration as `split/`. `fallback` and `qloo` come from `server/src/providers`.
3. Fully measured packets go through `deriveSubs` → `ledgerPoints`. Weights are anchor 30, cross 25, local 20, audience 25. Friction is `round(subscore × 0.4)` and then subtracted. Each row is rounded before the sum. A null measurement is excluded. `deriveSubs` throws if it is asked to treat one as zero.
4. Evidence strength is the count of active references: 4+ `HIGH`, 2–3 `MEDIUM`, below 2 `LIMITED`. Any missing dimension also forces `LIMITED`. A LIMITED score that exists is displayed to the nearest 5 (`≈ 70`). A run with no measured dimensions returns `score: null` and null ledger cells. That is a gap, not a failure and not a zero.
5. `explain` and `critique` return fits, frictions, and a change set. The adapter maps that set onto engine proposals. A proposal must cite a signal domain that exists on that run and a supported `change`.

The default brief (Japanese minimalist streetwear, ages 18–25, Los Angeles, Premium, five starter references) scores **71**. Applying accessible premium and independent pre-order drops scores **82**.

## Persistence rules

- A simulation is bound to one concept version and one evidence snapshot. Reading it does not recompute.
- Concept versions are append-only. Apply creates the next version. Version 1 is never updated.
- Apply stacks on the version that simulation was scored against. Applying the price proposal, then the scarcity proposal from the new simulation, is how the API reaches 82.
- `PATCH /api/projects/:id/brief` appends a `brief_edit` version and clears proposal overrides (`posture`, `scarcity`). Complete simulations on that project become `stale`.
- A failed run is a new row with `status: "failed"` and `score: null`. It does not copy a previous result.

## API

Errors:

```json
{ "error": { "code": "bad_request", "message": "..." } }
```

`bad_request` is 400, `not_found` is 404, `conflict` is 409. A simulation that ran and failed is **422** with the failed simulation as the body (the row exists; the score is null).

### `GET /api/health`

```json
{ "ok": true, "service": "tastedraft" }
```

### `POST /api/projects`

Creates the project and concept version 1. An empty body uses the calibrated default brief. Omitted brief fields fall back to that default.

```json
{
  "name": "optional",
  "brief": {
    "idea": "string",
    "age": "18–25 | 26–35 | 36–45 | 46+",
    "city": "Los Angeles | New York | San Francisco | Austin | Miami | Chicago | Seattle",
    "pos": "Independent | Premium | Mass | Luxury",
    "refs": ["up to 8 unique names"],
    "muted": ["subset of refs"],
    "interests": "stored, not scored"
  }
}
```

`201` returns `{ id, name, currentVersionId, createdAt, updatedAt, version }`. Age bands use an en dash (`U+2013`).

### `PATCH /api/projects/:id/brief`

Partial brief. At least one field. This does not return a score.

```json
{
  "projectId": "...",
  "version": { "id": "...", "number": 2, "origin": "brief_edit", "parentId": "...", "brief": {} },
  "staleSimulationIds": ["..."]
}
```

An identical brief returns the current version and `staleSimulationIds: []`.

### `POST /api/simulations`

```json
{ "projectId": "...", "conceptVersionId": "optional, defaults to the current version" }
```

`201` when `status` is `complete`. `422` when `status` is `failed`.

### `GET /api/simulations/:id`

Same simulation object. `stale` means the brief was edited after this run. The historical score is still on the row. It is not a new result.

### Simulation object

```json
{
  "id": "...",
  "projectId": "...",
  "conceptVersionId": "...",
  "versionNumber": 1,
  "evidenceSnapshotId": "...",
  "status": "complete | failed | stale",
  "provider": "sample | inferred | qloo | open-data",
  "score": 71,
  "displayScore": { "text": "71", "why": "Why 71?", "limited": false, "approx": 71 },
  "ledger": { "anchor": 24, "cross": 20, "local": 15, "audience": 17, "friction": -5 },
  "evidenceStrength": "HIGH | MEDIUM | LIMITED",
  "signals": [
    {
      "domain": "Fashion",
      "name": "Japanese minimalism",
      "level": "Strong | Moderate | Limited",
      "feeds": "Anchor affinity",
      "sources": [{ "name": "Muji", "type": "Brand", "provenance": "sample", "affinity": 80 }]
    }
  ],
  "districts": { "min": ["Silver Lake", "Echo Park"], "lux": ["Beverly Hills", "West Hollywood"] },
  "fits": [{ "text": "Japanese minimalism" }, { "text": "Accessible premium", "isNew": true }],
  "frictions": [{ "text": "Premium pricing signals", "why": "..." }],
  "proposals": [
    {
      "id": "...",
      "before": "Premium pricing",
      "after": "Accessible premium",
      "why": "...",
      "evidence": "...",
      "evidenceIds": ["Fashion"],
      "change": { "kind": "posture", "posture": "accessible" },
      "status": "open | applied | dismissed"
    }
  ],
  "subs": { "anchor": 80, "cross": 80, "local": 74, "audience": 68, "friction": 12 },
  "mixed": false,
  "parsedBrief": { "conceptTerms": [], "conflictHypotheses": [], "domains": [] },
  "error": null
}
```

`provider` is the packet source (`sample`, `inferred`, or `qloo`), which is what the screen labels. Unknown references are `inferred`. A mix of known and unknown stays `sample` with `mixed: true`.

`ledger` rows are the weighted points. `friction` is already negative. Their sum is `score`. `subs` is the 0–100 audit trail.

On failure, `score`, `ledger`, `displayScore`, `evidenceStrength`, `subs`, `mixed`, and `parsedBrief` are null, the arrays are empty, and `error` is set.

Supported proposal changes:

- `{ "kind": "posture", "posture": "accessible" }` — accessible premium
- `{ "kind": "scarcity", "scarcity": "preorder" }` — independent pre-order drops

### `POST /api/recommendations/:id/apply`

Creates the next concept version from the parent version of that simulation, then runs a new simulation for it. Version 1 is not modified. A stale or failed simulation, or a recommendation that is not `open`, is `409`.

```json
{
  "recommendation": { "id": "...", "status": "applied", "appliedVersionId": "..." },
  "version": { "number": 2, "origin": "recommendation_applied", "parentId": "...", "brief": {} },
  "simulation": {}
}
```

`201` when the new simulation completed. `422` when the new version was stored but the new simulation failed. Retry with `POST /api/simulations`, not by applying again.

### `POST /api/recommendations/:id/dismiss`

`200` with the recommendation, `status: "dismissed"`. No new version.

### `GET /api/projects/:id/versions`

```json
{
  "projectId": "...",
  "currentVersionId": "...",
  "versions": []
}
```

Versions are ordered by `number`. `origin` is `initial`, `brief_edit`, or `recommendation_applied`.

## Wiring

| Piece | Interface | What `createApp` uses |
|---|---|---|
| Evidence | `EvidenceProvider.getEvidence(brief)` | `createConfiguredProvider`: sample, or `createEvidenceProvider({ env })` for fallback and qloo |
| Language | `parseBrief`, `explain`, `critique` | `createEngineLlm`, which calls `server/src/llm` and maps change sets onto engine proposals |
| Storage | `ProjectRepository` | `node:sqlite`. A Supabase/Postgres adapter can replace it without touching routes |

Pass overrides into `createApp({ provider, llm, repository })`. `deriveSubs` and `ledgerPoints` stay the numeric calibrator. Null measurements go through `scorePacket` instead.

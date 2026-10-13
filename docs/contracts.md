# Shared contracts

`packages/contracts` is the schema both the API and the web app import. Zod parses every payload. Types are inferred from those schemas. Nothing in this package calls Qloo or scores a brief.

## Evidence strength

`HIGH` / `MEDIUM` / `LIMITED` follow the engine rule in `evidenceKey`:

- 4 or more measured refs → `HIGH`
- 2 or 3 → `MEDIUM`
- fewer than 2 → `LIMITED`

Friction `confidence` uses that same function on the friction's evidence refs. A model does not choose it.

## Records

| Schema | Role |
| --- | --- |
| `Persona` | One simulated customer. `quoteLabel` is always `Simulated persona response`. The quote is not evidence. |
| `Evidence` | One Qloo entity or tag. `ref` is the entity or tag id. `affinity` is 0–1 or null. |
| `Friction` | `hypothesis`, evidence refs, and `confidence`. `label` is `Potential friction inferred from cultural signals`. |
| `Proposal` | One or more `QlooParamDiff` rows (`param`, `from`, `to`) plus `evidenceRefs`. |
| `SimulationResult` | Engine ledger, signals, and proposals for a finished scoring pass. `mode` is `live` or `mock`. |
| `SimulationScore` | The engine total and ledger for one version inside a run. |
| `RunSnapshot` | The runner's public state: status, version, round, Qloo call count, `grounding` (`qloo`, `recorded`, or `llm-only`), personas, frictions, evidence, `districts` (derived heatmap cells), proposals, `applied` proposals, `links` (the entities, tags, and heatmap cells behind each proposal), steps, stop reason, report, and `simulation` (the engine ledger, or null before the engine scores). |
| `Step` | One persisted runner step (`seq`, `kind`, `label`, `detail`). |
| `StopReason` | `approved_target`, `insufficient_evidence`, `no_meaningful_improvement`, `max_rounds_or_budget`. |

A run stops after at most 5 rounds or 40 Qloo calls (`MAX_ROUNDS`, `DEFAULT_QLOO_BUDGET`).

## SSE

`GET /api/runs/:id/events` sends `SseEvent` frames.

- `step` — one `Step`, id is the sequence number.
- `state` — the `RunSnapshot` after the machine is waiting or stopped.

Reconnect with `Last-Event-ID` set to the last sequence. Frames at or below that sequence are not sent again. The closing `state` frame is sent on every connection.

## Claims

Proposal copy is an `Evidence-backed hypothesis`. Sentences that do not cite an evidence id are dropped. With no live LLM key, the offline template is the whole sentence.

## Still required elsewhere

These stay because something still imports them:

- `Brief` in `apps/api/src/engine/types.ts` is the sample engine's input. The calibrated 71 / 80 path reads it. `BriefV2` is the card the runner stores.
- `split/` is still served by `app.ts` (`/assets/map.js`) and `agent/http.ts` (`/results`). `apps/api` `prestart` runs `split/build.mjs`. `agent/agent.test.ts` reads `split/results-demo.json`.
- `apps/api/src/providers/qloo.ts` still exports `QLOO_AGE_BUCKETS` for `agent/model.ts`.
- `providers/qloo/mock-data.ts` and `insights-mock.ts` are the keyless Qloo stand-in. `QlooClient` returns them when no key is set.
- `providers/fallback.ts`, Wikidata, OpenStreetMap, and MusicBrainz still have callers and tests. Synthetic fixtures used by those tests stay.

# TasteDraft contracts

Shared shapes for the Qloo Agentic Hackathon build. The server and the frontend import this package. They do not each declare a second copy.

```ts
import { BriefV2Schema, type BriefV2 } from '@tastedraft/contracts';
```

Zod parses at runtime. The TypeScript types are `z.infer` of those schemas. A relative import of `packages/contracts/src/index.ts` resolves to the same file. `npm install` from the repository root links this package into the workspaces.

`BriefV2` is the hackathon brief. It is not the prototype brief in `server/src/engine/types.ts` (`pos`, `refs: string[]`). Age strings stay product bands (`18–25`, en dash). Turning a band into `signal.demographics.age` is the insights owner's job. `priceLevel` is the Qloo place scale 1–4. `geo.lng` is longitude; map a Qloo `lon` field onto it at the edge.

Affinity on `InsightSignal` is 0–1. `null` means the call did not measure that signal. It is not a score of 0. Ledger rows carry provenance (`source`, `detail`, `evidenceRefs`). `points: null` is an unmeasured dimension. Friction points are signed when present. `Proposal.changes` are dotted Qloo parameter diffs (`signal.demographics.age`, `filter.location.query`), not prose rewrites of the idea. A `MapLayer` is either heatmap cells or pins.

## Shapes

| Export | Fields |
|---|---|
| `Entity` | `id`, `name`, `type`, `image?`, `city?`, `geo?`, `source` |
| `Tag` | `id`, `name`, `type?` |
| `SearchResult` | `query`, `entities`, `source` |
| `BriefV2` | `idea`, `interests: Tag[]`, `references: Entity[]`, `locations: Entity[]`, `city`, `age`, `gender?`, `priceLevel?`, `positioning`, `constraints` |
| `InsightSignal` | `id`, `name`, `type`, `affinity` (0–1 or null), `source`, `params` |
| `ExplainabilityContribution` | `input`, `weight`, `target` |
| `ScoreLedger` | `rows[]` each with `provenance`, plus `total` (null when nothing was measured) |
| `Proposal` | `id`, `changes` (Qloo param diffs), `why`, `evidenceRefs`, `predictedDelta?` |
| `MapLayer` | `{ kind: 'heatmap', cells }` or `{ kind: 'pins', pins }` |
| `SimulationResult` | `id`, `brief`, `signals`, `explainability`, `ledger`, `proposals`, `layers`, `mode` (`live` or `mock`) |

## Folder ownership

Wave 0 lands `contracts/` and `server/src/providers/qloo/client.ts` only. The next four teams start from those and stay inside the paths below.

| Team | Owns |
|---|---|
| A | `server/src/providers/qloo/search*` and `split/brief*` |
| B | `server/src/providers/qloo/insights*` and `server/src/engine` |
| C | `split/map*` and `server/src/providers/qloo/heatmap*` |
| D | `server/src/agent` and `split/results*` |

Shared, not owned by one team:

- `contracts/` — change a shape here when every caller needs the new field.
- `server/src/providers/qloo/client.ts` — the only hackathon HTTP client (`GET /search`, `GET /v2/tags`, `GET /v2/insights`). Search, insights, and heatmap modules call it. They do not open a second client.

`server/src/providers/qloo.ts` is the existing evidence provider used by the calibrated demo. Leave that loop on its current path.

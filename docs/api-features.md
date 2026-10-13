# Feature API

Typed endpoints for the Taste Lab UI. Contracts live in `@tastedraft/contracts` (`packages/contracts/src/features.ts`). The server implements them in `apps/api/src/features`. These routes do not render the web app.

Every JSON body is strict. Unknown fields are HTTP 400. Qloo parameters that the host would silently ignore are rejected before the call.

## Shared envelope

Successful responses extend this object:

| Field | Meaning |
|---|---|
| `mode` | `live` when `QLOO_API_KEY` is set, otherwise `mock` |
| `cached` | `true` when this request was served from the in-memory feature cache |
| `qlooCalls` | Calls spent on this request. A cache hit reports `0` |
| `budget` | Cap for this request. Default `12`, maximum `40`. Send `budget` to override |
| `warnings` | Partial failures, dropped rows, and exhausted budget. The key is never included |

The feature cache keeps a derived result for 10 minutes. It does not store the API key or the raw Qloo body. Live Qloo bodies, when cached at all, stay in the gitignored Qloo client cache.

A second identical POST returns the same result with `cached: true` and `qlooCalls: 0`.

## SSE

`POST /api/features/<name>/stream` uses the same JSON body as the JSON route and responds with `text/event-stream`.

| Event | Payload |
|---|---|
| `step` | `{ type, feature, label, detail }` |
| `warning` | `{ type, feature, message }` |
| `token` | `{ type, feature, text }` persona chat only |
| `citation` | `{ type, feature, id, name }` persona chat only |
| `result` | `{ type, feature, result }` the same object as the JSON route |
| `done` | `{ type, feature, qlooCalls, budget, cached }` |

`feature` is one of `demographic-fit`, `competitors`, `neighborhood`, `niche`, `activation`, `impact`, `reinterview`, `persona-chat`.

Validate events with `FeatureSseEventSchema`.

## Gotchas the server already handles

- Videogame requests must use `urn:entity:videogame`. `video_game` and `urn:entity:video_game` are rewritten. The host returns HTTP 400 for the underscored form.
- `signal.demographics.age` or `gender` is never sent without `signal.location.query` or `filter.location.query`. Alone, Qloo returns HTTP 400.
- `feature.explainability` is read both as an array of `{ entity_id, score }` and as an object keyed by signal name whose value is that array.
- `output.heatmap.boundary` is not sent. A locality boundary returns HTTP 500.
- `bias.trends` is only `off`, `very_low`, `low`, `mid`, `medium`, `high`, or `very_high`. The default niche value is `high`. Videogame rejects trending (`bias.trends`) with HTTP 400. The niche route retries that type without the bias and says so in `warnings`.
- `heatmap.dimensions` is only `price_level,popularity`.
- Rows that come back above `popularity.max` are dropped and reported in `warnings`, in case the host ignores the filter.

Entity `id` may be a Qloo UUID. A non-UUID id is resolved with `/search` and counts against the budget.

## 1. Demographic fit

`POST /api/features/demographic-fit`

Compares each reference's `urn:demographics` skew with the target audience. Skew values are about −1 to 1. The mismatch score is 0–100 and comes from the engine (`demographicMismatch`), not from a model.

```json
{
  "references": [{ "id": "GL-UUID", "name": "Glossier", "type": "brand" }],
  "audience": { "age": "36–45", "gender": "female", "location": "Los Angeles" },
  "budget": 4
}
```

`audience.location` is required. `age` may be a product band (`18–25`, `26–35`, `36–45`, `46+`) or a Qloo bucket (`24_and_younger`, `25_to_29`, `30_to_34`, `35_to_44`, `45_to_54`, `55_and_older`).

Response `references[]`:

| Field | Meaning |
|---|---|
| `skew` | `{ dimension: "age" \| "gender", bucket, value }` |
| `peak` | Age bucket with the highest skew, or null |
| `targetBucket` / `targetValue` | The audience age bucket and its skew |
| `mismatch` | 0–100. Higher means the reference fits the target audience worse |
| `evidence` | `{ id, detail }` rows. `id` is the entity id or `entity:age:bucket` |

`mismatch` on the root is the mean of the reference scores.

The call is `filter.type=urn:demographics` plus the entity id and `signal.location.query`. Age and gender are not sent as a lone demographic signal.

## 2. Competitor benchmark

`POST /api/features/competitors`

Scores user-picked brands for each persona with `filter.results.entities`.

```json
{
  "competitors": [{ "id": "RIVAL-UUID", "name": "The Ordinary", "type": "brand" }],
  "personas": [{
    "id": "fans",
    "label": "Fans",
    "location": "Los Angeles",
    "age": "25_to_29",
    "gender": "female",
    "anchors": [{ "id": "GL-UUID", "name": "Glossier" }]
  }]
}
```

`personas[].location` is required. Each competitor comes back with `affinity` (0–1 or null) and `explainability` (`{ input, weight, target }`). A competitor the host does not return stays in the list with `affinity: null` and a warning.

If anchors plus `filter.results.entities` come back empty, the server retries once with location and demographics only. That retry spends another call.

## 3. Neighborhood and price fit

`POST /api/features/neighborhood`

Heatmap for a city with `heatmap.dimensions=price_level,popularity`. Requires `anchors`, `tags`, or `age`, plus `location`.

```json
{
  "location": "Los Angeles",
  "anchors": [{ "id": "GL-UUID", "name": "Glossier", "type": "brand" }],
  "age": "25_to_29",
  "gender": "female"
}
```

Response:

| Field | Meaning |
|---|---|
| `cellCount` | Heatmap cells used to rank areas |
| `areas` | At most 5. `{ id, label, lat, lng, affinity, popularityAffinity, priceLevelAffinity, priceLevel, priceRecommendation, evidenceRefs }` |
| `priceRecommendation` | One line for the set of areas |

`priceLevel` is 1–4 (`$` through `$$$$`) when a priced place falls in the area. `price_level_affinity` is not a tier. When no priced place is present, `priceLevel` is null and the sentence says so.

Area names come from the nearest place's neighborhood. Otherwise the label is `Area {lat}, {lng}`.

## 4. Niche reference finder

`POST /api/features/niche`

`filter.popularity.max` (default `0.4`) and `bias.trends` (default `high`).

```json
{
  "anchors": [{ "id": "GL-UUID", "name": "Glossier", "type": "brand" }],
  "type": "brand",
  "popularityMax": 0.4,
  "trends": "high",
  "take": 8
}
```

`type` accepts labels (`brand`, `artist`, `videogame`) or a URN. `video_game` is sent as `urn:entity:videogame`.

Each reference has `affinity`, `popularity`, `audienceGrowth`, and `kind`:

- `rising` when `audienceGrowth` is above `0.05`
- `under-the-radar` otherwise

Provide `anchors`, `tags`, or `query`. `query` is resolved with `/search` first.

## 5. Activation plan

`POST /api/features/activation`

For each persona, three insight calls in the launch city: places (`sort_by=quality` and optional `priceLevel` 1–4), podcasts, and partner brands.

```json
{
  "location": "Los Angeles",
  "priceLevel": 3,
  "personas": [{
    "id": "fans",
    "label": "Fans",
    "location": "Los Angeles",
    "age": "25_to_29",
    "gender": "female",
    "anchors": [{ "id": "GL-UUID", "name": "Glossier" }]
  }]
}
```

`personas[].places`, `podcasts`, and `partners` are `{ id, name, type, affinity, priceLevel }`. `priceLevel` is null for podcasts and brands.

## 6. Business impact

`POST /api/features/impact`

No Qloo call. The engine computes an estimate:

`costAvoided = roundsAvoided × (pilotCost + focusGroupCost × sampleSize)`

A missing cost counts as 0. At least one of `pilotCost` or `focusGroupCost` is required.

```json
{
  "pilotCost": 8000,
  "focusGroupCost": 150,
  "sampleSize": 12,
  "roundsAvoided": 2,
  "currency": "USD"
}
```

Response `label` is `estimate`. `disclaimer` is `Not a sales forecast`. `perRound` for the example is `9800` and `costAvoided` is `19600`.

## 7. Persona re-interview

`POST /api/features/reinterview`

Scores each persona against the V1 references and the V2 references with `filter.results.entities`, then runs both affinity lists through the scoring engine (`scoreInsights`).

```json
{
  "personas": [{ "id": "fans", "label": "Fans", "location": "Los Angeles", "age": "25_to_29" }],
  "before": { "references": [{ "id": "GL-UUID", "name": "Glossier", "type": "brand" }] },
  "after": { "references": [{ "id": "RIVAL-UUID", "name": "The Ordinary", "type": "brand" }] }
}
```

Each persona has:

| Field | Meaning |
|---|---|
| `before` / `after` | `{ score, total, ledger }`. `score` is the engine anchor subscore, 0–100. `ledger` is the weighted ledger. `total` is null when nothing was measured |
| `delta` | `after.score - before.score`, or null |
| `changedMind` | `true` when the absolute delta is at least 5 |
| `reason` | Engine text. It cites the reference id whose affinity moved the most |

The quote is not a forecast. `changedMind: false` with a small delta means the score moved inside the 5-point threshold.

## 8. Persona chat

`POST /api/features/persona-chat`

Grounded reply for one persona. `label` is always `Simulated persona response`. `citations` are that persona's Qloo anchors. The model may not invent entities.

```json
{
  "persona": {
    "id": "fans",
    "label": "Fans",
    "location": "Los Angeles",
    "anchors": [{ "id": "GL-UUID", "name": "Glossier", "affinity": 0.8 }]
  },
  "message": "Would this reference fit a 35 to 44 launch?",
  "history": [{ "role": "user", "content": "Earlier turn" }]
}
```

`source` is `llm` when `LLM_API_KEY` is set and the model returns JSON that cites a known anchor. Otherwise `source` is `template` and the message still names the anchors and their ids. No Qloo call is made when the anchors are already on the persona.

The stream emits `token` events, then `citation` events, then `result` and `done`.

## UI notes

- Import the schemas from `@tastedraft/contracts` and parse before rendering.
- Show `warnings` even when the status is 200. A budget stop is a partial result, not a transport error.
- Show `label: "estimate"` and `Not a sales forecast` on the impact card.
- Show `Simulated persona response` on chat. Do not present it as a customer quote.
- Demographic charts should plot `skew` (signed) and call out `mismatch`.
- Neighborhood map: plot `areas` (at most 5). `cellCount` is the underlying heatmap size, not the number of pins.
- Do not send `output.heatmap.boundary`, `urn:entity:video_game`, or demographic age/gender without a location. The server rejects those.

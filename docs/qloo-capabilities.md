# Qloo hackathon capabilities

Probed against `https://hackathon.api.qloo.com` with `X-Api-Key`. Calls are GET. Parameters are dotted query keys. This note records what the hackathon host accepted. It does not store response bodies.

`/search` results are a JSON array on `results` and often omit `success`. Entity type is `types[]` (for example `urn:entity:brand`). Images are `properties.image.url` on `images.qloo.com`. Entity ids are UUIDs.

`/v2/insights` results are `results.entities[]` with `subtype`, `query.affinity` (0–1), and the same image field. `feature.explainability=true` returns `query.explainability` as an object keyed by signal name, not an array. Each entry is `{ entity_id, score }`.

Demographics are modifiers. `signal.demographics.age` or `signal.demographics.gender` alone returns HTTP 400 (`at least one valid signal or filter is required`). They succeed when paired with `signal.location.query` or `filter.location.query`.

Heatmaps need `filter.type=urn:heatmap`, `filter.location.query`, and a real interest signal. Cells are `results.heatmap[]` with `location.latitude`, `location.longitude`, `location.geohash`, and `query.affinity`. `output.heatmap.boundary=urn:entity:locality` returned HTTP 500, so the map client does not send it. `signal.location.query` alone is not enough for a heatmap.

Dining is not its own entity type. `filter.type=urn:entity:place` plus `filter.tags=urn:tag:genre:place:restaurant` returned priced places. `filter.price_level.min` and `filter.price_level.max` are accepted on places (scale 1–4).

## Matrix

| Call | Result |
|---|---|
| `GET /search?query=` | Works. Images on `properties.image.url`. `types` filters. |
| `GET /v2/tags?filter.query=&feature.semantic_search=true` | Works. Tag ids such as `urn:tag:product_service:qloo:restaurant_dining`. |
| `signal.interests.entities` | Works for brand, artist, place, and heatmap. |
| `signal.interests.tags` | Works when the id comes from `/v2/tags`. |
| `signal.demographics.age` | Works with a location signal. Checked: `24_and_younger`, `25_to_29`, `30_to_34`, `35_and_younger`, `36_to_55`, `45_to_54`, `55_and_older`. |
| `signal.demographics.gender` | Works (`female`, `male`) with a location filter or signal. Not sufficient alone. |
| `signal.location.query` | Works for brand, movie, artist, and place. |
| `filter.location.query` | Works for place. Required, with an interest signal, for heatmap. |
| `filter.price_level.min` / `filter.price_level.max` | Works on `urn:entity:place`. |
| `feature.explainability=true` | Works. Object shape described above. |
| `filter.type=urn:heatmap` | Works with `filter.location.query` and `signal.interests.entities`. |
| `output.heatmap.boundary=urn:entity:locality` | HTTP 500. Not used. |
| `filter.tags=urn:tag:genre:place:restaurant` | Works for dining places. |
| `urn:entity:movie` with `signal.location.query` | Works, including images and affinity. |
| Demographics or heatmap location with no other signal | HTTP 400. |

Search uses Qloo first and keeps Qloo images. Wikidata and MusicBrainz run only when that call fails. Live bodies are cached under `server/data/qloo-cache`, which is gitignored. Fixtures in the repo are synthetic.

# TasteDraft

TasteDraft is an AI audience simulator for the Qloo Agentic Hackathon 2026. It tests whether a brand, product, or campaign concept culturally resonates with a target audience in a chosen city.

The screen is primarily Thai, with English system terms. This repository is the fixed Claude Design prototype: the editable source is `split/`, and `node split/build.mjs` rebuilds a single HTML file that opens in a browser.

The principle of the product is unchanged: an interpreter reads the brief, an evidence provider supplies affinities, deterministic code calculates the score, an agent proposes a change, and a person authorizes it. The score formula stays in the engine. The sample provider is the calibrated demo. Open data and Qloo plug in beside it.

## Run

One command runs the full loop (screen + API):

```bash
cd server
npm install
npm start
```

Open `http://127.0.0.1:8787/?autostart=1`. The server builds `dist/TasteDraft.dc.html`, serves it, and points `apiBase` at itself. Default provider is `sample` unless `QLOO_API_KEY` is set (`EVIDENCE_PROVIDER=sample|fallback|qloo`). The default brief scores **71**. Apply both proposals and the re-simulation scores **82**.

The offline prototype is still `node split/build.mjs`, which writes `dist/TasteDraft.dc.html`. Open that file directly, or serve the repo:

```bash
python3 -m http.server 41773 --bind 0.0.0.0
```

Then open `http://127.0.0.1:41773/dist/TasteDraft.dc.html`. An empty `apiBase` never calls `fetch`.

The page embeds its runtime. It still loads cover images from Wikimedia Commons, so those cards need a network.

Check the score math without a browser:

```bash
node split/check-engine.mjs
```

## Source

| Path | Role |
|---|---|
| `split/` | Editable source. `build.mjs` concatenates `mock-data.js`, `evidence.js`, `engine.js`, `view-model.js`, `api.js`, and `logic.js` into the design bundle. |
| `docs/IMAGE_SOURCES.md` | Plain list of cover-image sources. Not shown in the UI. |
| `dist/TasteDraft.dc.html` | Built file. |
| `reference/Main.original.dc.html` | Original prototype, before cover images and these fixes. |
| `reference/Main.with-images.dc.html` | Same prototype with Wikimedia cover images, before these fixes. |
| `server/` | API, deterministic engine, evidence providers, and the score-free interpreter. `npm start` serves the screen and the API. |
| `research-report.md` | Code review, Qloo API notes, and the MVP plan (Thai). |

Do not edit `split/runtime.manifest.json` or `split/shell.html` unless the bundler itself has to change.

## How a score is calculated

`provideEvidence(brief)` returns affinities from the sample tables in `split/evidence.js` (or, later, from Qloo). `deriveSubs()` turns that packet into five sub-scores from 0 to 100. `ledgerPoints()` then applies the existing weights and rounds **each row**:

- Anchor affinity × 30
- Cross-domain fit × 25
- Local fit × 20
- Audience fit × 25
- Cultural friction × 0.4, subtracted

The total is the sum of those rounded rows.

Sub-scores come from the current brief:

- **Anchor** is the mean concept affinity of the active references. Each reference blends its strongest matching facet with the mean of the facets named in the idea (Japanese, minimal, streetwear, electronic).
- **Cross-domain** is the mean affinity per reference type (brand, artist, film, place), scaled by coverage once there are fewer than three types. An electronic idea with no artist reference loses 6 points.
- **Local** is the city’s indie-district affinity, plus a place bonus when a reference is tied to that city, minus a drag for premium pricing and limited-run scarcity.
- **Audience** is age fit plus a city modifier, minus a penalty for the price posture.
- **Friction** is the price-posture gap plus the scarcity gap, plus a small city modifier.

The default brief (the Japanese minimalist streetwear idea, ages 18–25, Los Angeles, Premium, and the five starter references) still scores **71**. Applying the agent’s proposal (accessible premium, independent pre-order drops) still scores **82**. Changing the city, age, positioning, references, or idea changes the total. Version 2 is cleared when the brief is saved again.

Evidence strength is still the count of active, non-muted references: 4 or more is HIGH, 2–3 is MEDIUM, fewer than 2 is LIMITED. A LIMITED score is shown rounded to the nearest 5 (`≈ 70`), and the “Why …?” heading uses that same figure. The ledger underneath keeps the exact sum.

While the provider id is `sample`, the screen says **Sample data**. Unknown references are labeled **Inferred**. `sourceId: 'qloo'` says **Qloo**. `sourceId: 'open-data'` says **Open data** (not sample data). A null measurement stays a gap: the ledger cell is empty and the strength is LIMITED.

## Image sources

Cover art still loads from Wikimedia Commons. Brand logos use `object-fit: contain` on a white tile. The artist portrait stays circular. Film and place images stay rounded squares. The input and result screens do not show credits. The list lives only in [docs/IMAGE_SOURCES.md](docs/IMAGE_SOURCES.md).

## API

Leave the `apiBase` prop empty and the page never calls `fetch`. Scores, fits, frictions, proposals, signals, and districts come from the local engine, so the prototype works offline.

Set `apiBase` (design tweak, or `?apiBase=` on a normally served page) to the backend origin with no trailing slash. The client then calls:

- `POST /api/projects` with `{ idea, age, city, interests, positioning, references }`
- `POST /api/simulations` with that brief plus `{ projectId, applied }`
- `GET /api/simulations/:id` until the body is ready
- `POST /api/recommendations/:id/apply` and `POST /api/recommendations/:id/dismiss`
- `GET /api/projects/:id/versions`

A simulation body is `{ score, ledger: { anchor, cross, local, audience, friction }, evidenceStrength, signals: [{ domain, name, level, feeds, sources }], districts: { min, lux }, fits, frictions: [{ text, why }], proposals: [{ id, before, after, why, evidence }], provider, status }`. Ledger numbers are the weighted points (friction is the signed row). `score` is the total. If `recommendationId` is set, apply and dismiss post once to that id; otherwise they post once per proposal id.

`status` may be `pending`, `ready`, `error`, `entity_not_found`, `stale`, or `ambiguous`. `evidenceStrength` may be `HIGH`, `MEDIUM`, `LIMITED`, or `AMBIGUOUS`. `entity_not_found` (or HTTP 422 with `unresolved`) stops the run and lets the person fix the reference. A ready body with `unresolved` still renders, with the same fix action. `LIMITED` rounds the headline score to the nearest 5. `stale` keeps the numbers on screen and says they are from an older brief.

The analysis checklist advances only when that stage's work finishes: local evidence functions, or the matching request. A failure stays on the failed step with retry. A failed re-run keeps the previous result and marks it stale.

The `.dc.html` artifact sandbox often blocks `fetch`. This client does not tunnel around that. Serve `dist/TasteDraft.dc.html` over HTTP and point `apiBase` at a backend that sends CORS headers. With an empty `apiBase`, the sandbox never has to allow a connection. `?autostart=1` runs the test on load. `?pace=` sets the local stage gap in milliseconds so the checklist can be read.

```bash
node split/check-engine.mjs
node split/check-view.mjs
```

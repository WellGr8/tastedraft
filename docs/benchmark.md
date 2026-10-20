# Persona-panel benchmark

Same launch, two panels.

**With Qloo** builds a persona reason from entities this run can verify. **Without Qloo** asks the same question with no entity list. The published file is [apps/web/public/benchmark.json](../apps/web/public/benchmark.json). Regenerate it with `npm run benchmark` from the repo root.

## Headline in this checkout

`QLOO_API_KEY` and `LLM_API_KEY` were unset, so the file is a **recorded offline run**. It is not a live OpenRouter or Qloo pass.

| | With Qloo | Without Qloo |
|---|---|---|
| Reasons that name a verified Qloo entity | **16 of 36** (0.444) | **0 of 36** |
| Unverifiable names | 10 names, 40 mentions | 0 |
| Hallucinations confirmed by search | not searched | not searched |
| Agreement with public outcomes | no city ranks yet | waits for a live model |
| Score spread | no ledger totals in this file | no scores |

The 16 verified reasons are the four Tokyo case studies, four personas each. Each template names the subject `case-studies.json` already resolved: Billie Eilish, Olivia Rodrigo, Harry Styles, Forever 21. The 20 example reasons name sample references (Aphex Twin, Blue Bottle, Celeste, Laneige, Alfama, and the second anchor on each brief). Those names were not resolved by a Qloo search in this run, so they stay unverifiable. They are not labeled hallucinations.

The without-Qloo arm is the sentence the runner already stores when a pass has no Qloo entities and no model: it names no place and no taste. That is why its citation share is 0 and its unverifiable count is 0. A live model can name entities the offline sentence refuses to invent. Those names are what a live run searches.

## What a reason has to do

Every item uses four slices: the brief age, then the next bands, alternating female and male. The question is “Would you try this?”

A reason **cites a verified entity** when the sentence contains a name from this run’s catalog. The catalog is:

- subjects whose `resolvedName` is already in [apps/web/public/case-studies.json](../apps/web/public/case-studies.json), and
- on a live run, entities returned by `QlooGateway` search or insights whose names match.

A listed name that is absent from that catalog is **unverifiable**. It becomes **hallucinated** only when a search in the same run returns no matching entity. The recorded file does not search, so `hallucinatedMentions` is null. Stray proper nouns that the reply does not list, and that are not in the catalog, are ignored. City names and the words “that reference” are ignored.

The with-Qloo text goes through `draftPersonaReply`. Offline, that is the product template, which names the anchors it was given. Live, the same function calls OpenRouter (`google/gemini-2.5-flash-lite` unless `LLM_MODEL` is set) and keeps a reply only when it cites those anchors. Anything else falls back to the template.

The without-Qloo text, live, is a separate completion at temperature 0 with an empty anchor list. The model must return JSON (`message`, `entities`, `fit`, `verdict`). Each claimed name gets at most two searches per launch, inside the script budget. Offline, the arm uses the runner’s no-entity sentence and does not invent a fit.

## Scores and outcomes

city-rank-2 has no live ranks in this checkout, so this file does not report a top-2 rate or a mean rank. city-rank-1 ranked every real city 1 of 5 because size crowned the capital. An earlier absolute rule (encourage only when the ledger total was at least 55 and local fit was at least 50) matched 2 of 4 scored Tokyo rows. Those totals are not copied into this benchmark, and they are not city ranks. The headline counts persona reasons that name a taste entity from that audience, not every verified catalog name.

The four subjects that an earlier search resolved (Billie Eilish, Olivia Rodrigo, Harry Styles, Forever 21) are still names the offline template may cite. That is the 16 of 36. It is not a new rank. Example personas have no Qloo score in the recorded file, so the example spread is empty.

The `sampleEngine` block is separate. It is the local Rust fixture on the five examples, four ages each. City means are Tokyo 55, Bangkok 50.75, Seoul 46.25, New York 44, Lisbon 48. City range 11. Segment scores run from 39 to 58, range 19. Tokyo follows the Los Angeles row because that fixture has no Tokyo entry. These numbers are not Qloo affinities.

## Launches

Examples, in order: Tokyo tour + merch, Bangkok coffee shop, Seoul indie game, NYC skincare, Lisbon eco tour. Then the four published studies: Billie Eilish (2022), Olivia Rodrigo (2024), Harry Styles (2017), Forever 21 (2009).

## How to run it live

Set both keys in `.env.local` (gitignored). The provider stays OpenRouter:

```
QLOO_API_KEY=...
LLM_API_KEY=...
LLM_PROVIDER=openrouter
LLM_MODEL=google/gemini-2.5-flash-lite
```

Then `npm run benchmark`. The script uses `QlooGateway` with a cap of **80 calls** for the whole file, under the shared hackathon budget of 1000 calls a day (`QLOO_DAILY_BUDGET`). Live 200 bodies go to `apps/api/data/qloo-cache/`, which is gitignored. The writer refuses the public file if it contains a key, an `entity_id`, an explainability blob, or a raw `results` envelope.

`BENCHMARK_RECORDED=1` forces the offline file even when keys are present.

A missing key does not call the network. The script prints which key was absent and writes the recorded file.

## Limits

The Qloo graph behind a live pass is today’s graph. Later records, and Forever 21’s 2019 exit, can still sit in those affinities. The briefs stop at pre-launch facts.

The recorded citation gap (16 of 36 versus 0 of 36) measures the offline templates against the published catalog. It does not measure Gemini. A live run replaces both arms and can move the unverifiable names into verified hits or confirmed misses.

Persona scores on a live with-Qloo arm are the mean of the affinities that insights returned, scaled to 0–100. They are not city ranks. The without-Qloo fit is the model’s own integer. It is a guess.

This is not a sales forecast.

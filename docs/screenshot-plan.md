# Devpost screenshots

Six images. Capture them from the hosted demo or from `npm run dev` with the sample audience (no keys required for shots 1–4). English UI. Crop browser chrome unless the address bar is part of the shot.

## 1. The brief

**File:** `01-brief.png`

**Caption:** A launch brief before any spend: the idea, the city, the age band, and the references the agent will test.

Show the opening brief: an indie Tokyo tour and merch drop, city Tokyo, ages 18–25. The Los Angeles 71 sample is the empty-body API path, not this screen.

## 2. The resonance ledger

**File:** `02-ledger.png`

**Caption:** The cultural resonance score is 71 on the built-in sample. Each row names its source. The number is not a sales forecast.

Show the ledger after the first sample run: anchor, cross, local, audience, and friction, with evidence strength visible.

## 3. A proposal, then the new score

**File:** `03-proposal.png`

**Caption:** Approving the price change (level 3 to 2) re-scores the same sample to 80. The model does not invent the number.

Show the proposal diff and the score after approval, on one image or a before/after pair inside one frame.

## 4. Simulated persona

**File:** `04-persona.png`

**Caption:** Persona chat stays labeled “Simulated persona response.” The reply cites that persona’s Qloo anchors, or it falls back to the template.

Show one reply with the label visible and at least one anchor name in the text.

## 5. The city map

**File:** `05-map.png`

**Caption:** Heatmap cells for the launch city come from Qloo insights. The request does not send the boundary parameter that returns HTTP 500. Empty heat falls back to place pins.

Show the map with either heatmap cells or the place-pin fallback, and the city name in the brief.

## 6. Where the calls went

**File:** `06-trace.png`

**Caption:** Every step is a Qloo call or an engine re-score. A run that cannot reach Qloo is labeled Recorded run instead of a live result.

Show the step list or the trace panel with endpoint names (`/search`, `/v2/insights`, `/v2/tags`) and, if you can trigger it, the Recorded run label. Do not include response bodies, cache files, or keys in the frame.

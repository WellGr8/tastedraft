# Devpost

## Title

TasteDraft

## Tagline

Test a launch with simulated customers before you spend.

## Inspiration

A small artist can sell out a room they have never played, or spend the guarantee and the merch run on a city that does not care. The usual tools for that decision are a group chat and a hope. We wanted an agent that would argue from taste data, show the number it used, and stay obviously simulated so nobody could mistake it for a panel of real fans.

The story we kept on the wall was an indie artist taking a first show, and a merch drop, to Tokyo.

## What it does

You describe a launch: the idea, the city, the age band, the price, the references. TasteDraft builds personas from Qloo insights, interviews them in plain language, and scores the brief in a deterministic Rust engine compiled to WebAssembly. The same engine runs in the browser preview and on the server.

A person approves every change. The strongest proposals come back as Qloo parameter diffs, with the engine's predicted lift. Approving one sends the updated brief back to the same personas.

With no API keys, a built-in Los Angeles streetwear sample scores 71. Approving the price change from level 3 to 2 scores 80. That path is there so a judge can try the loop immediately. It is a calibrated sample, not a live Qloo measurement.

Persona chat is labeled **Simulated persona response**. The reply has to cite that persona's Qloo anchors. If the model is missing, slow, or ungrounded, a template with the same label takes over.

## How we built it

- Next.js and Tailwind for the web app.
- Hono on Node for the API, with SQLite in WAL mode for projects, runs, and the daily Qloo budget.
- Zod contracts shared by the client and the server.
- A Rust scorer, shipped as WASM, with TypeScript parity tests.
- A Qloo client that only sends GET requests to the hackathon host: `/search`, `/v2/tags`, and `/v2/insights` (including heatmap and demographics).
- An OpenRouter provider for persona chat, OpenAI-compatible, with a cheap default model and a cheaper fallback. xAI, OpenAI, and Anthropic remain selectable.

The API is ready for a small VM (Dockerfile, Caddy, a nightly SQLite backup, per-address rate limit, a daily Qloo cap that falls back to a labeled Recorded run). The web build reads `NEXT_PUBLIC_API_URL` for Cloudflare Pages. We did not deploy as part of this branch.

## Challenges

Qloo's graph is today's graph. A fair test of a 2009 or 2017 launch still sees everything that happened later. We wrote the briefs from pre-launch facts only, locked the encourage rule before the calls (total at least 55 and local fit at least 50), and published the misses.

The self-affinity we wanted for the anchor row did not come back. Insights returned related entities, not an affinity for the subject. Those totals leave the anchor and the friction rows empty rather than inventing them.

Place affinity in Tokyo is high for sold-out shows and for a brand that later left the country. An earlier five-city backtest had already shown the same pattern. Heatmap medians did not rank the exit below the sellouts.

Demographics need a location. Age or gender alone is HTTP 400. The heatmap boundary parameter is HTTP 500, so we never send it. Search types have to be URN strings.

Gemini 2.0 Flash no longer has OpenRouter endpoints. The default model is Gemini 2.5 Flash Lite, with Llama 3.2 3B as the fallback. Persona chat stays inside 120 tokens and 8 seconds.

## Accomplishments that we're proud of

The sample loop is deterministic: 71, then 80 after one approved price change, with no keys.

The live Tokyo pass is honest. Under the pre-registered rule, Olivia Rodrigo's 2024 sellout is an encourage (55) and Forever 21's later exit is a caution (42). Billie Eilish's 2022 sellout (45) and Harry Styles's 2017 sellout (44) are cautions, so they miss. Two of four. Local fit was 85–89 for every row.

Persona replies that are not grounded in the persona's own anchors are discarded. The user still sees a simulated answer, and a warning that it is the template.

When the daily Qloo budget is spent, the product says Recorded run. It does not pretend the network succeeded.

## What we learned

A cultural resonance score can be specific and still be a poor forecast. High place affinity in the target city did not mean the launch would hold. The number is useful as a trace of what Qloo measured, with the gaps left visible.

Locking the rule first changed the writeup. We could not move 55 after seeing that Olivia Rodrigo landed on it and the other three landed just under.

Today's taste graph is the wrong instrument for a historical launch unless you say so in the first paragraph.

## What's next

The opening screen is the Tokyo tour. The Los Angeles 71 → 80 sample stays on the empty-body API path.

A way to score the subject entity itself, once we have a Qloo call that returns that affinity, instead of leaving the anchor row empty.

Host the API through 16 November 2026, point Cloudflare Pages at it, and keep the keys on the server only.

## Built with

Qloo Hackathon API, Next.js, React, TypeScript, Tailwind CSS, Hono, Node.js, SQLite, Rust, WebAssembly, Zod, OpenRouter, Docker, Caddy, Cloudflare Pages.

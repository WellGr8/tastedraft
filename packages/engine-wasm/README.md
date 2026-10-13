# @tastedraft/engine-wasm

Thin TypeScript wrapper around the Rust scoring engine.

- `src/index.ts` loads `pkg/nodejs` for Node. No init call.
- `src/web.ts` loads `pkg/web` for the browser. Call `initEngine()` before scoring.

JSON in, JSON out. The shapes match the shared score ledger: weighted rows, null points for unmeasured dimensions, and a total that is the sum of the present rows.

`npm test` (from the repo root, or `npm test -w @tastedraft/engine-wasm`) checks parity against `apps/api`. The API defaults to `ENGINE=wasm`. Set `ENGINE=ts` to score with the TypeScript fallback.

# TasteDraft scoring engine (Rust)

This crate is the deterministic scorer: `deriveSubs`, `ledgerPoints`, insight measurements, the sample graph, and counterfactual re-scoring of Qloo parameter diffs.

`cargo test` checks the golden numbers: the default brief is 71 (ledger 24/20/15/17/-5), the agent price diff is 80, and the Bangkok, Tokyo, and Berlin mock briefs are 69, 65, and 37.

## WebAssembly

The committed builds live in `packages/engine-wasm/pkg/nodejs` (API) and `packages/engine-wasm/pkg/web` (browser preview). Loading those does not require Rust. The API uses this build unless `ENGINE=ts`.

Rebuild both targets, installing rustup and wasm-pack if they are missing:

```bash
packages/engine-rs/scripts/build-wasm.sh
```

`wasm-pack` writes a `*` gitignore into each output directory. The script replaces that so the `.wasm` files stay in git.

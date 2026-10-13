/**
 * Which deterministic scorer the API uses.
 * Unset and `ENGINE=wasm` load the Rust/WebAssembly build.
 * `ENGINE=ts` keeps the TypeScript fallback.
 */
export type EngineBackend = 'ts' | 'wasm';

export function engineBackend(env: NodeJS.ProcessEnv = process.env): EngineBackend {
  return env.ENGINE === 'ts' ? 'ts' : 'wasm';
}

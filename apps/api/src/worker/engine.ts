/** Load the wasm-pack web build synchronously so @tastedraft/engine-wasm works in a Worker. */
import * as web from '../../../../packages/engine-wasm/pkg/web/tastedraft_engine.js';
// Wrangler turns a .wasm import into a compiled WebAssembly.Module.
import wasmModule from '../../../../packages/engine-wasm/pkg/web/tastedraft_engine_bg.wasm';

web.initSync({ module: wasmModule as unknown as WebAssembly.Module });
(globalThis as { __TD_WASM__?: unknown }).__TD_WASM__ = web;

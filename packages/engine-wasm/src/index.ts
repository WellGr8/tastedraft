import { createRequire } from 'node:module';
import type { DisplayScore, InsightScore, LedgerPoints, Rescore, SampleScore, ScoredPacket, Subscores } from './types.ts';

/**
 * Node entry for the TasteDraft scoring engine.
 * The wasm-pack `nodejs` build is loaded synchronously. Browser code should
 * import `@tastedraft/engine-wasm/web` and call `initEngine()` first.
 */

export type {
  DisplayScore,
  InsightScore,
  LedgerPoints,
  NullableSubs,
  Rescore,
  SampleScore,
  ScoreLedger,
  ScoredPacket,
  Subscores,
} from './types.ts';

interface WasmExports {
  deriveSubs(packetJson: string): string;
  ledgerPoints(subsJson: string): string;
  displayScore(total: number, activeRefCount: number): string;
  evidenceStrength(activeRefCount: number): string;
  scorePacket(packetJson: string): string;
  scoreInsights(inputJson: string): string;
  scoreSampleBrief(briefJson: string): string;
  rescoreParamDiffs(briefJson: string, changesJson: string): string;
  scoreMockBrief(briefJson: string): string;
  engineConstants(): string;
}

let cached: WasmExports | undefined;

function wasm(): WasmExports {
  if (!cached) {
    // Cloudflare Workers: apps/api/src/worker/engine.ts installs the web build here.
    const injected = (globalThis as { __TD_WASM__?: WasmExports }).__TD_WASM__;
    if (injected) return (cached = injected);
    const require = createRequire(import.meta.url);
    cached = require('../pkg/nodejs/tastedraft_engine.js') as WasmExports;
  }
  return cached;
}

function read<T>(json: string): T {
  return JSON.parse(json) as T;
}

export function deriveSubs(packet: unknown): Subscores {
  return read(wasm().deriveSubs(JSON.stringify(packet ?? null)));
}

export function ledgerPoints(subs: Subscores): LedgerPoints {
  return read(wasm().ledgerPoints(JSON.stringify(subs)));
}

export function displayScore(total: number, activeRefCount: number): DisplayScore {
  return read(wasm().displayScore(total, activeRefCount));
}

export function evidenceStrength(activeRefCount: number): string {
  return wasm().evidenceStrength(activeRefCount);
}

export function scorePacket(packet: unknown): ScoredPacket {
  return read(wasm().scorePacket(JSON.stringify(packet)));
}

export function scoreInsights(input: unknown): InsightScore {
  return read(wasm().scoreInsights(JSON.stringify(input)));
}

export function scoreSampleBrief(brief: unknown): SampleScore {
  return read(wasm().scoreSampleBrief(JSON.stringify(brief)));
}

export function rescoreParamDiffs(brief: unknown, changes: unknown): Rescore {
  return read(wasm().rescoreParamDiffs(JSON.stringify(brief), JSON.stringify(changes)));
}

export function scoreMockBrief(brief: unknown): InsightScore {
  return read(wasm().scoreMockBrief(JSON.stringify(brief)));
}

export function engineConstants(): {
  weights: { anchor: number; cross: number; local: number; audience: number };
  frictionFactor: number;
} {
  return read(wasm().engineConstants());
}

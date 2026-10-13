/**
 * Browser entry. Call `initEngine()` before the scoring functions.
 * The wasm file is fetched from beside this package's `pkg/web` build.
 */
import init, {
  deriveSubs as deriveSubsRaw,
  displayScore as displayScoreRaw,
  engineConstants as engineConstantsRaw,
  evidenceStrength as evidenceStrengthRaw,
  ledgerPoints as ledgerPointsRaw,
  rescoreParamDiffs as rescoreParamDiffsRaw,
  scoreInsights as scoreInsightsRaw,
  scoreMockBrief as scoreMockBriefRaw,
  scorePacket as scorePacketRaw,
  scoreSampleBrief as scoreSampleBriefRaw,
  type InitInput,
} from '../pkg/web/tastedraft_engine.js';
import type {
  DisplayScore,
  InsightScore,
  LedgerPoints,
  Rescore,
  SampleScore,
  ScoredPacket,
  Subscores,
} from './types.ts';

export async function initEngine(moduleOrPath?: InitInput | Promise<InitInput>): Promise<void> {
  await init(moduleOrPath);
}

function read<T>(json: string): T {
  return JSON.parse(json) as T;
}

export function deriveSubs(packet: unknown): Subscores {
  return read(deriveSubsRaw(JSON.stringify(packet ?? null)));
}

export function ledgerPoints(subs: Subscores): LedgerPoints {
  return read(ledgerPointsRaw(JSON.stringify(subs)));
}

export function displayScore(total: number, activeRefCount: number): DisplayScore {
  return read(displayScoreRaw(total, activeRefCount));
}

export function evidenceStrength(activeRefCount: number): string {
  return evidenceStrengthRaw(activeRefCount);
}

export function scorePacket(packet: unknown): ScoredPacket {
  return read(scorePacketRaw(JSON.stringify(packet)));
}

export function scoreInsights(input: unknown): InsightScore {
  return read(scoreInsightsRaw(JSON.stringify(input)));
}

export function scoreSampleBrief(brief: unknown): SampleScore {
  return read(scoreSampleBriefRaw(JSON.stringify(brief)));
}

export function rescoreParamDiffs(brief: unknown, changes: unknown): Rescore {
  return read(rescoreParamDiffsRaw(JSON.stringify(brief), JSON.stringify(changes)));
}

export function scoreMockBrief(brief: unknown): InsightScore {
  return read(scoreMockBriefRaw(JSON.stringify(brief)));
}

export function engineConstants(): { weights: { anchor: number; cross: number; local: number; audience: number }; frictionFactor: number } {
  return read(engineConstantsRaw());
}

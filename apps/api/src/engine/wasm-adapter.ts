/**
 * Switch for the deterministic engine.
 * `ENGINE=wasm` is the default and loads the committed Rust/WebAssembly build.
 * `ENGINE=ts` keeps the TypeScript implementation.
 */
import type { BriefV2, QlooParamDiff } from '@tastedraft/contracts';
import * as wasm from '@tastedraft/engine-wasm';
import { applyDiffsToEngine, engineBriefFromV2, scoreEngine } from '../agent/model.ts';
import { QlooClient } from '../providers/qloo/client.ts';
import { runInsights } from '../providers/qloo/insights.ts';
import { scorePacket as scorePacketTs, type ScoredPacket } from '../wiring/gaps.ts';
import { engineBackend, type EngineBackend } from './engine-mode.ts';
import {
  scoreInsightMeasurements as scoreInsightsTs,
  type InsightScore,
  type InsightScoreInput,
} from './insights-score.ts';
import { provideEvidence } from './sample-evidence.ts';
import {
  deriveSubs as deriveSubsTs,
  displayScore as displayScoreTs,
  evidenceKey as evidenceKeyTs,
  ledgerPoints as ledgerPointsTs,
} from './score.ts';
import type { Brief, DisplayScore, EvidencePacket, EvidenceStrength, LedgerPoints, Subscores } from './types.ts';

export { engineBackend };
export type { EngineBackend };

export interface SampleEngineScore {
  subscores: Subscores;
  points: LedgerPoints;
  evidenceStrength: EvidenceStrength;
  display: DisplayScore;
}

export interface RescoreResult {
  baseline: number;
  total: number;
  predictedDelta: number;
  subscores: Subscores;
  points: LedgerPoints;
}

export function deriveSubs(packet: EvidencePacket | null | undefined): Subscores {
  if (engineBackend() === 'wasm') return wasm.deriveSubs(packet ?? null);
  return deriveSubsTs(packet);
}

export function ledgerPoints(subs: Subscores): LedgerPoints {
  if (engineBackend() === 'wasm') return wasm.ledgerPoints(subs);
  return ledgerPointsTs(subs);
}

export function displayScore(total: number, activeRefCount: number): DisplayScore {
  if (engineBackend() === 'wasm') return wasm.displayScore(total, activeRefCount);
  return displayScoreTs(total, activeRefCount);
}

export function evidenceKey(activeRefCount: number): EvidenceStrength {
  if (engineBackend() === 'wasm') return wasm.evidenceStrength(activeRefCount) as EvidenceStrength;
  return evidenceKeyTs(activeRefCount);
}

export function scorePacket(packet: EvidencePacket): ScoredPacket {
  if (engineBackend() === 'wasm') return wasm.scorePacket(packet) as ScoredPacket;
  return scorePacketTs(packet);
}

export function scoreInsightMeasurements(input: InsightScoreInput): InsightScore {
  if (engineBackend() === 'wasm') return wasm.scoreInsights(input) as InsightScore;
  return scoreInsightsTs(input);
}

export function scoreSampleBrief(brief: Brief): SampleEngineScore {
  if (engineBackend() === 'wasm') {
    const scored = wasm.scoreSampleBrief(brief);
    return {
      subscores: scored.subscores,
      points: scored.points,
      evidenceStrength: scored.evidenceStrength as EvidenceStrength,
      display: scored.display,
    };
  }
  const packet = provideEvidence(brief);
  const subscores = deriveSubsTs(packet);
  const points = ledgerPointsTs(subscores);
  const active = packet.refs.length;
  return {
    subscores,
    points,
    evidenceStrength: evidenceKeyTs(active),
    display: displayScoreTs(points.total, active),
  };
}

export function rescoreParamDiffs(brief: BriefV2, changes: readonly QlooParamDiff[]): RescoreResult {
  if (engineBackend() === 'wasm') {
    const scored = wasm.rescoreParamDiffs(brief, changes);
    return {
      baseline: scored.baseline,
      total: scored.total,
      predictedDelta: scored.predictedDelta,
      subscores: scored.subscores,
      points: scored.points,
    };
  }
  const baseline = scoreEngine(engineBriefFromV2(brief));
  const next = scoreEngine(applyDiffsToEngine(brief, changes));
  return {
    baseline: baseline.total,
    total: next.total,
    predictedDelta: next.total - baseline.total,
    subscores: deriveSubsTs(next.packet),
    points: next.points,
  };
}

export async function scoreMockBrief(
  brief: BriefV2,
): Promise<Pick<InsightScore, 'ledger' | 'evidenceStrength' | 'gaps' | 'subscores'>> {
  if (engineBackend() === 'wasm') {
    return wasm.scoreMockBrief(brief) as Pick<InsightScore, 'ledger' | 'evidenceStrength' | 'gaps' | 'subscores'>;
  }
  const run = await runInsights(new QlooClient({ apiKey: '' }), brief);
  return {
    ledger: run.ledger,
    evidenceStrength: run.evidenceStrength,
    gaps: run.gaps,
    subscores: run.subscores,
  };
}

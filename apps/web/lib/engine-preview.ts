'use client';

import type { BriefV2 } from '@tastedraft/contracts';

export interface PreviewChange {
  id: string;
  param: string;
  from?: string | null;
  to?: string | null;
}

interface LiveEngine {
  rescoreParamDiffs: (brief: unknown, changes: unknown) => { predictedDelta: number };
  scoreSampleBrief: (brief: unknown) => {
    points: { total: number; anchor: number; cross: number; local: number; audience: number; friction: number };
  };
}

let starting: Promise<LiveEngine> | null = null;

function loadEngine() {
  if (!starting) {
    starting = (async () => {
      const engine = await import('@tastedraft/engine-wasm/web');
      const response = await fetch('/engine/tastedraft_engine_bg.wasm');
      if (!response.ok) throw new Error('The browser scoring engine failed to load');
      await engine.initEngine(await response.arrayBuffer());
      return engine;
    })().catch((error: unknown) => {
      starting = null;
      throw error;
    });
  }
  return starting;
}

/** Re-score proposal diffs in the browser with the same Rust engine the API uses. */
export async function previewDeltas(brief: BriefV2, changes: readonly PreviewChange[]): Promise<Record<string, number>> {
  const engine = await loadEngine();
  const deltas: Record<string, number> = {};
  for (const change of changes) {
    const scored = engine.rescoreParamDiffs(brief, [
      { param: change.param, from: change.from ?? null, to: change.to ?? null },
    ]);
    deltas[change.id] = scored.predictedDelta;
  }
  return deltas;
}

export interface LiveBrief {
  idea: string;
  age: string;
  city: string;
  pos: string;
  refs: string[];
  posture?: string | null;
  scarcity?: string | null;
}

export interface LiveScore {
  total: number;
  rows: Array<{ id: string; points: number }>;
}

/** Instant what-if. The number is the same Rust engine the API uses. */
export async function scoreLive(brief: LiveBrief): Promise<LiveScore> {
  const engine = await loadEngine();
  const scored = engine.scoreSampleBrief({
    idea: brief.idea,
    age: brief.age,
    city: brief.city,
    pos: brief.pos,
    refs: brief.refs,
    applied: false,
    posture: brief.posture ?? null,
    scarcity: brief.scarcity ?? null,
  });
  const points = scored.points;
  return {
    total: points.total,
    rows: [
      { id: 'anchor', points: points.anchor },
      { id: 'cross', points: points.cross },
      { id: 'local', points: points.local },
      { id: 'audience', points: points.audience },
      { id: 'friction', points: points.friction },
    ],
  };
}

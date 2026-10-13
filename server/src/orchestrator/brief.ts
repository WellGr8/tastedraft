import type { Brief } from '../engine/types.ts';
import type { RecommendationChange } from '../domain/llm.ts';
import { applyDiffsToBrief, applyDiffsToEngine } from '../agent/model.ts';
import { briefForAgent } from './agent-score.ts';
import { badRequest } from '../errors.ts';

export interface BriefPatch {
  idea?: string;
  age?: string;
  city?: string;
  pos?: string;
  refs?: string[];
  muted?: string[];
  interests?: string;
}

/** Active playlist. Muted names stay on the version but are not evidence. */
export function forEvidence(brief: Brief): Brief {
  const muted = new Set(brief.muted ?? []);
  return { ...brief, refs: brief.refs.filter((name) => !muted.has(name)) };
}

/**
 * Brief edits clear applied proposal overrides. Version 2 does not carry
 * forward when the brief is saved again.
 */
export function mergeBrief(current: Brief, patch: BriefPatch): Brief {
  const next: Brief = {
    idea: patch.idea !== undefined ? patch.idea.trim() : current.idea,
    age: patch.age ?? current.age,
    city: patch.city ?? current.city,
    pos: patch.pos ?? current.pos,
    refs: patch.refs ?? current.refs,
    muted: patch.muted ?? current.muted ?? [],
  };
  if (patch.interests !== undefined) next.interests = patch.interests;
  else if (current.interests !== undefined) next.interests = current.interests;
  const identityChanged =
    next.idea !== current.idea ||
    next.age !== current.age ||
    next.city !== current.city ||
    next.pos !== current.pos ||
    next.refs.join('\n') !== current.refs.join('\n') ||
    (next.interests ?? '') !== (current.interests ?? '');
  if (!identityChanged && current.briefV2) next.briefV2 = current.briefV2;
  return next;
}

export function canonicalBrief(brief: Brief): string {
  return JSON.stringify({
    idea: brief.idea.trim(),
    age: brief.age,
    city: brief.city,
    pos: brief.pos,
    refs: brief.refs,
    muted: brief.muted ?? [],
    interests: brief.interests ?? '',
    posture: brief.posture ?? null,
    scarcity: brief.scarcity ?? null,
    briefV2: brief.briefV2 ?? null,
  });
}

export function applyChange(brief: Brief, change: RecommendationChange): Brief {
  if (change.kind === 'posture' || change.kind === 'scarcity') {
    const routed = routeLegacyChange(change);
    return applyChange(brief, routed);
  }
  const base = briefForAgent(brief);
  const nextV2 = applyDiffsToBrief(base, change.changes);
  const engine = applyDiffsToEngine(base, change.changes);
  return {
    ...brief,
    idea: nextV2.idea,
    age: engine.age,
    city: engine.city,
    pos: engine.pos,
    refs: engine.refs,
    muted: brief.muted ?? [],
    interests: nextV2.interests.map((tag) => tag.name).join(', '),
    posture: engine.posture,
    scarcity: engine.scarcity,
    briefV2: nextV2,
  };
}

/** Older fixed edits are the agent's price and channel diffs, not a second score story. */
function routeLegacyChange(change: RecommendationChange): RecommendationChange {
  if (change.kind === 'posture') {
    return {
      kind: 'qloo',
      predictedDelta: 0,
      changes: [{ param: 'filter.price_level.max', from: '3', to: '2' }],
    };
  }
  return {
    kind: 'qloo',
    predictedDelta: 0,
    changes: [{ param: 'filter.tags', from: 'limited-run', to: 'preorder-drop' }],
  };
}

export function assertPlaylist(refs: string[], muted: string[]): void {
  const seen = new Set<string>();
  for (const name of refs) {
    if (seen.has(name)) throw badRequest(`Duplicate reference: ${name}`);
    seen.add(name);
  }
  for (const name of muted) {
    if (!seen.has(name)) throw badRequest(`Muted reference is not in the playlist: ${name}`);
  }
}

export function projectName(idea: string, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  const flat = idea.trim().replace(/\s+/g, ' ');
  if (flat.length <= 80) return flat;
  return flat.slice(0, 77) + '...';
}

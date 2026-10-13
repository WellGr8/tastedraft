/**
 * Whether a run has enough cultural evidence to score, and how to widen
 * a thin Qloo query before asking the person for one more detail.
 * This file does not call Qloo and does not keep response bodies.
 */

export const DEFAULT_QLOO_LOCATION = 'Los Angeles';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const IDEA_STOP = new Set([
  'with',
  'this',
  'that',
  'from',
  'your',
  'about',
  'into',
  'over',
  'under',
  'sold',
  'limited',
  'runs',
  'premium',
  'price',
  'brand',
  'launch',
  'launching',
]);

export interface MeasuredEvidence {
  resolvedEntities: number;
  tags: number;
  heatmapCells: number;
  personaAnchors: number;
}

export interface GateInput {
  measured: MeasuredEvidence;
  referenceCount: number;
  /** Live Qloo, or a derived playback of a live call. Mock keeps the reference-count rule. */
  live: boolean;
  forced: boolean;
}

export type GateDecision = 'score' | 'ask';

export interface EvidenceAsk {
  kind: 'city' | 'reference';
  suggestion: string;
  question: string;
}

export interface BroadenInput {
  city: string;
  referenceNames: readonly string[];
  /** Ids already in hand. Sample slugs are dropped. Real Qloo ids are kept. */
  candidateIds: readonly string[];
  heatmapFailed: boolean;
  demographicsFailed: boolean;
}

export interface BroadenedQuery {
  location: string;
  usedDefaultLocation: boolean;
  entityIds: string[];
  dropDemographics: boolean;
  dropPrice: boolean;
  relatedNames: string[];
}

export function isQlooEntityId(id: string): boolean {
  const value = id.trim();
  return UUID.test(value) || value.startsWith('urn:entity:');
}

/** A live run is thin when Qloo contributed no entity, tag, heatmap cell, or persona anchor. */
export function evidenceIsThin(measured: MeasuredEvidence): boolean {
  const grounded = measured.resolvedEntities + measured.tags + measured.heatmapCells;
  return grounded === 0 && measured.personaAnchors < 3;
}

/**
 * Mock runs still ask when the brief has fewer than two references.
 * Live runs score once Qloo has returned something usable.
 */
export function decideGate(input: GateInput): GateDecision {
  if (input.forced) return 'score';
  if (!input.live) return input.referenceCount >= 2 ? 'score' : 'ask';
  return evidenceIsThin(input.measured) ? 'ask' : 'score';
}

export function ideaKeywords(idea: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const word of idea.split(/[^A-Za-z0-9]+/)) {
    const clean = word.trim();
    if (clean.length < 5 || IDEA_STOP.has(clean.toLowerCase())) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(clean);
    if (words.length === 3) break;
  }
  return words;
}

/**
 * The retry plan after the first Qloo pass is thin.
 * Filters come off, sample ids are dropped, and a failed place falls back to a known city.
 */
export function broadenQueries(input: BroadenInput): BroadenedQuery {
  const city = input.city.trim();
  const placeFailed = !city || input.heatmapFailed || input.demographicsFailed;
  const usedDefaultLocation = placeFailed && city.toLowerCase() !== DEFAULT_QLOO_LOCATION.toLowerCase();
  const related = new Set<string>();
  for (const name of input.referenceNames) {
    const clean = name.trim();
    if (clean) related.add(clean);
  }
  return {
    location: usedDefaultLocation || !city ? DEFAULT_QLOO_LOCATION : city,
    usedDefaultLocation: usedDefaultLocation || !city,
    entityIds: input.candidateIds.map((id) => id.trim()).filter(isQlooEntityId).slice(0, 4),
    dropDemographics: true,
    dropPrice: true,
    relatedNames: [...related].slice(0, 4),
  };
}

/** One question, and the button that answers it. */
export function askFor(measured: MeasuredEvidence, city: string, suggestionName?: string): EvidenceAsk {
  if (measured.resolvedEntities > 0) {
    const place = city.trim() || 'that place';
    return {
      kind: 'city',
      suggestion: DEFAULT_QLOO_LOCATION,
      question: `We couldn’t get a clear read on ${place}. Add a city and we’ll test it there.`,
    };
  }
  const suggestion = suggestionName?.trim() || 'Muji';
  return {
    kind: 'reference',
    suggestion,
    question: 'This reference didn’t give us enough to go on. Add another reference and we’ll continue.',
  };
}

export function plainStopReason(reason: string | null | undefined): string {
  if (reason === 'approved_target') return 'This version already clears the target you set.';
  if (reason === 'insufficient_evidence') return 'There isn’t enough cultural evidence to recommend a change yet.';
  if (reason === 'no_meaningful_improvement') return 'Another change wouldn’t move the score in a useful way.';
  if (reason === 'max_rounds_or_budget') return 'This run has used its questions and is stopping here.';
  return reason?.trim() ?? '';
}

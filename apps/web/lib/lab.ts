import { assumptionsFor, detectLaunch, type LaunchKind } from '@tastedraft/contracts';
import type { Entity } from '@tastedraft/contracts';
import { sentimentOf } from './voice.ts';
import {
  COFFEE_IDEA,
  COFFEE_REFERENCES,
  COFFEE_TAGS,
  GAME_IDEA,
  GAME_REFERENCES,
  GAME_TAGS,
  SKIN_IDEA,
  SKIN_REFERENCES,
  SKIN_TAGS,
  STARTER_REFERENCES,
  TOUR_IDEA,
  TOUR_REFERENCES,
  TOUR_TAGS,
  TRAVEL_IDEA,
  TRAVEL_REFERENCES,
  TRAVEL_TAGS,
  uniqueById,
  type DraftState,
} from './defaults.ts';
import type { ProfileControls } from './profile.ts';
export interface CostAssumptions {
  focusGroupUsd: number;
  groups: number;
  pilotDayUsd: number;
  pilotDays: number;
}

export const DEFAULT_ASSUMPTIONS: CostAssumptions = {
  focusGroupUsd: 2500,
  groups: 2,
  pilotDayUsd: 1800,
  pilotDays: 3,
};

/** Transparent stand-in for a focus group plus a short pilot. An estimate, not a forecast. */
export function costAvoided(input: CostAssumptions): number {
  const safe = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
  return Math.round(safe(input.focusGroupUsd) * safe(input.groups) + safe(input.pilotDayUsd) * safe(input.pilotDays));
}

export interface ImpactBody {
  pilotCost: number;
  focusGroupCost: number;
  sampleSize: number;
  roundsAvoided: number;
  currency: 'USD';
}

/**
 * Map the panel assumptions onto POST /api/features/impact.
 * roundsAvoided is 1. pilotCost is the pilot days. focusGroupCost is one group, sampleSize is the group count.
 * A zero group count sends sampleSize 1 and a zero focus cost so the route does not invent a group.
 * Returns null when both costs are zero, because the route requires one of them.
 */
export function impactRequest(input: CostAssumptions): ImpactBody | null {
  const safe = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
  const groups = safe(input.groups);
  const pilotCost = Math.round(safe(input.pilotDayUsd) * safe(input.pilotDays));
  const focusGroupCost = groups > 0 ? safe(input.focusGroupUsd) : 0;
  if (pilotCost === 0 && focusGroupCost === 0) return null;
  return {
    pilotCost,
    focusGroupCost,
    sampleSize: groups > 0 ? Math.max(1, Math.round(groups)) : 1,
    roundsAvoided: 1,
    currency: 'USD',
  };
}

export function isTourBrief(idea: string, city: string): boolean {
  return city.trim().toLowerCase() === 'tokyo' && /tour/i.test(idea) && /merch/i.test(idea);
}

export function formatMoney(usd: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    Number.isFinite(usd) ? usd : 0,
  );
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function whoFits(personas: readonly { label: string; fit: number }[]): string {
  return personas.map((persona) => `${persona.label} (${persona.fit})`).join(', ');
}

/**
 * The summary uses the same bands as the persona cards.
 */
export function snagLine(
  personas: readonly { label: string; fit: number; rejects: boolean; measuring: boolean }[],
  frictions: readonly string[],
): string {
  const scored = personas.filter((persona) => !persona.measuring && persona.fit > 0);
  const friction = frictions.find((line) => line.trim());
  if (!scored.length) return 'Still measuring where this snags.';
  const buy = scored.filter((persona) => sentimentOf(persona.fit) === 'buy');
  const curious = scored.filter((persona) => sentimentOf(persona.fit) === 'curious');
  const pass = scored.filter((persona) => sentimentOf(persona.fit) === 'pass');
  const parts: string[] = [];
  if (buy.length) parts.push(`${whoFits(buy)} would buy`);
  if (curious.length) parts.push(`${whoFits(curious)} ${curious.length === 1 ? 'is' : 'are'} curious`);
  if (pass.length) parts.push(`${whoFits(pass)} would pass`);
  const sentence = `${parts.join('. ')}.`;
  return friction ? `${sentence} Where it snags: ${friction}` : sentence;
}

/**
 * Neighborhood price is what nearby places charge.
 * When the agent tests a lower merch price, say so next to that sentence.
 */
export function neighborhoodPriceNote(
  priceLine: string | null,
  proposal: { param?: string | null; to?: string | null } | null,
): string | null {
  if (!priceLine) return null;
  const area = priceLine.match(/price level\s+([1-4])/i);
  const areaLevel = area ? Number(area[1]) : NaN;
  const merch = proposal?.param === 'filter.price_level.max' ? Number(proposal.to) : NaN;
  if (Number.isFinite(areaLevel) && Number.isFinite(merch) && merch < areaLevel) {
    return `${priceLine} The agent still tests a lower merch price, because the engine scores this idea higher there. Not a sales forecast.`;
  }
  return priceLine;
}

/** A mind changes when the engine score moves by at least 5 points. */
export function changedMind(before: number, after: number, beforeMeasuring = false, afterMeasuring = false): boolean {
  if (beforeMeasuring || afterMeasuring) return false;
  if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0 || after <= 0) return false;
  return Math.abs(after - before) >= 5;
}

export interface LabChip {
  id: string;
  name: string;
  type: string;
  kind: 'reference' | 'audience';
  image?: string;
}

export interface LabVersion {
  n: number;
  score: number | null;
}

export interface LabIdea {
  id: string;
  title: string;
  city: string;
  variant: string;
  parentId: string | null;
  draft: DraftState;
  controls: ProfileControls;
  versions: LabVersion[];
}

export interface LabReport {
  id: string;
  title: string;
  city: string;
  v1: number | null;
  v2: number | null;
  cost: number;
  summary: string;
}

export interface LabLibrary {
  ideas: LabIdea[];
  chips: LabChip[];
  reports: LabReport[];
  assumptions: CostAssumptions;
}

export interface LabExample {
  id: string;
  label: string;
  idea: string;
  city: string;
  age: string;
  priceLevel: 1 | 2 | 3 | 4;
  scarcity: 'open' | 'limited' | 'preorder';
  references: DraftState['references'];
  tags: DraftState['interests'];
}

export const LAB_EXAMPLES: LabExample[] = [
  {
    id: 'tokyo-tour',
    label: 'Tokyo tour + merch',
    idea: TOUR_IDEA,
    city: 'Tokyo',
    age: '18–25',
    priceLevel: 3,
    scarcity: 'limited',
    references: TOUR_REFERENCES,
    tags: TOUR_TAGS,
  },
  {
    id: 'bangkok-coffee',
    label: 'Bangkok coffee shop',
    idea: COFFEE_IDEA,
    city: 'Bangkok',
    age: '26–35',
    priceLevel: 2,
    scarcity: 'open',
    references: COFFEE_REFERENCES,
    tags: COFFEE_TAGS,
  },
  {
    id: 'seoul-game',
    label: 'Seoul indie game',
    idea: GAME_IDEA,
    city: 'Seoul',
    age: '18–25',
    priceLevel: 2,
    scarcity: 'limited',
    references: GAME_REFERENCES,
    tags: GAME_TAGS,
  },
  {
    id: 'nyc-skin',
    label: 'NYC skincare',
    idea: SKIN_IDEA,
    city: 'New York',
    age: '26–35',
    priceLevel: 3,
    scarcity: 'limited',
    references: SKIN_REFERENCES,
    tags: SKIN_TAGS,
  },
  {
    id: 'lisbon-travel',
    label: 'Lisbon eco tour',
    idea: TRAVEL_IDEA,
    city: 'Lisbon',
    age: '36–45',
    priceLevel: 3,
    scarcity: 'open',
    references: TRAVEL_REFERENCES,
    tags: TRAVEL_TAGS,
  },
];

export function assumptionsForIdea(idea: string) {
  return assumptionsFor(detectLaunch(idea).kind);
}

/** Keep a hand-edited cost panel. Swap defaults only when the category changes and the numbers are still the previous defaults. */
export function nextAssumptions(previousIdea: string, nextIdea: string, current: CostAssumptions): CostAssumptions {
  const before = assumptionsForIdea(previousIdea);
  const after = assumptionsForIdea(nextIdea);
  const untouched =
    current.focusGroupUsd === before.focusGroupUsd &&
    current.groups === before.groups &&
    current.pilotDayUsd === before.pilotDayUsd &&
    current.pilotDays === before.pilotDays;
  return untouched ? after : current;
}

export function launchKind(idea: string): LaunchKind {
  return detectLaunch(idea).kind;
}

export function seedLibrary(): LabLibrary {
  return {
    ideas: [],
    chips: uniqueById(
      [
        ...TOUR_REFERENCES,
        COFFEE_REFERENCES[0]!,
        GAME_REFERENCES[0]!,
        SKIN_REFERENCES[0]!,
        TRAVEL_REFERENCES[0]!,
        ...STARTER_REFERENCES,
      ]
        .filter((entity, index, all) => all.findIndex((item) => item.name.toLowerCase() === entity.name.toLowerCase()) === index)
        .map((entity) => ({
          id: entity.id,
          name: entity.name,
          type: entity.type,
          kind: 'reference' as const,
          ...(entity.image ? { image: entity.image } : {}),
        })),
    ),
    reports: [],
    assumptions: { ...DEFAULT_ASSUMPTIONS },
  };
}

const STORAGE_KEY = 'tastedraft-lab-ui';

export function loadLibrary(): LabLibrary | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LabLibrary>;
    if (!parsed || !Array.isArray(parsed.ideas) || !Array.isArray(parsed.chips)) return null;
    return {
      ideas: parsed.ideas,
      chips: parsed.chips,
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
      assumptions: { ...DEFAULT_ASSUMPTIONS, ...(parsed.assumptions ?? {}) },
    };
  } catch {
    return null;
  }
}

export function saveLibrary(library: LabLibrary): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  } catch {
    // The library is a convenience. A full disk should not block the test.
  }
}

export function addChip(references: readonly Entity[], chip: LabChip): Entity[] {
  const current = uniqueById(references);
  if (current.length >= 8) return current;
  if (current.some((item) => item.id === chip.id || item.name.toLowerCase() === chip.name.toLowerCase())) return current;
  return [
    ...current,
    {
      id: chip.id,
      name: chip.name,
      type: chip.type || 'urn:entity',
      source: 'user',
      ...(chip.image ? { image: chip.image } : {}),
    },
  ];
}

export function rememberVersion(idea: LabIdea, version: number, score: number | null): LabIdea {
  const versions = idea.versions.filter((item) => item.n !== version);
  versions.push({ n: version, score });
  versions.sort((a, b) => a.n - b.n);
  return { ...idea, versions };
}

export function duplicateIdea(idea: LabIdea, id: string): LabIdea {
  const letter = idea.variant === 'A' ? 'B' : String.fromCharCode(Math.min(idea.variant.charCodeAt(0) + 1, 90));
  return {
    id,
    title: idea.title,
    city: idea.city,
    variant: letter,
    parentId: idea.parentId ?? idea.id,
    draft: {
      ...idea.draft,
      references: idea.draft.references.map((entity) => ({ ...entity })),
      locations: idea.draft.locations.map((entity) => ({ ...entity })),
      interests: idea.draft.interests.map((tag) => ({ ...tag })),
    },
    controls: { ...idea.controls, muted: [...idea.controls.muted] },
    versions: [],
  };
}

export function previewGap(a: number | null, b: number | null): string {
  if (a == null || b == null) return 'Score both variants to compare.';
  const delta = b - a;
  const sign = delta > 0 ? `+${delta}` : String(delta);
  return `Variant B is ${sign} versus A on the engine preview. Not a sales forecast.`;
}

export function ideaTitle(idea: string): string {
  const trimmed = idea.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 42) return trimmed || 'Untitled idea';
  return `${trimmed.slice(0, 40).trim()}…`;
}

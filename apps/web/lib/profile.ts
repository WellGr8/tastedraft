import { BriefV2Schema, type BriefV2, type Entity, type Tag } from '@tastedraft/contracts';
import { CITIES, type DraftState } from '@/lib/defaults';

export const EXTRA_CITIES = ['Bangkok', 'Tokyo', 'Berlin', 'London', 'Paris', 'Seoul'] as const;
export const PROFILE_CITIES = [...CITIES, ...EXTRA_CITIES];

export const MOODS: Tag[] = [
  { id: 'tag-japanese', name: 'Japanese', type: 'urn:tag' },
  { id: 'tag-minimal', name: 'Minimal', type: 'urn:tag' },
  { id: 'tag-streetwear', name: 'Streetwear', type: 'urn:tag' },
  { id: 'tag-electronic', name: 'Electronic', type: 'urn:tag' },
  { id: 'tag-underground', name: 'Underground', type: 'urn:tag' },
  { id: 'tag-night', name: 'Night', type: 'urn:tag' },
  { id: 'tag-warm', name: 'Warm', type: 'urn:tag' },
];

const SIMILAR: Record<string, string[]> = {
  'comme des garcons': ['Issey Miyake', 'Sacai'],
  muji: ['Uniqlo'],
  'aphex twin': ['Boards of Canada'],
  'lost in translation': ['Studio Ghibli'],
  'silver lake': ['Echo Park'],
  newjeans: ['Blackpink', 'BTS'],
  blackpink: ['NewJeans'],
  bts: ['NewJeans'],
  uniqlo: ['Muji'],
  'studio ghibli': ['Lost in Translation'],
};

export type Scarcity = 'open' | 'limited' | 'preorder';
export type PriceLevel = 1 | 2 | 3 | 4;

export interface ProfileControls {
  muted: string[];
  priceLevel: PriceLevel;
  scarcity: Scarcity;
}

export function defaultControls(): ProfileControls {
  return { muted: [], priceLevel: 3, scarcity: 'limited' };
}

export function positioningForPrice(price: PriceLevel): string {
  if (price === 1) return 'Mass';
  if (price === 2) return 'Independent';
  if (price === 4) return 'Luxury';
  return 'Premium';
}

export function postureForPrice(price: PriceLevel): string | null {
  if (price === 1) return 'Mass';
  if (price === 2) return 'accessible';
  if (price === 4) return 'Luxury';
  return null;
}

export function scarcityForEngine(value: Scarcity): string {
  if (value === 'open') return 'none';
  return value;
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function activeReferences(draft: DraftState, muted: readonly string[]): Entity[] {
  const off = new Set(muted);
  return draft.references.filter((entity) => !off.has(entity.id));
}

export function toProfileBrief(draft: DraftState, controls: ProfileControls): BriefV2 {
  const priceLevel = controls.priceLevel;
  const constraints: string[] = [];
  if (priceLevel >= 3) constraints.push('premium price');
  if (controls.scarcity === 'limited') constraints.push('limited runs');
  if (controls.scarcity === 'preorder') constraints.push('preorder drops');
  return BriefV2Schema.parse({
    idea: draft.idea.trim(),
    interests: draft.interests,
    references: activeReferences(draft, controls.muted),
    locations: draft.locations,
    city: draft.city,
    age: draft.age,
    priceLevel,
    positioning: positioningForPrice(priceLevel),
    constraints,
  });
}

export function similarNames(draft: DraftState): string[] {
  const have = new Set(draft.references.map((entity) => fold(entity.name)));
  const names: string[] = [];
  for (const entity of draft.references) {
    for (const name of SIMILAR[fold(entity.name)] ?? []) {
      if (have.has(fold(name)) || names.some((item) => fold(item) === fold(name))) continue;
      names.push(name);
    }
  }
  return names.slice(0, 8);
}

export function liveDetail(id: string, draft: DraftState, controls: ProfileControls): string {
  const active = activeReferences(draft, controls.muted);
  if (id === 'anchor') {
    return active[0] ? `${active[0].name} leads the playlist.` : 'No active reference.';
  }
  if (id === 'cross') return 'Fit across the active references.';
  if (id === 'local') return `${draft.city} is the city on this profile.`;
  if (id === 'audience') return `Audience band ${draft.age}.`;
  if (id === 'friction') return `Price level ${controls.priceLevel}, ${controls.scarcity} scarcity.`;
  return '';
}

export const ROW_LABEL: Record<string, string> = {
  anchor: 'Anchor affinity',
  cross: 'Cross-domain fit',
  local: 'Local fit',
  audience: 'Audience fit',
  friction: 'Cultural friction',
};

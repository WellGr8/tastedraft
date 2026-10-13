/**
 * What kind of launch a sentence is, and which Qloo entity types belong to it.
 * `videogame` is the entity type. `video_game` is not.
 */

export const QLOO_ENTITY_TYPES = [
  'artist',
  'movie',
  'tv_show',
  'book',
  'videogame',
  'podcast',
  'place',
  'brand',
  'destination',
  'person',
] as const;

export type QlooEntityType = (typeof QLOO_ENTITY_TYPES)[number];

export type LaunchKind =
  | 'game'
  | 'screen'
  | 'movie'
  | 'book'
  | 'podcast'
  | 'cafe'
  | 'dining'
  | 'travel'
  | 'fashion'
  | 'music'
  | 'person'
  | 'event'
  | 'general';

export interface LaunchProfile {
  kind: LaunchKind;
  label: string;
  types: QlooEntityType[];
}

export interface LaunchCost {
  focusGroupUsd: number;
  groups: number;
  pilotDayUsd: number;
  pilotDays: number;
}

const PROFILES: ReadonlyArray<{ kind: LaunchKind; label: string; re: RegExp; types: QlooEntityType[] }> = [
  { kind: 'game', label: 'Video game', re: /video\s*games?|videogames?|\bgames?\b/i, types: ['videogame', 'brand', 'podcast'] },
  { kind: 'screen', label: 'TV series', re: /k-?drama|tv\s*show|tv\s*series|\bdrama\b/i, types: ['tv_show', 'brand', 'movie'] },
  { kind: 'movie', label: 'Film', re: /\bmovies?\b|\bfilms?\b|\bcinema\b/i, types: ['movie', 'brand', 'artist'] },
  { kind: 'book', label: 'Book', re: /\bbooks?\b|\bnovels?\b|\bauthor\b/i, types: ['book', 'movie', 'podcast'] },
  { kind: 'podcast', label: 'Podcast', re: /\bpodcasts?\b/i, types: ['podcast', 'artist', 'brand'] },
  { kind: 'cafe', label: 'Cafe', re: /\bcaf[eé]s?\b|\bcoffee\b|espresso/i, types: ['place', 'brand', 'artist'] },
  { kind: 'dining', label: 'Restaurant', re: /\brestaurants?\b|\bdining\b|\bbistros?\b|\bfood\b/i, types: ['place', 'brand', 'movie'] },
  { kind: 'travel', label: 'Travel', re: /\btravel\b|eco\s*tour|\btrips?\b|\bdestination\b/i, types: ['destination', 'place', 'brand'] },
  { kind: 'fashion', label: 'Fashion', re: /skincare|beauty|\bfashion\b|streetwear|apparel/i, types: ['brand', 'place', 'person'] },
  { kind: 'music', label: 'Music', re: /\bartists?\b|\bconcerts?\b|\bmerch\b|\balbums?\b|\btours?\b|listening\s*bar/i, types: ['artist', 'place', 'brand'] },
  { kind: 'person', label: 'Person', re: /\binfluencers?\b|\bcelebrities\b|\bfounders?\b/i, types: ['person', 'brand', 'podcast'] },
  { kind: 'event', label: 'Event', re: /\bfestivals?\b|product launch|launch event|\bconference\b/i, types: ['brand', 'place', 'artist'] },
];

const GENERAL: LaunchProfile = { kind: 'general', label: 'Launch', types: ['brand', 'place', 'artist', 'movie'] };

const COVERED = new Set<QlooEntityType>(['artist', 'brand', 'place', 'movie']);

const COSTS: Record<LaunchKind, LaunchCost> = {
  music: { focusGroupUsd: 2500, groups: 2, pilotDayUsd: 1800, pilotDays: 3 },
  cafe: { focusGroupUsd: 900, groups: 2, pilotDayUsd: 600, pilotDays: 3 },
  dining: { focusGroupUsd: 1100, groups: 2, pilotDayUsd: 700, pilotDays: 3 },
  game: { focusGroupUsd: 2800, groups: 2, pilotDayUsd: 1600, pilotDays: 4 },
  fashion: { focusGroupUsd: 1800, groups: 2, pilotDayUsd: 1200, pilotDays: 3 },
  travel: { focusGroupUsd: 1600, groups: 2, pilotDayUsd: 2200, pilotDays: 2 },
  screen: { focusGroupUsd: 2000, groups: 2, pilotDayUsd: 1400, pilotDays: 3 },
  movie: { focusGroupUsd: 2200, groups: 2, pilotDayUsd: 1500, pilotDays: 3 },
  book: { focusGroupUsd: 1200, groups: 2, pilotDayUsd: 800, pilotDays: 2 },
  podcast: { focusGroupUsd: 1000, groups: 2, pilotDayUsd: 700, pilotDays: 2 },
  person: { focusGroupUsd: 1500, groups: 2, pilotDayUsd: 900, pilotDays: 2 },
  event: { focusGroupUsd: 2000, groups: 2, pilotDayUsd: 1800, pilotDays: 2 },
  general: { focusGroupUsd: 2000, groups: 2, pilotDayUsd: 1200, pilotDays: 3 },
};

/** URN for a Qloo entity type. Videogame stays `urn:entity:videogame`. */
export function entityUrn(type: QlooEntityType): string {
  return `urn:entity:${type}`;
}

/** Specific cues win. A travel tour is travel. A merch tour is music. */
export function detectLaunch(idea: string): LaunchProfile {
  const text = idea.trim();
  const hit = PROFILES.find((profile) => profile.re.test(text));
  if (!hit) return GENERAL;
  return { kind: hit.kind, label: hit.label, types: hit.types };
}

/**
 * A type the five persona categories do not already request.
 * Artist, brand, place, and movie are already covered.
 */
export function extraTasteType(idea: string): QlooEntityType | null {
  return detectLaunch(idea).types.find((type) => !COVERED.has(type)) ?? null;
}

export function assumptionsFor(kind: LaunchKind): LaunchCost {
  return { ...COSTS[kind] };
}

export function comparisonLine(kind: LaunchKind): string {
  const name =
    kind === 'general' ? 'launch' : kind === 'screen' ? 'series' : kind === 'game' ? 'game' : kind;
  return `Compared with a ${name} focus group and a short pilot.`;
}

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Remove Qloo ids from a sentence a person will read. */
export function stripEntityIds(value: string): string {
  return value
    .replace(new RegExp(`\\s*\\(${UUID_SOURCE}\\)`, 'gi'), '')
    .replace(new RegExp(UUID_SOURCE, 'gi'), '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .trim();
}

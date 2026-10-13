import { BriefV2Schema, type BriefV2, type Entity, type Tag } from '@tastedraft/contracts';

export const AGES = ['18–25', '26–35', '36–45', '46+'] as const;
export const CITIES = [
  'Los Angeles',
  'New York',
  'San Francisco',
  'Austin',
  'Miami',
  'Chicago',
  'Seattle',
] as const;
export const POSITIONS = ['Independent', 'Premium', 'Mass', 'Luxury'] as const;

export const DEFAULT_IDEA =
  'Japanese minimalist streetwear with an underground electronic identity, sold at a premium price in limited runs';

export const TOUR_IDEA =
  'An indie artist launching a Tokyo tour + merch drop: positioning, merch price, which neighborhoods';

const IMG = {
  comme:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Comme_des_Garcons_logo.svg/500px-Comme_des_Garcons_logo.svg.png',
  muji: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/MUJI_logo.svg/500px-MUJI_logo.svg.png',
  aphex:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Aphex_Twin%2C_2008.jpg/500px-Aphex_Twin%2C_2008.jpg',
  lost: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/New_York_Bar_Unplugged%2C_Park_Hyatt_Tokyo_%288376387540%29.jpg/500px-New_York_Bar_Unplugged%2C_Park_Hyatt_Tokyo_%288376387540%29.jpg',
  silver:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Know_Your_City_No.101_Silver_Lake_Reservoir.jpg/500px-Know_Your_City_No.101_Silver_Lake_Reservoir.jpg',
};

export const STARTER_REFERENCES: Entity[] = [
  { id: 'comme-des-garcons', name: 'Comme des Garçons', type: 'urn:entity:brand', source: 'sample', image: IMG.comme },
  { id: 'muji', name: 'Muji', type: 'urn:entity:brand', source: 'sample', image: IMG.muji },
  { id: 'aphex-twin', name: 'Aphex Twin', type: 'urn:entity:artist', source: 'sample', image: IMG.aphex },
  { id: 'lost-in-translation', name: 'Lost in Translation', type: 'urn:entity:movie', source: 'sample', image: IMG.lost },
  {
    id: 'silver-lake',
    name: 'Silver Lake',
    type: 'urn:entity:place',
    source: 'sample',
    image: IMG.silver,
    city: 'Los Angeles',
    geo: { lat: 34.0869, lng: -118.2702 },
  },
];

export const TOUR_REFERENCES: Entity[] = [
  { id: 'aphex-twin', name: 'Aphex Twin', type: 'urn:entity:artist', source: 'sample', image: IMG.aphex },
  { id: 'boards-of-canada', name: 'Boards of Canada', type: 'urn:entity:artist', source: 'sample' },
  {
    id: 'shimokitazawa',
    name: 'Shimokitazawa',
    type: 'urn:entity:place',
    source: 'sample',
    city: 'Tokyo',
    geo: { lat: 35.6614, lng: 139.6676 },
  },
  { id: 'lost-in-translation', name: 'Lost in Translation', type: 'urn:entity:movie', source: 'sample', image: IMG.lost },
  { id: 'muji', name: 'Muji', type: 'urn:entity:brand', source: 'sample', image: IMG.muji },
];

export const TOUR_TAGS: Tag[] = [
  { id: 'tag-electronic', name: 'Electronic', type: 'urn:tag' },
  { id: 'tag-live', name: 'Live music', type: 'urn:tag' },
];

export const STARTER_TAGS: Tag[] = [
  { id: 'tag-japanese', name: 'Japanese', type: 'urn:tag' },
  { id: 'tag-minimal', name: 'Minimal', type: 'urn:tag' },
  { id: 'tag-streetwear', name: 'Streetwear', type: 'urn:tag' },
  { id: 'tag-electronic', name: 'Electronic', type: 'urn:tag' },
];

const LOCAL_TAGS: Tag[] = [
  ...STARTER_TAGS,
  { id: 'td-local-minimalist', name: 'minimalist', type: 'urn:tag:style' },
  { id: 'td-local-underground', name: 'underground', type: 'urn:tag:style' },
  { id: 'td-local-japanese-fashion', name: 'japanese fashion', type: 'urn:tag:genre:fashion' },
];

const CITY_PLACES: Record<string, string[]> = {
  'Los Angeles': ['Silver Lake', 'Echo Park', 'Beverly Hills', 'West Hollywood'],
  'New York': ['Lower East Side', 'Williamsburg', 'Upper East Side', 'Tribeca'],
  'San Francisco': ['Mission', 'Hayes Valley', 'Pacific Heights', 'Union Square'],
  Austin: ['East Austin', 'South Congress', 'Westlake', 'The Domain'],
  Miami: ['Wynwood', 'Little Haiti', 'South Beach', 'Brickell'],
  Chicago: ['Logan Square', 'Wicker Park', 'Gold Coast', 'River North'],
  Seattle: ['Capitol Hill', 'Fremont', 'Medina', 'Bellevue'],
};

export interface DraftState {
  idea: string;
  age: string;
  city: string;
  positioning: string;
  references: Entity[];
  locations: Entity[];
  interests: Tag[];
}

export function tourDraft(): DraftState {
  const place = TOUR_REFERENCES[2]!;
  return {
    idea: TOUR_IDEA,
    age: AGES[0],
    city: 'Tokyo',
    positioning: 'Premium',
    references: TOUR_REFERENCES.map((entity) => ({ ...entity })),
    locations: [{ ...place }],
    interests: TOUR_TAGS.map((tag) => ({ ...tag })),
  };
}

export function defaultDraft(): DraftState {
  const silver = STARTER_REFERENCES[4]!;
  return {
    idea: DEFAULT_IDEA,
    age: AGES[0],
    city: 'Los Angeles',
    positioning: 'Premium',
    references: STARTER_REFERENCES.map((entity) => ({ ...entity })),
    locations: [{ ...silver }],
    interests: STARTER_TAGS.map((tag) => ({ ...tag })),
  };
}

export function priceLevelFor(positioning: string): 1 | 2 | 3 | 4 {
  if (positioning === 'Luxury') return 4;
  if (positioning === 'Premium') return 3;
  if (positioning === 'Independent') return 2;
  return 1;
}

export function toBrief(draft: DraftState): BriefV2 {
  const priceLevel = priceLevelFor(draft.positioning);
  const constraints: string[] = [];
  if (priceLevel >= 3) constraints.push('premium price');
  if (/limited/i.test(draft.idea)) constraints.push('limited runs');
  return BriefV2Schema.parse({
    idea: draft.idea.trim(),
    interests: draft.interests,
    references: draft.references,
    locations: draft.locations,
    city: draft.city,
    age: draft.age,
    priceLevel,
    positioning: draft.positioning,
    constraints,
  });
}

function norm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slug(value: string): string {
  return norm(value).replace(/\s+/g, '-');
}

export function knownImage(name: string): string | undefined {
  const key = norm(name);
  if (key.includes('comme')) return IMG.comme;
  if (key.includes('muji')) return IMG.muji;
  if (key.includes('aphex')) return IMG.aphex;
  if (key.includes('lost') || key.includes('translation')) return IMG.lost;
  if (key.includes('silver lake')) return IMG.silver;
  return undefined;
}

export function withImage(entity: Entity): Entity {
  if (entity.image) return entity;
  const image = knownImage(entity.name);
  return image ? { ...entity, image } : entity;
}

export function suggestEntities(query: string, kind: 'reference' | 'location', city: string): Entity[] {
  const q = norm(query);
  if (!q) return [];
  const places = (CITY_PLACES[city] ?? CITY_PLACES['Los Angeles'] ?? []).map((name) => {
    const known = STARTER_REFERENCES.find((entity) => norm(entity.name) === norm(name));
    return (
      known ?? {
        id: `place-${slug(city)}-${slug(name)}`,
        name,
        type: 'urn:entity:place',
        source: 'sample',
        city,
      }
    );
  });
  const pool = kind === 'location' ? places : [...STARTER_REFERENCES, ...places];
  return pool
    .filter((entity) => norm(entity.name).includes(q) || q.includes(norm(entity.name)))
    .map((entity) => withImage({ ...entity }))
    .slice(0, 8);
}

export function suggestTags(query: string): Tag[] {
  const q = norm(query);
  if (!q) return [];
  return LOCAL_TAGS.filter((tag) => norm(tag.name).includes(q)).slice(0, 8);
}

export function mergeEntities(remote: Entity[], local: Entity[]): Entity[] {
  const seen = new Set<string>();
  const out: Entity[] = [];
  for (const entity of [...remote, ...local]) {
    const key = norm(entity.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(withImage(entity));
  }
  return out.slice(0, 8);
}

export function mergeTags(remote: Tag[], local: Tag[]): Tag[] {
  const seen = new Set<string>();
  const out: Tag[] = [];
  for (const tag of [...remote, ...local]) {
    const key = norm(tag.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.slice(0, 8);
}

import type { Brief, Districts } from './types.ts';

export const DEFAULT_IDEA =
  'Japanese minimalist streetwear with an underground electronic identity, sold at a premium price in limited runs';

/** Age bands use an en dash (U+2013), matching the prototype. */
export const AGES = ['18–25', '26–35', '36–45', '46+'] as const;
export type AgeBand = (typeof AGES)[number];

export const POS = ['Independent', 'Premium', 'Mass', 'Luxury'] as const;
export type Positioning = (typeof POS)[number];

export const CITY_NAMES = [
  'Los Angeles',
  'New York',
  'San Francisco',
  'Austin',
  'Miami',
  'Chicago',
  'Seattle',
] as const;
export type CityName = (typeof CITY_NAMES)[number];

export const DEFAULT_REFS = [
  'Comme des Garçons',
  'Muji',
  'Aphex Twin',
  'Lost in Translation',
  'Silver Lake',
] as const;

/** Illustrative districts: minimal/independent, then luxury. */
export const CITY_DISTRICTS: Record<CityName, Districts> = {
  'Los Angeles': { min: ['Silver Lake', 'Echo Park'], lux: ['Beverly Hills', 'West Hollywood'] },
  'New York': { min: ['Lower East Side', 'Williamsburg'], lux: ['Upper East Side', 'Tribeca'] },
  'San Francisco': { min: ['Mission', 'Hayes Valley'], lux: ['Pacific Heights', 'Union Square'] },
  Austin: { min: ['East Austin', 'South Congress'], lux: ['Westlake', 'The Domain'] },
  Miami: { min: ['Wynwood', 'Little Haiti'], lux: ['South Beach', 'Brickell'] },
  Chicago: { min: ['Logan Square', 'Wicker Park'], lux: ['Gold Coast', 'River North'] },
  Seattle: { min: ['Capitol Hill', 'Fremont'], lux: ['Medina', 'Bellevue'] },
};

export const DEFAULT_BRIEF: Brief = {
  idea: DEFAULT_IDEA,
  age: AGES[0],
  city: 'Los Angeles',
  pos: 'Premium',
  refs: [...DEFAULT_REFS],
  muted: [],
};

export function districtsFor(city: string): Districts {
  if (isCityName(city)) return CITY_DISTRICTS[city];
  return CITY_DISTRICTS['Los Angeles'];
}

export function isCityName(city: string): city is CityName {
  return (CITY_NAMES as readonly string[]).includes(city);
}

export function isAgeBand(age: string): age is AgeBand {
  return (AGES as readonly string[]).includes(age);
}

export function isPositioning(pos: string): pos is Positioning {
  return (POS as readonly string[]).includes(pos);
}

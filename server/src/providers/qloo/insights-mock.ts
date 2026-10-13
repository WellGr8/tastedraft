import type { BriefV2 } from '@tastedraft/contracts';
import type { QlooInsightsParams } from './client.ts';

/**
 * Authored insights bodies for three non-streetwear briefs.
 * These are TasteDraft stand-ins for mock mode. They are not Qloo responses.
 */

export type InsightRole = 'anchor' | 'cross' | 'local' | 'audience';

interface CatalogEntity {
  id: string;
  name: string;
  subtype: string;
  affinity: Partial<Record<InsightRole, number>>;
}

interface Scenario {
  city: string;
  explain: ReadonlyArray<{ input: string; weight: number }>;
  entities: readonly CatalogEntity[];
}

const place = 'urn:entity:place';
const brand = 'urn:entity:brand';
const artist = 'urn:entity:artist';

const BANGKOK: Scenario = {
  city: 'Bangkok',
  explain: [
    { input: 'td-mock-tag-night-market', weight: 0.62 },
    { input: 'td-mock-entity-maa-kai-yang', weight: 0.38 },
  ],
  entities: [
    { id: 'td-mock-entity-yaowarat-grill', name: 'Yaowarat Grill', subtype: place, affinity: { anchor: 0.84, cross: 0.9, local: 0.91, audience: 0.7 } },
    { id: 'td-mock-entity-talad-neon', name: 'Talad Neon', subtype: place, affinity: { cross: 0.9 } },
    { id: 'td-mock-entity-maa-kai-yang', name: 'Maa Kai Yang', subtype: brand, affinity: { anchor: 0.78, cross: 0.6, audience: 0.7 } },
    { id: 'td-mock-entity-boat-noodle-lamp', name: 'Boat Noodle Lamp', subtype: brand, affinity: { cross: 0.6 } },
  ],
};

const TOKYO: Scenario = {
  city: 'Tokyo',
  explain: [
    { input: 'td-mock-tag-indie-venue', weight: 0.58 },
    { input: 'td-mock-entity-koenji-echo', weight: 0.42 },
  ],
  entities: [
    { id: 'td-mock-entity-paper-coast', name: 'Paper Coast', subtype: artist, affinity: { anchor: 0.88, cross: 0.92, audience: 0.84 } },
    { id: 'td-mock-entity-shimokitazawa-static', name: 'Shimokitazawa Static', subtype: artist, affinity: { cross: 0.86 } },
    { id: 'td-mock-entity-koenji-echo', name: 'Koenji Echo', subtype: place, affinity: { anchor: 0.64, cross: 0.58, local: 0.7, audience: 0.6 } },
  ],
};

const BERLIN: Scenario = {
  city: 'Berlin',
  explain: [
    { input: 'td-mock-tag-vegan-sneaker', weight: 0.51 },
    { input: 'td-mock-entity-kreuzberg-yard', weight: 0.49 },
  ],
  entities: [
    { id: 'td-mock-entity-hof-sneaker', name: 'Hof Sneaker', subtype: brand, affinity: { anchor: 0.66, cross: 0.62, audience: 0.4 } },
    { id: 'td-mock-entity-spree-canvas', name: 'Spree Canvas', subtype: brand, affinity: { cross: 0.58 } },
    { id: 'td-mock-entity-kreuzberg-yard', name: 'Kreuzberg Yard', subtype: place, affinity: { anchor: 0.58, cross: 0.5, local: 0.44, audience: 0.36 } },
  ],
};

const SCENARIOS = [BANGKOK, TOKYO, BERLIN];

function entity(id: string, name: string, type: string, city?: string): BriefV2['references'][number] {
  return {
    id,
    name,
    type,
    city,
    source: 'mock',
    image: `https://example.invalid/tastedraft-mock/${id}.png`,
  };
}

export const BANGKOK_SNACK_BRIEF: BriefV2 = {
  idea: 'A late-night snack stall on a Bangkok night market row, grilled and eaten standing up',
  interests: [
    { id: 'td-mock-tag-night-market', name: 'night market snack', type: 'urn:tag:td-mock' },
    { id: 'td-mock-tag-street-grill', name: 'charcoal street grill', type: 'urn:tag:td-mock' },
  ],
  references: [
    entity('td-mock-entity-yaowarat-grill', 'Yaowarat Grill', place, 'Bangkok'),
    entity('td-mock-entity-maa-kai-yang', 'Maa Kai Yang', brand, 'Bangkok'),
  ],
  locations: [entity('td-mock-entity-yaowarat-grill', 'Yaowarat Grill', place, 'Bangkok')],
  city: 'Bangkok',
  age: '18–25',
  positioning: 'Mass',
  constraints: ['Serve after dusk'],
};

export const TOKYO_VENUE_BRIEF: BriefV2 = {
  idea: 'A small Tokyo venue for indie bands, with a listening bar in the back',
  interests: [{ id: 'td-mock-tag-indie-venue', name: 'indie live venue', type: 'urn:tag:td-mock' }],
  references: [
    entity('td-mock-entity-paper-coast', 'Paper Coast', artist, 'Tokyo'),
    entity('td-mock-entity-koenji-echo', 'Koenji Echo', place, 'Tokyo'),
  ],
  locations: [entity('td-mock-entity-koenji-echo', 'Koenji Echo', place, 'Tokyo')],
  city: 'Tokyo',
  age: '26–35',
  gender: 'female',
  positioning: 'Independent',
  constraints: ['Capacity under 80'],
};

export const BERLIN_SNEAKER_BRIEF: BriefV2 = {
  idea: 'A Berlin vegan sneaker made in small runs and sold from a courtyard shop',
  interests: [{ id: 'td-mock-tag-vegan-sneaker', name: 'vegan sneaker', type: 'urn:tag:td-mock' }],
  references: [
    entity('td-mock-entity-hof-sneaker', 'Hof Sneaker', brand, 'Berlin'),
    entity('td-mock-entity-kreuzberg-yard', 'Kreuzberg Yard', place, 'Berlin'),
  ],
  locations: [entity('td-mock-entity-kreuzberg-yard', 'Kreuzberg Yard', place, 'Berlin')],
  city: 'Berlin',
  age: '18–25',
  priceLevel: 2,
  positioning: 'Independent',
  constraints: ['No animal materials'],
};

function cityOf(params: QlooInsightsParams): string {
  const signalLocation = params.signal?.location;
  if (signalLocation && typeof signalLocation === 'object' && 'query' in signalLocation && typeof signalLocation.query === 'string') {
    return signalLocation.query;
  }
  const filterLocation = params.filter?.location;
  if (filterLocation && typeof filterLocation === 'object' && 'query' in filterLocation && typeof filterLocation.query === 'string') {
    return filterLocation.query;
  }
  return '';
}

function requestedIds(params: QlooInsightsParams): string[] | null {
  const results = params.filter?.results;
  if (!results || typeof results !== 'object' || Array.isArray(results)) return null;
  const entities = results.entities;
  if (typeof entities !== 'string' || !entities.trim()) return null;
  return entities.split(',').map((id) => id.trim()).filter(Boolean);
}

/** Mock-mode body for a known city. Undefined for every other brief, so those calls keep the client body. */
export function authoredInsightBody(
  params: QlooInsightsParams,
  role: InsightRole,
): { success: true; mock: true; results: { entities: unknown[] } } | undefined {
  const scenario = SCENARIOS.find((item) => item.city.toLowerCase() === cityOf(params).trim().toLowerCase());
  if (!scenario) return undefined;
  const type = typeof params.filter?.type === 'string' ? params.filter.type : '';
  const wanted = requestedIds(params);
  const explain = params.feature?.explainability === true;
  const entities = scenario.entities.flatMap((item) => {
    const affinity = item.affinity[role];
    if (item.subtype !== type || affinity == null) return [];
    if (wanted && !wanted.includes(item.id)) return [];
    const contributions = explain
      ? scenario.explain.filter((input) => input.input !== item.id).map((input) => ({ ...input, target: item.id }))
      : [];
    return [{
      entity_id: item.id,
      name: item.name,
      type: 'urn:entity',
      subtype: item.subtype,
      properties: {
        description: 'Authored TasteDraft mock. Not a Qloo entity.',
        image: { url: `https://example.invalid/tastedraft-mock/${item.id}.png` },
      },
      query: {
        affinity,
        ...(contributions.length ? { explainability: contributions } : {}),
      },
    }];
  });
  return { success: true, mock: true, results: { entities } };
}

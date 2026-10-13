/**
 * Brief ↔ engine bridge. Parameter diffs are applied here, then the
 * deterministic engine scores the result. Nothing in this file asks a model
 * for a number.
 */
import {
  BriefV2Schema,
  type BriefV2,
  type Entity,
  type QlooParamDiff,
  type Tag,
} from '@tastedraft/contracts';
import { scoreSampleBrief as scoreSampleWasm } from '@tastedraft/engine-wasm';
import {
  AGES,
  CITY_NAMES,
  DEFAULT_BRIEF,
  DEFAULT_IDEA,
  DEFAULT_REFS,
  districtsFor,
  isCityName,
  isPositioning,
  type CityName,
} from '../engine/constants.ts';
import { engineBackend } from '../engine/engine-mode.ts';
import { deriveSubs, ledgerPoints } from '../engine/score.ts';
import { hasLimitedLanguage, provideEvidence } from '../engine/sample-evidence.ts';
import type { Brief, EvidencePacket, LedgerPoints } from '../engine/types.ts';
import { QLOO_AGE_BUCKETS } from '../providers/qloo.ts';

export interface SampleEntity {
  id: string;
  name: string;
  type: string;
}

/** Entities the sample graph can score. Ids are what `signal.interests.entities` carries. */
export const SAMPLE_ENTITIES: readonly SampleEntity[] = [
  { id: 'comme-des-garcons', name: 'Comme des Garçons', type: 'urn:entity:brand' },
  { id: 'muji', name: 'Muji', type: 'urn:entity:brand' },
  { id: 'aphex-twin', name: 'Aphex Twin', type: 'urn:entity:artist' },
  { id: 'lost-in-translation', name: 'Lost in Translation', type: 'urn:entity:movie' },
  { id: 'silver-lake', name: 'Silver Lake', type: 'urn:entity:place' },
];

const INTERESTS: readonly Tag[] = [
  { id: 'tag-japanese', name: 'Japanese', type: 'urn:tag' },
  { id: 'tag-minimal', name: 'Minimal', type: 'urn:tag' },
  { id: 'tag-streetwear', name: 'Streetwear', type: 'urn:tag' },
  { id: 'tag-electronic', name: 'Electronic', type: 'urn:tag' },
];

export interface EngineScore {
  total: number;
  points: LedgerPoints;
  packet: EvidencePacket;
}

export function defaultBriefV2(): BriefV2 {
  const byName = new Map(SAMPLE_ENTITIES.map((entity) => [entity.name, entity]));
  const references: Entity[] = DEFAULT_REFS.map((name) => {
    const known = byName.get(name);
    return {
      id: known?.id ?? slug(name),
      name,
      type: known?.type ?? 'urn:entity',
      source: 'sample',
    };
  });
  return BriefV2Schema.parse({
    idea: DEFAULT_IDEA,
    interests: INTERESTS.map((tag) => ({ ...tag })),
    references,
    locations: [
      {
        id: 'silver-lake',
        name: 'Silver Lake',
        type: 'urn:entity:place',
        city: 'Los Angeles',
        source: 'sample',
      },
    ],
    city: DEFAULT_BRIEF.city,
    age: DEFAULT_BRIEF.age,
    priceLevel: priceLevelForPositioning(DEFAULT_BRIEF.pos),
    positioning: DEFAULT_BRIEF.pos,
    constraints: ['premium price', 'limited runs'],
  });
}

export function engineBriefFromV2(brief: BriefV2): Brief {
  return {
    idea: brief.idea,
    age: brief.age,
    city: brief.city,
    pos: brief.positioning,
    refs: brief.references.map((reference) => reference.name),
    muted: [],
  };
}

export function scoreEngine(brief: Brief): EngineScore {
  if (engineBackend() === 'wasm') {
    const scored = scoreSampleWasm(brief);
    return {
      total: scored.points.total,
      points: scored.points,
      packet: scored.packet as EvidencePacket,
    };
  }
  const packet = provideEvidence(brief);
  const points = ledgerPoints(deriveSubs(packet));
  return { total: points.total, points, packet };
}

export function priceLevelForPositioning(positioning: string): 1 | 2 | 3 | 4 {
  if (positioning === 'Luxury') return 4;
  if (positioning === 'Premium') return 3;
  if (positioning === 'Independent') return 2;
  return 1;
}

export function ageBucket(age: string): string {
  return QLOO_AGE_BUCKETS[age] ?? age;
}

export function bandForBucket(bucket: string): string | null {
  for (const band of AGES) {
    if (QLOO_AGE_BUCKETS[band] === bucket) return band;
  }
  return null;
}

export function nextAgeBand(age: string): string | null {
  const index = AGES.indexOf(age as (typeof AGES)[number]);
  if (index < 0 || index >= AGES.length - 1) return null;
  return AGES[index + 1] ?? null;
}

export function cityForLocationQuery(query: string): string {
  if (isCityName(query)) return query;
  for (const city of CITY_NAMES) {
    const districts = districtsFor(city);
    if (districts.min.includes(query) || districts.lux.includes(query)) return city;
  }
  return query;
}

export function indieDistrictsExcept(city: string): Array<{ query: string; city: CityName }> {
  const out: Array<{ query: string; city: CityName }> = [];
  for (const name of CITY_NAMES) {
    if (name === city) continue;
    const query = districtsFor(name).min[0];
    if (query) out.push({ query, city: name });
  }
  return out;
}

export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function entityName(brief: BriefV2, id: string): string {
  return (
    brief.references.find((reference) => reference.id === id)?.name ??
    SAMPLE_ENTITIES.find((entity) => entity.id === id)?.name ??
    id
  );
}

export function entityId(brief: BriefV2, name: string): string {
  return brief.references.find((reference) => reference.name === name)?.id ?? slug(name);
}

function postureForPrice(value: string | null): string | undefined {
  if (value === '1') return 'Mass';
  if (value === '2') return 'accessible';
  if (value === '4') return 'Luxury';
  return undefined;
}

function positioningForTag(tag: string): string {
  const titled = tag.slice(0, 1).toUpperCase() + tag.slice(1).toLowerCase();
  return isPositioning(titled) ? titled : tag;
}

function priceLiteral(value: string | null): 1 | 2 | 3 | 4 | undefined {
  if (value === '1' || value === '2' || value === '3' || value === '4') return Number(value) as 1 | 2 | 3 | 4;
  return undefined;
}

/** Re-run input. Price is applied after positioning so a price diff keeps its posture. */
export function applyDiffsToEngine(brief: BriefV2, changes: readonly QlooParamDiff[]): Brief {
  const next = engineBriefFromV2(brief);
  let posture: string | undefined;
  let positioning = false;
  for (const change of changes) {
    if (change.param === 'filter.price_level.max' || change.param === 'filter.price_level.min') {
      posture = postureForPrice(change.to);
    } else if (change.param === 'signal.demographics.age' && change.to) {
      const band = bandForBucket(change.to);
      if (band) next.age = band;
    } else if (change.param === 'filter.location.query' && change.to) {
      next.city = cityForLocationQuery(change.to);
    } else if (change.param === 'signal.interests.tags' && change.to) {
      next.pos = positioningForTag(change.to);
      positioning = true;
    } else if (change.param === 'filter.tags' && change.to === 'preorder-drop') {
      next.scarcity = 'preorder';
    } else if (change.param === 'filter.tags' && change.to === 'limited-run') {
      next.scarcity = 'limited';
    } else if (change.param === 'signal.interests.entities' && change.to != null) {
      next.refs = change.to
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => entityName(brief, id));
    }
  }
  if (posture) next.posture = posture;
  else if (positioning) next.posture = undefined;
  return next;
}

export function applyDiffsToBrief(brief: BriefV2, changes: readonly QlooParamDiff[]): BriefV2 {
  const next: BriefV2 = {
    ...brief,
    interests: brief.interests.map((tag) => ({ ...tag })),
    references: brief.references.map((reference) => ({ ...reference })),
    locations: brief.locations.map((location) => ({ ...location })),
    constraints: [...brief.constraints],
  };
  for (const change of changes) {
    if (change.param === 'filter.price_level.max' || change.param === 'filter.price_level.min') {
      const level = priceLiteral(change.to);
      if (level) next.priceLevel = level;
    } else if (change.param === 'signal.demographics.age' && change.to) {
      const band = bandForBucket(change.to);
      if (band) next.age = band;
    } else if (change.param === 'signal.demographics.gender') {
      if (change.to) next.gender = change.to;
      else delete next.gender;
    } else if (change.param === 'filter.location.query' && change.to) {
      const city = cityForLocationQuery(change.to);
      next.city = city;
      if (change.to !== city) {
        next.locations = [
          { id: slug(change.to), name: change.to, type: 'urn:entity:place', city, source: 'agent' },
        ];
      }
    } else if (change.param === 'signal.interests.tags' && change.to) {
      next.positioning = positioningForTag(change.to);
    } else if (change.param === 'filter.tags' && change.to === 'preorder-drop') {
      next.constraints = next.constraints.filter((item) => !/limited|exclusive|scarce/i.test(item));
      next.constraints.push('independent pre-order drops');
    } else if (change.param === 'signal.interests.entities' && change.to != null) {
      const ids = change.to
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      next.references = ids.map((id) => {
        const own = brief.references.find((reference) => reference.id === id);
        if (own) return { ...own };
        const known = SAMPLE_ENTITIES.find((entity) => entity.id === id);
        if (known) return { id: known.id, name: known.name, type: known.type, source: 'sample' };
        return { id, name: id, type: 'urn:entity', source: 'agent' };
      });
    }
  }
  return BriefV2Schema.parse(next);
}

export function channelLabel(brief: BriefV2): string {
  const named = brief.constraints.find((item) => /pre-?order|limited|exclusive|scarce/i.test(item));
  if (named) return named;
  if (hasLimitedLanguage(brief.idea)) return 'limited runs';
  return 'open';
}

export function referenceList(brief: BriefV2): string {
  return brief.references.map((reference) => reference.name).join(', ');
}

export function provenanceDetail(input: string, weight: string): string {
  return `from Qloo explainability: input ${input} contributed ${weight}`;
}

export function weightLabel(score0to100: number): string {
  return (Math.round(score0to100) / 100).toFixed(2);
}

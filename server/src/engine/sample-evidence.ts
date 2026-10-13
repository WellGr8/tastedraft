import { AGES } from './constants.ts';
import { avg } from './score.ts';
import type { EvidencePacket, EvidenceRef } from './types.ts';

/**
 * Sample cultural evidence, ported from split/evidence.js.
 * `provideEvidence(brief)` is the calibration path that still scores
 * the default brief at 71 and the applied proposal at 82.
 * Affinities are 0–100. They are sample data, not a live taste graph.
 *
 * TODO(providers): the live server calls EvidenceProvider.getEvidence(brief).
 * Keep this function as the deterministic fixture. A Qloo provider should
 * return the same packet shape with sourceId: 'qloo'.
 */

/** Swap to `'qloo'` only when this sample function is no longer the provider. */
const EVIDENCE_PROVIDER_ID: string = 'sample';
const PLACE_BONUS = 4;

interface RefRecord {
  type: string;
  fit: string;
  provenance: string;
  generic: number;
  facets: { japanese: number; minimal: number; streetwear: number; electronic: number };
  city?: string;
}

const REF_EVIDENCE: Record<string, RefRecord> = {
  'Comme des Garçons': {
    type: 'Brand',
    fit: 'logo',
    provenance: 'sample',
    generic: 46,
    facets: { japanese: 100, minimal: 96, streetwear: 90, electronic: 66 },
  },
  Muji: {
    type: 'Brand',
    fit: 'logo',
    provenance: 'sample',
    generic: 46,
    facets: { japanese: 70, minimal: 80, streetwear: 38, electronic: 20 },
  },
  'Aphex Twin': {
    type: 'Artist',
    fit: 'circle',
    provenance: 'sample',
    generic: 46,
    facets: { japanese: 40, minimal: 70, streetwear: 78, electronic: 100 },
  },
  'Lost in Translation': {
    type: 'Film',
    fit: 'photo',
    provenance: 'sample',
    generic: 46,
    facets: { japanese: 90, minimal: 60, streetwear: 36, electronic: 30 },
  },
  'Silver Lake': {
    type: 'Place',
    fit: 'photo',
    provenance: 'sample',
    generic: 46,
    city: 'Los Angeles',
    facets: { japanese: 44, minimal: 68, streetwear: 92, electronic: 84 },
  },
};

interface CityRow {
  localBase: number;
  premiumDrag: number;
  scarcityDrag: number;
  audienceMod: number;
  frictionMod: number;
}

const CITY_EVIDENCE: Record<string, CityRow> = {
  'Los Angeles': { localBase: 86, premiumDrag: 10, scarcityDrag: 6, audienceMod: 4, frictionMod: 0 },
  'New York': { localBase: 90, premiumDrag: 9, scarcityDrag: 6, audienceMod: 2, frictionMod: 2 },
  'San Francisco': { localBase: 81, premiumDrag: 7, scarcityDrag: 5, audienceMod: 0, frictionMod: 1 },
  Austin: { localBase: 83, premiumDrag: 4, scarcityDrag: 2, audienceMod: 3, frictionMod: -1 },
  Miami: { localBase: 64, premiumDrag: 14, scarcityDrag: 9, audienceMod: -8, frictionMod: 4 },
  Chicago: { localBase: 77, premiumDrag: 8, scarcityDrag: 5, audienceMod: -2, frictionMod: 1 },
  Seattle: { localBase: 85, premiumDrag: 5, scarcityDrag: 3, audienceMod: -2, frictionMod: 2 },
};

interface AgeRow {
  base: number;
  penalty: Record<string, number>;
}

function ageTable(): Record<string, AgeRow> {
  return {
    [AGES[0]]: { base: 84, penalty: { Independent: 2, Mass: 14, Premium: 20, Luxury: 36, accessible: 0 } },
    [AGES[1]]: { base: 80, penalty: { Independent: 4, Mass: 12, Premium: 10, Luxury: 22, accessible: 2 } },
    [AGES[2]]: { base: 68, penalty: { Independent: 6, Mass: 8, Premium: 4, Luxury: 10, accessible: 2 } },
    [AGES[3]]: { base: 50, penalty: { Independent: 10, Mass: 8, Premium: 6, Luxury: 4, accessible: 4 } },
  };
}

const AGE_EVIDENCE = ageTable();

function frictionTables(): { price: Record<string, Record<string, number>>; scarcity: Record<string, Record<string, number>> } {
  const price: Record<string, Record<string, number>> = {};
  const scarcity: Record<string, Record<string, number>> = {};
  price[AGES[0]] = { Independent: 3, Mass: 6, Premium: 8, Luxury: 18, accessible: 4 };
  price[AGES[1]] = { Independent: 3, Mass: 5, Premium: 6, Luxury: 12, accessible: 3 };
  price[AGES[2]] = { Independent: 4, Mass: 5, Premium: 4, Luxury: 7, accessible: 3 };
  price[AGES[3]] = { Independent: 7, Mass: 5, Premium: 4, Luxury: 4, accessible: 3 };
  scarcity[AGES[0]] = { limited: 4, preorder: 2, none: 0 };
  scarcity[AGES[1]] = { limited: 3, preorder: 1, none: 0 };
  scarcity[AGES[2]] = { limited: 2, preorder: 1, none: 0 };
  scarcity[AGES[3]] = { limited: 2, preorder: 1, none: 0 };
  return { price, scarcity };
}

const FRICTION_TABLES = frictionTables();

const CONCEPT_FACETS: Array<{ id: string; re: RegExp }> = [
  { id: 'japanese', re: /japan|japanese|ญี่ปุ่น/i },
  { id: 'minimal', re: /minimal|มินิมอล/i },
  { id: 'streetwear', re: /street\s?wear|สตรีท/i },
  { id: 'electronic', re: /electronic|underground|อิเล็กทรอนิก/i },
];

export function readFacets(idea: string | undefined): string[] {
  const out: string[] = [];
  const text = idea || '';
  for (let i = 0; i < CONCEPT_FACETS.length; i++) {
    if (CONCEPT_FACETS[i]!.re.test(text)) out.push(CONCEPT_FACETS[i]!.id);
  }
  return out;
}

export function hasPremiumLanguage(idea: string | undefined): boolean {
  return /premium|luxury|พรีเมียม|หรู|ราคาสูง/i.test(idea || '');
}

export function hasLimitedLanguage(idea: string | undefined): boolean {
  return /limited|exclusive|scarcity|ลิมิเต็ด|ขาดแคลน/i.test(idea || '');
}

function hashName(name: string | undefined): number {
  let h = 2166136261;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

function inferredRecord(name: string): RefRecord {
  const h = hashName(name);
  const band = (shift: number) => 40 + ((h >>> shift) % 22);
  return {
    type: 'Reference',
    fit: 'photo',
    provenance: 'inferred',
    generic: 44 + (h % 8),
    facets: { japanese: band(0), minimal: band(5), streetwear: band(10), electronic: band(15) },
  };
}

function recordFor(name: string): RefRecord {
  return REF_EVIDENCE[name] || inferredRecord(name);
}

/** 50/50 blend of the strongest matching facet and the mean. */
function conceptAffinity(rec: RefRecord, facets: string[]): number {
  if (!facets.length) return rec.generic;
  const vals: number[] = [];
  for (let i = 0; i < facets.length; i++) {
    const v = rec.facets[facets[i] as keyof RefRecord['facets']];
    vals.push(v == null ? 40 : v);
  }
  let strongest = vals[0]!;
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i]!;
    if (vals[i]! > strongest) strongest = vals[i]!;
  }
  return Math.round(strongest * 0.5 + (sum / vals.length) * 0.5);
}

function mustNumber(value: number | null): number {
  if (typeof value !== 'number') throw new Error('sample evidence left a measurement empty');
  return value;
}

function priceDrag(city: CityRow, posture: string): number {
  if (posture === 'Premium') return city.premiumDrag;
  if (posture === 'Luxury') return city.premiumDrag + 8;
  if (posture === 'Mass') return Math.round(city.premiumDrag * 0.4);
  return 0;
}

export interface EvidenceInput {
  idea?: string;
  age?: string;
  city?: string;
  pos?: string;
  refs?: string[];
  applied?: boolean;
  posture?: string;
  scarcity?: string;
}

export function provideEvidence(brief: EvidenceInput): EvidencePacket {
  const idea = brief.idea || '';
  const age = AGE_EVIDENCE[brief.age || ''] ? brief.age || AGES[0] : AGES[0];
  const cityName = CITY_EVIDENCE[brief.city || ''] ? brief.city || 'Los Angeles' : 'Los Angeles';
  const city = CITY_EVIDENCE[cityName]!;
  const pos = brief.pos || 'Premium';
  const facets = readFacets(idea);
  const names = brief.refs || [];
  const posture = brief.posture || (brief.applied ? 'accessible' : pos);
  const scarcity = brief.scarcity || (brief.applied ? 'preorder' : hasLimitedLanguage(idea) ? 'limited' : 'none');
  // Explicit accessible posture is the same price resolution as the applied proposal.
  const appliedLike = !!brief.applied || brief.posture === 'accessible';
  // The idea still promises a premium price while the positioning walks it back.
  const ideaConflict = !appliedLike && hasPremiumLanguage(idea) && (pos === 'Independent' || pos === 'Mass');

  const refs: EvidenceRef[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    const rec = recordFor(name);
    refs.push({
      name,
      type: rec.type,
      fit: rec.fit,
      provenance: rec.provenance,
      affinity: conceptAffinity(rec, facets),
      minimal: rec.facets.minimal,
      electronic: rec.facets.electronic,
      streetwear: rec.facets.streetwear,
      city: rec.city || '',
    });
  }

  const byType: Record<string, number[]> = {};
  const typeOrder: string[] = [];
  for (let i = 0; i < refs.length; i++) {
    const t = refs[i]!.type;
    if (!byType[t]) {
      byType[t] = [];
      typeOrder.push(t);
    }
    byType[t]!.push(mustNumber(refs[i]!.affinity));
  }
  const domains = typeOrder.map((t) => ({ type: t, affinity: avg(byType[t]!) }));

  let placeBonus = 0;
  for (let i = 0; i < refs.length; i++) {
    if (refs[i]!.city && refs[i]!.city === cityName) placeBonus = PLACE_BONUS;
  }
  let localPenalty = priceDrag(city, posture);
  if (scarcity === 'limited') localPenalty += city.scarcityDrag;
  if (ideaConflict) localPenalty += 4;

  const ageRow = AGE_EVIDENCE[age]!;
  let audiencePenalty = ageRow.penalty[posture] == null ? ageRow.penalty.Premium! : ageRow.penalty[posture]!;
  if (ideaConflict) audiencePenalty += 6;

  const priceF = FRICTION_TABLES.price[age]![posture] || 0;
  const scarceF = FRICTION_TABLES.scarcity[age]![scarcity] || 0;
  let friction = priceF + scarceF + city.frictionMod;
  if (ideaConflict) friction += 4;

  let fashion: number;
  if (byType.Brand) fashion = Math.round(avg(byType.Brand));
  else if (refs.length) fashion = Math.round(avg(refs.map((r) => mustNumber(r.streetwear))));
  else fashion = 48;

  let music: number;
  if (byType.Artist) music = Math.round(avg(byType.Artist));
  else if (refs.length) music = Math.round(avg(refs.map((r) => mustNumber(r.electronic))));
  else music = 42;

  const design = refs.length ? Math.round(avg(refs.map((r) => mustNumber(r.minimal)))) : 48;

  // An electronic concept with no artist reference is missing a music-domain specialist.
  let crossAdjust = 0;
  const wantsElectronic = facets.indexOf('electronic') >= 0;
  let hasElectronicArtist = false;
  for (let i = 0; i < refs.length; i++) {
    if (refs[i]!.type === 'Artist' && mustNumber(refs[i]!.electronic) >= 80) hasElectronicArtist = true;
  }
  if (wantsElectronic && refs.length && !hasElectronicArtist) crossAdjust -= 6;

  const inferredCount = refs.filter((r) => r.provenance === 'inferred').length;
  let sourceId = 'sample';
  if (EVIDENCE_PROVIDER_ID === 'qloo') sourceId = 'qloo';
  else if (refs.length && inferredCount === refs.length) sourceId = 'inferred';

  return {
    sourceId,
    mixed: inferredCount > 0 && inferredCount < refs.length,
    facets,
    refs,
    domains,
    local: { base: city.localBase + placeBonus, penalty: localPenalty },
    audience: { base: ageRow.base + city.audienceMod, penalty: audiencePenalty },
    friction,
    signal: { fashion, music, design },
    crossAdjust,
    posture,
    scarcity,
  };
}

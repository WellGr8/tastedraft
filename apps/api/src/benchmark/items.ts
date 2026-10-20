/**
 * The five launch examples plus the published Tokyo case studies.
 * Example reference names are the product's sample list. They are not
 * treated as Qloo hits unless a live search in this run resolves them.
 */
import type { PublicOutcome } from '../case-studies/cases.ts';

export interface BenchReference {
  id: string;
  name: string;
  type: string;
}

export interface LedgerReading {
  total: number;
  local: number | null;
  audience: number | null;
  verdict: 'encourage' | 'caution';
  matched: boolean;
}

export interface BenchItem {
  id: string;
  title: string;
  kind: 'example' | 'case-study';
  city: string;
  age: string;
  priceLevel: 1 | 2 | 3 | 4;
  positioning: string;
  idea: string;
  insightType: string;
  references: BenchReference[];
  /** Names a previous live Qloo search resolved. Empty for the examples. */
  verifiedNames: string[];
  outcome: PublicOutcome | null;
  ledger: LedgerReading | null;
  /** City-rank hit, even when the old absolute ledger total is absent. */
  rankMatched: boolean | null;
}

interface ExampleSeed {
  id: string;
  title: string;
  city: string;
  age: string;
  priceLevel: 1 | 2 | 3 | 4;
  idea: string;
  insightType: string;
  references: BenchReference[];
}

const EXAMPLES: readonly ExampleSeed[] = [
  {
    id: 'tokyo-tour',
    title: 'Tokyo tour + merch',
    city: 'Tokyo',
    age: '18–25',
    priceLevel: 3,
    idea: 'An indie artist launching a Tokyo tour + merch drop: positioning, merch price, which neighborhoods',
    insightType: 'urn:entity:artist',
    references: [
      { id: 'aphex-twin', name: 'Aphex Twin', type: 'urn:entity:artist' },
      { id: 'boards-of-canada', name: 'Boards of Canada', type: 'urn:entity:artist' },
      { id: 'shimokitazawa', name: 'Shimokitazawa', type: 'urn:entity:place' },
      { id: 'lost-in-translation', name: 'Lost in Translation', type: 'urn:entity:movie' },
      { id: 'muji', name: 'Muji', type: 'urn:entity:brand' },
    ],
  },
  {
    id: 'bangkok-coffee',
    title: 'Bangkok coffee shop',
    city: 'Bangkok',
    age: '26–35',
    priceLevel: 2,
    idea: 'A specialty coffee shop in Bangkok: pour-over, a small pastry case, and a neighborhood regulars bar',
    insightType: 'urn:entity:brand',
    references: [
      { id: 'blue-bottle', name: 'Blue Bottle', type: 'urn:entity:brand' },
      { id: 'arabica', name: '% Arabica', type: 'urn:entity:brand' },
      { id: 'thonglor', name: 'Thonglor', type: 'urn:entity:place' },
      { id: 'nils-frahm', name: 'Nils Frahm', type: 'urn:entity:artist' },
    ],
  },
  {
    id: 'seoul-game',
    title: 'Seoul indie game',
    city: 'Seoul',
    age: '18–25',
    priceLevel: 2,
    idea: 'An indie video game launch in Seoul: a narrative puzzle, a demo build, and a small merch table',
    insightType: 'urn:entity:videogame',
    references: [
      { id: 'celeste', name: 'Celeste', type: 'urn:entity:videogame' },
      { id: 'hades', name: 'Hades', type: 'urn:entity:videogame' },
      { id: 'hongdae', name: 'Hongdae', type: 'urn:entity:place' },
      { id: 'nintendo', name: 'Nintendo', type: 'urn:entity:brand' },
    ],
  },
  {
    id: 'nyc-skin',
    title: 'NYC skincare',
    city: 'New York',
    age: '26–35',
    priceLevel: 3,
    idea: 'A K-drama-inspired skincare brand launching in New York: a glass serum, a SoHo pop-up, and a limited first run',
    insightType: 'urn:entity:brand',
    references: [
      { id: 'laneige', name: 'Laneige', type: 'urn:entity:brand' },
      { id: 'crash-landing', name: 'Crash Landing on You', type: 'urn:entity:tv_show' },
      { id: 'soho', name: 'SoHo', type: 'urn:entity:place' },
      { id: 'sulwhasoo', name: 'Sulwhasoo', type: 'urn:entity:brand' },
    ],
  },
  {
    id: 'lisbon-travel',
    title: 'Lisbon eco tour',
    city: 'Lisbon',
    age: '36–45',
    priceLevel: 3,
    idea: 'An eco travel tour in Lisbon: small groups, tram neighborhoods, and a low-waste stay',
    insightType: 'urn:entity:destination',
    references: [
      { id: 'alfama', name: 'Alfama', type: 'urn:entity:destination' },
      { id: 'patagonia', name: 'Patagonia', type: 'urn:entity:brand' },
      { id: 'bairro-alto', name: 'Bairro Alto', type: 'urn:entity:place' },
      { id: 'rick-steves', name: 'Rick Steves', type: 'urn:entity:person' },
    ],
  },
];

const AGE_FROM_BUCKET: Record<string, string> = {
  '24_and_younger': '18–25',
  '25_to_29': '26–35',
  '30_to_34': '26–35',
  '35_to_44': '36–45',
  '36_to_55': '36–45',
  '45_to_54': '46+',
  '55_and_older': '46+',
};

export function positioningFor(priceLevel: 1 | 2 | 3 | 4): string {
  if (priceLevel === 4) return 'Luxury';
  if (priceLevel === 3) return 'Premium';
  if (priceLevel === 2) return 'Independent';
  return 'Mass';
}

export interface PublishedStudy {
  id?: unknown;
  title?: unknown;
  market?: unknown;
  outcome?: unknown;
  prelaunch?: unknown;
  subject?: { query?: unknown; resolvedName?: unknown; resolvedType?: unknown };
  inputs?: { ageBucket?: unknown; priceLevel?: unknown; city?: unknown };
  engine?: {
    total?: unknown;
    local?: unknown;
    audience?: unknown;
    verdict?: unknown;
  };
  matched?: unknown;
  realScore?: unknown;
  priceLevel?: unknown;
}

/**
 * Subjects a previous live search resolved, before city-rank-1.
 * The benchmark may cite these names. It does not reuse that pass's totals.
 */
const EARLIER_RESOLVE = new Set([
  'billie-eilish-tokyo-2022',
  'olivia-rodrigo-tokyo-2024',
  'harry-styles-tokyo-2017',
  'forever-21-tokyo-2009',
]);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function price(value: unknown): 1 | 2 | 3 | 4 {
  if (value === 1 || value === 2 || value === 3 || value === 4) return value;
  return 3;
}

export function exampleItems(): BenchItem[] {
  return EXAMPLES.map((row) => ({
    id: row.id,
    title: row.title,
    kind: 'example',
    city: row.city,
    age: row.age,
    priceLevel: row.priceLevel,
    positioning: positioningFor(row.priceLevel),
    idea: row.idea,
    insightType: row.insightType,
    references: row.references.map((reference) => ({ ...reference })),
    verifiedNames: [],
    outcome: null,
    ledger: null,
    rankMatched: null,
  }));
}

export function caseStudyItems(studies: readonly PublishedStudy[]): BenchItem[] {
  const items: BenchItem[] = [];
  for (const study of studies) {
    const id = text(study.id);
    const title = text(study.title);
    const outcome = study.outcome === 'sold_out' || study.outcome === 'left' || study.outcome === 'stayed' ? study.outcome : null;
    const verdict = study.engine?.verdict === 'encourage' || study.engine?.verdict === 'caution' ? study.engine.verdict : null;
    const total = typeof study.engine?.total === 'number' ? study.engine.total : null;
    const resolved = text(study.subject?.resolvedName);
    const resolvedType = text(study.subject?.resolvedType) || 'urn:entity';
    const query = text(study.subject?.query) || resolved;
    const rankMatched = study.matched === true ? true : study.matched === false ? false : null;
    const realScore = typeof study.realScore === 'number' ? study.realScore : null;
    const hasLedger = verdict != null && total != null && typeof study.matched === 'boolean';
    const cite = Boolean(resolved) || EARLIER_RESOLVE.has(id) || rankMatched != null;
    if (!id || !title || !query || (!hasLedger && !cite)) continue;
    const bucket = text(study.inputs?.ageBucket);
    const priceLevel = price(study.priceLevel ?? study.inputs?.priceLevel);
    const city = text(study.inputs?.city) || text(study.market) || 'Tokyo';
    const prelaunch = text(study.prelaunch);
    items.push({
      id,
      title,
      kind: 'case-study',
      city,
      age: AGE_FROM_BUCKET[bucket] ?? '18–25',
      priceLevel,
      positioning: positioningFor(priceLevel),
      idea: prelaunch ? `${title}. ${prelaunch}` : title,
      insightType: resolvedType.startsWith('urn:') ? resolvedType : `urn:entity:${resolvedType}`,
      references: [{ id: `subject-${id}`, name: query, type: resolvedType }],
      verifiedNames: [resolved || query],
      outcome,
      rankMatched,
      ledger: hasLedger && verdict
        ? {
            total: total as number,
            local: typeof study.engine?.local === 'number' ? study.engine.local : null,
            audience: typeof study.engine?.audience === 'number' ? study.engine.audience : null,
            verdict,
            matched: rankMatched ?? study.matched === true,
          }
        : realScore != null && rankMatched != null
          ? {
              total: realScore,
              local: null,
              audience: null,
              verdict: rankMatched ? 'encourage' : 'caution',
              matched: rankMatched,
            }
          : null,
    });
  }
  return items;
}

export function benchmarkItems(studies: readonly PublishedStudy[]): BenchItem[] {
  return [...exampleItems(), ...caseStudyItems(studies)];
}

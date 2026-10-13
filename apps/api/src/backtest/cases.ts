/**
 * Sourced city entries. The live backtest sends `city` to Qloo as written.
 * It does not substitute Los Angeles, and it does not score the sample graph.
 */

export interface CityBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface BacktestCase {
  brand: string;
  /** Name sent to Qloo `/search`. */
  query: string;
  /** Location string sent to Qloo. Not rewritten. */
  city: string;
  box: CityBox;
  outcome: 'stayed' | 'left';
  sources: string[];
  history: string;
}

export const BACKTEST_CASES: readonly BacktestCase[] = [
  {
    brand: 'Muji',
    query: 'Muji',
    city: 'New York',
    box: { minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.6 },
    outcome: 'stayed',
    sources: [
      'https://www.ryohin-keikaku.jp/news/2007_1025_01.html',
      'https://info.muji.us/2007/09/06/muji-will-open-its-first-us-store-in-november-2007/',
      'https://en.wikipedia.org/wiki/MUJI',
    ],
    history: 'SoHo opened 16 Nov 2007, the first US store, and the chain stayed.',
  },
  {
    brand: 'Blue Bottle',
    query: 'Blue Bottle Coffee',
    city: 'Tokyo',
    box: { minLat: 35.4, maxLat: 35.9, minLng: 139.3, maxLng: 140.0 },
    outcome: 'stayed',
    sources: [
      'https://sprudge.com/blue-bottle-tokyo-roastery-kiyosumi-shirakawa-opening-70221.html',
      'https://www.japantimes.co.jp/life/2015/02/03/food/blue-bottle-coffee-offers-fresher-brew/',
      'https://www.seattletimes.com/nation-world/calif-coffee-chain-blue-bottle-brews-long-lines-in-tokyo/',
    ],
    history: 'Kiyosumi-Shirakawa opened 6 Feb 2015, the first shop outside the US, and the brand stayed.',
  },
  {
    brand: 'Shake Shack',
    query: 'Shake Shack',
    city: 'Tokyo',
    box: { minLat: 35.4, maxLat: 35.9, minLng: 139.3, maxLng: 140.0 },
    outcome: 'stayed',
    sources: [
      'https://www.japantimes.co.jp/news/2015/11/13/business/corporate-business/first-shake-shack-in-asia-opens-to-long-lines-in-tokyo/',
      'https://investor.shakeshack.com/press-releases/press-release-details/2015/Hajimemashite-Tokyo-Shake-Shack-to-Open-First-Tokyo-Location-in-Meiji-Jingu-Gaien-This-Winter/default.aspx',
      'https://www.eater.com/2015/11/13/9728444/shake-shack-opens-first-location-japan',
    ],
    history: 'Meiji-Jingu Gaien opened 13 Nov 2015, the first Shake Shack in Asia, and the brand stayed.',
  },
  {
    brand: 'Chick-fil-A',
    query: 'Chick-fil-A',
    city: 'Reading, United Kingdom',
    box: { minLat: 51.35, maxLat: 51.55, minLng: -1.15, maxLng: -0.85 },
    outcome: 'left',
    sources: [
      'https://www.bbc.com/news/uk-england-berkshire-50094551',
      'https://www.washingtonpost.com/world/2019/10/19/days-after-opening-its-first-uk-restaurant-chick-fil-a-announces-location-will-close/',
    ],
    history: 'The Oracle pilot opened 10 Oct 2019. The landlord did not extend it (announced 18 Oct 2019). The shop closed 20 Mar 2020.',
  },
  {
    brand: 'Fresh & Easy',
    query: 'Fresh & Easy',
    city: 'Los Angeles',
    box: { minLat: 33.6, maxLat: 34.4, minLng: -118.8, maxLng: -117.9 },
    outcome: 'left',
    sources: [
      'https://www.bbc.com/news/business-22179255',
      'https://www.bbc.com/news/business-22168463',
      'https://www.reuters.com/article/business/tesco-quits-us-and-takes-35-billion-global-writedown-idUSBRE93G06O/',
    ],
    history: 'Tesco’s US banner opened on the West Coast in 2007, never turned a profit, and the exit was announced on 17 Apr 2013 at a cost of £1.2bn. Los Angeles is the city sent to Qloo.',
  },
];

export interface NamedEntity {
  id: string;
  name: string;
  type: string;
}

export interface ProbeResult {
  brand: string;
  query: string;
  city: string;
  outcome: 'stayed' | 'left';
  resolvedName: string | null;
  resolvedType: string | null;
  searchOk: boolean;
  placesOk: boolean;
  placeCount: number;
  /** Median Qloo affinity of the places returned for this city. Null when none were measured. */
  placeAffinity: number | null;
  heatmapOk: boolean;
  /** Sanitized failure text. Empty when the heatmap call succeeded. */
  heatmapError: string;
  cellCount: number;
  cellsInCity: number;
  /** Median weight of heatmap cells inside the city box. */
  heatAffinity: number | null;
  demographicsOk: boolean;
}

export function inCity(lat: number, lng: number, box: CityBox): boolean {
  return lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng;
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value * 100) / 100;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function typeOf(row: Record<string, unknown>): string {
  if (Array.isArray(row.types)) {
    const types = row.types.filter((item): item is string => typeof item === 'string');
    return types.find((item) => item.includes(':brand')) ?? types[0] ?? '';
  }
  return text(row.subtype) || text(row.type);
}

export function entitiesFrom(body: unknown): NamedEntity[] {
  const results = asRecord(body)?.results ?? body;
  const list = Array.isArray(results) ? results : Array.isArray(asRecord(results)?.entities) ? (asRecord(results)?.entities as unknown[]) : [];
  const rows: NamedEntity[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const id = text(row.entity_id) || text(row.id);
    const name = text(row.name);
    if (!id || !name) continue;
    rows.push({ id, name, type: typeOf(row) || 'urn:entity' });
  }
  return rows;
}

export function pickEntity(rows: readonly NamedEntity[], query: string): NamedEntity | null {
  const want = normalize(query);
  const brands = rows.filter((row) => row.type.includes('brand'));
  const pool = brands.length ? brands : rows;
  return (
    pool.find((row) => normalize(row.name) === want) ??
    pool.find((row) => normalize(row.name).includes(want) || want.includes(normalize(row.name))) ??
    pool[0] ??
    null
  );
}

export function affinitiesFrom(body: unknown): number[] {
  const results = asRecord(body)?.results;
  const list = Array.isArray(asRecord(results)?.entities) ? (asRecord(results)?.entities as unknown[]) : [];
  const values: number[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const query = asRecord(row.query);
    const raw = typeof query?.affinity === 'number' ? query.affinity : typeof row.affinity === 'number' ? row.affinity : null;
    if (raw == null || !Number.isFinite(raw)) continue;
    const unit = raw > 1 && raw <= 100 ? raw / 100 : raw;
    if (unit >= 0 && unit <= 1) values.push(unit);
  }
  return values;
}

export function heatPoints(body: unknown): Array<{ lat: number; lng: number; weight: number }> {
  const results = asRecord(body)?.results;
  const list = Array.isArray(asRecord(results)?.heatmap) ? (asRecord(results)?.heatmap as unknown[]) : [];
  const points: Array<{ lat: number; lng: number; weight: number }> = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const location = asRecord(row.location) ?? row;
    const lat = typeof location.lat === 'number' ? location.lat : typeof location.latitude === 'number' ? location.latitude : null;
    const lng = typeof location.lng === 'number' ? location.lng : typeof location.lon === 'number' ? location.lon : typeof location.longitude === 'number' ? location.longitude : null;
    if (lat == null || lng == null) continue;
    const query = asRecord(row.query);
    const raw = typeof query?.affinity === 'number' ? query.affinity : typeof row.affinity === 'number' ? row.affinity : typeof row.weight === 'number' ? row.weight : null;
    const unit = raw == null ? 0 : raw > 1 && raw <= 100 ? raw / 100 : raw;
    const weight = unit >= 0 && unit <= 1 ? unit : 0;
    points.push({ lat, lng, weight });
  }
  return points;
}

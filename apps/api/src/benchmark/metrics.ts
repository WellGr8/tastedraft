/**
 * Pure benchmark math.
 * A name is verified only when this run's Qloo catalog contains it.
 * A claimed name with no catalog hit is unverifiable.
 * It is hallucinated only when a Qloo search in this run came back without a match.
 */
import { normalizeName } from '../providers/qloo/search.ts';

export interface Spread {
  min: number;
  max: number;
  range: number;
  /** Population standard deviation. */
  stdev: number;
  n: number;
}

export interface ClassifiedReason {
  cited: string[];
  verified: string[];
  unverifiable: string[];
  hallucinated: string[];
}

const STOP = new Set(
  [
    'tokyo',
    'bangkok',
    'seoul',
    'new york',
    'nyc',
    'lisbon',
    'los angeles',
    'that reference',
    'qloo',
    'i',
    'me',
    'version',
  ].map((name) => normalizeName(name)),
);

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function spread(values: readonly number[]): Spread | null {
  const nums = values.filter((value) => Number.isFinite(value));
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const mean = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  const variance = nums.reduce((sum, value) => sum + (value - mean) ** 2, 0) / nums.length;
  return {
    min: round2(min),
    max: round2(max),
    range: round2(max - min),
    stdev: round2(Math.sqrt(variance)),
    n: nums.length,
  };
}

export function nameInText(name: string, text: string): boolean {
  const needle = normalizeName(name);
  const hay = normalizeName(text);
  if (needle.length < 3) return false;
  return ` ${hay} `.includes(` ${needle} `);
}

export function sameEntityName(left: string, right: string): boolean {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b || a.length < 3 || b.length < 3) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 4) return false;
  return longer.startsWith(`${shorter} `) || longer.endsWith(` ${shorter}`);
}

export function isStopName(name: string): boolean {
  return STOP.has(normalizeName(name));
}

/** Keep the first spelling. Later claims that normalize the same are dropped. */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = normalizeName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function classifyReason(input: {
  message: string;
  claims: readonly string[];
  verified: readonly string[];
  /** Normalized claim → search outcome. Missing means this run did not search. */
  searched?: ReadonlyMap<string, 'hit' | 'miss'>;
}): ClassifiedReason {
  const verifiedHits: string[] = [];
  const claimed: string[] = [];

  for (const name of input.verified) {
    if (isStopName(name)) continue;
    if (nameInText(name, input.message) || input.claims.some((claim) => sameEntityName(claim, name))) {
      verifiedHits.push(name);
    }
  }

  for (const claim of input.claims) {
    const cleaned = claim.trim();
    if (!cleaned || isStopName(cleaned)) continue;
    if (!nameInText(cleaned, input.message)) continue;
    if (verifiedHits.some((name) => sameEntityName(name, cleaned))) continue;
    claimed.push(cleaned);
  }

  const unverifiable: string[] = [];
  const hallucinated: string[] = [];
  for (const name of uniqueNames(claimed)) {
    const outcome = input.searched?.get(normalizeName(name));
    if (outcome === 'hit') {
      verifiedHits.push(name);
      continue;
    }
    if (outcome === 'miss') hallucinated.push(name);
    else unverifiable.push(name);
  }

  const verified = uniqueNames(verifiedHits);
  return {
    cited: uniqueNames([...verified, ...unverifiable, ...hallucinated]),
    verified,
    unverifiable,
    hallucinated,
  };
}

export function citationShare(reasons: readonly { verified: readonly string[] }[]): number | null {
  if (!reasons.length) return null;
  const hit = reasons.filter((reason) => reason.verified.length > 0).length;
  return round3(hit / reasons.length);
}

export function verifiedReasonCount(reasons: readonly { verified: readonly string[] }[]): number {
  return reasons.filter((reason) => reason.verified.length > 0).length;
}

/**
 * A reason shows Qloo value only when it names a taste entity from this
 * persona's own anchors. A city name, or any catalog name the model happened
 * to utter, does not count. The no-Qloo arm has no anchors, so it stays at 0
 * unless the caller passes that audience's list.
 */
export function specificTasteNames(verified: readonly string[], anchors: readonly string[], city: string): string[] {
  return uniqueNames(
    verified.filter((name) => {
      if (sameEntityName(name, city) || isStopName(name)) return false;
      return anchors.some((anchor) => sameEntityName(anchor, name));
    }),
  );
}

export function specificReasonCount(reasons: readonly { specific?: readonly string[] }[]): number {
  return reasons.filter((reason) => (reason.specific?.length ?? 0) > 0).length;
}

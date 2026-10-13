export interface NameHit {
  id: string;
  label: string;
  description?: string;
  matchScore?: number;
}

export type NameChoice =
  | { kind: 'one'; hit: NameHit; note?: string }
  | { kind: 'none' }
  | { kind: 'many'; hits: NameHit[]; note: string };

/** Compare labels without case or diacritics. Does not rank fame. */
export function normalizeName(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Pick a hit only when one label matches the query. A city string may break
 * a tie when it appears in exactly one description. Rank order is not used.
 */
export function chooseByName(query: string, hits: readonly NameHit[], city?: string): NameChoice {
  if (hits.length === 0) return { kind: 'none' };
  const wanted = normalizeName(query);
  const exact = hits.filter((hit) => normalizeName(hit.label) === wanted);
  if (exact.length === 1) {
    const only = exact[0];
    if (!only) return { kind: 'none' };
    return { kind: 'one', hit: only };
  }
  if (exact.length > 1 && city?.trim()) {
    const needle = city.trim().toLowerCase();
    const inCity = exact.filter((hit) => (hit.description ?? '').toLowerCase().includes(needle));
    if (inCity.length === 1) {
      const only = inCity[0];
      if (!only) return { kind: 'many', hits: exact, note: `${exact.length} entities share this label` };
      return {
        kind: 'one',
        hit: only,
        note: `Disambiguated because only this description mentions the brief city “${city.trim()}”.`,
      };
    }
  }
  if (exact.length > 1) {
    return {
      kind: 'many',
      hits: exact,
      note: `${exact.length} entities share the label “${query.trim()}”.`,
    };
  }
  return {
    kind: 'many',
    hits: hits.slice(0, 5),
    note: `No returned label matches “${query.trim()}” exactly, so the top search hit was not accepted.`,
  };
}

/**
 * MusicBrainz `score` is a name-match score. Use it only to separate two
 * exact-name rows. It is never an affinity.
 */
export function chooseMusicBrainz(query: string, hits: readonly NameHit[]): NameChoice {
  const wanted = normalizeName(query);
  const exact = hits.filter((hit) => normalizeName(hit.label) === wanted);
  if (exact.length === 0) return chooseByName(query, hits);
  const ranked = [...exact].sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
  const top = ranked[0];
  if (!top) return { kind: 'none' };
  const next = ranked[1];
  const topScore = top.matchScore ?? 0;
  const nextScore = next?.matchScore ?? 0;
  if (topScore >= 95 && (!next || topScore - nextScore >= 15)) {
    return { kind: 'one', hit: top };
  }
  if (!next) return { kind: 'one', hit: top };
  return {
    kind: 'many',
    hits: ranked,
    note: `MusicBrainz returned ${ranked.length} artists named “${query.trim()}” with close name-match scores (${topScore} and ${nextScore}).`,
  };
}

import { RANK_RULE, meanRank } from '@tastedraft/contracts';

export interface CityRankView {
  city: string;
  rank: number | null;
  score: number | null;
}

export interface CaseStudyView {
  id: string;
  title: string;
  short: string;
  domain: string;
  domainLabel: string;
  /** The city where the launch actually happened. */
  market: string;
  realRank: number | null;
  realScore: number | null;
  cityCount: number;
  cities: CityRankView[];
  confidence: string;
  /** First public source. Kept so other views can read one link. */
  source: string;
  matched: boolean | null;
  scored: boolean;
  grounding: string;
  outcome: string;
  outcomeSummary: string;
  sources: string[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sourceList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().startsWith('http'));
}

function cityRows(value: unknown): CityRankView[] {
  if (!Array.isArray(value)) return [];
  const rows: CityRankView[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const city = text(record.city);
    if (!city) continue;
    rows.push({
      city,
      rank: typeof record.rank === 'number' ? record.rank : null,
      score: typeof record.score === 'number' ? record.score : null,
    });
  }
  return rows;
}

/** Read the published fixture. Ranks stay whatever the file recorded. */
export function caseStudyViews(body: unknown): CaseStudyView[] {
  if (!body || typeof body !== 'object') return [];
  const studies = (body as { studies?: unknown }).studies;
  if (!Array.isArray(studies)) return [];
  const views: CaseStudyView[] = [];
  for (const row of studies) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const id = text(record.id);
    const title = text(record.title);
    if (!id || !title) continue;
    const sources = sourceList(record.sources);
    const cities = cityRows(record.cities);
    const realRank = typeof record.realRank === 'number' ? record.realRank : null;
    const matched = typeof record.matched === 'boolean' ? record.matched : null;
    const scored = record.scored === true && realRank != null && matched !== null;
    views.push({
      id,
      title,
      short: title.split(',')[0]?.trim() || title,
      domain: text(record.domain),
      domainLabel: text(record.domainLabel) || text(record.domain) || 'Launch',
      market: text(record.market),
      realRank: scored ? realRank : null,
      realScore: scored && typeof record.realScore === 'number' ? record.realScore : null,
      cityCount: cities.length,
      cities,
      confidence: scored ? text(record.confidence) : '',
      source: sources[0] ?? '',
      matched: scored ? matched : null,
      scored,
      grounding: text(record.grounding),
      outcome: text(record.outcome),
      outcomeSummary: text(record.outcomeSummary),
      sources,
    });
  }
  return views;
}

export function caseStudySummary(studies: readonly Pick<CaseStudyView, 'scored' | 'matched' | 'outcome' | 'realRank'>[]): string {
  const scored = studies.filter((study) => study.scored && typeof study.realRank === 'number');
  if (!scored.length) return `No live ranks yet · ${RANK_RULE.version}`;
  const successes = scored.filter((study) => study.outcome !== 'left');
  const failures = scored.filter((study) => study.outcome === 'left');
  const top2 = successes.filter((study) => study.matched).length;
  const low = failures.filter((study) => study.matched).length;
  const average = meanRank(scored.map((study) => study.realRank as number));
  const waiting = studies.length - scored.length;
  const base = `Top-2 ${top2} of ${successes.length} · low rank ${low} of ${failures.length} · mean rank ${average}`;
  return waiting ? `${base} · ${waiting} awaiting live Qloo` : base;
}

export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

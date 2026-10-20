/** Read the published benchmark. Numbers stay whatever the file recorded. */

export interface BenchmarkArmView {
  id: 'qloo' | 'llm';
  label: string;
  headline: string;
  share: number | null;
  unverifiableNames: number;
  unverifiableMentions: number;
  hallucinated: number | null;
  outcome: string | null;
  spread: string | null;
}

export interface BenchmarkRow {
  id: string;
  title: string;
  city: string;
  kind: 'example' | 'case-study';
  withQloo: string;
  withoutQloo: string;
  outcome: string;
  qlooReason: string;
  llmReason: string;
}

export interface BenchmarkView {
  source: 'recorded' | 'live';
  label: string;
  model: string | null;
  arms: { qloo: BenchmarkArmView; llm: BenchmarkArmView };
  rows: BenchmarkRow[];
  sampleNote: string | null;
  limits: string[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fraction(verified: unknown, total: unknown): string {
  const hit = count(verified);
  const all = count(total);
  if (hit == null || all == null) return '—';
  return `${hit} of ${all}`;
}

function spreadText(value: unknown): string | null {
  if (!isRecord(value) || typeof value.range !== 'number') return null;
  const min = typeof value.min === 'number' ? value.min : null;
  const max = typeof value.max === 'number' ? value.max : null;
  if (min == null || max == null) return `range ${value.range}`;
  return `${min}–${max}, range ${value.range}`;
}

function reasonOf(arm: unknown): string {
  if (!isRecord(arm) || !Array.isArray(arm.reasons)) return '';
  const first = arm.reasons.find(isRecord);
  return first ? text(first.reason) : '';
}

export function parseBenchmark(body: unknown): BenchmarkView | null {
  if (!isRecord(body)) return null;
  const headline = isRecord(body.headline) ? body.headline : null;
  const totals = isRecord(body.totals) ? body.totals : null;
  const qlooTotals = totals && isRecord(totals.qloo) ? totals.qloo : null;
  const llmTotals = totals && isRecord(totals.llm) ? totals.llm : null;
  const agreement = isRecord(body.agreement) ? body.agreement : null;
  const ledger = agreement && isRecord(agreement.qlooLedger) ? agreement.qlooLedger : null;
  const spread = isRecord(body.scoreSpread) ? body.scoreSpread : null;
  const items = Array.isArray(body.items) ? body.items : [];
  if (!headline || !text(headline.withQloo) || !Array.isArray(items) || items.length === 0) return null;
  const source = body.source === 'live' ? 'live' : body.source === 'recorded' ? 'recorded' : null;
  if (!source) return null;

  const rows: BenchmarkRow[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = text(item.id);
    const title = text(item.title);
    const city = text(item.city);
    const kind = item.kind === 'case-study' || item.kind === 'example' ? item.kind : null;
    const qloo = isRecord(item.qloo) ? item.qloo : null;
    const llm = isRecord(item.llm) ? item.llm : null;
    if (!id || !title || !city || !kind || !qloo || !llm) continue;
    const outcome = item.outcome === 'sold_out' ? 'Sold out' : item.outcome === 'left' ? 'Left the market' : item.outcome === 'stayed' ? 'Stayed' : '';
    const matched = qloo.matched === true ? 'Match' : qloo.matched === false ? 'Miss' : '';
    rows.push({
      id,
      title,
      city,
      kind,
      withQloo: fraction(qloo.verifiedReasons, qloo.reasonCount),
      withoutQloo: fraction(llm.verifiedReasons, llm.reasonCount),
      outcome: outcome && matched ? `${matched} · ${outcome}` : outcome || '—',
      qlooReason: reasonOf(qloo),
      llmReason: reasonOf(llm),
    });
  }
  if (!rows.length) return null;

  const qlooNames = qlooTotals && Array.isArray(qlooTotals.unverifiableNames) ? qlooTotals.unverifiableNames.length : 0;
  const llmNames = llmTotals && Array.isArray(llmTotals.unverifiableNames) ? llmTotals.unverifiableNames.length : 0;
  const sample = isRecord(body.sampleEngine) ? text(body.sampleEngine.label) : '';
  const limits = Array.isArray(body.limits) ? body.limits.filter((line): line is string => typeof line === 'string' && line.trim().length > 0) : [];

  return {
    source,
    label: text(body.label),
    model: text(body.model) || null,
    arms: {
      qloo: {
        id: 'qloo',
        label: 'With Qloo',
        headline: text(headline.withQloo),
        share: count(headline.citationShareWithQloo),
        unverifiableNames: qlooNames,
        unverifiableMentions: count(qlooTotals?.unverifiableMentions) ?? 0,
        hallucinated: count(qlooTotals?.hallucinatedMentions),
        outcome: text(headline.outcomeWithQloo) || ((count(ledger?.total) ?? 0) > 0 ? `${count(ledger?.matched) ?? 0} of ${count(ledger?.total)}` : null),
        spread: spreadText(spread?.qlooCaseStudies),
      },
      llm: {
        id: 'llm',
        label: 'Without Qloo',
        headline: text(headline.withoutQloo),
        share: count(headline.citationShareWithoutQloo),
        unverifiableNames: llmNames,
        unverifiableMentions: count(llmTotals?.unverifiableMentions) ?? 0,
        hallucinated: count(llmTotals?.hallucinatedMentions),
        outcome: text(headline.outcomeWithoutQloo) || null,
        spread: spreadText(spread?.llmExamples),
      },
    },
    rows,
    sampleNote: sample || null,
    limits,
  };
}

/**
 * Fold per-launch arms into the public file.
 * The writer refuses keys, raw Qloo envelopes, and explainability blobs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { citationShare, specificReasonCount, spread, uniqueNames, verifiedReasonCount } from './metrics.ts';
import type { ArmRecord, BenchmarkFile, ItemRecord, NameTotals, ReasonRecord, SampleCity } from './types.ts';

export const BUDGET_CAP = 80;

export const RECORDED_LABEL =
  'Recorded offline run. QLOO_API_KEY and LLM_API_KEY were not set, so persona reasons are the product templates. city-rank-2 has no live ranks in this checkout, so this file does not copy an outcome agreement. This is not a live OpenRouter or Qloo pass.';

export const LIMITS = [
  'A name counts as a verified Qloo entity only when this run resolved it, or when case-studies.json already records a resolved subject from the earlier live probe.',
  'Example reference names are the product sample list. Until a live search confirms them, a reason that cites them is unverifiable, not a confirmed hallucination.',
  'Hallucinated means a Qloo search in this run returned no matching entity. The recorded run does not search, so that count stays empty.',
  'city-rank-2 ranks cities by taste lift and has no live ranks in this checkout. city-rank-1 ranked every real city 1 of 5. An earlier absolute rule matched 2 of 4 scored Tokyo rows. Those totals are not copied here and are not city ranks.',
  'The sample-engine block is the local Rust fixture. It is not a Qloo score. Tokyo has no row in that fixture and follows the Los Angeles table.',
  'This is not a sales forecast.',
  'Entity counts use names the reply lists, plus any verified name that appears in the sentence. A stray proper noun that is neither listed nor in the Qloo catalog is left out, so the unverifiable count is not a scan of every capital letter.',
];

const FORBIDDEN = [
  /hack_[a-z0-9]+/i,
  /sk-or-v1-/i,
  /\bsk-[a-z0-9_-]{8,}\b/i,
  /"entity_id"/,
  /explainability/,
  /images\.qloo\.com/i,
  /x-api-key/i,
  /"results"\s*:/,
];

export function assertPublicBenchmark(text: string): void {
  for (const pattern of FORBIDDEN) {
    if (pattern.test(text)) {
      throw new Error(`benchmark.json failed the public fixture check (${pattern})`);
    }
  }
}

export function armFromReasons(
  reasons: readonly ReasonRecord[],
  ledger: { score: number | null; local: number | null; verdict: 'encourage' | 'caution' | null; matched: boolean | null },
  searched: boolean,
): ArmRecord {
  const unverifiable = reasons.flatMap((reason) => reason.unverifiable);
  const hallucinated = reasons.flatMap((reason) => reason.hallucinated);
  const scores = reasons.map((reason) => reason.score).filter((score): score is number => score != null);
  return {
    reasons: reasons.map((reason) => ({ ...reason, verified: [...reason.verified], unverifiable: [...reason.unverifiable], hallucinated: [...reason.hallucinated] })),
    verifiedReasons: verifiedReasonCount(reasons),
    reasonCount: reasons.length,
    citationShare: citationShare(reasons),
    unverifiableMentions: unverifiable.length,
    unverifiableNames: uniqueNames(unverifiable),
    hallucinatedMentions: searched ? hallucinated.length : null,
    hallucinatedNames: searched ? uniqueNames(hallucinated) : [],
    segmentSpread: spread(scores),
    ledgerScore: ledger.score,
    ledgerLocal: ledger.local,
    verdict: ledger.verdict,
    matched: ledger.matched,
  };
}

function pool(items: readonly ItemRecord[], arm: 'qloo' | 'llm'): ReasonRecord[] {
  return items.flatMap((item) => item[arm].reasons);
}

function agreementLine(matched: number, total: number): string {
  return `${matched} of ${total}`;
}

function nameTotals(reasons: readonly ReasonRecord[], searched: boolean): NameTotals {
  const unverifiable = reasons.flatMap((reason) => reason.unverifiable);
  const hallucinated = reasons.flatMap((reason) => reason.hallucinated);
  return {
    unverifiableMentions: unverifiable.length,
    unverifiableNames: uniqueNames(unverifiable),
    hallucinatedMentions: searched ? hallucinated.length : null,
    hallucinatedNames: searched ? uniqueNames(hallucinated) : [],
  };
}

export function summarize(input: {
  source: 'recorded' | 'live';
  label: string;
  generatedAt: string;
  model: string | null;
  qlooCalls: number;
  items: ItemRecord[];
  sampleEngine: BenchmarkFile['sampleEngine'];
  llmPanel: { matched: number; total: number } | null;
}): BenchmarkFile {
  const qlooReasons = pool(input.items, 'qloo');
  const llmReasons = pool(input.items, 'llm');
  const studies = input.items.filter((item) => item.kind === 'case-study' && typeof item.qloo.matched === 'boolean');
  const matched = studies.filter((item) => item.qloo.matched).length;
  const qlooShare = citationShare(qlooReasons.map((reason) => ({ verified: reason.specific ?? [] })));
  const llmShare = citationShare(llmReasons.map((reason) => ({ verified: reason.specific ?? [] })));
  const withCount = specificReasonCount(qlooReasons);
  const withoutCount = specificReasonCount(llmReasons);
  const exampleQlooScores = input.items
    .filter((item) => item.kind === 'example')
    .flatMap((item) => item.qloo.reasons.map((reason) => reason.score))
    .filter((score): score is number => score != null);
  const exampleLlmScores = input.items
    .filter((item) => item.kind === 'example')
    .flatMap((item) => item.llm.reasons.map((reason) => reason.score))
    .filter((score): score is number => score != null);
  const llmMatched = input.llmPanel;
  return {
    source: input.source,
    live: input.source === 'live',
    label: input.label,
    generatedAt: input.generatedAt,
    model: input.model,
    qlooCalls: input.qlooCalls,
    budgetCap: BUDGET_CAP,
    headline: {
      withQloo: `${withCount} of ${qlooReasons.length}`,
      withoutQloo: `${withoutCount} of ${llmReasons.length}`,
      citationShareWithQloo: qlooShare,
      citationShareWithoutQloo: llmShare,
      outcomeWithQloo: studies.length ? agreementLine(matched, studies.length) : null,
      outcomeWithoutQloo: llmMatched && llmMatched.total ? agreementLine(llmMatched.matched, llmMatched.total) : null,
    },
    agreement: {
      qlooLedger: { matched, total: studies.length, source: 'apps/web/public/case-studies.json' },
      llmPanel: llmMatched,
    },
    totals: {
      qloo: nameTotals(qlooReasons, input.source === 'live'),
      llm: nameTotals(llmReasons, input.source === 'live'),
    },
    scoreSpread: {
      qlooCaseStudies: spread(studies.map((item) => item.qloo.ledgerScore as number)),
      qlooExamples: spread(exampleQlooScores),
      llmExamples: spread(exampleLlmScores),
      note: 'Case-study spread is filled only when the published file still has ledger totals. city-rank-2 does not publish those totals. Example spreads use persona scores from this run only.',
    },
    sampleEngine: input.sampleEngine,
    items: input.items,
    limits: LIMITS,
  };
}

export function sampleBlock(cities: SampleCity[]): BenchmarkFile['sampleEngine'] {
  const means = cities.map((city) => city.mean);
  const segments = cities.flatMap((city) => city.segments.map((segment) => segment.score));
  return {
    label: 'Local Rust sample engine. Not a Qloo measurement. Tokyo follows the Los Angeles row because the sample table has no Tokyo entry.',
    cities,
    citySpread: spread(means),
    segmentSpread: spread(segments),
  };
}

export function writeBenchmark(file: BenchmarkFile, path: string): void {
  const text = `${JSON.stringify(file, null, 2)}\n`;
  assertPublicBenchmark(text);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

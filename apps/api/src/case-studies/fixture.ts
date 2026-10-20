/**
 * Published case-study catalog.
 * The needs-live file lists the locked cities and leaves every rank null.
 * A live run is the only writer that fills scores.
 */
import { RANK_RULE, caseStudyCallEstimate, meanRank } from '../engine/rank-options.ts';
import { DEFAULT_DAILY_BUDGET } from '../ops/qloo-budget.ts';
import { JAPAN_CITIES, LAUNCH_CASES, US_CITIES, citiesFor, polarityOf, type LaunchCase } from './cases.ts';
import { assertDerivedFixture, type LaunchStudy } from './probe.ts';

export const DAILY_BUDGET = DEFAULT_DAILY_BUDGET;

export const HISTORICAL_NOTE =
  'city-rank-1 (local 50, heatmap 25, popularity 25) ranked every real city 1 of 5 on the live run, including Forever 21 and Innisfree, because size and popularity crowned Tokyo and New York. city-rank-2 replaces that rule. An earlier absolute rule, encourage only when the ledger total was at least 55 and local fit was at least 50, matched 2 of 4 scored Tokyo rows. Those totals are not ranks.';

export function callEstimate(): number {
  return caseStudyCallEstimate(LAUNCH_CASES.length, JAPAN_CITIES.length);
}

export interface FixtureStudy extends LaunchStudy {
  grounding: 'needs-live' | 'live';
}

function blankStudy(row: LaunchCase): FixtureStudy {
  return {
    id: row.id,
    title: row.title,
    domain: row.domain,
    domainLabel: row.domainLabel,
    market: row.city,
    launch: row.launch,
    outcome: row.outcome,
    outcomeSummary: row.outcomeSummary,
    prelaunch: row.prelaunch,
    sources: [...row.sources],
    scored: false,
    subject: { query: row.query, resolvedName: null, resolvedType: null },
    audience: { age: null, gender: null, location: null },
    confidence: null,
    referenceCount: 0,
    references: [],
    realRank: null,
    realScore: null,
    cities: citiesFor(row.region).map((option) => ({
      city: option.city,
      score: null,
      rank: null,
      local: null,
      heatmap: null,
      popularity: null,
    })),
    derived: { qlooCalls: 0, failures: [] },
    matched: null,
    grounding: 'needs-live',
  };
}

function hitRate(studies: readonly FixtureStudy[], grounding: 'needs-live' | 'live') {
  const scored = studies.filter((study) => study.scored && typeof study.realRank === 'number');
  if (grounding !== 'live' || !scored.length) {
    return {
      top2Successes: null,
      successes: null,
      lowRankFailures: null,
      failures: null,
      meanRank: null,
      scored: 0,
      label: 'No live ranks yet',
    };
  }
  const successes = scored.filter((study) => polarityOf(study.outcome) === 'positive');
  const failures = scored.filter((study) => polarityOf(study.outcome) === 'negative');
  const top2 = successes.filter((study) => study.matched).length;
  const low = failures.filter((study) => study.matched).length;
  const average = meanRank(scored.map((study) => study.realRank as number));
  return {
    top2Successes: top2,
    successes: successes.length,
    lowRankFailures: low,
    failures: failures.length,
    meanRank: average,
    scored: scored.length,
    label: `Top-2 ${top2} of ${successes.length} · low rank ${low} of ${failures.length} · mean rank ${average}`,
  };
}

export function caseStudyFixture(studies: readonly FixtureStudy[], grounding: 'needs-live' | 'live') {
  return {
    method:
      `${RANK_RULE.version} ranks the real launch city against a locked list of comparable cities. Local and heatmap are taste lift: affinity divided by that city's popularity, then scaled. Weights are local ${RANK_RULE.weights.local}, heatmap ${RANK_RULE.weights.heatmap}, and popularity ${RANK_RULE.weights.popularity}. A missing part stays null. A capital does not win on size. Successes should land in the top 2. Failures (a later exit) should land in the bottom 2. Rank 3 of 5 is a miss for both. Locked ${RANK_RULE.lockedOn} before the rerun. This is not a sales forecast.`,
    grounding,
    rerun:
      'npm run case-studies -w @tastedraft/api with QLOO_API_KEY set. Cache: apps/api/data/qloo-cache (gitignored). The writer refuses raw results, entity ids, explainability, images, and keys. Without a key the script exits and leaves this file unchanged.',
    rule: {
      version: RANK_RULE.version,
      lockedOn: RANK_RULE.lockedOn,
      topK: RANK_RULE.topK,
      weights: RANK_RULE.weights,
      trends: RANK_RULE.trends,
      maxRelated: RANK_RULE.maxRelated,
      cities: {
        japan: JAPAN_CITIES.map((option) => option.city),
        us: US_CITIES.map((option) => option.city),
      },
    },
    callEstimate: callEstimate(),
    dailyBudget: DAILY_BUDGET,
    historicalNote: HISTORICAL_NOTE,
    hitRate: hitRate(studies, grounding),
    contamination:
      "Qloo is today's graph. Later records, the 2019 Forever 21 exit, and the 2021 Innisfree exit can still sit in the affinities. The briefs themselves stop at pre-launch facts.",
    studies,
  };
}

export function needsLiveFixture() {
  return caseStudyFixture(LAUNCH_CASES.map(blankStudy), 'needs-live');
}

export function needsLiveFixtureText(): string {
  const text = `${JSON.stringify(needsLiveFixture(), null, 2)}\n`;
  assertDerivedFixture(text);
  return text;
}

export function liveFixtureText(studies: readonly LaunchStudy[]): string {
  const text = `${JSON.stringify(caseStudyFixture(studies.map((study) => ({ ...study, grounding: 'live' as const })), 'live'), null, 2)}\n`;
  assertDerivedFixture(text);
  return text;
}

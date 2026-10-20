/**
 * One live pass of the pre-launch briefs under city-rank-2.
 * Prints derived ranks only. Writes apps/web/public/case-studies.json
 * after the fixture guard. Does not print the key or response bodies.
 *
 * Without QLOO_API_KEY the script exits and leaves the fixture unchanged.
 * It does not copy the sample graph and it does not invent a rank.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/load-env.ts';
import { QlooClient } from '../src/providers/qloo/client.ts';
import { LAUNCH_CASES, polarityOf } from '../src/case-studies/cases.ts';
import { DAILY_BUDGET, callEstimate, liveFixtureText } from '../src/case-studies/fixture.ts';
import { probeLaunch } from '../src/case-studies/probe.ts';
import { RANK_RULE, meanRank } from '../src/engine/rank-options.ts';

const estimate = callEstimate();
const key = process.env.QLOO_API_KEY?.trim() ?? '';
if (!key) {
  console.error(`${RANK_RULE.version} locked ${RANK_RULE.lockedOn}.`);
  console.error(`A full pass is about ${estimate} Qloo calls (${LAUNCH_CASES.length} briefs, 5 cities, search + related + demographics + two calls per city).`);
  console.error(`The shared daily budget is ${DAILY_BUDGET}. A bias.trends HTTP 400 retries once without that parameter. A cache hit does not call Qloo again.`);
  console.error('QLOO_API_KEY is not set. This pass does not invent ranks and does not rewrite the fixture.');
  console.error('Set QLOO_API_KEY and rerun. Live 200 bodies cache under apps/api/data/qloo-cache, which is gitignored.');
  process.exit(1);
}

const cacheDir = fileURLToPath(new URL('../data/qloo-cache/', import.meta.url));
const client = new QlooClient({
  apiKey: key,
  retries: 1,
  minIntervalMs: 300,
  timeoutMs: 25_000,
  cacheDir,
});

console.error(`${RANK_RULE.version} locked ${RANK_RULE.lockedOn}. About ${estimate} calls, budget ${DAILY_BUDGET}.`);

const studies = [];
for (const row of LAUNCH_CASES) {
  const study = await probeLaunch(client, row);
  studies.push(study);
  const rank = study.realRank == null ? '-' : `${study.realRank}/${study.cities.length}`;
  const failures = study.derived.failures.join(',') || '-';
  const mark = study.matched == null ? 'unscored' : study.matched ? 'hit' : 'miss';
  console.log([
    study.id,
    study.market,
    rank,
    study.realScore ?? '-',
    study.confidence ?? '-',
    study.outcome,
    mark,
    study.derived.qlooCalls,
    failures,
  ].join('\t'));
}

const scored = studies.filter((study) => study.scored && typeof study.realRank === 'number');
const successes = scored.filter((study) => polarityOf(study.outcome) === 'positive');
const failures = scored.filter((study) => polarityOf(study.outcome) === 'negative');
const top2 = successes.filter((study) => study.matched).length;
const low = failures.filter((study) => study.matched).length;
const average = meanRank(scored.map((study) => study.realRank as number));
console.log(`Top-2 ${top2} of ${successes.length} · low rank ${low} of ${failures.length} · mean rank ${average ?? '-'}`);

const text = liveFixtureText(studies);
const out = fileURLToPath(new URL('../../../apps/web/public/case-studies.json', import.meta.url));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);
console.log(`wrote ${studies.length} derived studies`);

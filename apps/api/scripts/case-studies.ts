/**
 * One live pass of the pre-launch briefs.
 * Prints derived numbers only. Writes apps/web/public/case-studies.json
 * after the fixture guard. Does not print the key or response bodies.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/load-env.ts';
import { QlooClient } from '../src/providers/qloo/client.ts';
import { ENCOURAGE_LOCAL, ENCOURAGE_TOTAL, LAUNCH_CASES } from '../src/case-studies/cases.ts';
import { assertDerivedFixture, probeLaunch } from '../src/case-studies/probe.ts';

const key = process.env.QLOO_API_KEY?.trim() ?? '';
if (!key) {
  console.error('QLOO_API_KEY is not set. This pass does not fall back to the sample graph.');
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

const studies = [];
for (const row of LAUNCH_CASES) {
  const study = await probeLaunch(client, row);
  studies.push(study);
  const failures = study.derived.failures.join(',') || '-';
  console.log([
    study.id,
    study.engine.verdict,
    study.engine.total ?? '-',
    study.engine.local ?? '-',
    study.outcome,
    study.matched ? 'match' : 'miss',
    study.derived.qlooCalls,
    failures,
  ].join('\t'));
}

const fixture = {
  method: 'scoreInsightMeasurements on live Qloo affinities. Heatmap is context and is not a ledger row. One reference keeps evidence LIMITED.',
  rule: {
    encourageTotal: ENCOURAGE_TOTAL,
    encourageLocal: ENCOURAGE_LOCAL,
    lockedBeforeCalls: true,
  },
  contamination: 'Qloo is today\'s graph. Later records and the 2019 Forever 21 exit can still sit in the affinities. The briefs themselves stop at pre-launch facts.',
  studies,
};
const text = `${JSON.stringify(fixture, null, 2)}\n`;
assertDerivedFixture(text);
const out = fileURLToPath(new URL('../../../apps/web/public/case-studies.json', import.meta.url));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);
console.log(`wrote ${studies.length} derived studies`);

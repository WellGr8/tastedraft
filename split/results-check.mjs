// Node check for the results demo view. Not part of the prototype bundle.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, 'results.js'), 'utf8');
const api = new Function(src + `
  return { esc, formatDelta, framePhase, changedDiffs, ledgerPairs };
`)();
const demo = JSON.parse(readFileSync(join(dir, 'results-demo.json'), 'utf8'));
const fails = [];
function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) fails.push(name + ' got ' + g + ' want ' + w);
  else console.log('ok', name);
}
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail ? ' ' + detail : ''));
  else console.log('ok', name);
}

eq('delta up', api.formatDelta(9), '+9');
eq('delta down', api.formatDelta(-2), '-2');
eq('phases', [0, 4, 5].map(api.framePhase), ['score', 'shortlist', 'done']);
eq('only price changed', api.changedDiffs(demo.diff).map((row) => row.label), ['Price level']);
const rows = api.ledgerPairs(demo);
ok('five ledger rows', rows.length === 5);
ok('provenance sentence', rows.every((row) => /^from Qloo explainability: input .+ contributed \d+\.\d{2}$/.test(row.provenance)));
ok('anchor names Comme', rows[0].provenance.indexOf('Comme des Garçons contributed 0.94') > 0);
ok('local and audience move', rows.filter((row) => row.changed).map((row) => row.label).join(',') === 'Local fit,Audience fit,Cultural friction');
ok('six captions', demo.captions.length === 6 && demo.timeline.length === 2);
ok('escape', api.esc('<b>&') === '&lt;b&gt;&amp;');
ok('shortlist of three', demo.shortlist.length === 3 && demo.v1.total === 71 && demo.v2.total === 80);

if (fails.length) {
  console.error(fails.join('\n'));
  process.exit(1);
}
console.log('results check ok');

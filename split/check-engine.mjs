// Node check for the deterministic engine. Not part of the browser bundle.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const src = ['mock-data.js', 'evidence.js', 'engine.js'].map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
const fn = new Function(src + `
  return {
    DEFAULT_IDEA, AGES, POS, CITIES,
    SUBS1, SUBS2, deriveSubs, ledgerPoints, displayScore, evidenceKey,
    provideEvidence, REF_EVIDENCE
  };
`);
const api = fn();

function brief(over) {
  return Object.assign({
    idea: api.DEFAULT_IDEA,
    age: api.AGES[0],
    city: 'Los Angeles',
    pos: 'Premium',
    refs: ['Comme des Garçons', 'Muji', 'Aphex Twin', 'Lost in Translation', 'Silver Lake'],
    applied: false
  }, over || {});
}

function score(over) {
  const b = brief(over);
  const packet = api.provideEvidence(b);
  const subs = api.deriveSubs(packet);
  const points = api.ledgerPoints(subs);
  return { subs, points, packet };
}

const fails = [];
function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) fails.push(name + ' got ' + g + ' want ' + w);
  else console.log('ok', name, g);
}

const v1 = score();
eq('v1 subs', v1.subs, api.SUBS1);
eq('v1 points', v1.points, { anchor: 24, cross: 20, local: 15, audience: 17, friction: -5, total: 71 });
eq('v1 sum', v1.points.anchor + v1.points.cross + v1.points.local + v1.points.audience + v1.points.friction, 71);

const v2 = score({ applied: true });
eq('v2 subs', v2.subs, api.SUBS2);
eq('v2 points', v2.points, { anchor: 24, cross: 20, local: 18, audience: 22, friction: -2, total: 82 });

const base = v1.points.total;
function changes(name, over) {
  const t = score(over).points.total;
  if (t === base) fails.push(name + ' still ' + t);
  else console.log('ok', name, base, '->', t);
}

for (const city of Object.keys(api.CITIES)) {
  if (city === 'Los Angeles') continue;
  changes('city ' + city, { city: city });
}
for (let i = 1; i < api.AGES.length; i++) changes('age ' + api.AGES[i], { age: api.AGES[i] });
for (const pos of api.POS) {
  if (pos === 'Premium') continue;
  changes('pos ' + pos, { pos: pos });
}
const refs = brief().refs;
for (const name of refs) changes('drop ' + name, { refs: refs.filter((r) => r !== name) });
changes('add Nike', { refs: refs.concat(['Nike']) });
changes('mute to one', { refs: ['Muji'] });
changes('idea dog food', { idea: 'Organic dog food subscription for retirees in the suburbs' });
changes('idea homeware', { idea: 'Japanese minimal homeware for quiet apartments' });
changes('idea no limited', { idea: 'Japanese minimalist streetwear with an underground electronic identity, sold at a premium price' });
changes('idea electronic only', { idea: 'An underground electronic club night' });

const one = score({ refs: ['Muji'] });
const shown = api.displayScore(one.points.total, 1);
if (!shown.limited) fails.push('one ref should be LIMITED');
if (shown.why !== 'Why ' + shown.text + '?') fails.push('why/score mismatch ' + shown.why + ' vs ' + shown.text);
else console.log('ok limited display', shown.text, shown.why, 'exact', one.points.total);

const full = api.displayScore(71, 5);
eq('high display', full, { text: '71', why: 'Why 71?', limited: false, approx: 71 });

const keys = api.evidenceKey(4) + api.evidenceKey(3) + api.evidenceKey(2) + api.evidenceKey(1) + api.evidenceKey(0);
eq('evidence keys', keys, 'HIGHMEDIUMMEDIUMLIMITEDLIMITED');

if (v1.packet.signal.fashion < 75 || v1.packet.signal.music < 75 || v1.packet.signal.design < 75) {
  fails.push('default signals not strong ' + JSON.stringify(v1.packet.signal));
} else console.log('ok default signals', JSON.stringify(v1.packet.signal), 'local', v1.subs.local);
if (!(v1.subs.local >= 55 && v1.subs.local < 75)) fails.push('v1 local not moderate ' + v1.subs.local);
if (v2.subs.local < 75) fails.push('v2 local not strong ' + v2.subs.local);
if (v1.packet.sourceId !== 'sample') fails.push('source ' + v1.packet.sourceId);
const nike = score({ refs: ['Nike', 'Uniqlo'] });
if (nike.packet.sourceId !== 'inferred') fails.push('expected inferred, got ' + nike.packet.sourceId);

if (fails.length) {
  console.error('\nFAILED');
  for (const f of fails) console.error(' -', f);
  process.exit(1);
}
console.log('\nall checks passed');

// Node checks for the shared result shape and the API client. Not part of the browser bundle.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const src = ['mock-data.js', 'evidence.js', 'engine.js', 'view-model.js', 'api.js']
  .map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
const api = new Function(src + `
  return {
    DEFAULT_IDEA, AGES, CITIES,
    buildLocalResult, normalizeResult, createTasteApi, recommendationIds,
    readApiBase, emptyResult, resultReady
  };
`)();

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

function brief(over) {
  return Object.assign({
    idea: api.DEFAULT_IDEA,
    age: api.AGES[0],
    city: 'Los Angeles',
    pos: 'Premium',
    interests: '',
    refs: ['Comme des Garçons', 'Muji', 'Aphex Twin', 'Lost in Translation', 'Silver Lake'],
    applied: false
  }, over || {});
}

const v1 = api.buildLocalResult(brief());
const v2 = api.buildLocalResult(brief({ posture: 'accessible' }));
eq('v1 score', v1.score, 71);
eq('v1 ledger', v1.ledger, { anchor: 24, cross: 20, local: 15, audience: 17, friction: -5 });
eq('v2 score', v2.score, 80);
eq('la districts', v1.districts, { min: ['Silver Lake', 'Echo Park'], lux: ['Beverly Hills', 'West Hollywood'] });
eq('miami districts', api.buildLocalResult(brief({ city: 'Miami' })).districts.min, api.CITIES.Miami[0]);

const fitText = v1.fits.map((f) => f.text).join(' | ');
ok('default fits from facets', fitText.indexOf('Streetwear') >= 0 && fitText.indexOf('Minimal aesthetic') >= 0 && fitText.indexOf('Electronic identity') >= 0, fitText);
ok('no canned streetwear script', fitText.indexOf('Japanese minimalism') < 0 && fitText.indexOf('Underground electronic') < 0 && fitText.indexOf('Independent aesthetic') < 0, fitText);
ok('three agent proposals', v1.proposals.length === 3 && v1.proposals[0].id === 'price-level' && v1.proposals[0].predictedDelta === 9, JSON.stringify(v1.proposals.map((p) => p.id)));
ok('no accessible-premium proposal', v1.proposals.every((p) => String(p.after).indexOf('Accessible premium') < 0));
ok('signals carry sources', v1.signals.every((s) => s.domain && s.name && s.level && s.feeds && Array.isArray(s.sources)), JSON.stringify(v1.signals));
ok('location signal is districts', v1.signals[3].name.indexOf('Silver Lake') >= 0);

const dog = api.buildLocalResult(brief({ idea: 'Organic dog food subscription for retirees in the suburbs' }));
const dogBlob = JSON.stringify({ fits: dog.fits, signals: dog.signals.map((s) => s.name), frictions: dog.frictions, proposals: dog.proposals }).toLowerCase();
ok('dog food drops streetwear script', dog.fits.length === 0 && dogBlob.indexOf('streetwear') < 0 && dogBlob.indexOf('underground') < 0 && dogBlob.indexOf('japanese minimalism') < 0, dogBlob);
ok('dog food still has a price proposal from positioning', dog.proposals.length === 1 && dog.proposals[0].before.indexOf('Premium') >= 0);

const unknown = api.buildLocalResult(brief({ refs: ['Nike'] }));
ok('unknown ref is ambiguous and limited', unknown.ambiguous && unknown.evidenceStrength === 'LIMITED' && unknown.inferred.indexOf('Nike') >= 0, unknown.evidenceStrength + ' ' + unknown.inferred.join(','));

const sample = {
  score: 64,
  ledger: { anchor: 20, cross: 16, local: 12, audience: 18, friction: -2 },
  evidenceStrength: 'medium',
  signals: [{ domain: 'Food', name: 'Night market snacks', level: 'Strong', feeds: 'Anchor affinity', sources: ['Or Tor Kor'] }],
  districts: { min: ['Wang Lang'], lux: ['Thonglor'] },
  fits: ['Night market snacks'],
  frictions: [{ text: 'Tourist pricing', why: 'ราคาท่องเที่ยวสวนกับย่าน Wang Lang' }],
  proposals: [{ id: 'rec-9', before: 'Tourist pricing', after: 'Neighborhood price', why: 'ลดราคา', evidence: 'ย่าน Wang Lang' }],
  provider: 'qloo',
  status: 'ready',
  recommendationId: 'rec-bundle'
};
const norm = api.normalizeResult(sample);
eq('api score', norm.score, 64);
eq('api strength', norm.evidenceStrength, 'MEDIUM');
eq('api fit text', norm.fits[0].text, 'Night market snacks');
eq('api districts', norm.districts, { min: ['Wang Lang'], lux: ['Thonglor'] });
eq('recommendation id', api.recommendationIds(norm), ['rec-bundle']);
const perProposal = api.normalizeResult(Object.assign({}, sample, { recommendationId: '' }));
eq('proposal ids', api.recommendationIds(perProposal), ['rec-9']);

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    text: async () => JSON.stringify(body)
  };
}

const calls = [];
const readyBody = Object.assign({}, sample, { id: 'sim_1', status: 'ready' });
const fakeFetch = async (url, init) => {
  calls.push({ url: url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
  if (url.endsWith('/api/projects') && init.method === 'POST') {
    const brief = JSON.parse(init.body);
    if ((brief.references || []).indexOf('Nope') >= 0) {
      return jsonResponse(422, { status: 'entity_not_found', unresolved: ['Nope'] });
    }
    return jsonResponse(201, { id: 'prj_1' });
  }
  if (url.endsWith('/api/simulations') && init.method === 'POST') return jsonResponse(202, { id: 'sim_1', status: 'pending' });
  if (url.endsWith('/api/simulations/sim_1') && init.method === 'GET') return jsonResponse(200, readyBody);
  if (url.endsWith('/api/projects/prj_1/versions')) return jsonResponse(200, { versions: [{ version: 1, result: readyBody }] });
  if (url.endsWith('/api/recommendations/rec-bundle/apply')) return jsonResponse(200, Object.assign({}, readyBody, { score: 80, version: 2 }));
  if (url.endsWith('/api/recommendations/rec-bundle/dismiss')) return jsonResponse(200, { status: 'dismissed' });
  return jsonResponse(500, { message: 'missing ' + url });
};

const client = api.createTasteApi('http://127.0.0.1:8799/', fakeFetch);
const project = await client.createProject(brief());
eq('project id', project.id, 'prj_1');
ok('project path', calls[0].url === 'http://127.0.0.1:8799/api/projects' && calls[0].body.positioning === 'Premium');
const sim = await client.createSimulation(project.id, brief(), false);
eq('sim id', sim.id, 'sim_1');
const waited = api.normalizeResult(await client.waitSimulation(sim.id));
eq('polled score', waited.score, 64);
eq('polled signal', waited.signals[0].name, 'Night market snacks');
const versions = await client.listVersions('prj_1');
eq('versions', versions.map((v) => v.version), [1]);
await client.applyRecommendation('rec-bundle');
await client.dismissRecommendation('rec-bundle');

let entityMsg = '';
try {
  await client.createProject(brief({ refs: ['Nope'] }));
} catch (err) {
  entityMsg = err.code + ':' + (err.unresolved || []).join(',');
}
eq('entity not found', entityMsg, 'entity_not_found:Nope');

let serverCode = '';
try {
  await api.createTasteApi('http://127.0.0.1:9', async () => jsonResponse(500, { message: 'boom' })).createProject(brief());
} catch (err) {
  serverCode = err.code;
}
eq('server error', serverCode, 'server');

let missingFetch = '';
try {
  await api.createTasteApi('http://127.0.0.1:9', null).createProject(brief());
} catch (err) {
  missingFetch = err.code;
}
eq('no fetch', missingFetch, 'sandbox');

let network = '';
try {
  await api.createTasteApi('http://127.0.0.1:9', async () => { throw new TypeError('Failed to fetch'); }).createProject(brief());
} catch (err) {
  network = err.code;
}
eq('network', network, 'network');

const tpl = readFileSync(join(dir, 'template.html'), 'utf8');
const logic = readFileSync(join(dir, 'logic.js'), 'utf8');
ok('credits removed from template', tpl.indexOf('byb-credits') < 0 && tpl.indexOf('Image credits') < 0);
ok('canned line removed', tpl.indexOf('Underground electronic') < 0 && tpl.indexOf('Japanese minimalism') < 0 && logic.indexOf('Underground electronic') < 0);
ok('apiBase prop', tpl.indexOf('apiBase') >= 0);

if (fails.length) {
  console.error('\nFAILED');
  for (const f of fails) console.error(' -', f);
  process.exit(1);
}
console.log('\nall view checks passed');

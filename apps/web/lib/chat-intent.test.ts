import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainFromRun, parseIntent, suggestChips } from './chat-intent.ts';

test('parses chat commands', () => {
  assert.deepEqual(parseIntent('try Osaka'), { kind: 'city', city: 'Osaka' });
  assert.deepEqual(parseIntent('cheaper merch'), { kind: 'cheaper' });
  assert.deepEqual(parseIntent('compare Shibuya vs Ginza'), { kind: 'compare', options: ['Shibuya', 'Ginza'] });
  assert.deepEqual(parseIntent('why is Meguro 98?'), { kind: 'explain', subject: 'Meguro' });
  assert.deepEqual(parseIntent('test'), { kind: 'test' });
  assert.equal(parseIntent('approve').kind, 'approve');
  assert.equal(parseIntent('hello there').kind, 'server');
});

test('explains from run data only', () => {
  const run = { score: 52, evidenceStrength: 'MEDIUM', grounding: 'qloo', qlooCalls: 7, report: '', proposals: [],
    evidence: [{ name: 'NewJeans', kind: 'entity', affinity: 0.81, source: 'qloo', strength: 'HIGH' }],
    districts: [{ label: 'Meguro', weight: 0.98 }] };
  assert.match(explainFromRun(run, 'Meguro'), /Meguro is a Qloo heatmap cell at 98/);
  assert.match(explainFromRun(run, 'Atlantis'), /not in this run's evidence/);
  assert.match(explainFromRun(null, null), /test/);
  assert.deepEqual(suggestChips({ hasRun: false, busy: false, hasProposal: false, city: 'Tokyo', districts: [] })[0], 'Test this idea');
});

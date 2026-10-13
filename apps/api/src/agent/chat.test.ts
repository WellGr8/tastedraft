import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultBriefV2 } from './model.ts';
import { planChat } from './chat.ts';

describe('chat planner', () => {
  it('moves a brief to Bangkok only after a confirmation, with an engine delta', async () => {
    const plan = await planChat({ message: 'make it work for Bangkok', brief: defaultBriefV2() });
    assert.ok(plan.steps.some((step) => /city/i.test(step)));
    assert.equal(plan.confirm?.patch?.city, 'Bangkok');
    assert.equal(plan.proposals[0]?.to, 'Bangkok');
    assert.equal(typeof plan.proposals[0]?.delta, 'number');
    assert.doesNotMatch(plan.message, /ledger is anchor|Six diffs/);
  });

  it('offers an older age band', async () => {
    const plan = await planChat({ message: 'what if older audience?', brief: defaultBriefV2() });
    assert.equal(plan.proposals[0]?.patch?.age, '26–35');
    assert.equal(typeof plan.proposals[0]?.delta, 'number');
  });

  it('answers local fit from the ledger row', async () => {
    const plan = await planChat({
      message: 'why is local score low?',
      brief: defaultBriefV2(),
      provenance: [{ id: 'local', label: 'Local fit', points: 15, detail: 'Silver Lake is the place reference.' }],
    });
    assert.match(plan.message, /15/);
    assert.match(plan.message, /Silver Lake/);
    assert.equal(plan.proposals.length, 0);
  });

  it('ranks the server shortlist without inventing a new number', async () => {
    const plan = await planChat({
      message: 'what should we change?',
      brief: defaultBriefV2(),
      proposals: [{ id: 'price', from: '3', to: '2', why: 'Lower price level 3 → 2', predictedDelta: 9, param: 'filter.price_level.max' }],
    });
    assert.equal(plan.proposals[0]?.kind, 'server');
    assert.equal(plan.proposals[0]?.delta, 9);
    assert.ok(plan.steps.some((step) => /Simulating/.test(step)));
  });
});

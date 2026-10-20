import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scoreSampleBrief } from '@tastedraft/engine-wasm';
import { COFFEE_IDEA, COFFEE_REFERENCES, TOUR_IDEA, TOUR_REFERENCES } from './defaults.ts';
import { planAgentRounds, type AgentBrief, type AgentState } from './agent-plan.ts';

function scorer(brief: AgentBrief): number {
  return scoreSampleBrief({
    idea: brief.idea,
    age: brief.age,
    city: brief.city,
    pos: brief.pos,
    refs: brief.refs,
    applied: false,
    posture: brief.posture,
    scarcity: brief.scarcity,
  }).points.total;
}

const tour: AgentState = {
  idea: TOUR_IDEA,
  city: 'Tokyo',
  age: '18–25',
  priceLevel: 3,
  scarcity: 'limited',
  refs: TOUR_REFERENCES.map((entity) => entity.name),
};

describe('agent plan', () => {
  it('keeps only engine jumps of at least 4 on the Tokyo tour', async () => {
    const plan = await planAgentRounds(
      { state: tour, places: ['Shimokitazawa', 'Koenji', 'Shibuya'] },
      scorer,
    );
    assert.equal(plan.before, 52);
    assert.ok(plan.rounds.length >= 2);
    assert.ok(plan.after > plan.before);
    let previous = plan.before;
    for (const round of plan.rounds) {
      assert.ok(round.delta >= 4, round.title);
      assert.equal(round.score, previous + round.delta);
      previous = round.score;
    }
    assert.equal(plan.rounds[0]?.kind, 'concept');
    assert.equal(plan.rounds.some((round) => round.kind === 'name'), false);
    assert.equal(plan.rounds.some((round) => round.kind === 'place'), false);
    assert.match(plan.stop, /at least 4 points/);
    assert.doesNotMatch(plan.stop, /move the score in a useful way/);
    assert.doesNotMatch(plan.action, /Round \d/);
    assert.doesNotMatch(plan.action, /Qloo calls/);
    assert.match(plan.action, /Night Bus/);
    assert.equal(plan.week.length, 7);
  });

  it('keeps a coffee concept only after the engine score rises, and skips a flat neighborhood', async () => {
    const plan = await planAgentRounds(
      {
        state: {
          idea: COFFEE_IDEA,
          city: 'Bangkok',
          age: '18–25',
          priceLevel: 3,
          scarcity: 'limited',
          refs: COFFEE_REFERENCES.map((entity) => entity.name),
        },
        places: ['Thonglor'],
      },
      scorer,
    );
    assert.ok(plan.after > plan.before);
    assert.equal(plan.rounds[0]?.kind, 'price');
    assert.equal(plan.rounds.some((round) => round.kind === 'place'), false);
    assert.match(plan.stop, /Thonglor/);
    for (const round of plan.rounds) assert.ok(round.delta >= 4);
  });
});

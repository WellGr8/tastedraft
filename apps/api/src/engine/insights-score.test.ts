import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ScoreLedgerSchema } from '@tastedraft/contracts';
import { DEFAULT_BRIEF, deriveSubs, ledgerPoints, provideEvidence } from './index.ts';
import { scoreInsightMeasurements, type MeasuredGroup } from './insights-score.ts';

const source = 'mock:/v2/insights';

function rows(affinities: Array<number | null>, label?: string): MeasuredGroup {
  return {
    label,
    rows: affinities.map((affinity, index) => ({
      affinity,
      contributions: affinity == null ? [] : [{ input: `input-${index}`, weight: 0.5, target: `target-${index}` }],
      evidenceRefs: [`target-${index}`],
    })),
  };
}

describe('insight ledger', () => {
  test('the calibrated sample path still scores 71 then 82', () => {
    const v1 = ledgerPoints(deriveSubs(provideEvidence(DEFAULT_BRIEF)));
    const v2 = ledgerPoints(deriveSubs(provideEvidence({ ...DEFAULT_BRIEF, applied: true })));
    assert.equal(v1.total, 71);
    assert.equal(v2.total, 82);
  });

  test('maps measured affinities with the existing weights', () => {
    const scored = scoreInsightMeasurements({
      anchor: { source, groups: [rows([0.75])] },
      cross: { source, groups: [rows([0.5], 'a'), rows([0.5], 'b'), rows([0.5], 'c')] },
      local: { source, groups: [rows([0.5])] },
      audience: { source, groups: [rows([0.25])] },
      activeRefCount: 4,
    });
    assert.deepEqual(scored.subscores, { anchor: 75, cross: 50, local: 50, audience: 25, friction: 50 });
    assert.deepEqual(
      Object.fromEntries(scored.ledger.rows.map((row) => [row.id, row.points])),
      { anchor: 23, cross: 13, local: 10, audience: 6, friction: -20 },
    );
    assert.equal(scored.ledger.total, 32);
    assert.equal(scored.evidenceStrength, 'HIGH');
    assert.deepEqual(scored.gaps, []);
    assert.equal(ScoreLedgerSchema.safeParse(scored.ledger).success, true);
    assert.match(scored.ledger.rows[0]?.provenance.detail ?? '', /input-0 0\.50 → target-0/);
  });

  test('an unmeasured affinity is a null gap and LIMITED, never a sample fallback', () => {
    const scored = scoreInsightMeasurements({
      anchor: { source, groups: [rows([null])] },
      cross: { source, groups: [] },
      local: { source, groups: [] },
      audience: { source, groups: [rows([0.5])] },
      activeRefCount: 4,
    });
    assert.equal(scored.subscores.anchor, null);
    assert.equal(scored.subscores.audience, 50);
    assert.equal(scored.subscores.friction, null);
    assert.equal(scored.ledger.total, 13);
    assert.equal(scored.evidenceStrength, 'LIMITED');
    assert.deepEqual(scored.gaps, ['anchor', 'cross', 'local', 'friction']);
    assert.equal(scored.ledger.rows.find((row) => row.id === 'anchor')?.points, null);
    assert.equal(scored.subscores.anchor === 42, false);
    assert.equal(scored.subscores.cross === 36, false);
  });
});

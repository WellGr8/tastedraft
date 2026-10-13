import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { QlooEnvelope, QlooInsightsParams, QlooResult } from '../providers/qloo/client.ts';
import { ENCOURAGE_LOCAL, ENCOURAGE_TOTAL, LAUNCH_CASES, launchVerdict, verdictMatched } from './cases.ts';
import { assertDerivedFixture, probeLaunch, type LaunchProbeClient } from './probe.ts';

function ok(body: unknown): QlooResult {
  return { ok: true, status: 200, mode: 'mock', url: '/mock', cached: false, body: body as QlooEnvelope };
}

function entity(id: string, name: string, type: string, affinity?: number): Record<string, unknown> {
  const row: Record<string, unknown> = { name, types: [type] };
  row.entity_id = id;
  if (affinity != null) row.query = { affinity };
  return row;
}

function standIn(options: { affinity: number; audience: number; places?: boolean }): LaunchProbeClient {
  return {
    async search() {
      return ok({
        success: true,
        results: { entities: [entity('subject-1', 'Billie Eilish', 'urn:entity:artist')] },
      });
    },
    async insights(params: QlooInsightsParams) {
      const type = String(params.filter?.type ?? '');
      if (type === 'urn:heatmap') {
        return ok({
          success: true,
          results: { heatmap: [{ location: { lat: 35.68, lng: 139.7 }, affinity: 0.55 }] },
        });
      }
      if (type === 'urn:demographics') {
        return ok({
          success: true,
          results: { demographics: [{ query: { age: { '24_and_younger': options.audience } } }] },
        });
      }
      const anchorId = params.filter?.results && typeof params.filter.results === 'object'
        ? (params.filter.results as { entities?: string }).entities
        : undefined;
      if (type === 'urn:entity:place' && options.places === false) {
        return ok({ success: true, results: { entities: [] } });
      }
      const id = anchorId ?? 'row-1';
      const count = type === 'urn:entity:place' ? 3 : 2;
      return ok({
        success: true,
        results: {
          entities: Array.from({ length: count }, (_, index) => entity(
            index === 0 ? id : `row-${index}`,
            `Row ${index}`,
            type.startsWith('urn:') ? type : 'urn:entity',
            options.affinity,
          )),
        },
      });
    },
  };
}

const soldOut = LAUNCH_CASES[0]!;
const left = LAUNCH_CASES.find((row) => row.outcome === 'left')!;

describe('launch verdict', () => {
  it('encourages only when both locked gates clear', () => {
    assert.equal(ENCOURAGE_TOTAL, 55);
    assert.equal(ENCOURAGE_LOCAL, 50);
    assert.equal(launchVerdict(55, 50), 'encourage');
    assert.equal(launchVerdict(54, 80), 'caution');
    assert.equal(launchVerdict(80, 49), 'caution');
    assert.equal(launchVerdict(null, 80), 'caution');
    assert.equal(verdictMatched('encourage', 'sold_out'), true);
    assert.equal(verdictMatched('caution', 'left'), true);
    assert.equal(verdictMatched('encourage', 'left'), false);
    assert.equal(verdictMatched('caution', 'sold_out'), false);
  });
});

describe('probeLaunch', () => {
  it('scores a fully measured brief as encourage and keeps the fixture derived', async () => {
    const study = await probeLaunch(standIn({ affinity: 0.9, audience: 0.9 }), soldOut);
    assert.equal(study.engine.verdict, 'encourage');
    assert.equal(study.engine.local != null && study.engine.local >= 50, true);
    assert.equal(study.matched, true);
    assert.equal(study.subject.resolvedName, 'Billie Eilish');
    assert.equal(study.derived.heatmapInCity, 1);
    assert.equal(study.derived.audienceSkew, 0.9);
    assert.equal(study.derived.qlooCalls, 7);
    assert.equal(study.engine.evidenceStrength, 'LIMITED');
    const text = JSON.stringify(study);
    assertDerivedFixture(text);
    assert.equal(text.includes('subject-1'), false);
  });

  it('cautions when local fit is missing, and that matches a later exit', async () => {
    const study = await probeLaunch(standIn({ affinity: 0.9, audience: 0.9, places: false }), left);
    assert.equal(study.engine.local, null);
    assert.equal(study.engine.verdict, 'caution');
    assert.equal(study.engine.gaps.includes('local'), true);
    assert.equal(study.matched, true);
  });

  it('cautions a sold-out show when place affinity stays under the local gate', async () => {
    const study = await probeLaunch(standIn({ affinity: 0.2, audience: 0.9 }), soldOut);
    assert.equal(study.engine.verdict, 'caution');
    assert.equal(study.matched, false);
  });

  it('records a failed search as a status label and does not invent a score', async () => {
    const client: LaunchProbeClient = {
      async search() {
        return { ok: false, status: 403, mode: 'live', url: '/search', timedOut: false, message: 'secret body' };
      },
      async insights() {
        throw new Error('insights should not run');
      },
    };
    const study = await probeLaunch(client, soldOut);
    assert.equal(study.engine.total, null);
    assert.equal(study.engine.verdict, 'caution');
    assert.deepEqual(study.derived.failures, ['search:403']);
    assert.equal(JSON.stringify(study).includes('secret'), false);
  });

  it('refuses a fixture that carries a raw field or a key', () => {
    const clean = JSON.stringify({ total: 1 });
    assert.doesNotThrow(() => assertDerivedFixture(clean));
    assert.throws(() => assertDerivedFixture('{"entity_id":"x"}'), /raw Qloo/);
    assert.throws(() => assertDerivedFixture('hack_secret'), /raw Qloo/);
    assert.throws(() => assertDerivedFixture('{"results":[]}'), /raw Qloo/);
  });
});

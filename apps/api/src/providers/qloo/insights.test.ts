import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { InsightSignalSchema, ScoreLedgerSchema, type BriefV2 } from '@tastedraft/contracts';
import { DEFAULT_IDEA } from '../../engine/index.ts';
import { QlooClient } from './client.ts';
import {
  BANGKOK_SNACK_BRIEF,
  BERLIN_SNEAKER_BRIEF,
  TOKYO_VENUE_BRIEF,
} from './insights-mock.ts';
import { buildInsightQueries, qlooAge, runInsights, targetEntityTypes } from './insights.ts';

function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (value == null) return {};
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return prefix ? { [prefix]: String(value) } : {};
  }
  if (Array.isArray(value) || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    Object.assign(out, flatten(child, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

describe('category insights', () => {
  it('maps product age bands and refuses an unknown band', () => {
    assert.equal(qlooAge('18–25'), '24_and_younger');
    assert.equal(qlooAge('26-35'), '30_to_34');
    assert.equal(qlooAge('36–45'), '35_to_44');
    assert.equal(qlooAge('46+'), '45_to_54');
    assert.equal(qlooAge('teens'), null);
  });

  it('chooses target types from the brief instead of a streetwear default', () => {
    assert.deepEqual(targetEntityTypes(BANGKOK_SNACK_BRIEF), ['urn:entity:place', 'urn:entity:brand']);
    assert.deepEqual(targetEntityTypes(TOKYO_VENUE_BRIEF), ['urn:entity:artist', 'urn:entity:place']);
    assert.deepEqual(targetEntityTypes(BERLIN_SNEAKER_BRIEF), ['urn:entity:brand', 'urn:entity:place']);
    const film: BriefV2 = {
      idea: 'A midnight film series in a reused station hall',
      interests: [{ id: 'td-mock-tag-midnight-film', name: 'midnight cinema' }],
      references: [{ id: 'td-mock-entity-platform-reel', name: 'Platform Reel', type: 'urn:entity:movie', source: 'mock' }],
      locations: [],
      city: 'Lisbon',
      age: '36–45',
      positioning: 'Independent',
      constraints: [],
    };
    assert.deepEqual(targetEntityTypes(film), ['urn:entity:movie']);
    const blank: BriefV2 = {
      idea: 'Something unspecified for a small group',
      interests: [],
      references: [],
      locations: [],
      city: 'Oslo',
      age: 'teens',
      positioning: 'Premium',
      constraints: [],
    };
    assert.deepEqual(targetEntityTypes(blank), []);
  });

  it('sends references, tags, demographics, location, anchor ids, and explainability', () => {
    const queries = buildInsightQueries(BANGKOK_SNACK_BRIEF);
    const anchor = queries.find((query) => query.role === 'anchor' && query.entityType === 'urn:entity:place');
    assert.ok(anchor);
    const flat = flatten(anchor?.params);
    assert.equal(flat['signal.interests.entities']?.includes('td-mock-entity-yaowarat-grill'), true);
    assert.equal(flat['signal.interests.tags']?.includes('td-mock-tag-night-market'), true);
    assert.equal(flat['signal.demographics.age'], '24_and_younger');
    assert.equal(flat['signal.location.query'], 'Bangkok');
    assert.equal(flat['filter.type'], 'urn:entity:place');
    assert.equal(flat['filter.results.entities'], 'td-mock-entity-yaowarat-grill');
    assert.equal(flat['feature.explainability'], 'true');
    const tokyo = buildInsightQueries(TOKYO_VENUE_BRIEF).find((query) => query.role === 'audience');
    const tokyoFlat = flatten(tokyo?.params);
    assert.equal(tokyoFlat['signal.demographics.age'], '30_to_34');
    assert.equal(tokyoFlat['signal.demographics.gender'], 'female');
    assert.equal(tokyoFlat['signal.interests.entities'], undefined);
    const local = buildInsightQueries(BERLIN_SNEAKER_BRIEF).find((query) => query.role === 'local');
    assert.equal(flatten(local?.params)['filter.price_level.max'], '2');
    assert.equal(flatten(local?.params)['filter.location.query'], 'Berlin');
  });

  it('scores three authored categories in mock mode without the streetwear sample', async () => {
    const client = new QlooClient({ apiKey: '' });
    const bangkok = await runInsights(client, BANGKOK_SNACK_BRIEF);
    const tokyo = await runInsights(client, TOKYO_VENUE_BRIEF);
    const berlin = await runInsights(client, BERLIN_SNEAKER_BRIEF);
    for (const run of [bangkok, tokyo, berlin]) {
      assert.equal(run.mode, 'mock');
      assert.equal(ScoreLedgerSchema.safeParse(run.ledger).success, true);
      assert.equal(run.signals.every((signal) => InsightSignalSchema.safeParse(signal).success), true);
      assert.equal(run.gaps.length, 0);
      assert.equal(run.evidenceStrength, 'MEDIUM');
      assert.equal(run.signals.some((signal) => signal.name === 'Velvet Circuit' || signal.name === 'Silver Lake'), false);
    }
    const names = (run: { signals: Array<{ name: string }> }) => run.signals.map((signal) => signal.name);
    assert.ok(names(bangkok).includes('Yaowarat Grill'));
    assert.ok(names(bangkok).includes('Maa Kai Yang'));
    assert.ok(names(tokyo).includes('Paper Coast'));
    assert.ok(names(tokyo).includes('Koenji Echo'));
    assert.ok(names(berlin).includes('Hof Sneaker'));
    assert.ok(names(berlin).includes('Kreuzberg Yard'));
    assert.deepEqual(bangkok.subscores, { anchor: 81, cross: 50, local: 91, audience: 70, friction: 11 });
    assert.deepEqual(tokyo.subscores, { anchor: 76, cross: 49, local: 70, audience: 72, friction: 4 });
    assert.deepEqual(berlin.subscores, { anchor: 62, cross: 37, local: 44, audience: 38, friction: 24 });
    assert.deepEqual([bangkok.ledger.total, tokyo.ledger.total, berlin.ledger.total], [69, 65, 37]);
    const anchor = bangkok.ledger.rows.find((row) => row.id === 'anchor');
    assert.match(anchor?.provenance.detail ?? '', /td-mock-tag-night-market 0\.62/);
    assert.ok(anchor?.provenance.evidenceRefs.includes('td-mock-tag-night-market'));
    const moved = await runInsights(client, { ...BANGKOK_SNACK_BRIEF, positioning: 'Luxury' });
    assert.equal(moved.ledger.total, bangkok.ledger.total);
  });

  it('does not invent the calibrated 71 for a Los Angeles streetwear brief', async () => {
    const client = new QlooClient({ apiKey: '' });
    const run = await runInsights(client, {
      idea: DEFAULT_IDEA,
      interests: [{ id: 'td-mock-tag-streetwear', name: 'streetwear', type: 'urn:tag:td-mock' }],
      references: [
        { id: 'ref-cdg', name: 'Comme des Garçons', type: 'urn:entity:brand', source: 'mock' },
        { id: 'ref-muji', name: 'Muji', type: 'urn:entity:brand', source: 'mock' },
        { id: 'ref-aphex', name: 'Aphex Twin', type: 'urn:entity:artist', source: 'mock' },
        { id: 'ref-film', name: 'Lost in Translation', type: 'urn:entity:movie', source: 'mock' },
        { id: 'ref-silver', name: 'Silver Lake', type: 'urn:entity:place', source: 'mock', city: 'Los Angeles' },
      ],
      locations: [],
      city: 'Los Angeles',
      age: '18–25',
      positioning: 'Premium',
      constraints: [],
    });
    assert.equal(run.ledger.total === 71, false);
    assert.equal(run.evidenceStrength, 'LIMITED');
    assert.ok(run.gaps.includes('anchor'));
  });

  it('leaves a live empty body unmeasured', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'td-insights-'));
    const client = new QlooClient({
      apiKey: 'test-key',
      cacheDir,
      minIntervalMs: 0,
      retries: 0,
      fetchImpl: async () => new Response(JSON.stringify({ success: true, results: { entities: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    try {
      const run = await runInsights(client, BANGKOK_SNACK_BRIEF);
      assert.equal(run.mode, 'live');
      assert.equal(run.ledger.total, null);
      assert.equal(run.evidenceStrength, 'LIMITED');
      assert.deepEqual(run.gaps, ['anchor', 'cross', 'local', 'audience', 'friction']);
      assert.equal(run.signals.some((signal) => signal.name === 'Yaowarat Grill'), false);
      assert.equal(run.calls.every((call) => call.ok && new URL(call.url).searchParams.get('feature.explainability') === 'true'), true);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('reads the live explainability object', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'td-explain-'));
    const client = new QlooClient({
      apiKey: 'test-key',
      cacheDir,
      minIntervalMs: 0,
      retries: 0,
      fetchImpl: async () => new Response(JSON.stringify({
        success: true,
        results: {
          entities: [{
            entity_id: 'td-mock-entity-yaowarat-grill',
            name: 'Yaowarat Grill',
            subtype: 'urn:entity:place',
            query: {
              affinity: 0.84,
              explainability: {
                'signal.interests.entities': [{ entity_id: 'td-mock-entity-maa-kai-yang', score: 0.38 }],
              },
            },
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    try {
      const run = await runInsights(client, BANGKOK_SNACK_BRIEF);
      assert.ok(run.explainability.some((row) => (
        row.input === 'td-mock-entity-maa-kai-yang'
        && row.weight === 0.38
        && row.target === 'td-mock-entity-yaowarat-grill'
      )));
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('omits demographics when the age band is unknown and marks audience LIMITED', async () => {
    const client = new QlooClient({ apiKey: '' });
    const run = await runInsights(client, { ...BANGKOK_SNACK_BRIEF, age: 'teens', gender: undefined });
    assert.equal(run.queries.some((query) => query.role === 'audience'), false);
    assert.equal(run.queries.some((query) => flatten(query.params)['signal.demographics.age']), false);
    assert.equal(run.subscores.audience, null);
    assert.equal(run.subscores.friction, null);
    assert.equal(run.evidenceStrength, 'LIMITED');
  });
});

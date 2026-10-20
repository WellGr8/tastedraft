import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { QlooClient } from '../providers/qloo/client.ts';
import { QlooGateway } from '../runner/gateway.ts';
import type { LlmClient } from '../llm/client.ts';
import { classifyReason, nameInText, spread } from './metrics.ts';
import { buildRecordedBenchmark, readPublishedStudies } from './recorded.ts';
import { runLiveBenchmark } from './live.ts';
import { assertPublicBenchmark } from './publish.ts';

describe('benchmark metrics', () => {
  it('counts a reason only when the sentence names a verified entity', () => {
    const hit = classifyReason({
      message: 'I would pass because Billie Eilish is the taste I already keep.',
      claims: ['Billie Eilish'],
      verified: ['Billie Eilish'],
    });
    assert.deepEqual(hit.verified, ['Billie Eilish']);
    assert.equal(hit.unverifiable.length, 0);

    const miss = classifyReason({
      message: 'I would pass because Aphex Twin and Boards of Canada are the taste I already keep.',
      claims: ['Aphex Twin', 'Boards of Canada'],
      verified: ['Billie Eilish'],
    });
    assert.deepEqual(miss.verified, []);
    assert.deepEqual(miss.unverifiable, ['Aphex Twin', 'Boards of Canada']);

    const invented = classifyReason({
      message: 'I would go because of Radiohead.',
      claims: ['Radiohead'],
      verified: [],
      searched: new Map([['radiohead', 'miss']]),
    });
    assert.deepEqual(invented.hallucinated, ['Radiohead']);
    assert.equal(invented.unverifiable.length, 0);
    assert.equal(nameInText('Radiohead', 'I would go because of Radiohead.'), true);
  });

  it('spreads measured scores and stays empty below two points', () => {
    const row = spread([45, 55, 44, 42]);
    assert.equal(row?.min, 42);
    assert.equal(row?.max, 55);
    assert.equal(row?.range, 13);
    assert.equal(row?.n, 4);
    assert.equal(spread([45]), null);
  });
});

describe('recorded benchmark', () => {
  it('labels the offline run and does not copy the old absolute totals', async () => {
    const studies = readPublishedStudies();
    const file = await buildRecordedBenchmark({ studies, now: '2026-10-14T00:00:00.000Z' });
    assert.equal(file.source, 'recorded');
    assert.equal(file.live, false);
    assert.equal(file.model, null);
    assert.equal(file.qlooCalls, 0);
    assert.equal(file.items.length, 9);
    assert.equal(file.headline.outcomeWithQloo, null);
    assert.equal(file.headline.outcomeWithoutQloo, null);
    assert.equal(file.headline.withQloo, '16 of 36');
    assert.equal(file.headline.withoutQloo, '0 of 36');
    assert.equal(file.agreement.qlooLedger.matched, 0);
    assert.equal(file.agreement.qlooLedger.total, 0);
    assert.equal(file.totals.qloo.hallucinatedMentions, null);
    assert.equal(file.totals.llm.unverifiableMentions, 0);
    assert.equal(file.totals.qloo.unverifiableNames.length, 10);
    assert.equal(file.scoreSpread.qlooCaseStudies, null);
    assert.equal(file.scoreSpread.qlooExamples, null);
    assert.ok(file.sampleEngine);
    assert.equal(file.sampleEngine.cities.length, 5);
    const tokyo = file.items.find((item) => item.id === 'billie-eilish-tokyo-2022');
    assert.ok(tokyo);
    assert.equal(tokyo.qloo.matched, null);
    assert.equal(tokyo.qloo.ledgerScore, null);
    assert.ok(tokyo.qloo.reasons[0]?.reason.includes('Billie Eilish'));
    assert.deepEqual(tokyo.qloo.reasons[0]?.verified, ['Billie Eilish']);
    const tour = file.items.find((item) => item.id === 'tokyo-tour');
    assert.ok(tour);
    assert.equal(tour.qloo.verifiedReasons, 0);
    assert.ok(tour.qloo.unverifiableNames.includes('Aphex Twin'));
    assert.match(tour.llm.reasons[0]?.reason ?? '', /Nothing here is tied/);
    const text = JSON.stringify(file);
    assertPublicBenchmark(text);
    assert.doesNotMatch(text, /entity_id|hack_|sk-or-v1-/);
  });

  it('matches the committed public file except the timestamp is whatever the script wrote', () => {
    const path = fileURLToPath(new URL('../../../../apps/web/public/benchmark.json', import.meta.url));
    const disk = JSON.parse(readFileSync(path, 'utf8')) as { generatedAt?: string; source?: string };
    assert.equal(disk.source, 'recorded');
    assert.equal(typeof disk.generatedAt, 'string');
  });
});

describe('live benchmark harness', () => {
  it('verifies Qloo names and marks a searched miss as hallucinated', async () => {
    const calls: string[] = [];
    const client = {
      mode: 'live' as const,
      async search(params: { query: string }) {
        calls.push(`search:${params.query}`);
        const name = params.query === 'Aphex Twin' ? 'Aphex Twin' : params.query === 'Boards of Canada' ? 'Boards of Canada' : '';
        return {
          ok: true as const,
          status: 200,
          mode: 'live' as const,
          url: '/search',
          cached: false,
          body: {
            success: true,
            results: {
              entities: name
                ? [{ entity_id: '11111111-1111-1111-1111-111111111111', name, subtype: 'urn:entity:artist', query: { affinity: 0.8 } }]
                : [],
            },
          },
        };
      },
      async insights() {
        calls.push('insights');
        return {
          ok: true as const,
          status: 200,
          mode: 'live' as const,
          url: '/v2/insights',
          cached: false,
          body: {
            success: true,
            results: {
              entities: [{
                entity_id: '22222222-2222-2222-2222-222222222222',
                name: 'Boards of Canada',
                subtype: 'urn:entity:artist',
                query: { affinity: 0.74 },
              }],
            },
          },
        };
      },
      async tags() {
        throw new Error('unused');
      },
    };
    const gateway = new QlooGateway(client as unknown as QlooClient, { budget: 40, sleep: async () => {}, attempts: 1 });
    const llm: LlmClient = {
      mode: 'live',
      provider: 'openrouter',
      async complete(messages) {
        const system = messages[0]?.content ?? '';
        if (system.includes('no taste graph')) {
          return JSON.stringify({
            message: 'I would go because of Radiohead.',
            entities: ['Radiohead'],
            fit: 61,
            verdict: 'encourage',
          });
        }
        return JSON.stringify({ message: 'I would go because of Boards of Canada.', citationIds: ['a1'] });
      },
    };
    const file = await runLiveBenchmark({
      gateway,
      llm,
      now: '2026-10-14T00:00:00.000Z',
      model: 'google/gemini-2.5-flash-lite',
      studies: [{
        id: 'billie-eilish-tokyo-2022',
        title: 'Billie Eilish, first solo Japan show',
        market: 'Tokyo',
        outcome: 'sold_out',
        prelaunch: 'Before the announcement the record was already out.',
        subject: { query: 'Billie Eilish', resolvedName: 'Billie Eilish', resolvedType: 'urn:entity:artist' },
        inputs: { ageBucket: '24_and_younger', priceLevel: 3, city: 'Tokyo' },
        engine: { total: 45, local: 87, audience: 46, verdict: 'caution' },
        matched: false,
      }],
    });
    assert.equal(file.source, 'live');
    assert.equal(file.model, 'google/gemini-2.5-flash-lite');
    assert.equal(file.agreement.qlooLedger.matched, 0);
    assert.equal(file.agreement.qlooLedger.total, 1);
    const tour = file.items.find((item) => item.id === 'tokyo-tour');
    assert.ok(tour);
    assert.ok(tour.qloo.reasons.every((reason) => reason.verified.includes('Boards of Canada')));
    assert.equal(tour.qloo.reasons[0]?.score, 74);
    assert.ok(tour.llm.reasons.some((reason) => reason.hallucinated.includes('Radiohead')));
    assert.ok(calls.some((call) => call === 'search:Radiohead'));
    const text = JSON.stringify(file);
    assertPublicBenchmark(text);
    assert.equal(text.includes('11111111-1111-1111-1111-111111111111'), false);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ProposalSchema, type InsightSignal } from '@tastedraft/contracts';
import { createApp } from '../app.ts';
import { deriveSubs, ledgerPoints, provideEvidence } from '../engine/index.ts';
import { findNovelNumbers, findScoreIssue } from '../llm/scores.ts';
import type { LlmClient } from '../llm/client.ts';
import { openRepository } from '../persistence/sqlite-repository.ts';
import { clearRuns } from './http.ts';
import { approve, buildDemo, runAgent } from './loop.ts';
import { applyDiffsToEngine, defaultBriefV2, engineBriefFromV2, provenanceDetail, scoreEngine } from './model.ts';

const offline = {
  client: {
    mode: 'offline' as const,
    async complete(): Promise<string> {
      throw new Error('offline');
    },
  },
};

function engineTotal(brief: ReturnType<typeof engineBriefFromV2>): number {
  return ledgerPoints(deriveSubs(provideEvidence(brief))).total;
}

describe('taste agent', () => {
  test('the default brief is still the calibrated 71 before any diff', () => {
    assert.equal(scoreEngine(engineBriefFromV2(defaultBriefV2())).total, 71);
  });

  test('proposes varied Qloo diffs, simulates them, and presents the top three', async () => {
    const run = await runAgent({ brief: defaultBriefV2() }, offline);
    assert.equal(run.status, 'awaiting_approval');
    assert.equal(run.baselineTotal, 71);
    const kinds = new Set(run.considered.map((candidate) => candidate.changes[0]?.param));
    for (const param of [
      'filter.price_level.max',
      'signal.interests.tags',
      'signal.demographics.age',
      'filter.location.query',
      'filter.tags',
      'signal.interests.entities',
    ]) {
      assert.ok(kinds.has(param), `missing ${param}`);
    }
    assert.deepEqual(
      run.proposals.map((proposal) => [proposal.id, proposal.predictedDelta]),
      [
        ['price-level', 9],
        ['positioning', 5],
        ['audience-age', 3],
      ],
    );
    const location = run.considered.find((candidate) => candidate.id === 'location');
    assert.equal(location?.changes[0]?.to, 'East Austin');
    assert.equal(location?.predictedDelta, 1);
    const swap = run.considered.find((candidate) => candidate.id === 'references-swap');
    assert.match(String(swap?.changes[0]?.from), /muji/);
    assert.doesNotMatch(String(swap?.changes[0]?.to), /muji/);
    assert.equal(swap?.predictedDelta, 2);

    for (const candidate of run.considered) {
      const next = engineTotal(applyDiffsToEngine(run.brief, candidate.changes));
      assert.equal(candidate.predictedDelta, next - run.baselineTotal, candidate.id);
      assert.equal(candidate.total, next, candidate.id);
    }
    for (const proposal of run.proposals) {
      assert.equal(ProposalSchema.safeParse(proposal).success, true);
      assert.equal(findScoreIssue({ why: proposal.why }), null);
      assert.equal(findNovelNumbers({ why: proposal.why }, new Set()), null);
      assert.ok(proposal.evidenceRefs.length >= 1);
    }
    assert.equal(
      run.proposals[0]?.why,
      'The price evidence conflicts with this audience, so the Qloo price filter should move to the level that evidence can support.',
    );
  });

  test('approval re-runs the engine and refuses a candidate that was not presented', async () => {
    const run = await runAgent({ brief: defaultBriefV2() }, offline);
    const approved = approve(run, 'price-level');
    assert.equal(approved.total, 80);
    assert.equal(approved.delta, 9);
    assert.equal(approved.delta, approved.proposal.predictedDelta);
    assert.equal(approved.brief.priceLevel, 2);
    assert.equal(approved.brief.positioning, 'Premium');
    assert.equal(approved.brief.city, 'Los Angeles');
    assert.throws(() => approve(run, 'location'), /shortlist/);
  });

  test('a gender signal becomes a gender diff and does not invent a lift', async () => {
    const signal: InsightSignal = {
      id: 'aud-women',
      name: 'Women in independent fashion',
      type: 'audience',
      affinity: 0.42,
      source: 'qloo',
      params: { 'signal.demographics.gender': 'female' },
    };
    const run = await runAgent({ brief: { ...defaultBriefV2(), gender: 'male' }, signals: [signal] }, offline);
    const gender = run.considered.find((candidate) => candidate.id === 'audience-gender');
    assert.ok(gender);
    assert.equal(gender?.changes[0]?.param, 'signal.demographics.gender');
    assert.equal(gender?.changes[0]?.from, 'male');
    assert.equal(gender?.changes[0]?.to, 'female');
    assert.equal(gender?.predictedDelta, 0);
    assert.equal(gender?.evidenceRefs.includes('aud-women'), true);
    assert.equal(run.proposals.some((proposal) => proposal.id === 'audience-gender'), false);
  });

  test('a missing artist is an add on the entity signal', async () => {
    const brief = defaultBriefV2();
    brief.references = brief.references.filter((reference) => reference.id !== 'aphex-twin');
    const run = await runAgent({ brief }, offline);
    const added = run.considered.find((candidate) => candidate.id === 'references-add');
    assert.ok(added);
    assert.equal(added?.changes[0]?.param, 'signal.interests.entities');
    assert.match(String(added?.changes[0]?.to), /aphex-twin/);
    const next = engineTotal(applyDiffsToEngine(brief, added!.changes));
    assert.equal(added?.predictedDelta, next - run.baselineTotal);
  });

  test('the model writes only the why, and a scored why is discarded', async () => {
    let user = '';
    const live: LlmClient = {
      mode: 'live',
      async complete(messages) {
        user = messages.find((message) => message.role === 'user')?.content ?? '';
        const param = (JSON.parse(user) as { changes: Array<{ param: string }> }).changes[0]?.param ?? '';
        return JSON.stringify({ why: `The cited evidence supports changing ${param}.` });
      },
    };
    const run = await runAgent({ brief: defaultBriefV2() }, { client: live });
    assert.match(run.proposals[0]?.why ?? '', /filter\.price_level\.max/);
    assert.doesNotMatch(user, /predictedDelta|"total"|affinity/);
    const scored: LlmClient = {
      mode: 'live',
      async complete() {
        return JSON.stringify({ why: 'This lifts the score by 40 points' });
      },
    };
    const fallen = await runAgent({ brief: defaultBriefV2() }, { client: scored });
    assert.equal(fallen.proposals[0]?.why.includes('40'), false);
    assert.match(fallen.proposals[0]?.why ?? '', /price evidence conflicts/);
  });

  test('provenance names the Qloo input and the demo snapshot matches the engine', async () => {
    assert.equal(
      provenanceDetail('Comme des Garçons', '0.94'),
      'from Qloo explainability: input Comme des Garçons contributed 0.94',
    );
    const demo = await buildDemo(offline);
    assert.equal(demo.v1.total, 71);
    assert.equal(demo.v2.total, 80);
    assert.equal(demo.v2.delta, 9);
    assert.equal(demo.approved.id, 'price-level');
    assert.equal(demo.shortlist.length, 3);
    assert.equal(demo.captions.length, 6);
    const anchor = demo.v1.rows.find((row) => row.id === 'anchor');
    assert.equal(anchor?.points, 24);
    assert.equal(anchor?.provenance, 'from Qloo explainability: input Comme des Garçons contributed 0.94');
    for (const row of [...demo.v1.rows, ...demo.v2.rows]) {
      assert.match(row.provenance, /^from Qloo explainability: input .+ contributed \d+\.\d{2}$/);
    }
    const price = demo.diff.find((row) => row.label === 'Price level');
    assert.deepEqual(price, { label: 'Price level', before: '3', after: '2', changed: true });
    assert.equal(demo.diff.filter((row) => row.changed).map((row) => row.label).join(','), 'Price level');
    const saved = JSON.parse(readFileSync(fileURLToPath(new URL('../../../split/results-demo.json', import.meta.url)), 'utf8'));
    assert.deepEqual(saved, demo);
  });

  test('the results page is mounted on the app', async () => {
    clearRuns();
    const app = createApp({ repository: openRepository(':memory:'), env: {} });
    const page = await app.request('/results/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Demo mode/);
    const demo = await app.request('/api/agent/demo');
    assert.equal(demo.status, 200);
    const body = (await demo.json()) as { v1: { total: number }; v2: { total: number; delta: number } };
    assert.equal(body.v1.total, 71);
    assert.equal(body.v2.total, body.v1.total + body.v2.delta);
  });
});

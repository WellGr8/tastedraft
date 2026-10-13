import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { STOP_REASONS } from '@tastedraft/contracts';
import { defaultBriefV2 } from '../agent/model.ts';
import { evidenceKey } from '../engine/score.ts';
import { createApp } from '../app.ts';
import { QlooClient } from '../providers/qloo/client.ts';
import { AgentRunner } from './runner.ts';
import { RunStore } from './store.ts';
import { keepCited, narrate, offlineClaim } from './narrate.ts';
import { QlooGateway } from './gateway.ts';
import { readFixtureText } from './record.ts';

const roots: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'td-run-'));
  roots.push(dir);
  return dir;
}

after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function runnerIn(dir: string, budget?: number): AgentRunner {
  return new AgentRunner({
    store: new RunStore(join(dir, 'runs.sqlite')),
    client: new QlooClient({ apiKey: '', retries: 0, minIntervalMs: 0 }),
    llm: { mode: 'offline', async complete() { throw new Error('offline'); } },
    ...(budget != null ? { budget } : {}),
  });
}

describe('narration', () => {
  it('keeps only sentences that cite an evidence id', () => {
    const text = keepCited('This adds a new city. Supported by ev:muji.', ['ev:muji']);
    assert.equal(text, 'Supported by ev:muji.');
  });

  it('uses the offline template and does not call a model', async () => {
    let called = false;
    const text = await narrate({
      hypothesis: 'Premium price pulls against this audience',
      evidenceIds: ['ev:muji'],
      llm: {
        mode: 'offline',
        async complete() {
          called = true;
          throw new Error('should not run');
        },
      },
    });
    assert.equal(called, false);
    assert.equal(text, offlineClaim('Premium price pulls against this audience', ['ev:muji']));
    assert.match(text, /ev:muji/);
    assert.match(text, /Evidence-backed hypothesis/);
  });

  it('strips an uncited live sentence', async () => {
    const text = await narrate({
      hypothesis: 'Premium price pulls against this audience',
      evidenceIds: ['ev:muji'],
      llm: {
        mode: 'live',
        async complete() {
          return 'A brand new claim without a source. ev:muji supports the price move.';
        },
      },
    });
    assert.equal(text, 'ev:muji supports the price move.');
  });
});

describe('Qloo gateway', () => {
  it('dedupes in-flight calls and counts each attempt once', async () => {
    let hits = 0;
    const client = new QlooClient({
      apiKey: 'test-key',
      retries: 0,
      minIntervalMs: 0,
      cacheDir: join(tempDir(), 'cache'),
      fetchImpl: async () => {
        hits += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return new Response(JSON.stringify({ success: true, results: { entities: [] } }), { status: 200 });
      },
    });
    const gateway = new QlooGateway(client, { budget: 10, sleep: async () => {} });
    const [a, b] = await Promise.all([
      gateway.search({ query: 'Muji', take: 1 }),
      gateway.search({ query: 'Muji', take: 1 }),
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(hits, 1);
    assert.equal(gateway.calls, 1);
  });

  it('backs off on 429 and then accepts 200', async () => {
    const waits: number[] = [];
    let hits = 0;
    const client = new QlooClient({
      apiKey: 'test-key',
      retries: 0,
      minIntervalMs: 0,
      cacheDir: join(tempDir(), 'cache'),
      fetchImpl: async () => {
        hits += 1;
        const status = hits === 1 ? 429 : 200;
        return new Response(JSON.stringify({ success: true, results: { entities: [] } }), { status });
      },
    });
    const gateway = new QlooGateway(client, {
      budget: 10,
      backoffMs: 200,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    const result = await gateway.search({ query: 'Muji', take: 1 });
    assert.equal(result.ok, true);
    assert.equal(hits, 2);
    assert.deepEqual(waits, [200]);
    assert.equal(gateway.calls, 2);
  });

  it('does not call the network once the budget is spent', async () => {
    let hits = 0;
    const client = new QlooClient({
      apiKey: 'test-key',
      retries: 0,
      minIntervalMs: 0,
      cacheDir: join(tempDir(), 'cache'),
      fetchImpl: async () => {
        hits += 1;
        return new Response(JSON.stringify({ success: true, results: { entities: [] } }), { status: 200 });
      },
    });
    const gateway = new QlooGateway(client, { budget: 0, sleep: async () => {} });
    const result = await gateway.search({ query: 'Muji', take: 1 });
    assert.equal(result.ok, false);
    assert.equal(hits, 0);
    assert.equal(gateway.calls, 0);
  });
});

describe('agent runner', () => {
  it('scores the LA brief at 71, approves the price diff to 80, and stops for a known reason', async () => {
    const agent = runnerIn(tempDir());
    const run = await agent.start(defaultBriefV2());
    assert.equal(run.score, 71);
    assert.equal(run.grounding, 'qloo');
    assert.ok(run.districts.length >= 1);
    assert.ok(run.links.some((link) => link.cells.length >= 1 && (link.entities.length > 0 || link.tags.length > 0)));
    assert.equal(run.evidenceStrength, 'HIGH');
    assert.equal(run.status, 'awaiting_approval');
    assert.ok(run.steps.some((step) => step.label === 'Build personas from Qloo'));
    for (const persona of run.personas) {
      assert.equal(persona.quoteLabel, 'Simulated persona response');
      assert.equal(run.evidence.some((row) => row.id === persona.quote || row.ref === persona.quote), false);
    }
    for (const friction of run.frictions) {
      assert.equal(friction.label, 'Potential friction inferred from cultural signals');
      assert.equal(friction.confidence, evidenceKey(friction.evidenceRefs.length));
    }
    const price = run.proposals.find((proposal) => proposal.changes.some((change) => change.param === 'filter.price_level.max' && change.to === '2'));
    assert.ok(price);
    assert.match(price.why, /Evidence-backed hypothesis/);
    assert.ok(price.evidenceRefs.every((id) => price.why.includes(id) || run.evidence.some((row) => row.id === id)));
    let next = await agent.approve(run.id, price.id);
    assert.equal(next.score, 80);
    assert.equal(next.version, 2);
    for (let turn = 0; next.status !== 'stopped' && turn < 5; turn += 1) {
      const proposal = next.proposals[0];
      assert.ok(proposal);
      next = await agent.approve(next.id, proposal.id);
    }
    assert.equal(next.status, 'stopped');
    assert.ok(next.stopReason && STOP_REASONS.includes(next.stopReason));
    assert.ok(next.steps.some((step) => step.label === 'Re-interview each persona'));
    assert.ok(next.report.includes(next.stopReason ?? ''));
  });

  it('offers the scored proposal after the budget is spent, then stops', async () => {
    const agent = runnerIn(tempDir(), 1);
    const run = await agent.start(defaultBriefV2());
    assert.equal(run.qlooCalls, 1);
    assert.equal(run.status, 'awaiting_approval');
    assert.equal(run.score, 71);
    const price = run.proposals.find((proposal) => proposal.changes.some((change) => change.param === 'filter.price_level.max'));
    assert.ok(price);
    const next = await agent.approve(run.id, price.id);
    assert.equal(next.score, 80);
    assert.equal(next.qlooCalls, 1);
    assert.equal(next.stopReason, 'max_rounds_or_budget');
  });

  it('asks when evidence is limited, and stop ends the run', async () => {
    const agent = runnerIn(tempDir());
    const brief = defaultBriefV2();
    brief.references = brief.references.slice(0, 1);
    const run = await agent.start(brief);
    assert.equal(run.status, 'awaiting_input');
    assert.equal(run.evidenceStrength, 'LIMITED');
    const stopped = await agent.command(run.id, 'stop');
    assert.equal(stopped.run.stopReason, 'insufficient_evidence');
  });

  it('replays steps after Last-Event-ID and still sends state', async () => {
    const dir = tempDir();
    const app = createApp({
      env: { QLOO_API_KEY: '', EVIDENCE_PROVIDER: 'sample' },
      runsPath: join(dir, 'runs.sqlite'),
      databasePath: join(dir, 'projects.sqlite'),
    });
    const created = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: defaultBriefV2() }),
    });
    assert.equal(created.status, 201);
    const { id } = (await created.json()) as { id: string };
    let status = 'running';
    for (let i = 0; i < 40 && status === 'running'; i += 1) {
      const polled = await app.request(`/api/runs/${id}`);
      const body = (await polled.json()) as { status: string };
      status = body.status;
      if (status === 'running') await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.notEqual(status, 'running');
    const replay = await app.request(`/api/runs/${id}/events`, { headers: { 'Last-Event-ID': '0' } });
    const text = await replay.text();
    const stepSeqs = [...text.matchAll(/event: step\ndata: (\{.*\})/g)].map((match) => {
      const payload = JSON.parse(match[1] ?? '{}') as { step?: { seq?: number } };
      return payload.step?.seq;
    });
    assert.ok(stepSeqs.length > 0);
    assert.ok(stepSeqs.every((seq) => (seq ?? 0) > 0));
    assert.match(text, /event: state/);
  });

  it('stops an LLM-only pass at the evidence gate with no score', async () => {
    const agent = runnerIn(tempDir());
    const run = await agent.start(defaultBriefV2(), { grounding: 'llm-only' });
    assert.equal(run.grounding, 'llm-only');
    assert.equal(run.qlooCalls, 0);
    assert.equal(run.score, null);
    assert.equal(run.evidence.length, 0);
    assert.equal(run.districts.length, 0);
    assert.equal(run.proposals.length, 0);
    assert.equal(run.evidenceStrength, 'LIMITED');
    assert.equal(run.stopReason, 'insufficient_evidence');
    assert.match(run.report, /No Qloo evidence/);
    assert.ok(run.personas.every((persona) => persona.quoteLabel === 'Simulated persona response'));
  });

  it('plays back a derived recording when live Qloo calls fail', async () => {
    const fixture = readFixtureText();
    assert.equal(/affinity|hack_|\"results\"|\"image\"/.test(fixture), false);
    const dir = tempDir();
    const client = new QlooClient({
      apiKey: 'test-key',
      retries: 0,
      minIntervalMs: 0,
      cacheDir: join(dir, 'cache'),
      fetchImpl: async () => new Response(JSON.stringify({ success: false }), { status: 400, headers: { 'content-type': 'application/json' } }),
    });
    const agent = new AgentRunner({
      store: new RunStore(join(dir, 'runs.sqlite')),
      client,
      recordingsDir: join(dir, 'recordings'),
      llm: { mode: 'offline', async complete() { throw new Error('offline'); } },
    });
    const run = await agent.start(defaultBriefV2());
    assert.equal(run.grounding, 'recorded');
    assert.match(run.report, /Recorded run/);
    assert.ok(run.districts.some((cell) => cell.label === '35.66, 139.70'));
    assert.ok(run.evidence.some((row) => row.source === 'recorded' && row.kind === 'tag'));
    assert.equal(run.score, 71);
    const recordings = join(dir, 'recordings');
    assert.equal(existsSync(recordings) && readdirSync(recordings).length > 0, false);
  });
});

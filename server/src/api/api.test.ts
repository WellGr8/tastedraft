import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Hono } from 'hono';
import type { EvidenceProvider } from '../domain/evidence-provider.ts';
import type { LlmClient } from '../domain/llm.ts';
import { DEFAULT_BRIEF, provideEvidence } from '../engine/index.ts';
import { createStubLlm } from '../orchestrator/stubs/stub-llm.ts';
import { openRepository } from '../persistence/sqlite-repository.ts';
import { createApp } from '../app.ts';

interface SimulationBody {
  id: string;
  projectId: string;
  conceptVersionId: string;
  versionNumber: number;
  evidenceSnapshotId: string | null;
  status: string;
  provider: string | null;
  score: number | null;
  displayScore: { text: string; why: string; limited: boolean; approx: number } | null;
  ledger: { anchor: number; cross: number; local: number; audience: number; friction: number } | null;
  evidenceStrength: string | null;
  signals: Array<{ domain: string; name: string; level: string; feeds: string; sources: unknown[] }>;
  districts: { min: string[]; lux: string[] };
  fits: Array<{ text: string; isNew?: boolean }>;
  frictions: Array<{ text: string; why: string }>;
  proposals: Array<{
    id: string;
    before: string;
    after: string;
    why: string;
    evidence: string;
    status: string;
    predictedDelta: number | null;
    param: string | null;
    change: { kind: string; posture?: string; scarcity?: string };
  }>;
  story: { mode: string; captions: string[] } | null;
  error: string | null;
}

interface VersionBody {
  id: string;
  number: number;
  parentId: string | null;
  origin: string;
  brief: {
    idea: string;
    age: string;
    city: string;
    pos: string;
    refs: string[];
    muted?: string[];
    posture?: string;
    scarcity?: string;
  };
}

function app() {
  return createApp({ repository: openRepository(':memory:') });
}

async function send(app: Hono, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

describe('HTTP API', () => {
  test('default brief scores 71 and the agent price diff scores 80 without overwriting V1', async () => {
    const api = app();
    const created = await send(api, 'POST', '/api/projects', {});
    assert.equal(created.status, 201);
    const project = created.json as { id: string; version: VersionBody };
    assert.equal(project.version.number, 1);
    assert.equal(project.version.origin, 'initial');
    assert.equal(project.version.brief.idea, DEFAULT_BRIEF.idea);
    assert.deepEqual(project.version.brief.refs, DEFAULT_BRIEF.refs);

    const first = await send(api, 'POST', '/api/simulations', { projectId: project.id });
    assert.equal(first.status, 201);
    const v1 = first.json as unknown as SimulationBody;
    assertSimulationContract(v1);
    assert.equal(v1.status, 'complete');
    assert.equal(v1.score, 71);
    assert.equal(v1.versionNumber, 1);
    assert.equal(v1.provider, 'sample');
    assert.equal(v1.evidenceStrength, 'HIGH');
    assert.deepEqual(v1.ledger, { anchor: 24, cross: 20, local: 15, audience: 17, friction: -5 });
    assert.equal(ledgerSum(v1), 71);
    assert.equal(v1.displayScore?.text, '71');
    assert.equal(v1.displayScore?.why, 'Why 71?');
    assert.deepEqual(v1.districts, { min: ['Silver Lake', 'Echo Park'], lux: ['Beverly Hills', 'West Hollywood'] });
    assert.equal(v1.signals.length, 4);
    assert.equal(v1.signals[0]?.domain, 'Fashion');
    assert.equal(v1.signals[0]?.level, 'Strong');
    assert.equal(v1.signals[0]?.feeds, 'Anchor affinity');
    assert.ok((v1.signals[0]?.sources.length ?? 0) >= 2);
    assert.equal(v1.signals[3]?.domain, 'Location');
    assert.equal(v1.signals[3]?.level, 'Moderate');
    assert.equal(v1.signals[3]?.feeds, 'Local fit');
    assert.ok(v1.frictions.some((friction) => /price/i.test(friction.text)));
    assert.equal(v1.proposals.length, 3);
    assert.equal(v1.proposals[0]?.change.kind, 'qloo');
    assert.equal(v1.proposals[0]?.param, 'filter.price_level.max');
    assert.deepEqual(
      v1.proposals.map((proposal) => proposal.predictedDelta),
      [9, 5, 3],
    );
    assert.equal(v1.proposals.some((proposal) => proposal.after === 'Accessible premium'), false);
    assert.equal(v1.story?.mode, 'sample');
    assert.equal(v1.story?.captions.at(-1)?.includes('80'), true);
    assert.ok(v1.evidenceSnapshotId);

    const same = await send(api, 'PATCH', `/api/projects/${project.id}/brief`, { city: 'Los Angeles' });
    assert.equal(same.status, 200);
    assert.deepEqual((same.json as { staleSimulationIds: string[] }).staleSimulationIds, []);
    assert.equal((same.json as { score?: number }).score, undefined);

    const applied = await send(api, 'POST', `/api/recommendations/${v1.proposals[0]!.id}/apply`);
    assert.equal(applied.status, 201);
    const step = applied.json as { version: VersionBody; simulation: SimulationBody };
    assert.equal(step.version.number, 2);
    assert.equal(step.version.origin, 'recommendation_applied');
    assert.equal(step.version.parentId, project.version.id);
    assert.equal(step.version.brief.posture, 'accessible');
    assert.equal(step.version.brief.scarcity, undefined);
    assert.equal(step.simulation.score, 80);
    assert.notEqual(step.simulation.id, v1.id);
    assert.equal(step.simulation.conceptVersionId, step.version.id);
    const vFinal = step.simulation;
    const finalVersion = step.version;
    assert.equal(vFinal.status, 'complete');
    assert.equal(ledgerSum(vFinal), 80);
    assert.equal(finalVersion.number, 2);
    assert.equal(finalVersion.parentId, project.version.id);

    const versions = await send(api, 'GET', `/api/projects/${project.id}/versions`);
    const listed = versions.json as { currentVersionId: string; versions: VersionBody[] };
    assert.equal(listed.versions.length, 2);
    assert.equal(listed.currentVersionId, finalVersion.id);
    const original = listed.versions[0]!;
    assert.equal(original.number, 1);
    assert.equal(original.id, project.version.id);
    assert.equal(original.brief.city, 'Los Angeles');
    assert.equal(original.brief.pos, 'Premium');
    assert.equal(original.brief.posture, undefined);
    assert.equal(original.brief.scarcity, undefined);
    assert.deepEqual(original.brief.refs, DEFAULT_BRIEF.refs);

    const stillV1 = await send(api, 'GET', `/api/simulations/${v1.id}`);
    const stored = stillV1.json as unknown as SimulationBody;
    assert.equal(stored.status, 'complete');
    assert.equal(stored.score, 71);
    assert.equal(stored.conceptVersionId, original.id);
  });

  test('brief edits mark results stale, and a failed rerun does not reuse the old score', async () => {
    const repo = openRepository(':memory:');
    let calls = 0;
    const provider: EvidenceProvider = {
      id: 'flaky',
      async getEvidence(brief) {
        calls += 1;
        if (calls > 1) throw new Error('qloo down');
        return provideEvidence(brief);
      },
    };
    const api = createApp({ repository: repo, provider });
    const created = await send(api, 'POST', '/api/projects', {});
    const projectId = (created.json as { id: string }).id;
    const first = await send(api, 'POST', '/api/simulations', { projectId });
    const v1 = first.json as unknown as SimulationBody;
    assert.equal(v1.score, 71);

    const edited = await send(api, 'PATCH', `/api/projects/${projectId}/brief`, { city: 'Miami' });
    assert.equal(edited.status, 200);
    const staleIds = (edited.json as { staleSimulationIds: string[]; version: VersionBody }).staleSimulationIds;
    assert.deepEqual(staleIds, [v1.id]);
    assert.equal((edited.json as { version: VersionBody }).version.origin, 'brief_edit');
    assert.equal((edited.json as { version: VersionBody }).version.brief.city, 'Miami');
    assert.equal((edited.json as { version: VersionBody }).version.brief.posture, undefined);
    assert.equal((edited.json as { score?: number }).score, undefined);

    const stale = (await send(api, 'GET', `/api/simulations/${v1.id}`)).json as unknown as SimulationBody;
    assert.equal(stale.status, 'stale');
    assert.equal(stale.score, 71);

    const denied = await send(api, 'POST', `/api/recommendations/${v1.proposals[0]!.id}/apply`);
    assert.equal(denied.status, 409);

    const failed = await send(api, 'POST', '/api/simulations', { projectId });
    assert.equal(failed.status, 422);
    const failure = failed.json as unknown as SimulationBody;
    assert.notEqual(failure.id, v1.id);
    assert.equal(failure.status, 'failed');
    assert.equal(failure.score, null);
    assert.equal(failure.ledger, null);
    assert.equal(failure.provider, null);
    assert.deepEqual(failure.signals, []);
    assert.deepEqual(failure.proposals, []);
    assert.equal(failure.evidenceSnapshotId, null);
    assert.match(failure.error ?? '', /qloo down/);

    const again = (await send(api, 'GET', `/api/simulations/${failure.id}`)).json as unknown as SimulationBody;
    assert.equal(again.score, null);
    assert.equal(again.status, 'failed');
    const historical = (await send(api, 'GET', `/api/simulations/${v1.id}`)).json as unknown as SimulationBody;
    assert.equal(historical.score, 71);
    assert.equal(historical.status, 'stale');
  });

  test('a critic that cites missing evidence is not the proposal source', async () => {
    const stub = createStubLlm();
    const llm: LlmClient = {
      parseBrief: (brief) => stub.parseBrief(brief),
      explain: (input) => stub.explain(input),
      async critique() {
        return {
          frictions: [],
          proposals: [
            {
              before: 'Premium pricing',
              after: 'Accessible premium',
              why: 'because',
              evidence: 'made up',
              evidenceIds: ['NotASignal'],
              change: { kind: 'posture', posture: 'accessible' },
            },
          ],
        };
      },
    };
    const api = createApp({ repository: openRepository(':memory:'), llm });
    const created = await send(api, 'POST', '/api/projects', {});
    const projectId = (created.json as { id: string }).id;
    const run = await send(api, 'POST', '/api/simulations', { projectId });
    assert.equal(run.status, 201);
    const body = run.json as unknown as SimulationBody;
    assert.equal(body.status, 'complete');
    assert.equal(body.score, 71);
    assert.equal(body.proposals[0]?.change.kind, 'qloo');
    assert.equal(body.proposals.some((proposal) => proposal.after === 'Accessible premium'), false);
  });

  test('dismiss does not create a version, and a second decision conflicts', async () => {
    const api = app();
    const created = await send(api, 'POST', '/api/projects', {});
    const projectId = (created.json as { id: string }).id;
    const sim = (await send(api, 'POST', '/api/simulations', { projectId })).json as unknown as SimulationBody;
    const dismissed = await send(api, 'POST', `/api/recommendations/${sim.proposals[1]!.id}/dismiss`);
    assert.equal(dismissed.status, 200);
    assert.equal((dismissed.json as { status: string }).status, 'dismissed');
    const again = await send(api, 'POST', `/api/recommendations/${sim.proposals[1]!.id}/apply`);
    assert.equal(again.status, 409);
    const versions = (await send(api, 'GET', `/api/projects/${projectId}/versions`)).json as { versions: VersionBody[] };
    assert.equal(versions.versions.length, 1);

    const applied = await send(api, 'POST', `/api/recommendations/${sim.proposals[0]!.id}/apply`);
    assert.equal(applied.status, 201);
    const repeat = await send(api, 'POST', `/api/recommendations/${sim.proposals[0]!.id}/apply`);
    assert.equal(repeat.status, 409);
  });

  test('muted references are not evidence, and one reference is LIMITED', async () => {
    const api = app();
    const muted = await send(api, 'POST', '/api/projects', {
      brief: { muted: ['Aphex Twin'] },
    });
    assert.equal(muted.status, 201);
    const projectId = (muted.json as { id: string }).id;
    const sim = (await send(api, 'POST', '/api/simulations', { projectId })).json as unknown as SimulationBody;
    assert.equal(sim.status, 'complete');
    assert.notEqual(sim.score, 71);
    assert.equal(sim.evidenceStrength, 'HIGH');

    const limitedProject = await send(api, 'POST', '/api/projects', { brief: { refs: ['Muji'] } });
    const limited = (
      await send(api, 'POST', '/api/simulations', { projectId: (limitedProject.json as { id: string }).id })
    ).json as unknown as SimulationBody;
    assert.equal(limited.evidenceStrength, 'LIMITED');
    assert.equal(limited.displayScore?.limited, true);
    assert.equal(limited.displayScore?.why, `Why ${limited.displayScore?.text}?`);
    assert.equal(limited.score, ledgerSum(limited));
    assert.ok(limited.signals.every((signal) => signal.level !== 'Strong'));
  });

  test('unknown refs are labeled inferred and validation errors stay 400', async () => {
    const api = app();
    const created = await send(api, 'POST', '/api/projects', { brief: { refs: ['Nike', 'Uniqlo'] } });
    const sim = (
      await send(api, 'POST', '/api/simulations', { projectId: (created.json as { id: string }).id })
    ).json as unknown as SimulationBody;
    assert.equal(sim.provider, 'inferred');
    assert.notEqual(sim.score, 71);

    const badCity = await send(api, 'POST', '/api/projects', { brief: { city: 'Paris' } });
    assert.equal(badCity.status, 400);
    const dup = await send(api, 'POST', '/api/projects', { brief: { refs: ['Muji', 'Muji'] } });
    assert.equal(dup.status, 400);
    const missing = await send(api, 'GET', '/api/simulations/missing');
    assert.equal(missing.status, 404);
    const health = await send(api, 'GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal((health.json as { ok: boolean }).ok, true);
  });
});

function ledgerSum(sim: SimulationBody): number {
  const ledger = sim.ledger;
  assert.ok(ledger);
  assert.equal('total' in ledger, false);
  return ledger.anchor + ledger.cross + ledger.local + ledger.audience + ledger.friction;
}

function assertSimulationContract(sim: SimulationBody): void {
  for (const key of [
    'score',
    'ledger',
    'evidenceStrength',
    'signals',
    'districts',
    'fits',
    'frictions',
    'proposals',
    'provider',
    'status',
  ]) {
    assert.equal(key in sim, true, key);
  }
  for (const signal of sim.signals) {
    for (const key of ['domain', 'name', 'level', 'feeds', 'sources']) assert.equal(key in signal, true);
    assert.ok(Array.isArray(signal.sources));
  }
  assert.ok(Array.isArray(sim.districts.min));
  assert.ok(Array.isArray(sim.districts.lux));
  for (const friction of sim.frictions) {
    assert.equal(typeof friction.text, 'string');
    assert.equal(typeof friction.why, 'string');
  }
  for (const proposal of sim.proposals) {
    assert.equal(typeof proposal.before, 'string');
    assert.equal(typeof proposal.after, 'string');
    assert.equal(typeof proposal.why, 'string');
    assert.equal(typeof proposal.evidence, 'string');
  }
}

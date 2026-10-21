/**
 * End-to-end smoke test against a running API (wrangler dev or a deployed Worker).
 *   API_BASE=http://127.0.0.1:8787 npm run smoke -w @tastedraft/api
 * Checks: health, brief -> score -> proposals -> apply -> higher score (projects flow),
 * and the agent run loop (/api/runs): score, proposals, approve -> new score.
 */
import { DEFAULT_BRIEF } from '../src/engine/index.ts';
import { BANGKOK_SNACK_BRIEF } from '../src/providers/qloo/insights-mock.ts';

const base = (process.env.API_BASE ?? 'http://127.0.0.1:8787').replace(/\/$/, '');

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', origin: process.env.SMOKE_ORIGIN ?? 'http://localhost:3000' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${(JSON.parse(text || "{}").error ?? text.slice(0, 300))}`);
  return text ? JSON.parse(text) : null;
}

function check(cond: unknown, label: string): void {
  if (!cond) throw new Error(`FAIL ${label}`);
  console.log(`ok  ${label}`);
}

const health = await call('GET', '/api/health');
console.log('health', JSON.stringify(health));

if (process.env.SKIP_PROJECTS !== '1') {
const project = await call('POST', '/api/projects', {
  idea: DEFAULT_BRIEF.idea, age: DEFAULT_BRIEF.age, city: DEFAULT_BRIEF.city,
  interests: '', positioning: 'Premium', references: [...DEFAULT_BRIEF.refs],
});
const v1 = await call('POST', '/api/simulations', {
  projectId: project.id, applied: false, idea: DEFAULT_BRIEF.idea, positioning: 'Premium', references: [...DEFAULT_BRIEF.refs],
});
check(typeof v1.score === 'number', `V1 scored ${v1.score} (${v1.provider}, ${v1.evidenceStrength})`);
check(v1.proposals.length > 0, `${v1.proposals.length} proposals`);
const best = [...v1.proposals].sort((a: any, b: any) => b.predictedDelta - a.predictedDelta)[0];
const applied = await call('POST', `/api/recommendations/${best.id}/apply`);
check(applied.simulation.score > v1.score, `apply "${best.after}" -> V${applied.version.number} scored ${applied.simulation.score} > ${v1.score}`);
const versions = await call('GET', `/api/projects/${project.id}/versions`);
check(versions.versions.length === 2, 'both versions persisted');
const again = await call('GET', `/api/simulations/${v1.id}`);
check(again.score === v1.score, 'V1 result still readable from storage');

}

async function settle(id: string): Promise<any> {
  for (let i = 0; i < 120; i += 1) {
    const snap = await call('GET', `/api/runs/${id}`);
    if (snap.status !== 'running') return snap;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('run did not settle');
}
const { id } = await call('POST', '/api/runs', { brief: BANGKOK_SNACK_BRIEF });
const r1 = await settle(id);
check(r1.score !== null, `run scored ${r1.score} (grounding ${r1.grounding}, status ${r1.status}, ${r1.proposals.length} proposals)`);
if (r1.status === 'awaiting_approval' && r1.proposals.length) {
  await call('POST', `/api/runs/${id}/approve`, { proposalId: r1.proposals[0].id });
  const r2 = await settle(id);
  check(r2.score !== null && r2.score >= r1.score, `approve -> v${r2.version} scored ${r2.score} (was ${r1.score})`);
}
console.log('SMOKE PASS');

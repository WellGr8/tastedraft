'use client';

import { RunSnapshotSchema, type BriefV2, type Proposal, type RunSnapshot, type Step } from '@tastedraft/contracts';
import { apiBase, type ProposalView, type SimulationResponse } from '@/lib/api';
import { scoreLive } from '@/lib/engine-preview';
import type { Persona } from '@/lib/personas';

export async function readRunEvents(id: string, onStep: (step: Step) => void | Promise<void>): Promise<RunSnapshot> {
  const response = await fetch(`${apiBase()}/api/runs/${encodeURIComponent(id)}/events`);
  if (!response.ok || !response.body) throw new Error('The run stream did not open');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let state: RunSnapshot | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (!data) continue;
      const event = JSON.parse(data) as { type?: string; step?: Step; run?: unknown };
      if (event.type === 'step' && event.step) await onStep(event.step);
      if (event.type === 'state') state = RunSnapshotSchema.parse(event.run);
    }
  }
  if (!state) throw new Error('The run ended without a state');
  return state;
}

const PARAM_LABEL: Record<string, string> = {
  'filter.price_level.max': 'Price',
  'filter.price_level.min': 'Price',
  'signal.demographics.age': 'Age',
  'signal.demographics.gender': 'Gender',
  'signal.interests.tags': 'Positioning',
  'filter.location.query': 'Location',
  'filter.tags': 'Channel',
  'signal.interests.entities': 'References',
};

export function viewOf(proposal: Proposal): ProposalView {
  const change = proposal.changes[0];
  const name = change ? PARAM_LABEL[change.param] ?? change.param : 'Change';
  return {
    id: proposal.id,
    before: `${name} ${change?.from ?? 'none'}`,
    after: `${name} ${change?.to ?? 'none'}`,
    why: proposal.why,
    evidence: proposal.evidenceRefs.join(', '),
    evidenceIds: [...proposal.evidenceRefs],
    predictedDelta: proposal.predictedDelta ?? null,
    param: change?.param ?? null,
    from: change?.from ?? null,
    to: change?.to ?? null,
    status: 'open',
  };
}

export function simulationOf(run: RunSnapshot): SimulationResponse {
  const ledger = run.simulation?.ledger ?? null;
  return {
    id: `${run.id}-v${run.version}`,
    projectId: run.id,
    conceptVersionId: `${run.id}-v${run.version}`,
    versionNumber: run.version,
    status: run.score == null ? 'failed' : 'complete',
    provider: 'sample',
    score: run.score,
    ledger,
    evidenceStrength: run.evidenceStrength,
    signals: run.evidence.slice(0, 6).map((row) => ({ domain: row.kind, name: row.name, level: row.strength })),
    fits: run.evidence.slice(0, 2).map((row) => ({ text: row.name })),
    frictions: run.frictions.map((friction) => ({ text: friction.hypothesis, why: friction.label })),
    proposals: run.proposals.map(viewOf),
    story: {
      mode: 'sample',
      considered: run.proposals.length,
      baseline: run.score,
      captions: [],
      provenance: ledger
        ? (['anchor', 'cross', 'local', 'audience', 'friction'] as const).map((id) => ({
            id,
            label: id,
            points: ledger[id],
            detail: id,
          }))
        : [],
    },
    error: run.score == null ? run.report : null,
  };
}

export function traceLines(run: RunSnapshot): string[] {
  const steps = run.steps.map((step) => step.label);
  const links = run.links.map((link) => {
    const entities = link.entities.length ? link.entities.join(', ') : 'none';
    const tags = link.tags.length ? link.tags.join(', ') : 'none';
    const cells = link.cells.length ? link.cells.join(', ') : 'none';
    return `${link.proposalId}: entities ${entities}; tags ${tags}; heatmap ${cells}`;
  });
  return run.grounding === 'recorded' ? ['Recorded run', ...steps, ...links] : [...steps, ...links];
}

export async function personasOf(run: RunSnapshot, brief: BriefV2): Promise<Persona[]> {
  const posture = brief.priceLevel === 2 ? 'accessible' : brief.priceLevel === 1 ? 'Mass' : brief.priceLevel === 4 ? 'Luxury' : null;
  const scarcity = brief.constraints.some((item) => /preorder/i.test(item))
    ? 'preorder'
    : brief.constraints.some((item) => /limited/i.test(item))
      ? 'limited'
      : 'none';
  const people: Persona[] = [];
  for (const row of run.personas) {
    const anchors = row.anchors.map((anchor) => ({
      id: anchor.id,
      name: anchor.name,
      type: anchor.type,
      affinity: anchor.affinity,
      provenance: anchor.affinity == null ? 'qloo; affinity unmeasured' : `qloo; affinity ${anchor.affinity}`,
      ...(anchor.image ? { image: anchor.image } : {}),
    }));
    const measuring = anchors.length === 0;
    let fit = 0;
    if (!measuring) {
      try {
        fit = (
          await scoreLive({
            idea: brief.idea,
            age: row.age ?? brief.age,
            city: brief.city,
            pos: brief.positioning,
            refs: brief.references.map((item) => item.name),
            posture,
            scarcity,
          })
        ).total;
      } catch {
        fit = 0;
      }
    }
    const words = row.label.split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word[0] ?? ''));
    people.push({
      id: row.id,
      label: row.label,
      city: row.location,
      age: row.age ?? brief.age,
      gender: row.gender ?? null,
      role: '',
      initials: `${words[0]?.[0] ?? 'P'}${words.length > 1 ? words[words.length - 1]?.[0] ?? '' : ''}`.toUpperCase(),
      anchors,
      fit,
      measuring,
      evidenceStrength: run.evidenceStrength,
      rejects: !measuring && fit > 0 && fit < 70,
      rejectWhy: null,
      interview: row.quote,
      evidence: measuring
        ? [{ label: 'Taste', detail: 'still measuring' }]
        : [
            { label: 'Fit', detail: String(fit) },
            { label: row.location, detail: row.age ?? brief.age },
            ...anchors.slice(0, 3).map((anchor) => ({ label: anchor.name, detail: 'from Qloo' })),
          ].slice(0, 5),
      provenance: [row.quoteLabel],
      source: 'qloo',
    });
  }
  return people;
}

/**
 * Agent loop: detect frictions, propose Qloo diffs, simulate each one,
 * rank by the engine's delta, present the top three. A person approves.
 */
import { ProposalSchema, type BriefV2, type ExplainabilityContribution, type InsightSignal, type Proposal } from '@tastedraft/contracts';
import type { LlmCallOptions } from '../llm/client.ts';
import { applyDiffsToBrief, applyDiffsToEngine, defaultBriefV2, engineBriefFromV2, scoreEngine, type EngineScore } from './model.ts';
import { detectFrictions, proposeCandidates, rankCandidates, simulateCandidates, type DetectedFriction, type ScoredCandidate } from './propose.ts';
import { demoView, type DemoView } from './view.ts';
import { writeWhy } from './why.ts';

export interface AgentInput {
  brief: BriefV2;
  signals?: InsightSignal[];
  explainability?: ExplainabilityContribution[];
}

export interface AgentOptions extends LlmCallOptions {
  id?: string;
}

export interface AgentRun {
  id: string;
  brief: BriefV2;
  baselineTotal: number;
  frictions: DetectedFriction[];
  considered: ScoredCandidate[];
  proposals: Proposal[];
  status: 'awaiting_approval';
}

export interface Approval {
  proposalId: string;
  proposal: Proposal;
  brief: BriefV2;
  total: number;
  delta: number;
  score: EngineScore;
}

const PRESENTED = 3;

export async function runAgent(input: AgentInput, options?: AgentOptions): Promise<AgentRun> {
  const brief = input.brief;
  const baseline = scoreEngine(engineBriefFromV2(brief));
  const frictions = detectFrictions(brief, baseline, input.signals ?? [], input.explainability ?? []);
  const considered = rankCandidates(simulateCandidates(brief, proposeCandidates(brief, frictions), baseline.total));
  const proposals: Proposal[] = [];
  for (const candidate of considered.slice(0, PRESENTED)) {
    const why = await writeWhy(
      {
        id: candidate.id,
        frictionText: candidate.frictionText,
        changes: candidate.changes,
        evidenceRefs: candidate.evidenceRefs,
      },
      options,
    );
    proposals.push(
      ProposalSchema.parse({
        id: candidate.id,
        changes: candidate.changes,
        why,
        evidenceRefs: candidate.evidenceRefs,
        predictedDelta: candidate.predictedDelta,
      }),
    );
  }
  return {
    id: options?.id ?? crypto.randomUUID(),
    brief,
    baselineTotal: baseline.total,
    frictions,
    considered,
    proposals,
    status: 'awaiting_approval',
  };
}

export function approve(run: AgentRun, proposalId: string): Approval {
  const proposal = run.proposals.find((item) => item.id === proposalId);
  if (!proposal) {
    throw new Error(`Proposal ${proposalId} is not on the shortlist. Approve one of the top ${PRESENTED}.`);
  }
  const brief = applyDiffsToBrief(run.brief, proposal.changes);
  const score = scoreEngine(applyDiffsToEngine(run.brief, proposal.changes));
  return {
    proposalId,
    proposal,
    brief,
    total: score.total,
    delta: score.total - run.baselineTotal,
    score,
  };
}

export async function buildDemo(options?: LlmCallOptions): Promise<DemoView> {
  const brief = defaultBriefV2();
  const baseline = scoreEngine(engineBriefFromV2(brief));
  const run = await runAgent({ brief }, { ...options, id: 'demo' });
  const top = run.proposals[0];
  if (!top) throw new Error('The default brief produced no proposal to approve');
  const approval = approve(run, top.id);
  return demoView({
    brief,
    considered: run.considered.length,
    frictionCount: run.frictions.length,
    proposals: run.proposals,
    approvalBrief: approval.brief,
    proposal: approval.proposal,
    delta: approval.delta,
    v1: baseline,
    v2: approval.score,
  });
}

import { districtsFor } from '../engine/index.ts';
import type { Brief, EvidencePacket } from '../engine/types.ts';
import { scorePacket, type ScoredPacket } from '../wiring/gaps.ts';
import {
  briefForAgent,
  decideProposals,
  districtsForBrief,
  isCalibratedDemo,
  packetFromInsights,
  scoredFromInsights,
  scoreInsightsBrief,
  signalsFromInsights,
  storyFor,
} from './agent-score.ts';
import type { EvidenceProvider } from '../domain/evidence-provider.ts';
import type { LlmClient } from '../domain/llm.ts';
import type { ProjectRepository } from '../domain/repository.ts';
import type {
  ConceptVersion,
  Project,
  ProposalView,
  Recommendation,
  SimulationView,
  StoredScore,
  StoredSimulation,
} from '../domain/records.ts';
import { conflict, notFound } from '../errors.ts';
import { AppError } from '../errors.ts';
import { applyChange, assertPlaylist, canonicalBrief, forEvidence, mergeBrief, projectName, type BriefPatch } from './brief.ts';
import { buildSignals } from './present.ts';

export interface CreateProjectInput {
  name?: string;
  brief: Brief;
}

export class Orchestrator {
  constructor(
    private readonly repo: ProjectRepository,
    private readonly provider: EvidenceProvider,
    private readonly llm: LlmClient,
    private readonly ids: () => string = () => crypto.randomUUID(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  createProject(input: CreateProjectInput): { project: Project; version: ConceptVersion } {
    const now = this.now();
    return this.repo.createProject({
      projectId: this.ids(),
      name: projectName(input.brief.idea, input.name),
      versionId: this.ids(),
      brief: input.brief,
      now,
    });
  }

  updateBrief(projectId: string, patch: BriefPatch): {
    projectId: string;
    version: ConceptVersion;
    staleSimulationIds: string[];
  } {
    const project = this.requireProject(projectId);
    const current = this.requireVersion(project.currentVersionId);
    const next = mergeBrief(current.brief, patch);
    if (canonicalBrief(next) === canonicalBrief(current.brief)) {
      return { projectId, version: current, staleSimulationIds: [] };
    }
    assertPlaylist(next.refs, next.muted ?? []);
    const saved = this.repo.saveBriefEdit({
      versionId: this.ids(),
      projectId,
      parentId: current.id,
      brief: next,
      now: this.now(),
    });
    return { projectId, version: saved.version, staleSimulationIds: saved.staleSimulationIds };
  }

  async runSimulation(projectId: string, conceptVersionId?: string): Promise<SimulationView> {
    const project = this.requireProject(projectId);
    const version = this.requireVersion(conceptVersionId ?? project.currentVersionId);
    if (version.projectId !== project.id) throw notFound('Concept version not found');
    const brief = forEvidence(version.brief);
    try {
      const parsed = await this.llm.parseBrief(brief);
      const demo = isCalibratedDemo(brief);
      let packet: EvidencePacket;
      let scored: ScoredPacket;
      let insights = null;
      if (demo) {
        packet = await this.provider.getEvidence(brief);
        scored = scorePacket(packet);
      } else {
        const v2 = brief.briefV2;
        if (!v2) throw new Error('Insights scoring needs a BriefV2');
        insights = await scoreInsightsBrief(v2);
        scored = scoredFromInsights(insights, v2.references.length);
        packet = packetFromInsights(brief, insights);
      }
      const districts = demo ? districtsFor(brief.city) : districtsForBrief(brief.city, districtsFor(brief.city));
      const signals = insights
        ? signalsFromInsights(insights)
        : buildSignals({
            packet,
            subs: scored.subs,
            districts,
            strength: scored.evidenceStrength,
          });
      const ledger = {
        anchor: scored.ledger.anchor,
        cross: scored.ledger.cross,
        local: scored.ledger.local,
        audience: scored.ledger.audience,
        friction: scored.ledger.friction,
        total: scored.score,
      };
      const explained = await this.llm.explain({
        brief,
        ledger,
        evidenceStrength: scored.evidenceStrength,
        signals,
        districts,
        provider: packet.sourceId,
        posture: packet.posture,
        scarcity: packet.scarcity,
      });
      const agent = await decideProposals(
        brief,
        scored.score,
        insights?.signals ?? [],
        insights?.explainability ?? [],
      );
      const createdAt = this.now();
      const simulationId = this.ids();
      const snapshotId = this.ids();
      const result: StoredScore = {
        score: scored.score,
        displayScore: scored.display,
        ledger: scored.ledger,
        subs: scored.subs,
        evidenceStrength: scored.evidenceStrength,
        signals,
        districts,
        fits: explained.fits,
        frictions: agent.frictions.length ? agent.frictions : [],
        provider: packet.sourceId,
        mixed: packet.mixed,
        parsedBrief: parsed,
        story: storyFor({
          mode: demo ? 'sample' : 'insights',
          brief,
          briefV2: brief.briefV2 ?? agent.run?.brief ?? briefForAgent(brief),
          scored,
          insights,
          considered: agent.considered,
          samplePacket: demo ? packet : undefined,
        }),
      };
      const recommendations: Recommendation[] = agent.recommendations.map((proposal, position) => ({
        id: this.ids(),
        simulationId,
        projectId,
        position,
        before: proposal.before,
        after: proposal.after,
        why: proposal.why,
        evidence: proposal.evidence,
        evidenceIds: proposal.evidenceIds,
        change: proposal.change,
        status: 'open',
        appliedVersionId: null,
        createdAt,
        updatedAt: createdAt,
      }));
      const simulation: StoredSimulation = {
        id: simulationId,
        projectId,
        conceptVersionId: version.id,
        evidenceSnapshotId: snapshotId,
        status: 'complete',
        result,
        error: null,
        createdAt,
      };
      this.repo.saveSuccess({
        snapshot: {
          id: snapshotId,
          projectId,
          conceptVersionId: version.id,
          providerId: this.provider.id,
          packet,
          createdAt,
        },
        simulation,
        recommendations,
      });
      return toView(simulation, version, recommendations);
    } catch (err) {
      if (err instanceof AppError) throw err;
      const simulation: StoredSimulation = {
        id: this.ids(),
        projectId,
        conceptVersionId: version.id,
        evidenceSnapshotId: null,
        status: 'failed',
        result: null,
        error: err instanceof Error ? err.message : 'Simulation failed',
        createdAt: this.now(),
      };
      this.repo.saveFailure(simulation);
      return toView(simulation, version, []);
    }
  }

  getSimulation(id: string): SimulationView {
    const simulation = this.repo.getSimulation(id);
    if (!simulation) throw notFound('Simulation not found');
    const version = this.requireVersion(simulation.conceptVersionId);
    return toView(simulation, version, this.repo.listRecommendations(id));
  }

  async applyRecommendation(id: string): Promise<{
    recommendation: Recommendation;
    version: ConceptVersion;
    simulation: SimulationView;
  }> {
    const recommendation = this.requireRecommendation(id);
    if (recommendation.status !== 'open') {
      throw conflict(`Recommendation is already ${recommendation.status}`);
    }
    const simulation = this.repo.getSimulation(recommendation.simulationId);
    if (!simulation) throw notFound('Simulation not found');
    if (simulation.status !== 'complete') {
      throw conflict('Brief changed or the simulation failed. Run it again before applying.');
    }
    const parent = this.requireVersion(simulation.conceptVersionId);
    const now = this.now();
    const version = this.repo.commitAppliedVersion({
      versionId: this.ids(),
      projectId: recommendation.projectId,
      parentId: parent.id,
      brief: applyChange(parent.brief, recommendation.change),
      recommendationId: recommendation.id,
      now,
    });
    const updated = this.requireRecommendation(id);
    const next = await this.runSimulation(recommendation.projectId, version.id);
    return { recommendation: updated, version, simulation: next };
  }

  dismissRecommendation(id: string): Recommendation {
    const recommendation = this.requireRecommendation(id);
    if (recommendation.status !== 'open') {
      throw conflict(`Recommendation is already ${recommendation.status}`);
    }
    this.repo.setRecommendationStatus(id, 'dismissed', null, this.now());
    return this.requireRecommendation(id);
  }

  listVersions(projectId: string): {
    projectId: string;
    currentVersionId: string;
    versions: ConceptVersion[];
  } {
    const project = this.requireProject(projectId);
    return {
      projectId,
      currentVersionId: project.currentVersionId,
      versions: this.repo.listVersions(projectId),
    };
  }

  private requireProject(id: string): Project {
    const project = this.repo.getProject(id);
    if (!project) throw notFound('Project not found');
    return project;
  }

  private requireVersion(id: string): ConceptVersion {
    const version = this.repo.getVersion(id);
    if (!version) throw notFound('Concept version not found');
    return version;
  }

  private requireRecommendation(id: string): Recommendation {
    const recommendation = this.repo.getRecommendation(id);
    if (!recommendation) throw notFound('Recommendation not found');
    return recommendation;
  }
}

export function toView(
  simulation: StoredSimulation,
  version: ConceptVersion,
  recommendations: Recommendation[],
): SimulationView {
  const base = {
    id: simulation.id,
    projectId: simulation.projectId,
    conceptVersionId: simulation.conceptVersionId,
    versionNumber: version.number,
    evidenceSnapshotId: simulation.evidenceSnapshotId,
    status: simulation.status,
  };
  if (simulation.status === 'failed' || !simulation.result) {
    return {
      ...base,
      status: simulation.status === 'failed' ? 'failed' : simulation.status,
      provider: null,
      score: null,
      displayScore: null,
      ledger: null,
      evidenceStrength: null,
      signals: [],
      districts: { min: [], lux: [] },
      fits: [],
      frictions: [],
      proposals: [],
      subs: null,
      mixed: null,
      parsedBrief: null,
      story: null,
      error: simulation.error,
    };
  }
  const { anchor, cross, local, audience, friction } = simulation.result.ledger;
  const proposals: ProposalView[] = recommendations.map((recommendation) => {
    const change = recommendation.change;
    const diff = change.kind === 'qloo' ? change.changes[0] : undefined;
    return {
      id: recommendation.id,
      before: recommendation.before,
      after: recommendation.after,
      why: recommendation.why,
      evidence: recommendation.evidence,
      evidenceIds: recommendation.evidenceIds,
      change,
      status: recommendation.status,
      predictedDelta: change.kind === 'qloo' ? change.predictedDelta : null,
      param: diff?.param ?? null,
      from: diff?.from ?? null,
      to: diff?.to ?? null,
    };
  });
  return {
    ...base,
    provider: simulation.result.provider,
    score: simulation.result.score,
    displayScore: simulation.result.displayScore,
    ledger: { anchor, cross, local, audience, friction },
    evidenceStrength: simulation.result.evidenceStrength,
    signals: simulation.result.signals,
    districts: simulation.result.districts,
    fits: simulation.result.fits,
    frictions: simulation.result.frictions,
    proposals,
    subs: simulation.result.subs,
    mixed: simulation.result.mixed,
    parsedBrief: simulation.result.parsedBrief,
    story: simulation.result.story ?? null,
    error: null,
  };
}

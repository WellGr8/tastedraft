/**
 * One agent. Chat, approve, and dismiss are commands into this machine.
 * The engine scores. Persona replies are labeled and are not evidence.
 * Friction confidence comes from evidenceKey, not from a model.
 */
import {
  CLAIM_LABEL,
  DEFAULT_QLOO_BUDGET,
  FRICTION_LABEL,
  MAX_ROUNDS,
  PERSONA_RESPONSE_LABEL,
  PersonaSchema,
  ProposalSchema,
  RunSnapshotSchema,
  type BriefV2,
  type DecisionLink,
  type Evidence,
  type Friction,
  type Grounding,
  type HeatmapCell,
  type Persona,
  type Proposal,
  type RunSnapshot,
  type Step,
  type StopReason,
} from '@tastedraft/contracts';
import {
  applyDiffsToBrief,
  engineBriefFromV2,
  scoreEngine,
  type EngineScore,
} from '../agent/model.ts';
import { detectFrictions, proposeCandidates, rankCandidates, simulateCandidates } from '../agent/propose.ts';
import { evidenceKey } from '../engine/score.ts';
import type { LlmClient } from '../llm/client.ts';
import { conflict, notFound } from '../errors.ts';
import { qlooAge } from '../providers/qloo/insights.ts';
import { parseHeatCells } from '../providers/qloo/heatmap.ts';
import { buildPersona } from '../providers/qloo/persona.ts';
import { QlooClient } from '../providers/qloo/client.ts';
import { QlooGateway } from './gateway.ts';
import { narrate } from './narrate.ts';
import { evidenceFromRecording, loadRecording, recordingsDir, saveRecording, type DerivedRecording } from './record.ts';
import { RunStore, type RunRecord } from './store.ts';


const AGES = ['18–25', '26–35', '36–45', '46+'] as const;
const CATEGORIES = ['artists', 'brands', 'places', 'dining', 'film'] as const;

export interface RunnerOptions {
  store: RunStore;
  llm?: LlmClient;
  budget?: number;
  /** Injected client. Defaults to a Qloo client with retries disabled (the gateway retries). */
  client?: QlooClient;
  env?: { QLOO_API_KEY?: string };
  sleep?: (ms: number) => Promise<void>;
  /** Runtime recordings. Gitignored. A missing file falls back to the derived fixture. */
  recordingsDir?: string;
}

export interface CommandResult {
  run: RunSnapshot;
  reply: string;
  steps: Step[];
}

export class AgentRunner {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly options: RunnerOptions) {}

  get store(): RunStore {
    return this.options.store;
  }

  create(brief: BriefV2, input?: { target?: number; id?: string; budget?: number; grounding?: 'qloo' | 'llm-only' }): string {
    const id = input?.id ?? crypto.randomUUID();
    const budget = input?.budget ?? this.options.budget ?? DEFAULT_QLOO_BUDGET;
    const grounding: Grounding = input?.grounding === 'llm-only' ? 'llm-only' : 'qloo';
    const snapshot = RunSnapshotSchema.parse({
      id,
      status: 'running',
      version: 1,
      round: 1,
      qlooCalls: 0,
      budget,
      score: null,
      evidenceStrength: grounding === 'llm-only' ? 'LIMITED' : evidenceKey(brief.references.length),
      stopReason: null,
      grounding,
      personas: [],
      frictions: [],
      evidence: [],
      districts: [],
      proposals: [],
      applied: [],
      links: [],
      steps: [],
      report: '',
      simulation: null,
    });
    const record: RunRecord = {
      brief,
      target: input?.target ?? null,
      applied: [],
      forced: false,
      phase: 'personas',
      snapshot,
    };
    this.options.store.create(record);
    return id;
  }

  async start(brief: BriefV2, input?: { target?: number; id?: string; budget?: number; grounding?: 'qloo' | 'llm-only' }): Promise<RunSnapshot> {
    const id = this.create(brief, input);
    await this.kick(id);
    return this.require(id);
  }

  kick(id: string): Promise<void> {
    return this.enqueue(id, () => this.drive(id));
  }

  async approve(id: string, proposalId: string): Promise<RunSnapshot> {
    await this.enqueue(id, async () => {
      const record = this.requireRecord(id);
      if (record.snapshot.status !== 'awaiting_approval') throw conflict('This run is not waiting for approval');
      const proposal = record.snapshot.proposals.find((item) => item.id === proposalId);
      if (!proposal) throw notFound('Proposal not found');
      record.brief = applyDiffsToBrief(record.brief, proposal.changes);
      record.applied.push(proposalId);
      record.snapshot.applied = [...record.snapshot.applied, proposal];
      record.snapshot.version += 1;
      record.snapshot.round += 1;
      record.snapshot.proposals = [];
      record.snapshot.status = 'running';
      record.snapshot.stopReason = null;
      record.phase = 'reinterview';
      this.options.store.save(record);
      await this.drive(id);
    });
    return this.require(id);
  }

  async dismiss(id: string, proposalId: string): Promise<RunSnapshot> {
    await this.enqueue(id, async () => {
      const record = this.requireRecord(id);
      if (record.snapshot.status !== 'awaiting_approval') throw conflict('This run is not waiting for approval');
      const proposal = record.snapshot.proposals.find((item) => item.id === proposalId);
      if (!proposal) throw notFound('Proposal not found');
      record.snapshot.proposals = record.snapshot.proposals.filter((item) => item.id !== proposalId);
      if (record.snapshot.proposals.some((item) => (item.predictedDelta ?? 0) > 0)) {
        record.snapshot.status = 'awaiting_approval';
        this.finish(record);
        return;
      }
      this.stop(record, 'no_meaningful_improvement');
    });
    return this.require(id);
  }

  async command(id: string, message: string): Promise<CommandResult> {
    const text = message.trim().toLowerCase();
    if (/^(approve|yes)\b/.test(text)) {
      const current = this.require(id);
      const proposal = current.proposals[0];
      if (!proposal || current.status !== 'awaiting_approval') {
        return { run: current, reply: this.reply(current), steps: current.steps };
      }
      const run = await this.approve(id, proposal.id);
      return { run, reply: this.reply(run), steps: run.steps };
    }
    if (/^(dismiss|reject)\b/.test(text)) {
      const current = this.require(id);
      const proposal = current.proposals[0];
      if (!proposal || current.status !== 'awaiting_approval') {
        return { run: current, reply: this.reply(current), steps: current.steps };
      }
      const run = await this.dismiss(id, proposal.id);
      return { run, reply: this.reply(run), steps: run.steps };
    }
    if (/^continue\b/.test(text)) {
      await this.enqueue(id, async () => {
        const record = this.requireRecord(id);
        if (record.snapshot.status !== 'awaiting_input') return;
        record.forced = true;
        record.snapshot.status = 'running';
        record.phase = 'simulate';
        this.options.store.save(record);
        await this.drive(id);
      });
      const run = this.require(id);
      return { run, reply: this.reply(run), steps: run.steps };
    }
    if (/^stop\b/.test(text)) {
      await this.enqueue(id, async () => {
        const record = this.requireRecord(id);
        if (record.snapshot.status === 'stopped') return;
        this.stop(record, 'insufficient_evidence');
      });
      const run = this.require(id);
      return { run, reply: this.reply(run), steps: run.steps };
    }
    const run = this.require(id);
    return { run, reply: this.reply(run), steps: run.steps };
  }

  private async drive(id: string): Promise<void> {
    try {
      await this.advance(id);
    } catch (error) {
      const record = this.options.store.read(id);
      if (!record || record.snapshot.status !== 'running') throw error;
      record.snapshot.report = error instanceof Error ? error.message : 'The run failed';
      this.stop(record, 'insufficient_evidence');
    }
  }

  private async advance(id: string): Promise<void> {
    const record = this.requireRecord(id);
    if (record.snapshot.status !== 'running') return;
    if (record.snapshot.round > MAX_ROUNDS) {
      this.stop(record, 'max_rounds_or_budget');
      return;
    }
    const gateway = this.gateway(record);
    if (record.phase === 'personas' || record.phase === 'interview' || record.phase === 'frictions' || record.phase === 'evidence' || record.phase === 'gate') {
      if (record.snapshot.qlooCalls >= record.snapshot.budget && record.phase === 'personas') {
        this.stop(record, 'max_rounds_or_budget');
        return;
      }
      await this.opening(record, gateway);
      return;
    }
    if (record.phase === 'reinterview') {
      await this.reinterview(record);
    }
    if (record.phase === 'simulate') {
      await this.simulate(record, gateway);
    }
  }

  private async opening(record: RunRecord, gateway: QlooGateway): Promise<void> {
    if (record.snapshot.grounding === 'llm-only') {
      await this.llmOnly(record);
      return;
    }
    if (record.phase === 'personas') {
      record.snapshot.personas = await this.personas(record, gateway);
      this.noteCalls(record, gateway);
      await this.step(record, 'personas', 'Build personas from Qloo', personaDetail(record.snapshot.personas));
      record.phase = 'interview';
    }
    if (record.phase === 'interview') {
      await this.step(record, 'interview', 'Interview each persona', interviewDetail(record.snapshot.personas));
      record.phase = 'frictions';
    }
    if (record.phase === 'frictions') {
    const scored = scoreEngine(engineFromBrief(record.brief));
    record.snapshot.frictions = frictionsFrom(record.brief, scored);
      await this.step(
        record,
        'frictions',
        'Friction hypotheses',
        record.snapshot.frictions.map((friction) => `${friction.label}: ${friction.hypothesis}`).join(' ') || 'No friction hypothesis from the measured packet.',
      );
      record.phase = 'evidence';
    }
    if (record.phase === 'evidence') {
      record.snapshot.evidence = evidenceFromBrief(record.brief);
      await this.qlooEvidence(record, gateway);
      this.noteCalls(record, gateway);
      record.snapshot.evidenceStrength = evidenceKey(record.brief.references.length);
      await this.step(
        record,
        'evidence',
        'Qloo evidence',
        record.snapshot.evidence.map((row) => row.id).join(', ') || 'No evidence ids.',
      );
      record.phase = 'gate';
    }
    if (record.phase === 'gate') {
      const strength = record.snapshot.evidenceStrength;
      const enough = strength !== 'LIMITED' || record.forced;
      await this.step(
        record,
        'gate',
        'Evidence sufficient?',
        enough ? `${strength}. The engine can score this.` : `${strength}. Ask the user to continue or stop.`,
      );
      if (!enough) {
        record.snapshot.status = 'awaiting_input';
        this.finish(record);
        return;
      }
      record.phase = 'simulate';
      await this.simulate(record, gateway);
    }
  }

  private async reinterview(record: RunRecord): Promise<void> {
    const scored = scoreEngine(engineFromBrief(record.brief));
    record.snapshot.personas = record.snapshot.personas.map((persona) =>
      PersonaSchema.parse({
        ...persona,
        quote: quoteFor(persona.anchors, scored.total < 70),
        quoteLabel: PERSONA_RESPONSE_LABEL,
      }),
    );
    await this.step(record, 'reinterview', 'Re-interview each persona', interviewDetail(record.snapshot.personas));
    record.phase = 'simulate';
  }

  private async simulate(record: RunRecord, gateway: QlooGateway): Promise<void> {
    if (record.snapshot.round > MAX_ROUNDS) {
      this.stop(record, 'max_rounds_or_budget');
      return;
    }
    const scored = scoreEngine(engineFromBrief(record.brief));
    this.noteCalls(record, gateway);
    record.snapshot.score = scored.total;
    record.snapshot.evidenceStrength = evidenceKey(record.brief.references.length);
    record.snapshot.simulation = {
      version: record.snapshot.version,
      total: scored.total,
      ledger: {
        anchor: scored.points.anchor,
        cross: scored.points.cross,
        local: scored.points.local,
        audience: scored.points.audience,
        friction: scored.points.friction,
      },
      evidenceStrength: record.snapshot.evidenceStrength,
      mode: 'sample',
    };
    await this.step(record, 'simulate', 'Simulate options with the engine', `Engine total ${scored.total}.`);
    const detected = detectFrictions(record.brief, scored);
    const ranked = rankCandidates(simulateCandidates(record.brief, proposeCandidates(record.brief, detected), scored.total)).filter(
      (candidate) => candidate.predictedDelta > 0,
    );
    await this.step(record, 'rank', 'Rank proposals', ranked.length ? ranked.map((candidate) => candidate.id).join(', ') : 'No positive engine delta.');
    const cited = [
      ...record.snapshot.evidence.filter((row) => row.kind === 'entity').map((row) => row.id).slice(0, 2),
      ...record.snapshot.evidence.filter((row) => row.kind === 'tag').map((row) => row.id).slice(0, 2),
    ];
    const proposals: Proposal[] = [];
    for (const candidate of ranked.slice(0, 3)) {
      if (!cited.length) break;
      const why = await narrate({ hypothesis: candidate.frictionText, evidenceIds: cited, llm: this.options.llm });
      proposals.push(
        ProposalSchema.parse({
          id: `${candidate.id}-v${record.snapshot.version}`,
          changes: candidate.changes,
          why,
          evidenceRefs: cited.slice(0, 4),
          predictedDelta: candidate.predictedDelta,
        }),
      );
    }
    record.snapshot.proposals = proposals;
    record.snapshot.links = mergeLinks(record.snapshot, proposals);
    record.snapshot.frictions = frictionsFrom(record.brief, scored);
    await this.step(record, 'propose', 'Propose the best change', proposals[0] ? `${proposals[0].id}: ${proposals[0].why}` : 'Nothing to propose.');
    const reason = this.stopReason(record, scored.total, proposals);
    if (reason) {
      this.stop(record, reason);
      return;
    }
    record.snapshot.status = 'awaiting_approval';
    record.phase = 'done';
    this.finish(record);
  }

  private stopReason(record: RunRecord, total: number, proposals: readonly Proposal[]): StopReason | null {
    const best = proposals[0]?.predictedDelta ?? 0;
    if (record.target != null && total >= record.target) return 'approved_target';
    if (record.snapshot.round >= MAX_ROUNDS) return 'max_rounds_or_budget';
    // The calls already spent can still back this version's proposal.
    // A later round does not start once the budget is gone.
    if (record.snapshot.qlooCalls >= record.snapshot.budget && record.snapshot.version > 1) return 'max_rounds_or_budget';
    if (record.snapshot.evidenceStrength === 'LIMITED' && best <= 0) return 'insufficient_evidence';
    if (best <= 0) return 'no_meaningful_improvement';
    return null;
  }

  private async personas(record: RunRecord, gateway: QlooGateway): Promise<Persona[]> {
    const built = await buildPersona(gateway, {
      brief: record.brief,
      location: record.brief.city,
      audiences: audiencesFor(record.brief),
    });
    const used = new Set<string>();
    return built.segments.slice(0, 4).map((segment) => {
      const anchors = [];
      for (const category of CATEGORIES) {
        for (const row of segment.insights[category]) {
          if (used.has(row.name)) continue;
          const anchor = { ...row };
          if (anchor.image?.includes('example.invalid')) delete anchor.image;
          used.add(row.name);
          anchors.push(anchor);
          break;
        }
        if (anchors.length === 3) break;
      }
      const fit = scoreEngine({ ...engineFromBrief(record.brief), age: segment.age ?? record.brief.age }).total;
      const rejects = anchors.length > 0 && fit < 70;
      return PersonaSchema.parse({
        id: segment.id,
        label: segment.label,
        location: segment.location,
        ...(segment.age ? { age: segment.age } : {}),
        ...(segment.gender ? { gender: segment.gender } : {}),
        anchors,
        quote: quoteFor(anchors, rejects),
        quoteLabel: PERSONA_RESPONSE_LABEL,
      });
    });
  }

  private async llmOnly(record: RunRecord): Promise<void> {
    const city = record.brief.city;
    record.snapshot.personas = [0, 1, 2].map((index) =>
      PersonaSchema.parse({
        id: `generic-${index + 1}`,
        label: `Simulated shopper ${index + 1} in ${city}`,
        location: city,
        anchors: [],
        quote: 'I might look at something like this. Nothing here is tied to a place or a taste I already have.',
        quoteLabel: PERSONA_RESPONSE_LABEL,
      }),
    );
    record.snapshot.evidence = [];
    record.snapshot.districts = [];
    record.snapshot.links = [];
    record.snapshot.proposals = [];
    record.snapshot.score = null;
    record.snapshot.simulation = null;
    record.snapshot.evidenceStrength = 'LIMITED';
    await this.step(record, 'personas', 'Build generic personas', 'No Qloo entities. These personas are generic.');
    await this.step(record, 'interview', 'Interview each persona', interviewDetail(record.snapshot.personas));
    await this.step(record, 'frictions', 'Friction hypotheses', 'No measured friction. There is no cultural evidence.');
    await this.step(record, 'evidence', 'Qloo evidence', 'No Qloo evidence. This pass cannot clear the evidence gate.');
    await this.step(record, 'gate', 'Evidence sufficient?', 'LIMITED. An LLM-only pass has no Qloo entities, tags, or heatmap cells.');
    this.stop(record, 'insufficient_evidence');
  }

  private async qlooEvidence(record: RunRecord, gateway: QlooGateway): Promise<void> {
    const reached = await this.collectQloo(record, gateway);
    if (reached && gateway.mode === 'live') {
      const recording = recordingFrom(record);
      if (recording) saveRecording(record.brief, recording, this.options.recordingsDir ?? recordingsDir());
      return;
    }
    if (reached || gateway.mode !== 'live') return;
    const replay = loadRecording(record.brief, this.options.recordingsDir ?? recordingsDir());
    if (!replay) return;
    this.applyRecording(record, replay);
  }

  private async collectQloo(record: RunRecord, gateway: QlooGateway): Promise<boolean> {
    let reached = false;
    const strength = evidenceKey(record.brief.references.length);
    const name = record.brief.references[0]?.name;
    if (name && gateway.calls < record.snapshot.budget) {
      const result = await gateway.search({ query: name, take: 1 });
      if (result.ok) {
        reached = true;
        const id = firstEntityId(result.body);
        if (id) pushEvidence(record, { id: `ev:${id}`, name, kind: 'entity', ref: id, strength, affinity: null, source: 'qloo' });
      }
    }
    const tagQuery = record.brief.interests[0]?.name ?? name;
    if (tagQuery && gateway.calls < record.snapshot.budget) {
      const result = await gateway.tags({ filter: { query: tagQuery }, take: 3 });
      if (result.ok) {
        reached = true;
        for (const tag of namesFrom(result.body, 'tags').slice(0, 3)) {
          pushEvidence(record, { id: `ev:${tag.id}`, name: tag.name, kind: 'tag', ref: tag.id, strength, affinity: null, source: 'qloo' });
        }
      }
    }
    const entityIds = record.snapshot.evidence.filter((row) => row.kind === 'entity').map((row) => row.ref).slice(0, 4);
    if (gateway.calls < record.snapshot.budget) {
      const heat = await gateway.insights({
        filter: { type: 'urn:heatmap', location: { query: record.brief.city } },
        ...(entityIds.length ? { signal: { interests: { entities: entityIds.join(',') } } } : {}),
        take: 6,
      });
      if (heat.ok) {
        reached = true;
        record.snapshot.districts = labelCells(parseHeatCells(heat.body)).slice(0, 6);
      }
    }
    if (gateway.calls < record.snapshot.budget) {
      const age = qlooAge(record.brief.age);
      const demo = await gateway.insights({
        filter: { type: 'urn:tag' },
        signal: {
          location: { query: record.brief.city },
          ...(age ? { demographics: { age } } : {}),
        },
        take: 3,
      });
      if (demo.ok) {
        reached = true;
        for (const tag of namesFrom(demo.body, 'tags').slice(0, 3)) {
          pushEvidence(record, { id: `ev:${tag.id}`, name: tag.name, kind: 'tag', ref: tag.id, strength, affinity: null, source: 'qloo' });
        }
      }
    }
    return reached;
  }

  private applyRecording(record: RunRecord, recording: DerivedRecording): void {
    const strength = evidenceKey(record.brief.references.length);
    for (const row of evidenceFromRecording(recording, strength)) pushEvidence(record, row);
    if (!record.snapshot.districts.length && recording.cells.length) {
      record.snapshot.districts = labelCells(recording.cells).slice(0, 6);
    }
    record.snapshot.grounding = 'recorded';
  }

  private gateway(record: RunRecord): QlooGateway {
    const client =
      this.options.client ??
      new QlooClient({
        apiKey: this.options.env?.QLOO_API_KEY ?? '',
        retries: 0,
        minIntervalMs: 0,
      });
    return new QlooGateway(client, {
      budget: record.snapshot.budget,
      already: record.snapshot.qlooCalls,
      sleep: this.options.sleep,
    });
  }

  private noteCalls(record: RunRecord, gateway: QlooGateway): void {
    record.snapshot.qlooCalls = gateway.calls;
  }

  private async step(record: RunRecord, kind: string, label: string, detail: string): Promise<void> {
    const seq = record.snapshot.steps.length;
    const step: Step = { id: `${record.snapshot.id}-${seq}`, seq, kind, label, detail };
    record.snapshot.steps.push(step);
    this.finish(record, step);
  }

  private stop(record: RunRecord, reason: StopReason): void {
    record.snapshot.status = 'stopped';
    record.snapshot.stopReason = reason;
    record.phase = 'done';
    this.finish(record);
  }

  private finish(record: RunRecord, step?: Step): void {
    record.snapshot.report = renderReport(record.snapshot);
    record.snapshot = RunSnapshotSchema.parse(record.snapshot);
    this.options.store.save(record, step);
  }

  private reply(run: RunSnapshot): string {
    const ids = run.evidence.map((row) => row.id);
    const proposal = run.proposals[0];
    if (proposal && ids.length) {
      return proposal.why.includes(ids[0] ?? '') ? proposal.why : `${CLAIM_LABEL} (${ids[0]}). ${proposal.why}`;
    }
    if (ids.length) return `${CLAIM_LABEL} (${ids[0]}). ${run.report.split('\n')[0] ?? ''}`.trim();
    return run.report.split('\n')[0] ?? 'Waiting.';
  }

  private require(id: string): RunSnapshot {
    const snapshot = this.options.store.snapshot(id);
    if (!snapshot) throw notFound('Run not found');
    return snapshot;
  }

  private requireRecord(id: string): RunRecord {
    const record = this.options.store.read(id);
    if (!record) throw notFound('Run not found');
    return record;
  }

  private enqueue(id: string, job: () => Promise<void>): Promise<void> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const next = previous.then(job, job);
    this.locks.set(id, next);
    return next;
  }
}

/** Price level is a Qloo filter. The sample engine reads it as posture. */
function engineFromBrief(brief: BriefV2) {
  const engine = engineBriefFromV2(brief);
  if (brief.priceLevel === 1) engine.posture = 'Mass';
  else if (brief.priceLevel === 2) engine.posture = 'accessible';
  else if (brief.priceLevel === 4) engine.posture = 'Luxury';
  if (brief.constraints.some((item) => /preorder/i.test(item))) engine.scarcity = 'preorder';
  else if (brief.constraints.some((item) => /limited/i.test(item))) engine.scarcity = 'limited';
  return engine;
}

function audiencesFor(brief: BriefV2) {
  const age = AGES.includes(brief.age as (typeof AGES)[number]) ? brief.age : AGES[0];
  const index = AGES.indexOf(age as (typeof AGES)[number]);
  const stated = brief.gender === 'female' || brief.gender === 'male' ? brief.gender : undefined;
  const older = AGES[Math.min(AGES.length - 1, index + 1)]!;
  const younger = AGES[Math.max(0, index - 1)]!;
  const rows: Array<{ age: string; gender?: 'female' | 'male' }> = [
    { age, ...(stated ? { gender: stated } : {}) },
    { age, gender: stated === 'male' ? 'female' : 'female' },
    { age: older, gender: stated ?? 'male' },
    { age: younger, gender: stated === 'female' ? 'male' : 'male' },
  ];
  const seen = new Set<string>();
  const out: Array<{ id: string; label: string; age: string; gender?: string }> = [];
  for (const row of rows) {
    const key = `${row.age}|${row.gender ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = [brief.city, row.age, row.gender].filter(Boolean).join(' ');
    out.push({
      id: `persona-${brief.city}-${row.age}-${row.gender ?? 'any'}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      label,
      age: row.age,
      ...(row.gender ? { gender: row.gender } : {}),
    });
  }
  return out.slice(0, 4);
}

function quoteFor(anchors: readonly { name: string }[], rejects: boolean): string {
  const [first, second] = anchors;
  if (!first) return 'Still measuring what this person actually likes.';
  if (!second) {
    return rejects
      ? `Not for me. I already live in ${first.name}, and this doesn't belong there.`
      : `I'd try it. It sits next to ${first.name}, which is already how I spend my time.`;
  }
  return rejects
    ? `Not for me. ${first.name} and ${second.name} are my taste. This concept doesn't share it.`
    : `I'd try it. It sits next to ${first.name} and ${second.name}, which is already how I spend my time.`;
}

function personaDetail(personas: readonly Persona[]): string {
  if (!personas.length) return 'No personas yet.';
  return personas.map((persona) => `${persona.label}: ${persona.quoteLabel}`).join(' ');
}

function interviewDetail(personas: readonly Persona[]): string {
  return personas.map((persona) => `${PERSONA_RESPONSE_LABEL}: ${persona.quote}`).join(' ');
}

function evidenceFromBrief(brief: BriefV2): Evidence[] {
  const strength = evidenceKey(brief.references.length);
  const rows: Evidence[] = [];
  for (const reference of brief.references) {
    rows.push({
      id: `ev:${reference.id}`,
      name: reference.name,
      kind: 'entity',
      ref: reference.id,
      strength,
      affinity: null,
      source: 'brief',
    });
  }
  for (const tag of brief.interests) {
    rows.push({
      id: `ev:${tag.id}`,
      name: tag.name,
      kind: 'tag',
      ref: tag.id,
      strength,
      affinity: null,
      source: 'brief',
    });
  }
  return rows;
}

function frictionsFrom(brief: BriefV2, scored: EngineScore): Friction[] {
  return detectFrictions(brief, scored).map((friction) => ({
    id: friction.id,
    hypothesis: friction.text,
    label: FRICTION_LABEL,
    evidenceRefs: friction.evidenceRefs,
    confidence: evidenceKey(friction.evidenceRefs.length),
  }));
}

function renderReport(snapshot: RunSnapshot): string {
  const head = snapshot.stopReason
    ? `Stop: ${snapshot.stopReason}.`
    : snapshot.status === 'awaiting_input'
      ? 'Evidence is limited. Continue or stop.'
      : snapshot.status === 'awaiting_approval'
        ? 'Waiting for approval.'
        : 'Running.';
  const lines = snapshot.steps.map((step) => `${step.seq + 1}. ${step.label}`);
  const label = snapshot.grounding === 'recorded' ? 'Recorded run.' : snapshot.grounding === 'llm-only' ? 'LLM-only. No Qloo evidence.' : '';
  return [label, head, `Round ${snapshot.round}. Qloo calls ${snapshot.qlooCalls} of ${snapshot.budget}.`, ...lines].filter(Boolean).join('\n');
}

function pushEvidence(record: RunRecord, row: Evidence): void {
  if (record.snapshot.evidence.some((item) => item.id === row.id)) return;
  record.snapshot.evidence.push(row);
}

function labelCells(cells: readonly HeatmapCell[]): HeatmapCell[] {
  return cells.map((cell) => ({
    ...cell,
    label: cell.label ?? `${cell.lat.toFixed(2)}, ${cell.lng.toFixed(2)}`,
  }));
}

function mergeLinks(snapshot: RunSnapshot, proposals: readonly Proposal[]): DecisionLink[] {
  const kept = snapshot.links.filter((link) => snapshot.applied.some((proposal) => proposal.id === link.proposalId));
  return [...kept, ...linkProposals(proposals, snapshot.evidence, snapshot.districts)];
}

function linkProposals(proposals: readonly Proposal[], evidence: readonly Evidence[], districts: readonly HeatmapCell[]): DecisionLink[] {
  const cells = districts.map((cell) => cell.label ?? `${cell.lat.toFixed(2)}, ${cell.lng.toFixed(2)}`);
  return proposals.map((proposal) => {
    const cited = evidence.filter((row) => proposal.evidenceRefs.includes(row.id));
    return {
      proposalId: proposal.id,
      entities: cited.filter((row) => row.kind === 'entity').map((row) => row.ref),
      tags: cited.filter((row) => row.kind === 'tag').map((row) => row.ref),
      cells,
    };
  });
}

function recordingFrom(record: RunRecord): DerivedRecording | null {
  const entities = record.snapshot.evidence
    .filter((row) => row.kind === 'entity' && row.source === 'qloo')
    .map((row) => ({ id: row.id, name: row.name, ref: row.ref }));
  const tags = record.snapshot.evidence
    .filter((row) => row.kind === 'tag' && row.source === 'qloo')
    .map((row) => ({ id: row.id, name: row.name, ref: row.ref }));
  const cells = record.snapshot.districts.map((cell) => ({
    id: cell.id,
    lat: cell.lat,
    lng: cell.lng,
    weight: cell.weight,
    ...(cell.label ? { label: cell.label } : {}),
  }));
  if (!entities.length && !tags.length && !cells.length) return null;
  return { v: 1, entities, tags, cells };
}

function namesFrom(body: unknown, key: 'tags' | 'entities'): Array<{ id: string; name: string }> {
  if (!body || typeof body !== 'object') return [];
  const results = (body as { results?: unknown }).results;
  const list = Array.isArray(results)
    ? results
    : results && typeof results === 'object' && Array.isArray((results as Record<string, unknown>)[key])
      ? ((results as Record<string, unknown>)[key] as unknown[])
      : [];
  const rows: Array<{ id: string; name: string }> = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { id?: unknown; entity_id?: unknown; name?: unknown };
    const id = typeof row.entity_id === 'string' ? row.entity_id : typeof row.id === 'string' ? row.id : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!id.trim() || !name) continue;
    rows.push({ id: id.trim(), name });
  }
  return rows;
}

function firstEntityId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const results = (body as { results?: unknown }).results;
  const list = Array.isArray(results)
    ? results
    : results && typeof results === 'object' && Array.isArray((results as { entities?: unknown[] }).entities)
      ? (results as { entities: unknown[] }).entities
      : [];
  const row = list[0];
  if (!row || typeof row !== 'object') return null;
  const id = (row as { entity_id?: unknown; id?: unknown }).entity_id ?? (row as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

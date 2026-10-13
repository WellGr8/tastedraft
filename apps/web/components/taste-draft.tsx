'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BriefV2, Entity, MapLayer } from '@tastedraft/contracts';
import { ChatPanel, type ChatTurn } from '@/components/chat-panel';
import {
  AnalysisPhase,
  CompareModal,
  FlowShell,
  InputPhase,
  NowPlaying,
  ProposalModal,
  ReportPhase,
  ResultPhase,
} from '@/components/flow-view';
import { AgentSteps, PersonaChat, bestProposal, type HeatSpot } from '@/components/persona-ui';
import {
  ApiError,
  TasteDraftClient,
  apiBase,
  readChatStream,
  type ChatPatch,
  type ChatStreamEvent,
  type ProposalView,
  type SimulationResponse,
} from '@/lib/api';
import { STARTER_REFERENCES, STARTER_TAGS, defaultDraft, withImage, type DraftState } from '@/lib/defaults';
import { scoreLive, type LiveScore } from '@/lib/engine-preview';
import { askFromRun, decisionTrace, EMPTY_TRACE, namesOnRun, personasOf, readRunEvents, simulationOf, viewOf, type DecisionTrace, type EvidenceAsk, type RunProgress } from '@/lib/run';
import { placeLabel, plainStopReason } from '@/lib/labels';
import type { RunSnapshot } from '@tastedraft/contracts';
import { bandOf } from '@/lib/hex';
import { chatWithPersona, loadPersonas, mindChanges, type EvidenceChip, type MindChange, type Persona } from '@/lib/personas';
import {
  defaultControls,
  positioningForPrice,
  postureForPrice,
  scarcityForEngine,
  toProfileBrief,
  type PriceLevel,
  type ProfileControls,
} from '@/lib/profile';

type Phase = 'input' | 'analyzing' | 'result' | 'report';
type Modal = null | 'proposal' | 'compare';

interface LoopSnap {
  timeline: number[];
  v2: SimulationResponse | null;
  view: 1 | 2;
  personas: Persona[];
  changes: MindChange[];
  reinterviewed: boolean;
  appliedIds: string[];
  draft: DraftState;
  controls: ProfileControls;
  pendingId: string | null;
}

const SAMPLE_CITIES = ['Los Angeles', 'New York', 'San Francisco', 'Austin', 'Miami', 'Chicago', 'Seattle'];

function qlooId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || id.startsWith('urn:');
}

function spotsOf(layer: MapLayer | null | undefined, city: string): HeatSpot[] {
  if (!layer) return [];
  if (layer.kind === 'heatmap') {
    return [...layer.cells]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6)
      .map((cell) => ({
        id: cell.id,
        label: placeLabel(cell.label, city),
        weight: cell.weight,
        lat: cell.lat,
        lng: cell.lng,
      }));
  }
  return layer.pins.slice(0, 6).map((pin) => ({ id: pin.id, label: pin.name, weight: 1 }));
}

export function TasteDraft() {
  const client = useMemo(() => new TasteDraftClient(), []);
  const [draft, setDraft] = useState<DraftState>(() => defaultDraft());
  const [controls, setControls] = useState<ProfileControls>(() => defaultControls());
  const [live, setLive] = useState<LiveScore | null>(null);
  const [phase, setPhase] = useState<Phase>('input');
  const [runId, setRunId] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [trace, setTrace] = useState<DecisionTrace>(EMPTY_TRACE);
  const [v1, setV1] = useState<SimulationResponse | null>(null);
  const [v2, setV2] = useState<SimulationResponse | null>(null);
  const [v1Brief, setV1Brief] = useState<BriefV2 | null>(null);
  const [view, setView] = useState<1 | 2>(1);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaNote, setPersonaNote] = useState<string | null>(null);
  const [heatSpots, setHeatSpots] = useState<HeatSpot[]>([]);
  const [heatNote, setHeatNote] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunSnapshot | null>(null);
  const [compare, setCompare] = useState<RunSnapshot | 'loading' | null>(null);
  const districtLock = useRef(false);
  const [loopProposal, setLoopProposal] = useState<ProposalView | null>(null);
  const [changes, setChanges] = useState<MindChange[]>([]);
  const [reinterviewed, setReinterviewed] = useState(false);
  const [timeline, setTimeline] = useState<number[]>([]);
  const [target, setTarget] = useState('');
  const [stopReason, setStopReason] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<string[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [history, setHistory] = useState<LoopSnap[]>([]);
  const [chatPersona, setChatPersona] = useState<Persona | null>(null);
  const [personaSay, setPersonaSay] = useState('');
  const [personaChips, setPersonaChips] = useState<EvidenceChip[]>([]);
  const [personaDraft, setPersonaDraft] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [composer, setComposer] = useState('');
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<EvidenceAsk | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [dismissed, setDismissed] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [frictionOpen, setFrictionOpen] = useState<number | null>(null);
  const [barParked, setBarParked] = useState(false);
  const [progress, setProgress] = useState<RunProgress | null>(null);

  const brief = useMemo(() => {
    try {
      return toProfileBrief(draft, controls);
    } catch {
      return null;
    }
  }, [draft, controls]);

  const openProposals = useMemo(() => {
    if (!lastRun || lastRun.status !== 'awaiting_approval') return [];
    return simulationOf(lastRun).proposals;
  }, [lastRun]);

  useEffect(() => {
    if (!brief) return;
    let cancel = false;
    void scoreLive({
      idea: brief.idea,
      age: brief.age,
      city: brief.city,
      pos: brief.positioning,
      refs: brief.references.map((entity) => entity.name),
      posture: postureForPrice(controls.priceLevel),
      scarcity: scarcityForEngine(controls.scarcity),
    })
      .then((score) => {
        if (!cancel) setLive(score);
      })
      .catch(() => {
        if (!cancel) setLive(null);
      });
    return () => {
      cancel = true;
    };
  }, [brief, controls.priceLevel, controls.scarcity]);

  async function withQlooReferences(current: BriefV2): Promise<BriefV2> {
    const references = await Promise.all(
      current.references.map(async (reference) => {
        if (qlooId(reference.id)) return reference;
        try {
          const found = (await client.search(reference.name, reference.type)).entities[0];
          if (!found || !qlooId(found.id)) return reference;
          return { ...reference, id: found.id, type: found.type || reference.type };
        } catch {
          return reference;
        }
      }),
    );
    return { ...current, references };
  }

  async function loadAudience(current: BriefV2, posture?: string, scarcity = scarcityForEngine(controls.scarcity)) {
    return loadPersonas(
      {
        brief: await withQlooReferences(current),
        posture,
        scarcity,
      },
      (next) => scoreLive(next).then((scored) => scored.total),
      fetch,
      apiBase(),
    );
  }

  async function loadHeat(current: BriefV2) {
    const entities = current.references.map((item) => item.id).filter(qlooId);
    const tags = current.interests.map((tag) => tag.id).filter((id) => id.startsWith('urn:tag:') || qlooId(id));
    try {
      const payload = await client.map({
        city: current.city,
        interests: entities.length || tags.length ? { entities, tags } : undefined,
      });
      if (districtLock.current) return;
      setHeatSpots(spotsOf(payload.fits.v1, current.city));
      setHeatNote(payload.note);
    } catch {
      setHeatSpots([]);
      setHeatNote(null);
    }
  }

  function remember() {
    const snap: LoopSnap = {
      timeline: [...timeline],
      v2,
      view,
      personas: personas.map((persona) => ({ ...persona })),
      changes: [...changes],
      reinterviewed,
      appliedIds: [...appliedIds],
      draft,
      controls,
      pendingId,
    };
    setHistory((items) => [...items, snap]);
  }

  async function refreshPersonas(current: BriefV2, posture?: string) {
    const built = await loadAudience(current, posture);
    setChanges(mindChanges(personas, built.personas));
    setPersonas(built.personas);
    setPersonaNote(built.note);
    setReinterviewed(true);
    return built;
  }

  function syncPrice(proposal: ProposalView | undefined) {
    if (proposal?.param !== 'filter.price_level.max') return undefined;
    const level = Number(proposal.to);
    if (level !== 1 && level !== 2 && level !== 3 && level !== 4) return undefined;
    const priceLevel = level as PriceLevel;
    setControls((current) => ({ ...current, priceLevel }));
    setDraft((current) => ({ ...current, positioning: positioningForPrice(priceLevel) }));
    if (priceLevel === 1) return 'Mass';
    if (priceLevel === 2) return 'accessible';
    if (priceLevel === 4) return 'Luxury';
    return undefined;
  }

  function acceptRun(run: RunSnapshot, nextBrief: BriefV2, initial: boolean) {
    const simulation = simulationOf(run);
    setProjectId(run.id);
    setRunId(run.id);
    setLastRun(run);
    setTrace(decisionTrace(run, nextBrief.city));
    if (run.districts.length) {
      districtLock.current = true;
      setHeatSpots(
        run.districts.slice(0, 6).map((cell) => ({
          id: cell.id,
          label: placeLabel(cell.label, nextBrief.city),
          weight: cell.weight,
          lat: cell.lat,
          lng: cell.lng,
        })),
      );
      setHeatNote(run.grounding === 'recorded' ? 'Recorded run' : 'Qloo heatmap');
    }
    setLabels(run.steps.map((step) => step.label));
    setStopReason(run.status === 'stopped' ? run.stopReason : null);
    setLoopProposal(simulation.proposals[0] ?? null);
    void personasOf(run, nextBrief).then((people) => {
      setPersonas(people);
      setPersonaNote(null);
    });
    if (initial || run.version <= 1) {
      setV1(simulation);
      setV1Brief(nextBrief);
      setV2(null);
      setView(1);
      setTimeline(simulation.score != null ? [simulation.score] : []);
      return;
    }
    setV2(simulation);
    setView(2);
    if (simulation.score != null) {
      const score = simulation.score;
      setTimeline((items) => (items[items.length - 1] === score ? items : [...items, score]));
    }
    setReinterviewed(true);
    setPendingId(run.status === 'awaiting_approval' ? (simulation.proposals[0]?.id ?? null) : null);
  }

  function noteStep(kind: string) {
    const index =
      kind === 'personas'
        ? 0
        : kind === 'interview' || kind === 'reinterview'
          ? 1
          : kind === 'frictions'
            ? 2
            : kind === 'evidence' || kind === 'broaden' || kind === 'ask' || kind === 'gate'
              ? 3
              : kind === 'simulate'
                ? 4
                : kind === 'rank' || kind === 'propose'
                  ? 5
                  : -1;
    if (index < 0) return;
    setProgress((current) => ({
      calls: current?.calls ?? 0,
      budget: current?.budget ?? 0,
      shown: current?.shown ?? 0,
      of: current?.of ?? 0,
      label: current?.label ?? '',
      step: Math.max(current?.step ?? 0, index),
    }));
  }

  async function startTest(override?: { draft: DraftState; controls: ProfileControls }) {
    const currentDraft = override?.draft ?? draft;
    const currentControls = override?.controls ?? controls;
    let currentBrief: BriefV2;
    try {
      currentBrief = toProfileBrief(currentDraft, currentControls);
    } catch {
      setError('Add an idea before testing.');
      return;
    }
    if (override) {
      setDraft(currentDraft);
      setControls(currentControls);
    }
    setBusy(true);
    setError('');
    setAsk(null);
    setRunId(null);
    setLabels([]);
    setProgress(null);
    setTrace(EMPTY_TRACE);
    setPhase('analyzing');
    setModal(null);
    setDismissed(false);
    setPersonas([]);
    setHeatSpots([]);
    setHeatNote(null);
    setLastRun(null);
    setCompare(null);
    districtLock.current = false;
    setLoopProposal(null);
    setChanges([]);
    setReinterviewed(false);
    setTimeline([]);
    setStopReason(null);
    setPendingId(null);
    setAppliedIds([]);
    setHistory([]);
    setChatPersona(null);
    try {
      const resolvedBrief = await withQlooReferences(currentBrief);
      void loadHeat(resolvedBrief);
      const created = await client.createRun(resolvedBrief);
      setRunId(created.id);
      const run = await readRunEvents(created.id, async (step) => {
        setLabels((current) => (current.includes(step.label) ? current : [...current, step.label]));
        noteStep(step.kind);
        if (step.kind === 'personas' || step.kind === 'interview') {
          const snap = await client.getRun(created.id);
          setPersonas(await personasOf(snap, resolvedBrief));
        }
        if (step.kind === 'propose') {
          const snap = await client.getRun(created.id);
          setLoopProposal(simulationOf(snap).proposals[0] ?? null);
        }
      }, (next) => {
        setProgress((current) => ({ ...next, step: Math.max(current?.step ?? 0, next.step) }));
      });
      await new Promise((resolve) => setTimeout(resolve, 3500));
      if (run.status === 'awaiting_input') {
        setTrace(decisionTrace(run, resolvedBrief.city));
        setAsk(askFromRun(run));
        setPhase('input');
        return;
      }
      if (run.score == null) throw new Error(plainStopReason(run.stopReason) || 'This run stopped before it could recommend a change.');
      acceptRun(run, resolvedBrief, true);
      setPhase('result');
    } catch (err) {
      setPhase('input');
      setError(err instanceof Error ? err.message : 'The API could not score this concept');
    } finally {
      setBusy(false);
    }
  }

  async function toggleWhy() {
    if (compare) {
      setCompare(null);
      return;
    }
    const brief = v1Brief;
    if (!brief) return;
    setCompare('loading');
    try {
      const created = await client.createRun(brief, 'llm-only');
      const run = await readRunEvents(created.id, () => undefined);
      setCompare(run);
    } catch (err) {
      setCompare(null);
      setError(err instanceof Error ? err.message : 'The comparison did not finish');
    }
  }

  function tryExample() {
    const nextDraft: DraftState = {
      idea: 'A Bangkok streetwear brand launching in Tokyo',
      age: '18–25',
      city: 'Tokyo',
      positioning: 'Independent',
      references: STARTER_REFERENCES.slice(0, 3),
      locations: [],
      interests: STARTER_TAGS.filter((tag) => /streetwear|japanese/i.test(tag.name)),
    };
    void startTest({ draft: nextDraft, controls: { ...defaultControls(), priceLevel: 2 } });
  }

  async function resumeAsk() {
    if (!ask || !runId || busy) return;
    setBusy(true);
    setError('');
    const nextDraft: DraftState = {
      ...draft,
      references: [...draft.references],
      interests: [...draft.interests],
      locations: [...draft.locations],
    };
    if (ask.kind === 'city') nextDraft.city = ask.suggestion;
    else if (!nextDraft.references.some((item) => item.name.toLowerCase() === ask.suggestion.toLowerCase())) {
      nextDraft.references.push({
        id: ask.suggestion.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reference',
        name: ask.suggestion,
        type: 'urn:entity',
        source: 'user',
      });
    }
    setDraft(nextDraft);
    try {
      const result = await client.commandRun(runId, ask.kind === 'city' ? `resume city ${ask.suggestion}` : `resume reference ${ask.suggestion}`);
      const run = result.run;
      if (run.status === 'awaiting_input') {
        setAsk(askFromRun(run));
        setTrace(decisionTrace(run, nextDraft.city));
        return;
      }
      if (run.score == null) throw new Error(plainStopReason(run.stopReason) || 'This run stopped before it could recommend a change.');
      setAsk(null);
      acceptRun(run, toProfileBrief(nextDraft, controls), run.version <= 1);
      setPhase('result');
    } catch (err) {
      setPhase('input');
      setError(err instanceof Error ? err.message : 'The API could not score this concept');
    } finally {
      setBusy(false);
    }
  }

  function home() {
    setPhase('input');
    setModal(null);
    setView(1);
    setError('');
    setAsk(null);
  }

  async function addSimilar(name: string) {
    if (draft.references.length >= 8) return;
    let entity: Entity | null = null;
    try {
      entity = (await client.search(name)).entities[0] ?? null;
    } catch {
      entity = null;
    }
    const row = withImage(
      entity ?? {
        id: `similar-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name,
        type: 'urn:entity',
        source: 'sample',
      },
    );
    if (draft.references.some((item) => item.name.toLowerCase() === row.name.toLowerCase())) return;
    setDraft({ ...draft, references: [...draft.references, row] });
  }

  function applyPatch(current: DraftState, currentControls: ProfileControls, patch: ChatPatch | undefined) {
    const nextDraft = { ...current, references: [...current.references], interests: [...current.interests], locations: [...current.locations] };
    const nextControls = { ...currentControls, muted: [...currentControls.muted] };
    if (!patch) return { draft: nextDraft, controls: nextControls };
    if (patch.city) nextDraft.city = patch.city;
    if (patch.age) nextDraft.age = patch.age;
    if (patch.positioning) nextDraft.positioning = patch.positioning;
    if (patch.priceLevel) nextControls.priceLevel = patch.priceLevel;
    if (patch.reference && nextDraft.references.length < 8) {
      const reference = withImage(patch.reference);
      if (!nextDraft.references.some((item) => item.name.toLowerCase() === reference.name.toLowerCase())) {
        nextDraft.references.push(reference);
      }
    }
    nextDraft.positioning = positioningForPrice(nextControls.priceLevel);
    return { draft: nextDraft, controls: nextControls };
  }

  async function acceptSimulation(simulation: SimulationResponse, nextBrief: BriefV2) {
    if (!v1) {
      setV1(simulation);
      setV1Brief(nextBrief);
      setView(1);
    } else {
      setV2(simulation);
      setView(2);
    }
    setPhase('result');
    setModal(null);
  }

  async function approveServer(id: string) {
    const before = v1?.score ?? null;
    const result = await client.apply(id);
    if (result.simulation.status === 'failed' || result.simulation.score == null) {
      throw new Error(result.simulation.error ?? 'The new version did not score');
    }
    const afterBrief = result.version.brief.briefV2 ?? v1Brief ?? brief;
    setV2(result.simulation);
    setView(2);
    setPhase('result');
    setModal(null);
    return { before, after: result.simulation.score, afterBrief };
  }

  function decisionBrief(): BriefV2 {
    return v1Brief ?? brief ?? toProfileBrief(draft, controls);
  }

  async function resyncDecision(note: string) {
    if (!runId) {
      setError(note);
      return;
    }
    try {
      const run = await client.getRun(runId);
      acceptRun(run, decisionBrief(), run.version <= 1);
      setModal(null);
      setDismissed(run.status !== 'awaiting_approval');
      setPendingId(run.status === 'awaiting_approval' ? (run.proposals[0]?.id ?? null) : null);
      if (run.score != null || run.status === 'stopped' || run.status === 'awaiting_approval') setPhase('result');
      setError(note);
    } catch (err) {
      setError(err instanceof Error ? err.message : note);
    }
  }

  function movedOn(err: unknown): boolean {
    return err instanceof ApiError && (err.status === 409 || err.status === 404);
  }

  async function approveProposal(proposal: ProposalView) {
    if (runId) {
      remember();
      const run = await client.approveRun(runId, proposal.id);
      syncPrice(proposal);
      acceptRun(run, decisionBrief(), run.version <= 1);
      setAppliedIds((ids) => [...ids, proposal.id]);
      setModal(null);
      setDismissed(run.status !== 'awaiting_approval');
      setPendingId(run.status === 'awaiting_approval' ? (run.proposals[0]?.id ?? null) : null);
      return { before: v1?.score ?? null, after: run.score };
    }
    const scored = await approveServer(proposal.id);
    remember();
    const posture = syncPrice(proposal);
    if (scored.afterBrief) await refreshPersonas(scored.afterBrief, posture);
    setTimeline((items) => [...items, scored.after]);
    setAppliedIds((ids) => [...ids, proposal.id]);
    setPendingId(null);
    setStopReason(null);
    return scored;
  }

  async function decide(action: 'approve' | 'dismiss', proposal: ProposalView | undefined) {
    if (!proposal || busy) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'approve') {
        await approveProposal(proposal);
      } else if (runId) {
        const run = await client.dismissRun(runId, proposal.id);
        acceptRun(run, decisionBrief(), run.version <= 1);
        setDismissed(run.status !== 'awaiting_approval' || run.proposals.length === 0);
        setPendingId(run.status === 'awaiting_approval' ? (run.proposals[0]?.id ?? null) : null);
        setModal(null);
      } else {
        await client.dismiss(proposal.id);
        setDismissed(true);
        setModal(null);
      }
    } catch (err) {
      const note = movedOn(err)
        ? 'This run already moved on. Showing the latest result.'
        : err instanceof Error
          ? err.message
          : 'That decision did not apply.';
      await resyncDecision(note);
    } finally {
      setBusy(false);
    }
  }

  function chase(pool = openProposals.length ? openProposals : ((v2 ?? v1)?.proposals ?? []), ids = appliedIds) {
    const goal = Number(target);
    const current = (v2 ?? v1)?.score ?? null;
    const strength = (v2 ?? v1)?.evidenceStrength;
    if (current == null || !Number.isFinite(goal)) return;
    if (lastRun && lastRun.status !== 'awaiting_approval') {
      setPendingId(null);
      setStopReason(lastRun.stopReason ?? 'This run is not waiting for a decision.');
      return;
    }
    if (current >= goal) {
      setStopReason(`The score is ${current}, which meets the target.`);
      setPendingId(null);
      return;
    }
    const best = bestProposal(pool, new Set(ids));
    if (strength === 'LIMITED' || !best || (best.predictedDelta ?? 0) <= 0) {
      setStopReason('Evidence is too thin to move the score further.');
      setPendingId(null);
      return;
    }
    setStopReason(null);
    setPendingId(best.id);
  }

  function revert() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((items) => items.slice(0, -1));
    setTimeline(previous.timeline);
    setV2(previous.v2);
    setView(previous.view);
    setPersonas(previous.personas);
    setChanges(previous.changes);
    setReinterviewed(previous.reinterviewed);
    setAppliedIds(previous.appliedIds);
    setDraft(previous.draft);
    setControls(previous.controls);
    setPendingId(previous.pendingId);
    setStopReason(null);
  }

  function talk(persona: Persona) {
    setChatPersona(persona);
    setPersonaSay(persona.interview);
    setPersonaChips(persona.evidence.slice(0, 5));
    setPersonaDraft('');
    setSheet(true);
  }

  async function sendPersona() {
    if (!chatPersona || !personaDraft.trim()) return;
    const message = personaDraft.trim();
    setPersonaDraft('');
    const reply = await chatWithPersona(chatPersona, message, fetch, apiBase());
    setPersonaSay(reply.say);
    setPersonaChips(reply.evidence);
  }

  async function approve(id: string) {
    const turn = [...turns].reverse().find((item) => item.proposals.some((proposal) => proposal.id === id));
    const proposal = turn?.proposals.find((item) => item.id === id);
    if (!proposal || proposal.status !== 'open' || !brief) return;
    setChatBusy(true);
    setError('');
    const before = v1?.score ?? live?.total ?? null;
    try {
      let afterScore: number | null = null;
      if (proposal.kind === 'server' && runId) {
        const known = [...(v2?.proposals ?? []), ...(v1?.proposals ?? [])].find((item) => item.id === proposal.id);
        if (known) syncPrice(known);
        const run = await client.approveRun(runId, proposal.id);
        acceptRun(run, v1Brief ?? brief, false);
        afterScore = run.score;
      } else if (proposal.kind === 'server') {
        const scored = await approveServer(proposal.id);
        afterScore = scored.after;
      } else {
        const patched = applyPatch(draft, controls, proposal.patch);
        const nextBrief = toProfileBrief(patched.draft, patched.controls);
        let nextProject = projectId;
        if (nextProject) {
          const knownCity = SAMPLE_CITIES.includes(nextBrief.city);
          await client.patchBrief(nextProject, {
            briefV2: nextBrief,
            idea: nextBrief.idea,
            age: nextBrief.age,
            ...(knownCity ? { city: nextBrief.city } : {}),
            pos: nextBrief.positioning,
            refs: nextBrief.references.map((entity) => entity.name),
            interests: nextBrief.interests.map((tag) => tag.name).join(', '),
          });
        } else {
          const project = await client.createProject(nextBrief);
          nextProject = project.id;
          setProjectId(project.id);
        }
        const afterSim = await client.simulate(nextProject);
        if (afterSim.status === 'failed' || afterSim.score == null) {
          throw new Error(afterSim.error ?? 'The new version did not score');
        }
        await acceptSimulation(afterSim, nextBrief);
        setDraft(patched.draft);
        setControls(patched.controls);
        afterScore = afterSim.score;
      }
      setTurns((current) =>
        current.map((item) =>
          item.id !== turn?.id
            ? item
            : {
                ...item,
                proposals: item.proposals.map((row) => (row.id === id ? { ...row, status: 'approved' as const } : row)),
                comparison: before != null && afterScore != null ? { before, after: afterScore } : item.comparison,
              },
        ),
      );
    } catch (err) {
      if (movedOn(err)) {
        await resyncDecision('This run already moved on. Showing the latest result.');
      } else {
        setError(err instanceof Error ? err.message : 'Approve failed');
      }
    } finally {
      setChatBusy(false);
    }
  }

  async function dismiss(id: string) {
    const proposal = turns.flatMap((turn) => turn.proposals).find((item) => item.id === id);
    if (!proposal || proposal.status !== 'open') return;
    if (proposal.kind === 'server') {
      try {
        if (runId && brief) {
          const run = await client.dismissRun(runId, id);
          acceptRun(run, v1Brief ?? brief, run.version <= 1);
        } else {
          await client.dismiss(id);
        }
      } catch (err) {
        if (movedOn(err)) {
          await resyncDecision('This run already moved on. Showing the latest result.');
        } else {
          setError(err instanceof ApiError ? err.message : 'Dismiss failed');
        }
        return;
      }
    }
    setTurns((current) =>
      current.map((turn) => ({
        ...turn,
        proposals: turn.proposals.map((row) => (row.id === id ? { ...row, status: 'dismissed' as const } : row)),
      })),
    );
  }

  async function send(message: string) {
    const text = message.trim();
    if (!text || !brief || chatBusy) return;
    setComposer('');
    setChatBusy(true);
    setError('');
    const userTurn: ChatTurn = { id: `user-${Date.now()}`, role: 'user', text, steps: [], tools: [], proposals: [] };
    const agentId = `agent-${Date.now()}`;
    const agentTurn: ChatTurn = { id: agentId, role: 'agent', text: '', steps: [], tools: [], proposals: [] };
    setTurns((current) => [...current, userTurn, agentTurn]);
    const source = v2 ?? v1;
    try {
      if (runId) {
        const result = await client.commandRun(runId, text);
        const open = result.run.proposals[0];
        const view = open ? viewOf(open, namesOnRun(result.run)) : null;
        setTurns((current) =>
          current.map((turn) =>
            turn.id === agentId
              ? {
                  ...turn,
                  text: result.reply,
                  steps: result.steps.map((step) => step.label),
                  proposals: view
                    ? [
                        {
                          id: view.id,
                          title: `${view.before} → ${view.after}`,
                          from: view.before,
                          to: view.after,
                          delta: view.predictedDelta ?? null,
                          why: view.why,
                          kind: 'server' as const,
                          status: 'open' as const,
                        },
                      ]
                    : [],
                }
              : turn,
          ),
        );
        if (result.run.status === 'stopped' || result.run.version > 1) {
          acceptRun(result.run, v1Brief ?? brief, result.run.version <= 1);
        }
        return;
      }
      const response = await client.chat({
        message: text,
        brief,
        provenance: source?.story?.provenance,
        proposals: (v2 ? [] : v1?.proposals ?? []).slice(0, 3).map((item) => ({
          id: item.id,
          param: item.param,
          from: item.from,
          to: item.to,
          why: item.why,
          predictedDelta: item.predictedDelta,
        })),
        considered: source?.story?.considered,
      });
      await readChatStream(response, (event) => applyEvent(agentId, event));
    } catch (err) {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === agentId ? { ...turn, text: err instanceof Error ? err.message : 'The agent could not answer.' } : turn,
        ),
      );
    } finally {
      setChatBusy(false);
    }
  }

  function applyEvent(agentId: string, event: ChatStreamEvent) {
    setTurns((current) =>
      current.map((turn) => {
        if (turn.id !== agentId) return turn;
        if (event.type === 'step') return { ...turn, steps: [...turn.steps, event.label] };
        if (event.type === 'token') return { ...turn, text: turn.text + event.text };
        if (event.type === 'tool') return { ...turn, tools: [...turn.tools, { title: event.title, detail: event.detail }] };
        if (event.type === 'proposal') {
          return {
            ...turn,
            proposals: [
              ...turn.proposals,
              {
                id: event.id,
                title: event.title,
                from: event.from,
                to: event.to,
                delta: event.delta,
                why: event.why,
                kind: event.kind,
                status: 'open',
                patch: event.patch,
              },
            ],
          };
        }
        if (event.type === 'confirm') return { ...turn, confirmLabel: event.label, confirmId: event.id };
        return turn;
      }),
    );
  }

  function openAgentAction() {
    if (lastRun?.status === 'awaiting_approval' && openProposals.length && !v2) {
      setModal('proposal');
      return;
    }
    if (v2) {
      setModal('compare');
      return;
    }
    if (openProposals.length) setModal('proposal');
  }

  const savedScore = view === 2 && v2?.score != null ? v2.score : v1?.score ?? null;
  const previewScore = live?.total ?? null;
  const shown = savedScore ?? previewScore;
  const band = bandOf(shown ?? 0);
  const scoresDiffer = view === 1 && previewScore != null && savedScore != null && previewScore !== savedScore;
  const barCaption =
    savedScore == null
      ? null
      : scoresDiffer
        ? `Preview ${previewScore} · Saved V${view} ${savedScore}`
        : `Saved V${view} ${savedScore}`;

  useEffect(() => {
    if (phase !== 'result') {
      setBarParked(false);
      return;
    }
    const measure = () => {
      const zoneTop = window.innerHeight - 148;
      const stillUnder = ['sec-score', 'sec-friction', 'sec-agent'].some((id) => {
        const el = document.getElementById(id);
        if (!el) return true;
        return el.getBoundingClientRect().bottom > zoneTop;
      });
      document.querySelector('.np')?.classList.toggle('is-parked', stillUnder);
      setBarParked(stillUnder);
    };
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [phase, view, v1, v2]);

  const chat = (
    <ChatPanel
      turns={turns}
      draft={composer}
      busy={chatBusy}
      onDraft={setComposer}
      onSend={() => void send(composer)}
      onPrompt={(prompt) => void send(prompt)}
      onApprove={(id) => void approve(id)}
      onDismiss={(id) => void dismiss(id)}
      onTweak={(id) => {
        const proposal = turns.flatMap((turn) => turn.proposals).find((item) => item.id === id);
        setComposer(proposal ? `tweak ${proposal.title}` : 'tweak ');
      }}
      onConfirm={(id) => void approve(id)}
    />
  );

  return (
    <FlowShell
      onHome={home}
      agent={
        phase !== 'report' && (phase !== 'result' || barParked) ? (
          <button type="button" className="byb-pill td-head-agent" data-testid="chat-toggle" onClick={() => setSheet((open) => !open)}>
            Agent
          </button>
        ) : null
      }
      bar={
        phase === 'result' && v1 ? (
          <NowPlaying
            draft={draft}
            score={shown}
            band={band.label}
            version={view}
            hasV2={Boolean(v2)}
            caption={barCaption}
            parked={barParked}
            showAgent={!barParked}
            onView={setView}
            onAgent={() => setSheet((open) => !open)}
          />
        ) : null
      }
      dock={
        <>
          {sheet ? (
            <>
              <button type="button" className="td-chatback" aria-label="Close chat" onClick={() => setSheet(false)} />
              <aside className="td-drawer" data-testid="chat-drawer">
                {chatPersona ? (
                  <PersonaChat
                    persona={chatPersona}
                    say={personaSay}
                    evidence={personaChips}
                    draft={personaDraft}
                    busy={chatBusy}
                    onDraft={setPersonaDraft}
                    onSend={() => void sendPersona()}
                    onBack={() => setChatPersona(null)}
                  />
                ) : (
                  <div className="flex h-full min-h-0 flex-col">
                    <AgentSteps labels={labels.length ? labels : undefined} done={phase === 'result'} />
                    {personas.length ? (
                      <div className="td-loop" style={{ paddingTop: 0 }}>
                        {personas.map((persona) => (
                          <button key={persona.id} type="button" className="byb-tbtn" onClick={() => talk(persona)}>
                            {persona.label}
                            <span style={{ marginLeft: 8 }}>{persona.measuring ? '—' : persona.fit}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="min-h-0 flex-1">{chat}</div>
                  </div>
                )}
              </aside>
            </>
          ) : null}
        </>
      }
    >
      {error && phase !== 'input' ? (
        <div className="byb-state is-error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}
      {phase === 'input' ? (
        <InputPhase
          draft={draft}
          controls={controls}
          live={live}
          error={error}
          ask={ask}
          busy={busy}
          onDraft={setDraft}
          onControls={setControls}
          onSubmit={() => void startTest()}
          onAddSimilar={(name) => void addSimilar(name)}
          onAsk={() => void resumeAsk()}
          onExample={() => tryExample()}
        />
      ) : null}
      {phase === 'analyzing' ? (
        <AnalysisPhase
          city={draft.city}
          personas={personas}
          proposal={loopProposal}
          step={progress?.step ?? 0}
          status={progress?.label}
          calls={progress?.shown ?? 0}
          total={progress?.of ?? 0}
        />
      ) : null}
      {phase === 'result' && v1 ? (
        <ResultPhase
          draft={draft}
          controls={controls}
          live={live}
          v1={v1}
          v2={v2}
          view={view}
          personas={personas}
          heatSpots={heatSpots}
          heatNote={heatNote}
          changes={changes}
          timeline={timeline}
          trace={trace}
          target={target}
          stop={stopReason}
          pending={
            !lastRun || lastRun.status === 'awaiting_approval'
              ? (openProposals.find((item) => item.id === pendingId) ?? (v2 ?? v1).proposals.find((item) => item.id === pendingId) ?? null)
              : null
          }
          personaNote={personaNote}
          reinterviewed={reinterviewed}
          ledgerOpen={ledgerOpen}
          frictionOpen={frictionOpen}
          dismissed={dismissed}
          canDecide={!lastRun || lastRun.status === 'awaiting_approval'}
          decisions={lastRun ? openProposals : undefined}
          onView={setView}
          onToggleLedger={() => setLedgerOpen((open) => !open)}
          onToggleFriction={(index) => setFrictionOpen((current) => (current === index ? null : index))}
          onOpenProposal={openAgentAction}
          onOpenPlaylist={() => document.querySelector('.pl-cards')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          onNew={home}
          onDraft={setDraft}
          onControls={setControls}
          onAddSimilar={(name) => void addSimilar(name)}
          onTarget={setTarget}
          onChase={() => chase()}
          onRevert={revert}
          onTalk={talk}
          grounding={lastRun?.grounding ?? 'qloo'}
          compare={compare}
          onWhyQloo={() => void toggleWhy()}
          onLaunch={() => setPhase('report')}
          onApprovePending={() => {
            const proposal = openProposals.find((item) => item.id === pendingId) ?? (v2 ?? v1)?.proposals.find((item) => item.id === pendingId);
            void decide('approve', proposal);
          }}
          onRejectPending={() => {
            const proposal = openProposals.find((item) => item.id === pendingId);
            if (!proposal || !runId) {
              setPendingId(null);
              setStopReason(`Stopped. The concept stays at ${(v2 ?? v1)?.score ?? '—'}.`);
              return;
            }
            void decide('dismiss', proposal);
          }}
        />
      ) : null}
      {phase === 'report' && v1 ? (
        <ReportPhase
          score={(v2 ?? v1).score}
          strength={(v2 ?? v1).evidenceStrength ?? 'MEDIUM'}
          grounding={lastRun?.grounding ?? 'qloo'}
          city={draft.city}
          spots={heatSpots}
          applied={(lastRun?.applied ?? []).map((proposal) => viewOf(proposal, lastRun ? namesOnRun(lastRun) : undefined))}
          stop={stopReason}
          trace={trace}
          onExport={() => window.print()}
          onBack={() => setPhase('result')}
        />
      ) : null}
      {modal === 'proposal' && openProposals.length ? (
        <ProposalModal
          proposals={openProposals}
          busy={busy}
          onApprove={() => void decide('approve', openProposals[0])}
          onReject={() => void decide('dismiss', openProposals[0])}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal === 'compare' && v1 && v2 ? (
        <CompareModal
          v1={v1}
          v2={v2}
          onClose={() => setModal(null)}
          onViewV2={() => {
            setView(2);
            setModal(null);
          }}
        />
      ) : null}
    </FlowShell>
  );
}

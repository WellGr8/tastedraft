'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { comparisonLine, detectLaunch, RunSnapshotSchema, stripEntityIds, type BriefV2, type RunSnapshot } from '@tastedraft/contracts';
import { agentStateFrom, PARTNER_CATALOG, planAgentRounds, type AgentBrief, type AgentPlan, type AgentState } from '@/lib/agent-plan';
import { BenchmarkPanel } from '@/components/benchmark-panel';
import { LaunchReport } from '@/components/launch-report';
import { buildLaunchReport } from '@/lib/launch-report';
import { ApiError, TasteDraftClient, apiBase, type ProposalView, type SimulationResponse } from '@/lib/api';
import { AGES, tourDraft, uniqueById, withImage, type DraftState } from '@/lib/defaults';
import { scoreLive } from '@/lib/engine-preview';
import {
  addChip,
  costAvoided,
  changedMind,
  duplicateIdea,
  formatElapsed,
  formatMoney,
  ideaTitle,
  impactRequest,
  assumptionsForIdea,
  neighborhoodPriceNote,
  nextAssumptions,
  JUDGE_EXAMPLES,
  LAB_EXAMPLES,
  loadLibrary,
  previewGap,
  rememberVersion,
  saveLibrary,
  seedLibrary,
  snagLine,
  type LabChip,
  type LabIdea,
  type LabLibrary,
} from '@/lib/lab';
import {
  featureEntity,
  loadImpact,
  loadLabFeatures,
  loadPersonaChat,
  loadReinterview,
  mergeFeatures,
  stubLabFeatures,
  type LabFeatures,
} from '@/lib/lab-api';
import { caseStudySummary, caseStudyViews, sourceHost, type CaseStudyView } from '@/lib/cases';
import { redTeamOf } from '@/lib/red-team';
import { moveEvidence } from '@/lib/reveal';
import { ScoreReveal } from '@/components/score-reveal';
import { deltaText, fitOf, plainStopReason, tasteVerb, typeLabel } from '@/lib/labels';
import { groupDistricts, insideCity, namedArea, playbackDistricts } from '@/lib/places';
import { chatWithPersona, type Persona } from '@/lib/personas';
import { compareSummary, saturationLabel, type CompareCard, type CompareKind } from '@/lib/compare';
import { runCompare } from '@/lib/compare-run';

function spoken(message: string): string {
  return stripEntityIds(message).replace(/^simulated persona response\.?\s*/i, '').trim();
}

const TEMPLATE_NOTE = 'Template reply. The language model was not used.';

function AreaMap({ city, areas }: { city: string; areas: Array<{ label: string; lat?: number; lng?: number }> }) {
  const points = areas.filter((area): area is { label: string; lat: number; lng: number } => typeof area.lat === 'number' && typeof area.lng === 'number');
  if (!points.length) return null;
  const width = 280;
  const height = 160;
  const pad = 36;
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = maxLat - minLat || 0.02;
  const lngSpan = maxLng - minLng || 0.02;
  const x = (lng: number) => pad + ((lng - minLng) / lngSpan) * (width - pad * 2);
  const y = (lat: number) => pad + ((maxLat - lat) / latSpan) * (height - pad * 2);
  return (
    <svg className="lab-map" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Map of ${city}`}>
      <rect width={width} height={height} rx="16" />
      {points.map((point, index) => (
        <g key={`${point.label}-${index}`}>
          <circle cx={x(point.lng)} cy={y(point.lat)} r="5" />
          <text x={x(point.lng)} y={Math.max(12, y(point.lat) - 8)} textAnchor="middle">
            {point.label.length > 14 ? `${point.label.slice(0, 13)}…` : point.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
import {
  defaultControls,
  positioningForPrice,
  postureForPrice,
  PROFILE_CITIES,
  scarcityForEngine,
  toProfileBrief,
  type PriceLevel,
  type ProfileControls,
  type Scarcity,
} from '@/lib/profile';
import { askFromRun, decisionTrace, personasOf, readRunEvents, simulationOf, type RunProgress } from '@/lib/run';
import { buildRecordedRun, RECORDED_NOTE, scoreBrief } from '@/lib/recorded-tour';
import { distinctVoices, sentimentLabel, sentimentOf } from '@/lib/voice';
import { explainFromRun, parseIntent, suggestChips } from '@/lib/chat-intent';

/**
 * Taste lab. Progress labels come from the run stream.
 * Approve and dismiss follow the latest snapshot when the server answers 409 or 404.
 * The report prints that snapshot's plain text.
 */

const STEPS = ['Idea', 'Customers', 'Proposal', 'Result'] as const;

function movedOn(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 409 || err.status === 404);
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  return reduced;
}

function notableSkews<T extends { name: string; skew: number }>(skews: readonly T[]): T[] {
  return [...skews].sort((a, b) => Math.abs(b.skew) - Math.abs(a.skew) || a.name.localeCompare(b.name)).slice(0, 4);
}

function hue(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 33 + char.charCodeAt(0)) % 360;
  return hash;
}

function nearlyBlank(image: HTMLImageElement): boolean {
  if (image.naturalWidth < 2 || image.naturalHeight < 2) return true;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(image, 0, 0, 8, 8);
    const data = context.getImageData(0, 0, 8, 8).data;
    let light = 0;
    let visible = 0;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] ?? 0;
      if (alpha < 24) continue;
      visible += 1;
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      if (red > 242 && green > 242 && blue > 242) light += 1;
    }
    return visible === 0 || light / visible > 0.82;
  } catch {
    return false;
  }
}

function Cover({ name, type, image, size = 72 }: { name: string; type: string; image?: string | null; size?: number }) {
  const [hidden, setHidden] = useState(!image);
  const imgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    // Static export: an image can fail before React attaches onError, which leaves a broken icon.
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth === 0) setHidden(true);
  });
  const shape = fitOf(type);
  const tone = hue(name);
  const letter = name.trim().slice(0, 1).toUpperCase() || '·';
  const kind = typeLabel(type);
  useEffect(() => {
    if (!image) {
      setHidden(true);
      return;
    }
    setHidden(false);
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = () => {
      if (nearlyBlank(probe)) setHidden(true);
    };
    probe.onerror = () => {
      // A photo can still draw without CORS. The visible image hides itself if it fails.
    };
    probe.src = image;
    return () => {
      probe.onload = null;
      probe.onerror = null;
    };
  }, [image]);
  const photo = Boolean(image) && !hidden;
  return (
    <span
      className={`lab-cover is-${shape}${photo ? ' has-photo' : ''}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(145deg, hsl(${tone} 52% 42%), hsl(${(tone + 36) % 360} 42% 18%))`,
      }}
    >
      {photo ? (
        <img ref={imgRef} src={image ?? ''} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" width={size} height={size} style={{ objectFit: /brand/i.test(type) ? 'contain' : 'cover', background: /brand/i.test(type) ? '#fff' : undefined, width: '100%', height: '100%' }} onError={() => setHidden(true)} />
      ) : (
        <span className="lab-mark">
          <b>{letter}</b>
          <small>{kind}</small>
        </span>
      )}
    </span>
  );
}

function materialize(id: string, draft: DraftState, controls: ProfileControls, library: LabLibrary): LabIdea {
  const found = library.ideas.find((item) => item.id === id);
  const base: LabIdea = found ?? {
    id,
    title: ideaTitle(draft.idea),
    city: draft.city,
    variant: 'A',
    parentId: null,
    draft,
    controls,
    versions: [],
  };
  return { ...base, title: ideaTitle(draft.idea), city: draft.city, draft, controls };
}

function readableWhy(why: string): string {
  try {
    const parsed = JSON.parse(why) as { hypothesis?: string; evidenceIds?: unknown[] };
    if (parsed && typeof parsed.hypothesis === 'string') return `${parsed.hypothesis}${Array.isArray(parsed.evidenceIds) ? ` (${parsed.evidenceIds.length} evidence items)` : ''}`;
  } catch {}
  return why;
}

export function LabApp() {
  const client = useMemo(() => new TasteDraftClient(), []);
  const reduced = useReducedMotion();
  const [library, setLibrary] = useState<LabLibrary>(() => seedLibrary());
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState('draft');
  const [draft, setDraft] = useState<DraftState>(() => tourDraft());
  const [controls, setControls] = useState<ProfileControls>(() => defaultControls());
  const [step, setStep] = useState(1);
  const [reached, setReached] = useState(1);
  const [labMode, setLabMode] = useState<'one' | 'compare'>('one');
  const [compareKind, setCompareKind] = useState<CompareKind>('cities');
  const [compareOptions, setCompareOptions] = useState<string[]>(['', '', '', '', '']);
  const [compareRows, setCompareRows] = useState<CompareCard[]>([]);
  const [live, setLive] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [after, setAfter] = useState<Persona[]>([]);
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const [v1, setV1] = useState<SimulationResponse | null>(null);
  const [v2, setV2] = useState<SimulationResponse | null>(null);
  const [lastRun, setLastRun] = useState<RunSnapshot | null>(null);
  const [ask, setAsk] = useState<ReturnType<typeof askFromRun>>(null);
  const [features, setFeatures] = useState<LabFeatures>(() => stubLabFeatures({ city: 'Tokyo', age: '18–25' }));
  const [impactCost, setImpactCost] = useState<number | null>(null);
  const [places, setPlaces] = useState<Array<{ label: string; weight: number; lat?: number; lng?: number }>>([]);
  const [studies, setStudies] = useState<CaseStudyView[]>([]);
  const [openStudy, setOpenStudy] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const pendingAction = useRef<'test' | 'compare' | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [whyRun, setWhyRun] = useState<RunSnapshot | null>(null);
  const [whyBusy, setWhyBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [appliedPlan, setAppliedPlan] = useState<AgentPlan | null>(null);
  const [over, setOver] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Array<{ id: string; name: string; type: string; image?: string }>>([]);
  const [lines, setLines] = useState<Array<{ role: 'you' | 'agent'; text: string; note?: string }>>([]);
  const [composer, setComposer] = useState('');
  const [talking, setTalking] = useState<Persona | null>(null);
  const briefRef = useRef<BriefV2 | null>(null);
  const clock = useRef<number | null>(null);
  const clockStart = useRef(0);
  const elapsedRef = useRef(0);
  const generation = useRef(0);
  const settled = useRef(false);
  const featureAbort = useRef<AbortController | null>(null);
  const chatInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = loadLibrary();
    if (saved) setLibrary(saved);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveLibrary(library);
  }, [library, ready]);

  useEffect(() => {
    let cancel = false;
    void fetch('/case-studies.json')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancel) setStudies(caseStudyViews(body));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (chatOpen) chatInput.current?.focus();
  }, [chatOpen, talking?.id]);

  useEffect(() => {
    let cancel = false;
    const handle = window.setTimeout(() => {
      try {
        const brief = toProfileBrief(draft, controls);
        briefRef.current = brief;
        void scoreLive({
          idea: brief.idea,
          age: brief.age,
          city: brief.city,
          pos: brief.positioning,
          refs: brief.references.map((item) => item.name),
          posture: postureForPrice(controls.priceLevel),
          scarcity: scarcityForEngine(controls.scarcity),
        }).then((scored) => {
          if (!cancel) setLive(scored.total);
        });
      } catch {
        if (!cancel) setLive(null);
      }
    }, 80);
    return () => {
      cancel = true;
      window.clearTimeout(handle);
    };
  }, [draft, controls]);

  useEffect(() => {
    if (appliedPlan || personas.length === 0) return;
    let cancel = false;
    const areaNames = (features.neighborhoods.length ? features.neighborhoods : places).map((item) => item.label);
    const partners = personas.flatMap((persona) => persona.anchors.map((anchor) => anchor.name));
    void planAgentRounds({ state: agentStateFrom(draft, controls), places: areaNames, partners }, scoreAgentBrief)
      .then((next) => {
        if (!cancel) setPlan(next);
      })
      .catch(() => {
        if (!cancel) setPlan(null);
      });
    return () => {
      cancel = true;
    };
  }, [draft, controls, personas, appliedPlan, features.neighborhoods, places]);

  useEffect(() => {
    if (live == null) return;
    setLibrary((current) => {
      const idea = current.ideas.find((item) => item.id === activeId);
      if (!idea) return current;
      const preview = idea.versions.find((item) => item.n === 0);
      if (preview?.score === live) return current;
      return { ...current, ideas: current.ideas.map((item) => (item.id === activeId ? rememberVersion(item, 0, live) : item)) };
    });
  }, [live, activeId]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void client
        .search(query.trim(), undefined, draft.city)
        .then((result) => setHits(uniqueById(result.entities).slice(0, 4).map((entity) => withImage(entity))))
        .catch(() => setHits([]));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, draft.city, client]);

  useEffect(() => {
    if (!features.niches.length) return;
    setLibrary((current) => {
      const names = new Set(current.chips.map((chip) => chip.name.toLowerCase()));
      const extra = features.niches
        .filter((niche) => !names.has(niche.name.toLowerCase()))
        .map((niche) => ({
          id: niche.id,
          name: niche.name,
          type: niche.type,
          kind: 'reference' as const,
          ...(niche.image ? { image: niche.image } : {}),
        }));
      if (!extra.length) return current;
      return { ...current, chips: [...current.chips, ...extra].slice(0, 16) };
    });
  }, [features]);

  useEffect(() => {
    const body = impactRequest(library.assumptions);
    if (!body) {
      setImpactCost(null);
      return;
    }
    const controller = new AbortController();
    setImpactCost(null);
    void loadImpact(body, fetch, apiBase(), controller.signal).then((result) => {
      if (controller.signal.aborted || !result) return;
      setImpactCost(result.costAvoided);
    });
    return () => controller.abort();
  }, [library.assumptions]);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  useEffect(() => () => {
    if (clock.current) window.clearInterval(clock.current);
    featureAbort.current?.abort();
  }, []);

  function startClock(keep = false) {
    const base = keep ? elapsedRef.current : 0;
    const started = Date.now() - base;
    clockStart.current = started;
    if (!keep) {
      elapsedRef.current = 0;
      setElapsed(0);
    }
    if (clock.current) window.clearInterval(clock.current);
    const tick = () => {
      const next = Date.now() - started;
      elapsedRef.current = next;
      setElapsed(next);
    };
    tick();
    clock.current = window.setInterval(tick, 250);
  }

  function rememberLabel(label: string) {
    if (/budget exhausted|No Qloo entity for/i.test(label)) return;
    setLabels((current) => (current.includes(label) ? current : [...current, label]));
  }

  function markSettled(run: RunSnapshot, city: string) {
    if (run.status === 'running') return;
    const calls = run.qlooCalls;
    const budget = Math.max(run.budget, 1);
    const label = run.grounding === 'recorded'
      ? `Sample run (no live calls). Scored ${city}.`
      : run.status === 'awaiting_input'
        ? `Need one more detail for ${city}.`
        : run.status === 'awaiting_approval'
          ? `Proposal ready for ${city}. ${calls}/${budget} calls`
          : `Scored ${city}. ${calls}/${budget} calls`;
    setProgress({ calls, budget, shown: calls, of: budget, label, step: 5 });
  }

  function stopClock() {
    const started = clockStart.current;
    if (!started) {
      if (clock.current) window.clearInterval(clock.current);
      clock.current = null;
      return;
    }
    const finish = () => {
      if (clockStart.current !== started) return;
      if (clock.current) window.clearInterval(clock.current);
      clock.current = null;
      const next = Date.now() - started;
      elapsedRef.current = next;
      setElapsed(next);
      clockStart.current = 0;
    };
    const soFar = Date.now() - started;
    if (soFar < 1000) {
      window.setTimeout(finish, 1000 - soFar);
      return;
    }
    finish();
  }

  function bump(next: number) {
    setStep(next);
    setReached((current) => Math.max(current, next));
  }

  function noteDistricts(run: RunSnapshot, city: string) {
    if (!run.districts.length) return;
    setPlaces(
      run.districts.slice(0, 5).flatMap((cell) => {
        if (!insideCity(cell.lat, cell.lng, city)) return [];
        return [{
          label: namedArea(cell.label ?? '', city, cell.lat, cell.lng),
          weight: cell.weight,
          lat: cell.lat,
          lng: cell.lng,
        }];
      }),
    );
  }

  async function loadPlaces(brief: BriefV2) {
    try {
      const entities = brief.references.map((item) => item.id).filter((id) => id.startsWith('urn:'));
      const payload = await client.map({
        city: brief.city,
        interests: entities.length ? { entities, tags: [] } : undefined,
      });
      const layer = payload.fits.v1;
      if (layer.kind !== 'heatmap') return;
      setPlaces((current) =>
        current.length
          ? current
          : layer.cells.slice(0, 5).flatMap((cell) => {
              if (!insideCity(cell.lat, cell.lng, brief.city)) return [];
              return [{
                label: namedArea(cell.label ?? '', brief.city, cell.lat, cell.lng),
                weight: cell.weight,
                lat: cell.lat,
                lng: cell.lng,
              }];
            }),
      );
    } catch {
      // The run's own districts still draw the strip.
    }
  }

  function remember(run: RunSnapshot, versionScore: number | null) {
    const idea = materialize(activeId, draft, controls, library);
    const next = rememberVersion(idea, run.version, versionScore);
    setLibrary((current) => {
      const ideas = current.ideas.some((item) => item.id === next.id)
        ? current.ideas.map((item) => (item.id === next.id ? next : item))
        : [next, ...current.ideas];
      return { ...current, ideas };
    });
  }

  async function finishRun(run: RunSnapshot, brief: BriefV2) {
    setLastRun(run);
    noteDistricts(run, brief.city);
    const people = await personasOf(run, brief);
    const sim = simulationOf(run);
    if (run.version <= 1) {
      setPersonas(people);
      setV1(sim);
      setProposal(run.status === 'awaiting_approval' ? (sim.proposals[0] ?? null) : null);
    } else {
      setAfter(people);
      setV2(sim);
    }
    setAsk(run.status === 'awaiting_input' ? askFromRun(run) : null);
    remember(run, run.score);
    markSettled(run, brief.city);
    if (run.status === 'awaiting_input') {
      bump(2);
      return;
    }
    if (run.score == null && people.length === 0) {
      throw new Error(plainStopReason(run.stopReason) || run.report || 'This run stopped before it could recommend a change.');
    }
    bump(run.version > 1 ? 4 : 2);
  }

  function alive(token: number): boolean {
    return token === generation.current;
  }

  async function settleRecorded(brief: BriefV2, token: number) {
    if (!alive(token) || settled.current) return;
    settled.current = true;
    setRunId(null);
    setProgress((current) => ({
      calls: current?.calls ?? 0,
      budget: current?.budget ?? 40,
      shown: 1,
      of: 1,
      label: 'Sample run: scoring this launch on the engine.',
      step: Math.max(current?.step ?? 0, 1),
    }));
    setLabels((current) =>
      current.includes('Sample run: scoring this launch on the engine.')
        ? current
        : [...current, 'Sample run: scoring this launch on the engine.'],
    );
    try {
      const snapshot = await buildRecordedRun(brief);
      if (!alive(token)) return;
      if (!snapshot) throw new Error('Recorded playback could not be scored.');
      const playback = playbackDistricts(brief.city);
      const recordedNote = brief.city.trim().toLowerCase() === 'tokyo'
        ? RECORDED_NOTE
        : 'Sample run. District names are known neighborhoods. The bars are a replay, not a live measurement.';
      setFeatures((current) => ({
        ...current,
        demographicLine: current.skews.length ? current.demographicLine : recordedNote,
        neighborhoods: current.neighborhoods.length
          ? current.neighborhoods
          : playback.map((area) => ({ label: area.label, weight: area.weight, price: null, popularity: null, lat: area.lat, lng: area.lng })),
      }));
      await finishRun(snapshot, brief);
    } catch (err) {
      if (!alive(token)) return;
      setError(err instanceof Error ? err.message : 'Recorded playback could not be scored.');
      setStep(1);
    } finally {
      if (alive(token)) {
        stopClock();
        setBusy(false);
      }
    }
  }

  function startFeatures(brief: BriefV2, token: number) {
    featureAbort.current?.abort();
    const controller = new AbortController();
    featureAbort.current = controller;
    const killer = window.setTimeout(() => controller.abort(), 12_000);
    void loadLabFeatures(brief, {
      base: apiBase(),
      signal: controller.signal,
      onStep: (label) => {
        if (!alive(token)) return;
        rememberLabel(label);
      },
    }).then((incoming) => {
      window.clearTimeout(killer);
      if (!alive(token)) return;
      setFeatures((current) => mergeFeatures(current, incoming));
    });
  }

  const chatRun = useMemo(() => {
    if (!lastRun) return null;
    const city = draft.city;
    const seen = new Set<string>();
    const scored = (lastRun.personas ?? [])
      .flatMap((persona) => persona.anchors ?? [])
      .filter((anchor) => typeof anchor.affinity === 'number' && !seen.has(anchor.name) && seen.add(anchor.name))
      .sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0))
      .map((anchor) => ({ id: `qa:${anchor.id}`, name: anchor.name, kind: String(anchor.type ?? 'entity').replace('urn:entity:', ''), ref: anchor.id, strength: lastRun.evidenceStrength, affinity: anchor.affinity as number, source: 'qloo' as const }));
    const named = lastRun.districts.map((cell) => ({ ...cell, label: namedArea(cell.label ?? '', city, cell.lat, cell.lng) }));
    const districts = groupDistricts(named.map((cell) => ({ ...cell, label: cell.label })));
    return { ...lastRun, districts, evidence: [...scored, ...lastRun.evidence] };
  }, [lastRun, draft.city]);

  function renderSteps(testId: string) {
    return (
        <ul className="lab-log" data-testid={testId}>
          {labels.map((label, index) => {
            const live = busy && index === labels.length - 1;
            const found = lastRun?.steps.find((item) => item.label === label);
            const step = found && /^ev:/.test(found.detail ?? '') ? { ...found, detail: '' } : found;
            const evidential = /qloo|evidence|insight|signal|heat|tag|entit/i.test(label);
            const open = openStep === label;
            return (
              <li key={label} className={open ? 'is-open' : undefined}>
                <button type="button" className="lab-step" onClick={() => setOpenStep(open ? null : label)} aria-expanded={open}>
                  <span className={live ? 'lab-spin' : 'lab-check'} aria-hidden="true">{live ? '' : '✓'}</span>
                  {label}
                </button>
                {open ? (
                  <div className="lab-step-detail" data-testid="step-detail">
                    {step?.detail ? <p>{step.detail}</p> : null}
                    {evidential && chatRun?.evidence.length ? (
                      <ul>
                        {chatRun.evidence.filter((item) => item.affinity !== null).concat(chatRun.evidence.filter((item) => item.affinity === null)).slice(0, 8).map((item) => (
                          <li key={item.id}>{item.name} · {item.kind} · {item.affinity === null ? 'not scored' : `affinity ${item.affinity.toFixed(2)}`} · {item.source === 'qloo' ? 'Qloo' : 'brief'}</li>
                        ))}
                      </ul>
                    ) : null}
                    {!step?.detail && !(evidential && chatRun?.evidence.length) ? <p>{live ? 'Working on this step…' : 'No extra evidence recorded for this step.'}</p> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
    );
  }

  useEffect(() => {
    const action = pendingAction.current;
    if (!action) return;
    pendingAction.current = null;
    if (action === 'test') void testIdea();
    else void compareIdeas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  async function testIdea() {
    let brief: BriefV2;
    try {
      brief = toProfileBrief(draft, controls);
    } catch {
      setError('Add an idea before testing.');
      return;
    }
    const token = ++generation.current;
    settled.current = false;
    briefRef.current = brief;
    setBusy(true);
    setError('');
    setAsk(null);
    setRunId(null);
    setLabels([]);
    setPersonas([]);
    setAfter([]);
    setProposal(null);
    setPlan(null);
    setAppliedPlan(null);
    setV1(null);
    setV2(null);
    setWhyRun(null);
    setReportOpen(false);
    setLastRun(null);
    setPlaces([]);
    setFeatures(stubLabFeatures({ city: brief.city, age: brief.age }));
    setProgress({
      calls: 0,
      budget: 0,
      shown: 0,
      of: 1,
      label: `Asking Qloo for ${brief.city} tastes…`,
      step: 0,
    });
    bump(2);
    startClock();
    startFeatures(brief, token);
    void loadPlaces(brief);
    const timer = window.setTimeout(() => {
      void settleRecorded(brief, token);
    }, 12_000);
    let liveWon = false;
    try {
      const created = await client.createRun(brief);
      if (!alive(token) || settled.current) return;
      setRunId(created.id);
      const run = await readRunEvents(
        created.id,
        async (frame) => {
          if (!alive(token) || settled.current) return;
          rememberLabel(frame.label);
          if (frame.kind === 'personas' || frame.kind === 'interview') {
            const snap = await client.getRun(created.id);
            if (!alive(token) || settled.current) return;
            setPersonas(await personasOf(snap, brief));
          }
          if (frame.kind === 'propose') {
            const snap = await client.getRun(created.id);
            if (!alive(token) || settled.current) return;
            setProposal(simulationOf(snap).proposals[0] ?? null);
          }
        },
        (next) => {
          if (!alive(token) || settled.current) return;
          setProgress((current) => ({ ...next, step: Math.max(current?.step ?? 0, next.step) }));
        },
      );
      if (!alive(token) || settled.current) return;
      const anchored = run.personas.some((persona) => persona.anchors.length > 0);
      const useful = anchored && run.score != null && run.proposals.some((item) => (item.predictedDelta ?? 0) > 0);
      if (run.status === 'awaiting_input' || !useful) {
        await settleRecorded(brief, token);
        return;
      }
      settled.current = true;
      if (timer) window.clearTimeout(timer);
      liveWon = true;
      await finishRun(run, brief);
    } catch {
      if (!alive(token) || settled.current) return;
      await settleRecorded(brief, token);
    } finally {
      if (timer && liveWon) window.clearTimeout(timer);
      if (alive(token) && liveWon) {
        stopClock();
        setBusy(false);
      }
    }
  }

  function follow(run: RunSnapshot, brief: BriefV2) {
    setLastRun(run);
    noteDistricts(run, brief.city);
    const sim = simulationOf(run);
    const open = run.status === 'awaiting_approval' ? (sim.proposals[0] ?? null) : null;
    setProposal(open);
    setAsk(run.status === 'awaiting_input' ? askFromRun(run) : null);
    markSettled(run, brief.city);
    void personasOf(run, brief).then((people) => {
      if (run.version <= 1) setPersonas(people);
      else setAfter(people);
    });
    if (run.version <= 1) {
      setV1(sim);
      bump(open ? 3 : run.status === 'awaiting_input' ? 2 : 4);
    } else {
      setV2(sim);
      bump(4);
    }
    remember(run, run.score);
  }

  async function refetch(note: string) {
    if (!runId || !briefRef.current) {
      setError(note);
      return;
    }
    const run = await client.getRun(runId);
    follow(run, briefRef.current);
    setError(note);
  }

  async function scoreAgentBrief(brief: AgentBrief): Promise<number> {
    const scored = await scoreLive({
      idea: brief.idea,
      age: brief.age,
      city: brief.city,
      pos: brief.pos,
      refs: brief.refs,
      posture: brief.posture,
      scarcity: brief.scarcity,
    });
    return scored.total;
  }

  function draftWithPlan(current: DraftState, state: AgentState): DraftState {
    const references = state.refs.map((name) => {
      const found = current.references.find((entity) => entity.name.toLowerCase() === name.toLowerCase());
      if (found) return found;
      const known = PARTNER_CATALOG.find((entity) => entity.name.toLowerCase() === name.toLowerCase());
      return {
        id: known?.id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name,
        type: known?.type ?? 'urn:entity:brand',
        source: 'sample' as const,
      };
    });
    return {
      ...current,
      idea: state.idea,
      city: state.city,
      age: state.age,
      positioning: positioningForPrice(state.priceLevel),
      references,
    };
  }

  async function applyPlan(ready: AgentPlan) {
    const base = lastRun;
    const nextState = ready.rounds[ready.rounds.length - 1]?.state;
    if (!base || !nextState) return false;
    const beforeBrief = briefRef.current;
    const nextControls = { ...controls, priceLevel: nextState.priceLevel, scarcity: nextState.scarcity };
    const nextDraft = draftWithPlan(draft, nextState);
    setAppliedPlan(ready);
    setPlan(ready);
    setControls(nextControls);
    setDraft(nextDraft);
    const brief = toProfileBrief(nextDraft, nextControls);
    briefRef.current = brief;
    const scored = await scoreBrief(brief);
    const version = Math.max(2, base.version + (base.version < 2 ? 1 : 0));
    const next = RunSnapshotSchema.parse({
      ...base,
      version,
      status: 'stopped',
      stopReason: 'approved_target',
      grounding: base.grounding,
      score: scored.total,
      proposals: [],
      report: ready.action,
      simulation: {
        version,
        total: scored.total,
        ledger: scored.rows.reduce(
          (bag, row) => {
            if (row.id === 'anchor' || row.id === 'cross' || row.id === 'local' || row.id === 'audience' || row.id === 'friction') {
              bag[row.id] = row.points;
            }
            return bag;
          },
          { anchor: null, cross: null, local: null, audience: null, friction: null } as {
            anchor: number | null;
            cross: number | null;
            local: number | null;
            audience: number | null;
            friction: number | null;
          },
        ),
        evidenceStrength: base.evidenceStrength,
        mode: 'sample',
      },
    });
    setRunId(null);
    follow(next, brief);
    setLive(scored.total);
    if (beforeBrief) queueReinterview(beforeBrief, brief);
    return true;
  }

  function applyPrice(nextProposal: ProposalView) {
    if (nextProposal.param !== 'filter.price_level.max') return { draft, controls };
    const level = Number(nextProposal.to);
    if (level !== 1 && level !== 2 && level !== 3 && level !== 4) return { draft, controls };
    const priceLevel = level as PriceLevel;
    const nextControls = { ...controls, priceLevel };
    const nextDraft = { ...draft, positioning: positioningForPrice(priceLevel) };
    setControls(nextControls);
    setDraft(nextDraft);
    return { draft: nextDraft, controls: nextControls };
  }

  async function approveLocal(nextProposal: ProposalView) {
    const base = lastRun;
    if (!base) return;
    const priced = applyPrice(nextProposal);
    const brief = toProfileBrief(priced.draft, priced.controls);
    briefRef.current = brief;
    const scored = await scoreBrief(brief);
    const version = Math.max(2, base.version + (base.version < 2 ? 1 : 0));
    const next = RunSnapshotSchema.parse({
      ...base,
      version,
      status: 'stopped',
      stopReason: 'approved_target',
      grounding: 'recorded',
      score: scored.total,
      proposals: [],
      report: 'Recorded run.',
      simulation: {
        version,
        total: scored.total,
        ledger: scored.rows.reduce(
          (bag, row) => {
            if (row.id === 'anchor' || row.id === 'cross' || row.id === 'local' || row.id === 'audience' || row.id === 'friction') {
              bag[row.id] = row.points;
            }
            return bag;
          },
          { anchor: null, cross: null, local: null, audience: null, friction: null } as {
            anchor: number | null;
            cross: number | null;
            local: number | null;
            audience: number | null;
            friction: number | null;
          },
        ),
        evidenceStrength: base.evidenceStrength,
        mode: 'sample',
      },
    });
    setRunId(null);
    follow(next, brief);
    setLive(scored.total);
  }

  function queueReinterview(beforeBrief: BriefV2, afterBrief: BriefV2) {
    const people = personas.filter((persona) => persona.anchors.length > 0).slice(0, 4);
    const beforeRefs = beforeBrief.references.slice(0, 6).map((entity) => featureEntity(entity));
    const afterRefs = afterBrief.references.slice(0, 6).map((entity) => featureEntity(entity));
    if (!people.length || !beforeRefs.length || !afterRefs.length) return;
    void loadReinterview(
      {
        personas: people.map((persona) => ({
          id: persona.id,
          label: persona.label,
          location: persona.city,
          age: persona.age,
          anchors: persona.anchors.slice(0, 3).map((anchor) => featureEntity(anchor)),
        })),
        before: { references: beforeRefs },
        after: { references: afterRefs },
        budget: 32,
      },
      fetch,
      apiBase(),
    ).then((result) => {
      if (!result) return;
      setFeatures((current) => ({
        ...current,
        reinterview: result.personas,
        warnings: [...current.warnings, ...result.warnings.filter((warning) => !current.warnings.includes(warning))].slice(0, 6),
      }));
    });
  }

  async function approveRemote(id: string, proposalId: string, signal?: AbortSignal): Promise<RunSnapshot> {
    const response = await fetch(`${apiBase()}/api/runs/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId }),
      signal,
    });
    if (!response.ok) throw new ApiError('Approve failed', response.status);
    return RunSnapshotSchema.parse(await response.json());
  }

  async function approve() {
    const beforeBrief = briefRef.current;
    setBusy(true);
    setError('');
    bump(4);
    startClock(true);
    try {
      const areaNames = (features.neighborhoods.length ? features.neighborhoods : places).map((item) => item.label);
      const partners = personas.flatMap((persona) => persona.anchors.map((anchor) => anchor.name));
      const ready = plan && plan.rounds.length
        ? plan
        : await planAgentRounds({ state: agentStateFrom(draft, controls), places: areaNames, partners }, scoreAgentBrief);
      if (ready.rounds.length && (await applyPlan(ready))) return;
      if (!proposal) return;
      if (!runId) {
        await approveLocal(proposal);
        if (beforeBrief && briefRef.current) queueReinterview(beforeBrief, briefRef.current);
        return;
      }
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 8_000);
      let run: RunSnapshot;
      try {
        run = await approveRemote(runId, proposal.id, controller.signal);
      } catch (err) {
        if (timer) window.clearTimeout(timer);
        if (err instanceof Error && err.name === 'AbortError') {
          await approveLocal(proposal);
          if (beforeBrief && briefRef.current) queueReinterview(beforeBrief, briefRef.current);
          return;
        }
        if (!movedOn(err)) throw err;
        const priced = applyPrice(proposal);
        const brief = toProfileBrief(priced.draft, priced.controls);
        briefRef.current = brief;
        const latest = await client.getRun(runId);
        follow(latest, brief);
        setError('This run already moved on. Showing the latest result.');
        return;
      }
      if (timer) window.clearTimeout(timer);
      const priced = run.version >= 2 ? applyPrice(proposal) : { draft, controls };
      const brief = toProfileBrief(priced.draft, priced.controls);
      briefRef.current = brief;
      follow(run, brief);
      if (beforeBrief) queueReinterview(beforeBrief, brief);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
      setStep(3);
    } finally {
      stopClock();
      setBusy(false);
    }
  }

  async function skip() {
    if (!proposal || !runId || !briefRef.current) return;
    setBusy(true);
    setError('');
    try {
      let run: RunSnapshot;
      try {
        run = await client.dismissRun(runId, proposal.id);
      } catch (err) {
        if (!movedOn(err)) throw err;
        await refetch('This run already moved on. Showing the latest result.');
        return;
      }
      follow(run, briefRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Skip failed');
    } finally {
      setBusy(false);
    }
  }

  async function acceptEvidence() {
    if (!ask || !runId) return;
    setBusy(true);
    setError('');
    const suggestion = ask.suggestion;
    const nextDraft: DraftState = {
      ...draft,
      references: [...draft.references],
      locations: [...draft.locations],
      interests: [...draft.interests],
    };
    if (ask.kind === 'city') nextDraft.city = suggestion;
    else {
      nextDraft.references = addChip(nextDraft.references, {
        id: suggestion.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reference',
        name: suggestion,
        type: 'urn:entity',
        kind: 'reference',
      });
    }
    setDraft(nextDraft);
    startClock(true);
    try {
      const result = await client.commandRun(runId, ask.kind === 'city' ? `resume city ${suggestion}` : `resume reference ${suggestion}`);
      const brief = toProfileBrief(nextDraft, controls);
      briefRef.current = brief;
      await finishRun(result.run, brief);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The API could not score this concept');
    } finally {
      stopClock();
      setBusy(false);
    }
  }

  async function why() {
    const brief = briefRef.current;
    if (!brief || whyBusy) return;
    setWhyBusy(true);
    setError('');
    try {
      const created = await client.createRun(brief, 'llm-only');
      const run = await readRunEvents(created.id, () => undefined);
      setWhyRun(run);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The comparison did not finish');
    } finally {
      setWhyBusy(false);
    }
  }

  function openTalk(persona: Persona) {
    setTalking(persona);
    setChatOpen(true);
    const opening = persona.interview.trim();
    setLines([{ role: 'agent', text: spoken(opening) }]);
  }

  function closeTalk() {
    setChatOpen(false);
    setTalking(null);
  }

  function applyExample(example: (typeof LAB_EXAMPLES)[number]) {
    const references = example.references.map((entity) => ({ ...entity }));
    const place = references.find((entity) => /place|destination/.test(entity.type));
    setDraft((current) => ({
      ...current,
      idea: example.idea,
      city: example.city,
      age: example.age,
      positioning: positioningForPrice(example.priceLevel),
      references,
      locations: place ? [{ ...place }] : [],
      interests: example.tags.map((tag) => ({ ...tag })),
    }));
    setControls((current) => ({
      ...current,
      priceLevel: example.priceLevel,
      scarcity: example.scarcity,
    }));
    setLibrary((current) => ({ ...current, assumptions: assumptionsForIdea(example.idea) }));
    if (example.compare) {
      setLabMode('compare');
      setCompareKind(example.compare.kind);
      setCompareOptions([...example.compare.options, '', '', '', '', ''].slice(0, 5));
      setCompareRows([]);
    } else {
      setLabMode('one');
    }
  }

  async function compareIdeas() {
    const labels = compareOptions.map((option) => option.trim()).filter(Boolean);
    if (labels.length < 2) {
      setError('Add at least two options to compare.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const rows = await runCompare({
        draft,
        controls,
        kind: compareKind,
        labels,
        fetchImpl: fetch,
        base: apiBase(),
      });
      setCompareRows(rows);
      bump(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The comparison did not finish');
    } finally {
      setBusy(false);
    }
  }

  async function send(preset?: string) {
    const text = (preset ?? composer).trim();
    if (!text) return;
    const history = lines
      .slice(-8)
      .map((line) => ({
        role: line.role === 'you' ? ('user' as const) : ('persona' as const),
        content: line.text.slice(0, 500),
      }))
      .filter((item) => item.content.length > 0);
    setComposer('');
    setLines((current) => [...current, { role: 'you', text }]);
    try {
      if (talking) {
        const anchors = talking.anchors.slice(0, 8).map((anchor) => {
          const entity = featureEntity(anchor);
          const category = anchor.type.split(':').filter(Boolean).pop()?.replace(/_/g, ' ') || 'taste';
          const reason = anchor.affinity == null
            ? `${category} listed by Qloo, affinity not measured`
            : `${category} with Qloo affinity ${anchor.affinity.toFixed(2)}`;
          return { ...entity, reason: stripEntityIds(reason).slice(0, 240) };
        });
        const frictions = (v1?.frictions ?? [])
          .map((item) => stripEntityIds(item.text).slice(0, 240))
          .filter((line) => line.length > 0)
          .slice(0, 6);
        const idea = stripEntityIds(draft.idea).slice(0, 500);
        setLines((current) => [...current, { role: 'agent', text: '' }]);
        let streamed = '';
        // Recorded runs have zero Qloo calls. Chat still asks the model and only templates when it is unavailable.
        const feature = anchors.length
          ? await loadPersonaChat(
              {
                persona: {
                  id: talking.id,
                  label: talking.label,
                  location: talking.city,
                  age: talking.age,
                  ...(talking.gender ? { gender: talking.gender } : {}),
                  anchors,
                },
                message: text.slice(0, 500),
                ...(history.length ? { history } : {}),
                context: {
                  ...(idea ? { idea } : {}),
                  verdict: talking.role === 'Red team' ? 'Argues against this idea' : sentimentLabel(sentimentOf(talking.fit, talking.measuring)),
                  ...(frictions.length ? { frictions } : {}),
                  ...(talking.role === 'Red team' ? { stance: 'red-team' as const } : {}),
                },
              },
              fetch,
              apiBase(),
              undefined,
              (token) => {
                streamed += token;
                const partial = streamed;
                setLines((current) => {
                  const next = current.slice();
                  const last = next[next.length - 1];
                  if (last?.role === 'agent') next[next.length - 1] = { role: 'agent', text: partial };
                  return next;
                });
              },
            )
          : null;
        const reply = feature ?? {
          label: 'Simulated',
          source: 'template' as const,
          message: (
            await chatWithPersona(
              talking,
              text,
              fetch,
              apiBase(),
              history,
            )
          ).say,
        };
        const shown = spoken(reply.message);
        const note = reply.source === 'template' ? TEMPLATE_NOTE : undefined;
        setLines((current) => {
          const next = current.slice();
          const last = next[next.length - 1];
          if (last?.role === 'agent') {
            next[next.length - 1] = { role: 'agent', text: shown, ...(note ? { note } : {}) };
            return next;
          }
          return [...current, { role: 'agent', text: shown, ...(note ? { note } : {}) }];
        });
        return;
      }
      const say = (reply: string) => setLines((current) => [...current, { role: 'agent', text: reply }]);
      const intent = parseIntent(text);
      if (intent.kind === 'test' || (!runId && intent.kind === 'server')) {
        say(busy ? 'A test is already running. Watch the steps.' : 'Running the test now: personas, Qloo evidence, engine score.');
        if (!busy) pendingAction.current = 'test';
        setDraft((current) => ({ ...current }));
        return;
      }
      if (intent.kind === 'city') {
        say(`Switching the market to ${intent.city} and re-running the test.`);
        pendingAction.current = 'test';
        setDraft((current) => ({ ...current, city: intent.city }));
        return;
      }
      if (intent.kind === 'compare') {
        say(`Comparing ${intent.options.join(' vs ')} with the same engine.`);
        setLabMode('compare');
        setCompareOptions([...intent.options, '', '', '', '', ''].slice(0, 5));
        setCompareRows([]);
        pendingAction.current = 'compare';
        setDraft((current) => ({ ...current }));
        return;
      }
      if (intent.kind === 'explain') {
        say(explainFromRun(chatRun, intent.subject));
        return;
      }
      if (intent.kind === 'approve' || intent.kind === 'cheaper') {
        if (!proposal) {
          say(runId ? 'There is no open proposal right now.' : 'Testing first so the agent can propose a change.');
          if (!runId && !busy) {
            pendingAction.current = 'test';
            setDraft((current) => ({ ...current }));
          }
          return;
        }
        if (intent.kind === 'cheaper' && !/price|cheap|\$|฿|budget/i.test(`${proposal.param ?? ''} ${proposal.after} ${proposal.why}`)) {
          say(`The open proposal is not a price change: "${proposal.after}". Approve it, reject it, or say "why" for the evidence.`);
          return;
        }
        say(`Approving: ${proposal.before} -> ${proposal.after}. Re-scoring.`);
        await approve();
        return;
      }
      if (intent.kind === 'reject') {
        if (!runId || !proposal) {
          say('There is no open proposal to reject.');
          return;
        }
      }
      if (!runId) return;
      const result = await client.commandRun(runId, intent.kind === 'reject' ? 'reject' : text);
      setLines((current) => [...current, { role: 'agent', text: result.reply }]);
      if (briefRef.current) follow(result.run, briefRef.current);
    } catch (err) {
      if (movedOn(err)) {
        await refetch('This run already moved on. Showing the latest result.');
        setLines((current) => [...current, { role: 'agent', text: 'This run already moved on. Showing the latest result.' }]);
        return;
      }
      setLines((current) => [...current, { role: 'agent', text: err instanceof Error ? err.message : 'The agent could not answer.' }]);
    }
  }

  function duplicate() {
    const current = materialize(activeId, draft, controls, library);
    const kept = rememberVersion(current, 0, live);
    const copy = rememberVersion(duplicateIdea(kept, `idea-${crypto.randomUUID()}`), 0, live);
    setLibrary((currentLibrary) => ({
      ...currentLibrary,
      ideas: [kept, copy, ...currentLibrary.ideas.filter((item) => item.id !== kept.id)],
    }));
    setActiveId(copy.id);
    setDraft(copy.draft);
    setControls(copy.controls);
  }

  function selectIdea(idea: LabIdea) {
    setActiveId(idea.id);
    setDraft(idea.draft);
    setControls(idea.controls);
    setStep(1);
    setReportOpen(false);
    setPlan(null);
    setAppliedPlan(null);
    setMenuOpen(false);
  }

  function addReference(chip: LabChip) {
    setDraft((current) => ({ ...current, references: addChip(current.references, chip) }));
  }

  function openReport() {
    if (!lastRun) return;
    const summary = lastRun.report;
    setLibrary((current) => ({
      ...current,
      reports: [
        {
          id: lastRun.id,
          title: ideaTitle(draft.idea),
          city: draft.city,
          v1: v1?.score ?? null,
          v2: v2?.score ?? null,
          cost: impactCost ?? costAvoided(current.assumptions),
          summary,
        },
        ...current.reports.filter((item) => item.id !== lastRun.id),
      ],
    }));
    setReportOpen(true);
    bump(4);
  }

  const cost = costAvoided(library.assumptions);
  const shownCost = impactCost ?? cost;
  const status = progress?.label || (busy ? `Asking Qloo for ${draft.city} tastes…` : 'Ready when you are.');
  const fraction = progress && progress.of > 0 ? Math.min(1, progress.shown / progress.of) : 0;
  const width = Math.max(reduced ? (busy ? 8 : 0) : busy ? 14 : 0, Math.round(fraction * 100));
  const shownIdeas = library.ideas.some((item) => item.id === activeId)
    ? library.ideas
    : [materialize(activeId, draft, controls, library), ...library.ideas];
  const parentId = shownIdeas.find((item) => item.id === activeId)?.parentId ?? activeId;
  const variantA = library.ideas.find((item) => item.id === parentId);
  const variantB = library.ideas.find((item) => item.parentId === parentId && item.variant === 'B');
  const gap =
    variantA && variantB
      ? previewGap(variantA.versions.find((item) => item.n === 0)?.score ?? null, variantB.versions.find((item) => item.n === 0)?.score ?? null)
      : null;
  const afterQuotes = distinctVoices(
    personas.map((persona) => {
      const next = after.find((item) => item.id === persona.id) ?? after.find((item) => item.label === persona.label);
      const anchors = next?.anchors.length ? next.anchors : persona.anchors;
      const fit = next && !next.measuring && next.fit > 0 ? next.fit : 0;
      return { anchors, fit, previous: persona.fit, who: persona.label };
    }),
  );
  const redTeam = redTeamOf(personas, v1?.frictions.map((item) => item.text) ?? []);
  const snag = snagLine(
    personas.map((persona) => ({ label: persona.label, fit: persona.fit, rejects: persona.rejects, measuring: persona.measuring })),
    v1?.frictions.map((item) => item.text) ?? [],
  );
  const heat = groupDistricts(
    (features.neighborhoods.length ? features.neighborhoods : places)
      .map((item) => ({
        label: namedArea(item.label, draft.city, item.lat, item.lng),
        weight: item.weight,
        ...(typeof item.lat === 'number' ? { lat: item.lat } : {}),
        ...(typeof item.lng === 'number' ? { lng: item.lng } : {}),
      }))
      .filter((item) => item.lat == null || item.lng == null || insideCity(item.lat, item.lng, draft.city)),
  );
  const launch = detectLaunch(draft.idea);
  const neighborhoods = heat.map((item) => item.label);
  const priceNote = neighborhoodPriceNote(features.priceLine, proposal);
  const customersReady = personas.length > 0 || Boolean(ask);
  const references = uniqueById(draft.references);
  const chips = uniqueById(library.chips);
  const moved = /moved on/i.test(error);

  return (
    <div className="lab" data-testid="lab-root">
      {menuOpen ? <button type="button" className="lab-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} /> : null}
      <aside className="lab-side" data-testid="sidebar" data-open={menuOpen ? 'true' : 'false'}>
        <p className="lab-brand">
          <i />
          TasteDraft
        </p>
        <p className="lab-k">Your ideas</p>
        {shownIdeas.map((idea) => (
          <button key={idea.id} type="button" className={idea.id === activeId ? 'lab-idea is-on' : 'lab-idea'} onClick={() => selectIdea(idea)}>
            <span className="lab-variant">{idea.variant}</span>
            <span>
              <b>{idea.title}</b>
              <small>
                {idea.city}
                {idea.versions.find((item) => item.n > 0)?.score != null ? ` · ${idea.versions.filter((item) => item.n > 0).map((item) => `V${item.n} ${item.score ?? '—'}`).join(' ')}` : ''}
              </small>
            </span>
          </button>
        ))}
        <button type="button" className="lab-duplicate" data-testid="duplicate-idea" onClick={duplicate}>
          Duplicate into a variant
        </button>
        <p className="lab-k">Taste library</p>
        <input className="lab-search" data-testid="reference-search" value={query} placeholder="Add a reference" onChange={(event) => setQuery(event.target.value)} />
        {hits.map((hit) => (
          <button
            key={hit.id}
            type="button"
            className="lab-hit"
            data-testid="search-hit"
            onClick={() => addReference({ id: hit.id, name: hit.name, type: hit.type, kind: 'reference', ...(hit.image ? { image: hit.image } : {}) })}
          >
            <Cover name={hit.name} type={hit.type} image={hit.image} size={36} />
            {hit.name}
          </button>
        ))}
        <div className="lab-chips">
          {chips.map((chip) => (
            <div
              key={chip.id}
              className="lab-chip"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-taste-chip', JSON.stringify(chip));
                event.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <Cover name={chip.name} type={chip.type} image={chip.image} size={40} />
              <span>
                {chip.name}
                <small>{chip.kind === 'audience' ? 'Audience' : typeLabel(chip.type)}</small>
              </span>
            </div>
          ))}
        </div>
        <p className="lab-k">Markets</p>
        {PROFILE_CITIES.map((city) => (
          <button key={city} type="button" className={draft.city === city ? 'lab-market is-on' : 'lab-market'} onClick={() => { setDraft((current) => ({ ...current, city })); setMenuOpen(false); }}>
            <small>{city}</small>
          </button>
        ))}
        <p className="lab-k">Reports</p>
        {library.reports.length === 0 ? <p className="lab-meta-line" style={{ margin: '0 8px' }}>A report lands after you test.</p> : null}
        {library.reports.map((report) => (
          <button key={report.id} type="button" className="lab-report" onClick={() => { setReportOpen(true); bump(4); }}>
            <span>
              <b>{report.title}</b>
              <small>
                {report.city} · {report.v2 ?? report.v1 ?? '—'}
              </small>
            </span>
          </button>
        ))}
        {studies.length ? (
          <div className="lab-cases" data-testid="case-studies">
            <p className="lab-case-sum">{caseStudySummary(studies)}</p>
            {studies.map((study) => (
              <div
                key={study.id}
                className="lab-case"
                role="button"
                tabIndex={0}
                aria-expanded={openStudy === study.id}
                onClick={() => setOpenStudy((current) => (current === study.id ? null : study.id))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setOpenStudy((current) => (current === study.id ? null : study.id));
                  }
                }}
              >
                <b>{study.short}</b>
                <small>
                  {study.domainLabel}
                  {study.market ? ` · ${study.market}` : ''}
                  {' · '}
                  {study.scored ? `rank ${study.realRank}/${study.cityCount}${study.confidence ? ` · ${study.confidence}` : ''} · ${study.matched ? 'Match' : 'Miss'}` : 'Awaiting live Qloo'}
                </small>
                {openStudy === study.id ? (
                  <span>
                    {study.outcomeSummary}
                    {study.scored && study.confidence ? ` Panel confidence ${study.confidence}.` : ' Not scored on this pass.'}
                    {study.cities.length ? (
                      <span className="lab-case-ranks">
                        {study.cities.map((city) => (
                          <span key={city.city} className={city.city === study.market ? 'is-launch' : undefined}>
                            {city.rank != null ? `${city.rank}. ` : '— '}
                            {city.city}
                            {city.score != null ? ` ${city.score}` : ''}
                            {city.city === study.market ? ' · launch city' : ''}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {study.sources.length ? (
                      <span className="lab-case-sources">
                        {study.sources.map((url) => (
                          <a key={url} href={url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                            {sourceHost(url)}
                          </a>
                        ))}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
            ))}
            <p className="lab-case-note">Ranking method fixed on 2026-10-14. Ranks by taste lift, not city size. Successes should rank in the top 2. Failures should rank in the bottom 2. Not a sales forecast.</p>
          </div>
        ) : null}
      </aside>
      <main className="lab-canvas">
        <header className="lab-topbar">
          <button type="button" className="lab-menu" data-testid="lab-menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            Ideas
          </button>
          <p className="lab-brand"><i />TasteDraft</p>
          <p className="lab-progress" data-testid="lab-progress">{step} / {STEPS.length} {STEPS[step - 1]}</p>
        </header>
        <div className="lab-scroll">
          <ol className="lab-steps" data-testid="lab-stepper">
            {STEPS.map((label, index) => {
              const number = index + 1;
              return (
                <li key={label}>
                  <button type="button" aria-current={step === number ? 'step' : undefined} disabled={number > reached} onClick={() => setStep(number)}>
                    <em>{number}</em>
                    {label}
                  </button>
                </li>
              );
            })}
          </ol>
          {error ? <p className={moved ? 'lab-note' : 'lab-error'}>{error}</p> : null}
          {gap ? <p className="lab-note" data-testid="ab-compare">{gap}</p> : null}

          {step === 1 ? (
            <section className="lab-in">
              <div className="lab-hero">
                <div>
                  <p className="lab-eyebrow">Any launch</p>
                  <h1>
                    Test the taste
                    <span>before you spend.</span>
                  </h1>
                  <p>A cafe, a game, a brand, a trip, or a show. Four simulated customers. One change you can approve. The number comes from the engine, and it is not a sales forecast.</p>
                </div>
                <div className="lab-fan" aria-hidden="true">
                  {references.slice(0, 4).map((entity) => (
                    <Cover key={entity.id} name={entity.name} type={entity.type} image={entity.image} size={78} />
                  ))}
                </div>
              </div>
              <div className="lab-mode" role="group" aria-label="How to test" data-testid="lab-mode">
                <button type="button" aria-pressed={labMode === 'one'} onClick={() => setLabMode('one')}>Test one</button>
                <button type="button" aria-pressed={labMode === 'compare'} onClick={() => setLabMode('compare')}>Compare options</button>
              </div>
              {labMode === 'compare' ? (
                <div className="lab-card lab-compare-setup" data-testid="compare-setup">
                  <label className="lab-label" htmlFor="compare-kind">What changes between options</label>
                  <select id="compare-kind" className="lab-select" value={compareKind} onChange={(event) => setCompareKind(event.target.value as CompareKind)}>
                    <option value="cities">Cities</option>
                    <option value="neighborhoods">Neighborhoods in this city</option>
                    <option value="variants">Variants of the idea</option>
                  </select>
                  <div className="lab-compare-options">
                    {compareOptions.map((option, index) => (
                      <label key={index} className="lab-label">
                        Option {index + 1}
                        <input
                          value={option}
                          maxLength={80}
                          onChange={(event) => {
                            const value = event.target.value;
                            setCompareOptions((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="lab-fine">Up to five options. Each one gets the persona panel and one cached Qloo saturation read.</p>
                </div>
              ) : null}
              <div className="lab-split">
                <div className="lab-card">
                  <label className="lab-label" htmlFor="lab-idea">Your idea</label>
                  <textarea id="lab-idea" className="lab-idea-input" value={draft.idea} onChange={(event) => {
                    const idea = event.target.value;
                    setLibrary((current) => ({ ...current, assumptions: nextAssumptions(draft.idea, idea, current.assumptions) }));
                    setDraft((current) => ({ ...current, idea }));
                  }} />
                  <p className="lab-fine" data-testid="launch-kind">{launch.label} · {launch.types.join(', ')}</p>
                  <label className="lab-label" htmlFor="lab-city" style={{ marginTop: 12 }}>Market</label>
                  <select id="lab-city" className="lab-select" value={draft.city} onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))}>
                    {PROFILE_CITIES.map((city) => (
                      <option key={city}>{city}</option>
                    ))}
                  </select>
                </div>
                <div className="lab-card lab-impact" data-testid="impact-panel">
                  <div>
                    <span className="lab-label" title="0–100: how well this idea matches what this audience already loves, per Qloo taste data. Updates as you edit; Test this idea runs the full check.">Taste fit (preview)</span>
                    <strong data-testid="live-score">{live ?? '—'}</strong>
                    <small className="lab-fine">0–100 audience taste match. Press Test this idea for the full check. Not a sales forecast.</small>
                  </div>
                  <div>
                    <span className="lab-label">Market-test cost avoided</span>
                    <strong>{formatMoney(shownCost)}</strong>
                    <small className="lab-fine">Estimate, not a forecast</small>
                  </div>
                  <p className="lab-fine lab-compare" data-testid="impact-compare">{comparisonLine(launch.kind)}</p>
                  <div className="lab-assumptions">
                    <label className="lab-assumption">
                      Focus group $
                      <input data-testid="assumption-focus" type="number" min={0} value={library.assumptions.focusGroupUsd} onChange={(event) => setLibrary((current) => ({ ...current, assumptions: { ...current.assumptions, focusGroupUsd: Number(event.target.value) } }))} />
                    </label>
                    <label className="lab-assumption">
                      Groups
                      <input data-testid="assumption-groups" type="number" min={0} value={library.assumptions.groups} onChange={(event) => setLibrary((current) => ({ ...current, assumptions: { ...current.assumptions, groups: Number(event.target.value) } }))} />
                    </label>
                    <label className="lab-assumption">
                      Pilot day $
                      <input data-testid="assumption-pilot" type="number" min={0} value={library.assumptions.pilotDayUsd} onChange={(event) => setLibrary((current) => ({ ...current, assumptions: { ...current.assumptions, pilotDayUsd: Number(event.target.value) } }))} />
                    </label>
                    <label className="lab-assumption">
                      Days
                      <input data-testid="assumption-days" type="number" min={0} value={library.assumptions.pilotDays} onChange={(event) => setLibrary((current) => ({ ...current, assumptions: { ...current.assumptions, pilotDays: Number(event.target.value) } }))} />
                    </label>
                  </div>
                </div>
              </div>
              <div
                className={over ? 'lab-albums is-over' : 'lab-albums'}
                onDragOver={(event) => {
                  event.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setOver(false);
                  const raw = event.dataTransfer.getData('application/x-taste-chip');
                  if (!raw) return;
                  try {
                    addReference(JSON.parse(raw) as LabChip);
                  } catch {
                    // A bad drag payload does not change the idea.
                  }
                }}
              >
                {references.map((entity) => (
                  <figure key={entity.id} className="lab-album">
                    <Cover name={entity.name} type={entity.type} image={entity.image} size={72} />
                    <figcaption>{entity.name}</figcaption>
                    <button type="button" aria-label={`Remove ${entity.name}`} onClick={() => setDraft((current) => ({ ...current, references: current.references.filter((item) => item.id !== entity.id) }))}>
                      ×
                    </button>
                  </figure>
                ))}
              </div>
              <div className="lab-examples">
                {LAB_EXAMPLES.map((example) => (
                  <button key={example.id} type="button" onClick={() => applyExample(example)}>
                    {example.label}
                  </button>
                ))}
              </div>
              <p className="lab-fine lab-more">More starting points</p>
              <div className="lab-examples" data-testid="judge-examples">
                {JUDGE_EXAMPLES.map((example) => (
                  <button key={example.id} type="button" onClick={() => applyExample(example)}>
                    {example.label}
                  </button>
                ))}
              </div>
              <div className="lab-go">
                <span className="byb-ring" data-busy={busy ? 'true' : 'false'}>
                  <button type="button" className="byb-primary" onClick={() => void (labMode === 'compare' ? compareIdeas() : testIdea())} disabled={busy}>
                    {labMode === 'compare' ? 'Compare these' : 'Test this idea'}
                  </button>
                </span>
              </div>
              <details className="lab-card">
                <summary>Advanced</summary>
                <div className="lab-split" style={{ marginTop: 12 }}>
                  <label className="lab-label">
                    Age
                    <select className="lab-select" value={draft.age} onChange={(event) => setDraft((current) => ({ ...current, age: event.target.value }))}>
                      {AGES.map((age) => (
                        <option key={age}>{age}</option>
                      ))}
                    </select>
                  </label>
                  <label className="lab-label">
                    Price level {controls.priceLevel}
                    <input data-testid="price-slider" type="range" min={1} max={4} step={1} value={controls.priceLevel} onChange={(event) => {
                      const priceLevel = Number(event.target.value) as PriceLevel;
                      setControls((current) => ({ ...current, priceLevel }));
                      setDraft((current) => ({ ...current, positioning: positioningForPrice(priceLevel) }));
                    }} />
                  </label>
                  <label className="lab-label">
                    Scarcity
                    <select className="lab-select" value={controls.scarcity} onChange={(event) => setControls((current) => ({ ...current, scarcity: event.target.value as Scarcity }))}>
                      <option value="open">Open</option>
                      <option value="limited">Limited</option>
                      <option value="preorder">Preorder</option>
                    </select>
                  </label>
                </div>
              </details>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="lab-in">
              <h2 className="lab-section-title">What customers say</h2>
              {lastRun?.grounding === 'recorded' ? <span className="lab-pill" data-testid="recorded-run">Recorded run</span> : null}
              <p className="lab-fine">{status}</p>
              {compareRows.length ? (
                <div data-testid="compare-results">
                  <p className="lab-compare-summary" data-testid="compare-summary">{compareSummary(compareRows)}</p>
                  <ol className="lab-compare-list">
                    {compareRows.map((row) => (
                      <li key={row.id} className={row.verdict ? `lab-card is-${row.verdict}` : 'lab-card'} data-testid="compare-row">
                        <header>
                          <div>
                            <h3><span className="lab-rank">{row.rank ?? '—'}</span> {row.label}</h3>
                            <div className="lab-row-meta">
                              {row.verdict === 'best-bet' ? <span className="lab-pill is-buy">Best bet</span> : null}
                              {row.verdict === 'safe-market' ? <span className="lab-pill is-curious">Safe big market</span> : null}
                              <span className="lab-pill">{saturationLabel(row.saturation)}</span>
                            </div>
                          </div>
                          <strong className="lab-score-lg">{row.score ?? '—'}</strong>
                        </header>
                        <p>{row.reason}</p>
                        <p className="lab-fine">{row.risk}</p>
                        <details>
                          <summary>Why?</summary>
                          <p className="lab-fine">
                            Score {row.score ?? '—'} from audience {row.local == null ? '—' : row.local.toFixed(2)}, heatmap {row.heatmap == null ? '—' : row.heatmap.toFixed(2)}, popularity {row.popularity == null ? '—' : row.popularity.toFixed(2)}.
                            Engine fit {row.fit ?? '—'}. Saturation {row.saturation == null ? 'not measured' : row.saturation.toFixed(2)}.
                            {row.personas.length ? ` Panel: ${row.personas.join(', ')}.` : ''}
                          </p>
                        </details>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {customersReady ? (
                <>
                  {ask ? (
                    <div className="lab-card" data-testid="evidence-ask">
                      <p>{ask.question}</p>
                      <button type="button" className="lab-quiet" data-testid="evidence-ask-action" onClick={() => void acceptEvidence()}>
                        Use {ask.suggestion}
                      </button>
                    </div>
                  ) : null}
                  <div className="lab-personas">
                    {personas.map((persona) => (
                      <article key={persona.id} className="lab-card lab-persona" data-testid="persona-card">
                        <header>
                          <div>
                            <h3>{persona.label}</h3>
                            <div className="lab-row-meta">
                              <span className="lab-pill is-sim">Simulated</span>
                              <span className={`lab-pill is-${sentimentOf(persona.fit, persona.measuring)}`}>{sentimentLabel(sentimentOf(persona.fit, persona.measuring))}</span>
                            </div>
                          </div>
                          <strong className="lab-score-lg" data-testid="persona-score">{persona.measuring || persona.fit <= 0 ? '—' : persona.fit}</strong>
                        </header>
                        <div className="lab-anchors">
                          {uniqueById(persona.anchors).slice(0, 3).map((anchor) => (
                            <Cover key={anchor.id} name={anchor.name} type={anchor.type} image={anchor.image} size={48} />
                          ))}
                        </div>
                        {persona.taste.length ? (
                          <ul className="lab-taste" data-testid="taste-graph">
                            {persona.taste.slice(0, 5).map((link) => (
                              <li key={`${link.type}-${link.name}`}>
                                <em>{tasteVerb(link.type)}</em>
                                <span>{link.name}</span>
                                {link.affinity != null ? <small>{Math.round(link.affinity * 100)}</small> : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <p className="lab-quote" data-testid="persona-quote">{persona.interview}</p>
                        <button type="button" className="lab-quiet" onClick={() => openTalk(persona)}>
                          Talk
                        </button>
                      </article>
                    ))}
                    {redTeam ? (
                      <article className="lab-card lab-persona lab-redteam" data-testid="red-team">
                        <header>
                          <div>
                            <h3>{redTeam.label}</h3>
                            <div className="lab-row-meta">
                              <span className="lab-pill is-red">Red team</span>
                              <span className="lab-pill is-pass">Objects</span>
                            </div>
                          </div>
                          <strong className="lab-score-lg" data-testid="red-team-score">{redTeam.fit}</strong>
                        </header>
                        <div className="lab-anchors">
                          {uniqueById(redTeam.anchors).slice(0, 3).map((anchor) => (
                            <Cover key={anchor.id} name={anchor.name} type={anchor.type} image={anchor.image} size={48} />
                          ))}
                        </div>
                        <p className="lab-quote" data-testid="red-team-quote">{redTeam.interview}</p>
                        <button type="button" className="lab-quiet" onClick={() => openTalk(redTeam)}>
                          Talk
                        </button>
                      </article>
                    ) : null}
                  </div>
                  <div className="lab-follow">
                    <p className="lab-note" data-testid="customer-summary">{snag}</p>
                    <p className="lab-fine" data-testid="feature-stub">Target is {draft.age} in {draft.city}.</p>
                    {features.competitors.length ? (
                      <p className="lab-fine">Also near {[...new Set(features.competitors.map((row) => row.name))].slice(0, 3).join(', ')}.</p>
                    ) : null}
                  </div>
                  <details className="lab-why">
                    <summary>Why?</summary>
                    {features.mismatch != null ? <p className="lab-fine">Mean demographic mismatch {features.mismatch}.</p> : <p className="lab-fine">{features.demographicLine}</p>}
                    {notableSkews(features.skews).length ? (
                      <div className="lab-skew">
                        {notableSkews(features.skews).map((row) => (
                          <div key={`${row.name}-${row.bucket}`}>
                            <span>{row.name} · {row.bucket.replaceAll('_', ' ')} ({row.skew > 0 ? `+${row.skew}` : row.skew})</span>
                            <i><em style={{ width: `${Math.max(8, Math.round(Math.abs(row.skew) * 100))}%` }} data-sign={row.skew < 0 ? 'down' : 'up'} /></i>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {personas.some((persona) => persona.taste.length) ? (
                      <div data-testid="taste-evidence">
                        {personas.map((persona) => (
                          <p key={persona.id} className="lab-fine">
                            {persona.label}: {persona.taste.map((link) => `${tasteVerb(link.type)} ${link.name}${link.affinity == null ? '' : ` ${Math.round(link.affinity * 100)}`}`).join(' · ')}
                          </p>
                        ))}
                        <p className="lab-fine">
                          {lastRun?.grounding === 'recorded'
                            ? 'Recorded run. Cross-domain names are from this brief. Affinity was not measured.'
                            : 'People who like this also show up across these Qloo types.'}
                        </p>
                      </div>
                    ) : null}
                    {features.warnings.filter((warning) => !/budget exhausted/i.test(warning)).slice(0, 3).map((warning) => (
                      <p key={warning} className="lab-fine">{stripEntityIds(warning)}</p>
                    ))}
                  </details>
                  <div className="lab-card lab-heat" data-testid="heatmap">
                    <span className="lab-label">Neighborhood fit</span>
                    <AreaMap city={draft.city} areas={heat} />
                    {heat.length === 0 ? <p className="lab-fine">{busy ? 'Loading neighborhoods' : 'Neighborhoods appear as the heatmap returns.'}</p> : null}
                    {priceNote ? <p className="lab-fine" data-testid="price-note">{priceNote}</p> : null}
                    {heat.map((item) => (
                      <div key={item.label}>
                        <span className="lab-fine">{item.label}</span>
                        <i style={{ width: `${Math.max(8, Math.round(item.weight * 100))}%` }} />
                      </div>
                    ))}
                  </div>
                  {(features.activation.places.length || features.activation.podcasts.length || features.activation.brands.length) ? (
                    <p className="lab-fine">
                      Show up at {[...features.activation.places, ...features.activation.podcasts, ...features.activation.brands].join(', ')}.
                    </p>
                  ) : null}
                </>
              ) : compareRows.length ? null : (
                <>
                  <p className="lab-fine" data-testid="customers-loading">Loading customers</p>
                  <div className="lab-personas">
                    {[0, 1, 2, 3].map((item) => <div key={item} className="lab-shimmer" />)}
                  </div>
                </>
              )}
              <div className="lab-go">
                <span className="byb-ring" data-busy={busy ? 'true' : 'false'}>
                  <button type="button" className="byb-primary" disabled={busy || (!proposal && !plan?.rounds.length)} onClick={() => bump(3)}>
                    Let the Agent fix it
                  </button>
                </span>
              </div>
            </section>
          ) : null}

          {step === 3 && plan && plan.rounds.length ? (
            <section className="lab-in lab-card lab-proposal" data-testid="agent-rounds">
              <p className="lab-eyebrow" style={{ color: '#4a5273' }}>Agent</p>
              <h2 className="lab-section-title">Changes that move the score</h2>
              <p className="lab-report-flips">{plan.before} → {plan.after}</p>
              <ol className="lab-rounds">
                {plan.rounds.map((round) => (
                  <li key={`${round.kind}-${round.title}`} data-testid="agent-round">
                    <b>{round.title}</b>
                    <span>+{round.delta} to {round.score}</span>
                    <p>{round.before}</p>
                    <p>{round.after}</p>
                    <p className="lab-fine">{round.why}</p>
                  </li>
                ))}
              </ol>
              <p data-testid="agent-stop">{plan.stop}</p>
              <div className="lab-go">
                <span className="byb-ring" data-busy={busy ? 'true' : 'false'}>
                  <button type="button" className="byb-primary" disabled={busy} onClick={() => void approve()}>
                    Approve
                  </button>
                </span>
                <button type="button" className="lab-ghost" disabled={busy} onClick={() => void skip()}>
                  Skip
                </button>
                <button type="button" className="lab-quiet" data-testid="why-qloo" onClick={() => void why()}>
                  {whyBusy ? 'Comparing…' : 'Why Qloo'}
                </button>
              </div>
              {whyRun ? (
                <div className="lab-split" data-testid="why-qloo-panel">
                  <article className="lab-card">
                    <p className="lab-eyebrow" style={{ color: '#4a5273' }}>Qloo-grounded</p>
                    <p>Cultural resonance score {v1?.score ?? '—'}</p>
                    <p className="lab-fine">Not a sales forecast</p>
                  </article>
                  <article className="lab-card">
                    <p className="lab-eyebrow" style={{ color: '#4a5273' }}>LLM-only</p>
                    <p>No score. This pass does not call Qloo.</p>
                    <p className="lab-fine" data-testid="llm-stop">{plainStopReason(whyRun.stopReason ?? 'insufficient_evidence')}</p>
                    <p className="lab-plain">{whyRun.report}</p>
                  </article>
                </div>
              ) : null}
            </section>
          ) : null}

          {step === 3 && proposal && !(plan && plan.rounds.length) ? (
            <section className="lab-in lab-card lab-proposal">
              <p className="lab-eyebrow" style={{ color: '#4a5273' }}>One change</p>
              <h2 className="lab-section-title">The agent would change this</h2>
              <div className="lab-ba">
                <span>{proposal.before}</span>
                <span aria-hidden="true">→</span>
                <span>{proposal.after}</span>
              </div>
              <p>{proposal.why}</p>
              <p className="lab-fine">Evidence {proposal.evidence}</p>
              {deltaText(proposal.predictedDelta) ? <p className="lab-delta">{deltaText(proposal.predictedDelta)} on the engine. Not a sales forecast.</p> : null}
              {features.explain.length ? (
                <ul>
                  {features.explain.map((row) => (
                    <li key={row.name}>
                      {row.name}: weight {row.after ?? '—'}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lab-fine">Explainability shows up when the competitor benchmark returns.</p>
              )}
              <details>
                <summary>Why?</summary>
                <p>{lastRun ? decisionTrace(lastRun, draft.city).summary : proposal.why}</p>
              </details>
              <div className="lab-go">
                <span className="byb-ring" data-busy={busy ? 'true' : 'false'}>
                  <button type="button" className="byb-primary" disabled={busy} onClick={() => void approve()}>
                    Approve
                  </button>
                </span>
                <button type="button" className="lab-ghost" disabled={busy} onClick={() => void skip()}>
                  Skip
                </button>
                <button type="button" className="lab-quiet" data-testid="why-qloo" onClick={() => void why()}>
                  {whyBusy ? 'Comparing…' : 'Why Qloo'}
                </button>
              </div>
              {whyRun ? (
                <div className="lab-split" data-testid="why-qloo-panel">
                  <article className="lab-card">
                    <p className="lab-eyebrow" style={{ color: '#4a5273' }}>Qloo-grounded</p>
                    <p>Cultural resonance score {v1?.score ?? '—'}</p>
                    <p className="lab-fine">Not a sales forecast</p>
                  </article>
                  <article className="lab-card">
                    <p className="lab-eyebrow" style={{ color: '#4a5273' }}>LLM-only</p>
                    <p>No score. This pass does not call Qloo.</p>
                    <p className="lab-fine" data-testid="llm-stop">{plainStopReason(whyRun.stopReason ?? 'insufficient_evidence')}</p>
                    <p className="lab-plain">{whyRun.report}</p>
                  </article>
                </div>
              ) : null}
            </section>
          ) : null}

          {step === 3 && !proposal && !(plan && plan.rounds.length) ? (
            <section className="lab-card">
              <h2 className="lab-section-title">No change is waiting</h2>
              {lastRun?.stopReason ? <p data-testid="stop-reason">{plainStopReason(lastRun.stopReason)}</p> : <p>Test the idea, then come back for the one change.</p>}
            </section>
          ) : null}

          {step === 4 && !reportOpen ? (
            <section className="lab-in lab-result">
              <BenchmarkPanel />
              <h2 className="lab-section-title">Version 1 beside version 2</h2>
              {lastRun?.grounding === 'recorded' ? <span className="lab-pill" data-testid="recorded-run">Recorded run</span> : null}
              <p className="lab-fine">Market-test cost avoided {formatMoney(shownCost)}. Estimate, not a forecast.</p>
              <div className="lab-versions">
                <article className="lab-card">
                  <span className="lab-label">Version 1</span>
                  <strong data-testid="score-v1">{v1?.score ?? '—'}</strong>
                  <p className="lab-fine">Not a sales forecast</p>
                </article>
                <article className="lab-card">
                  <span className="lab-label">Version 2</span>
                  <strong data-testid="score-v2">{v2?.score ?? '—'}</strong>
                  <p className="lab-fine">{busy ? status : 'Same personas, scored again.'}</p>
                </article>
              </div>
              {personas.map((persona, index) => {
                const next = after.find((item) => item.id === persona.id) ?? after.find((item) => item.label === persona.label);
                const api = features.reinterview.find((row) => row.id === persona.id) ?? features.reinterview.find((row) => row.label === persona.label);
                const apiShift = Boolean(api && api.before != null && api.after != null && api.changedMind);
                const shifted = next ? changedMind(persona.fit, next.fit, persona.measuring, next.measuring) || apiShift : false;
                const anchors = next?.anchors.length ? next.anchors : persona.anchors;
                const afterQuote = afterQuotes[index] ?? 'Still measuring what this person actually likes.';
                const afterSentiment = next ? sentimentOf(next.fit, next.measuring) : 'measuring';
                const friction = v1?.frictions.map((item) => item.text).find((line) => line.trim()) ?? null;
                return (
                  <ScoreReveal
                    key={persona.id}
                    name={persona.label}
                    from={persona.fit}
                    to={next && next.fit > 0 ? next.fit : persona.fit}
                    fromSentiment={sentimentOf(persona.fit, persona.measuring)}
                    toSentiment={afterSentiment}
                    beforeQuote={persona.interview}
                    afterQuote={afterQuote}
                    shifted={shifted}
                    evidence={moveEvidence(
                      persona.anchors.map((anchor) => anchor.name),
                      anchors.map((anchor) => anchor.name),
                      api?.reason ?? null,
                      friction,
                    )}
                    reduced={reduced}
                    delayMs={index * 160}
                  />
                );
              })}
              <div className="lab-go">
                <span className="byb-ring">
                  <button type="button" className="byb-primary" data-testid="open-report" onClick={openReport} disabled={!lastRun}>
                    Report
                  </button>
                </span>
                <button type="button" className="lab-ghost" onClick={() => { setReportOpen(false); bump(1); }}>
                  Refine again
                </button>
              </div>
            </section>
          ) : null}

          {reportOpen && lastRun ? (
            <LaunchReport
              model={buildLaunchReport({
                before: v1?.score ?? appliedPlan?.before ?? plan?.before ?? 0,
                after: v2?.score ?? appliedPlan?.after ?? v1?.score ?? 0,
                plan: appliedPlan ?? plan,
                people: personas.map((persona) => {
                  const next = after.find((item) => item.id === persona.id) ?? after.find((item) => item.label === persona.label);
                  return {
                    label: persona.label,
                    before: persona.fit,
                    after: next && next.fit > 0 ? next.fit : persona.fit,
                    anchors: (next?.anchors.length ? next.anchors : persona.anchors).map((anchor) => ({ name: anchor.name })),
                  };
                }),
                areas: heat.map((item) => ({ label: item.label, weight: item.weight })),
                costLabel: formatMoney(shownCost),
              })}
              onBack={() => setReportOpen(false)}
            />
          ) : null}
        </div>
      </main>
      <aside className="lab-drawer" data-testid="working-state">
        <section className="lab-work" data-testid="analysis-screen" role="status" aria-live="polite" aria-busy={busy} data-motion={reduced ? 'reduce' : 'ok'}>
          <p className="lab-eyebrow">Agent</p>
          <p className="lab-status" data-testid="analysis-status">
            <span className="lab-spin" data-testid="working-spinner" data-off={busy && !reduced ? 'false' : 'true'} />
            <span data-testid="working-step">{status}</span>
          </p>
          <p className="lab-meta-line">
            Market-test cost avoided <strong data-testid="cost-avoided">{formatMoney(shownCost)}</strong>
          </p>
          <p className="lab-meta-line" data-testid="analysis-elapsed">Elapsed {formatElapsed(elapsed)}</p>
          <p className="lab-meta-line" data-testid="qloo-calls">Qloo calls {progress?.calls ?? lastRun?.qlooCalls ?? 0}</p>
          <div className={busy && !reduced ? 'byb-bar is-busy' : 'byb-bar'} data-testid="analysis-bar" aria-hidden="true">
            <i style={{ width: `${width}%` }} />
          </div>
        </section>
        {renderSteps("agent-steps")}
        {!chatOpen ? (
          <button type="button" className="lab-chat-toggle" data-testid="chat-toggle" onClick={() => setChatOpen(true)}>
            Chat with the agent
          </button>
        ) : null}
        <div className={chatOpen ? 'lab-chat is-open' : 'lab-chat'} data-testid={chatOpen ? 'persona-chat' : undefined}>
          {chatOpen && !talking ? (
            <p className="lab-chat-who lab-chat-head">
              Agent chat
              <button type="button" data-testid="chat-close" onClick={closeTalk}>Close</button>
            </p>
          ) : null}
          <div className="lab-lines">
            {talking ? (
              <p className="lab-chat-who">
                Talking with {talking.label}. Simulated.
                <button type="button" onClick={closeTalk}>Close</button>
              </p>
            ) : null}
            {lines.map((line, index) => (
              <p key={`${line.role}-${index}`} className={line.role === 'you' ? 'is-you' : 'is-agent'}>
                {line.role === 'agent' ? <span className="lab-avatar" aria-hidden="true">{talking?.initials || 'A'}</span> : null}
                <span>
                  {line.text}
                  {line.note ? <small className="lab-chat-note">{line.note}</small> : null}
                </span>
              </p>
            ))}
          </div>
          {!talking && labels.length ? (
            <details className="lab-chat-steps" data-testid="chat-steps">
              <summary>{busy ? <span className="lab-spin" aria-hidden="true" /> : '✓'} Steps ({labels.length}) · {labels[labels.length - 1]}</summary>
              {renderSteps('chat-steps-list')}
            </details>
          ) : null}
          {!talking && proposal && lastRun?.status === 'awaiting_approval' ? (
            <div className="lab-chat-proposal" data-testid="chat-proposal">
              <p><strong>Proposal</strong> {proposal.before} → {proposal.after}{typeof proposal.predictedDelta === 'number' ? ` (predicted +${proposal.predictedDelta})` : ''}</p>
              <p className="lab-chat-note">{readableWhy(proposal.why)}</p>
              <div>
                <button type="button" disabled={busy} onClick={() => void send('approve')}>Approve</button>
                <button type="button" disabled={busy} onClick={() => void send('reject')}>Reject</button>
                <button type="button" disabled={busy} onClick={() => { setComposer(`Adjust: ${proposal.after} → `); chatInput.current?.focus(); }}>Adjust</button>
              </div>
            </div>
          ) : null}
          {busy && !talking ? <p className="lab-chat-note" data-testid="chat-busy"><span className="lab-spin" aria-hidden="true" /> {status}</p> : null}
          {!talking ? (
            <div className="lab-chips" data-testid="chat-chips">
              {suggestChips({ hasRun: Boolean(lastRun), busy, hasProposal: Boolean(proposal && lastRun?.status === 'awaiting_approval'), city: draft.city, districts: [...(chatRun?.districts ?? [])].sort((a, b) => b.weight - a.weight).map((cell) => cell.label ?? '').filter((name) => name && name !== draft.city && !/^-?[0-9.]+, *-?[0-9.]+$/.test(name)) }).map((chip) => (
                <button key={chip} type="button" onClick={() => void send(chip === 'Test this idea' ? 'test' : chip)}>{chip}</button>
              ))}
            </div>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <input ref={chatInput} data-testid="chat-input" value={composer} placeholder={talking ? `Ask ${talking.label}` : 'Ask the agent'} onChange={(event) => setComposer(event.target.value)} />
            <button type="submit" data-testid="chat-send">Send</button>
          </form>
        </div>
      </aside>
    </div>
  );
}

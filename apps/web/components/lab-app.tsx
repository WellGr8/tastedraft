'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { comparisonLine, detectLaunch, RunSnapshotSchema, stripEntityIds, type BriefV2, type RunSnapshot } from '@tastedraft/contracts';
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
import { caseStudySummary, caseStudyViews, type CaseStudyView } from '@/lib/cases';
import { deltaText, fitOf, plainStopReason, tasteVerb, typeLabel } from '@/lib/labels';
import { groupDistricts, insideCity, namedArea, playbackDistricts } from '@/lib/places';
import { chatWithPersona, type Persona } from '@/lib/personas';

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
import { sentimentLabel, sentimentOf, voiceFor } from '@/lib/voice';

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
  const shape = fitOf(type);
  const tone = hue(name);
  const letter = name.trim().slice(0, 1).toUpperCase() || '·';
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
        background: photo && shape === 'logo' ? '#fff' : `linear-gradient(145deg, hsl(${tone} 52% 42%), hsl(${(tone + 36) % 360} 42% 18%))`,
      }}
    >
      {photo ? <img src={image ?? ''} alt="" onError={() => setHidden(true)} /> : letter}
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
  const [whyRun, setWhyRun] = useState<RunSnapshot | null>(null);
  const [whyBusy, setWhyBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
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
    if (/budget exhausted/i.test(label)) return;
    setLabels((current) => (current.includes(label) ? current : [...current, label]));
  }

  function markSettled(run: RunSnapshot, city: string) {
    if (run.status === 'running') return;
    const calls = run.qlooCalls;
    const budget = Math.max(run.budget, 1);
    const label = run.grounding === 'recorded'
      ? `Recorded run. Scored ${city}.`
      : run.status === 'awaiting_input'
        ? `Need one more detail for ${city}.`
        : run.status === 'awaiting_approval'
          ? `Proposal ready for ${city}. ${calls}/${budget} calls`
          : `Scored ${city}. ${calls}/${budget} calls`;
    setProgress({ calls, budget, shown: calls, of: budget, label, step: 5 });
  }

  function stopClock() {
    if (clock.current) window.clearInterval(clock.current);
    clock.current = null;
    if (clockStart.current) {
      const next = Date.now() - clockStart.current;
      elapsedRef.current = next;
      setElapsed(next);
      clockStart.current = 0;
    }
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
      label: 'Recorded run. Scoring this launch on the engine.',
      step: Math.max(current?.step ?? 0, 1),
    }));
    setLabels((current) =>
      current.includes('Recorded run. Scoring this launch on the engine.')
        ? current
        : [...current, 'Recorded run. Scoring this launch on the engine.'],
    );
    try {
      const snapshot = await buildRecordedRun(brief);
      if (!alive(token)) return;
      if (!snapshot) throw new Error('Recorded playback could not be scored.');
      const playback = playbackDistricts(brief.city);
      const recordedNote = brief.city.trim().toLowerCase() === 'tokyo'
        ? RECORDED_NOTE
        : 'Recorded run. District names are known neighborhoods. The bars are playback, not a live measurement.';
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
      const useful = run.score != null && run.proposals.some((item) => (item.predictedDelta ?? 0) > 0);
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
    if (!proposal) return;
    const beforeBrief = briefRef.current;
    setBusy(true);
    setError('');
    bump(4);
    startClock(true);
    try {
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

  async function send() {
    const text = composer.trim();
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
        const anchors = talking.anchors.slice(0, 8).map((anchor) => featureEntity(anchor));
        setLines((current) => [...current, { role: 'agent', text: '' }]);
        let streamed = '';
        const feature = anchors.length
          ? await loadPersonaChat(
              {
                persona: {
                  id: talking.id,
                  label: talking.label,
                  location: talking.city,
                  age: talking.age,
                  anchors,
                },
                message: text.slice(0, 500),
                ...(history.length ? { history } : {}),
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
        const reply = feature ?? { label: 'Simulated', source: 'template' as const, message: (await chatWithPersona(talking, text, fetch, apiBase())).say };
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
      if (!runId) {
        setLines((current) => [...current, { role: 'agent', text: 'Test the idea first.' }]);
        return;
      }
      const result = await client.commandRun(runId, text);
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
      <aside className="lab-side" data-testid="sidebar">
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
          <button key={city} type="button" className={draft.city === city ? 'lab-market is-on' : 'lab-market'} onClick={() => setDraft((current) => ({ ...current, city }))}>
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
              <button
                key={study.id}
                type="button"
                className="lab-case"
                aria-expanded={openStudy === study.id}
                onClick={() => setOpenStudy((current) => (current === study.id ? null : study.id))}
              >
                <b>{study.short}</b>
                <small>
                  {study.verdict} · {study.matched ? 'Match' : 'Miss'}
                </small>
                {openStudy === study.id && study.outcomeSummary ? <span>{study.outcomeSummary}</span> : null}
              </button>
            ))}
            <p className="lab-case-note">These four are Tokyo launches. The same pre-registered rule applies to any category. Not a sales forecast.</p>
          </div>
        ) : null}
      </aside>
      <main className="lab-canvas">
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
                    <span className="lab-label">Cultural resonance</span>
                    <strong data-testid="live-score">{live ?? '—'}</strong>
                    <small className="lab-fine">Not a sales forecast</small>
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
              <div className="lab-go">
                <span className="byb-ring" data-busy={busy ? 'true' : 'false'}>
                  <button type="button" className="byb-primary" onClick={() => void testIdea()} disabled={busy}>
                    Test this idea
                  </button>
                </span>
                <div className="lab-examples">
                  {LAB_EXAMPLES.map((example) => (
                    <button
                      key={example.id}
                      type="button"
                      onClick={() => {
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
                      }}
                    >
                      {example.label}
                    </button>
                  ))}
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
                  </div>
                  <p className="lab-note">{snag}</p>
                  <p className="lab-fine" data-testid="feature-stub">Target is {draft.age} in {draft.city}.</p>
                  {features.competitors.length ? (
                    <p className="lab-fine">Also near {[...new Set(features.competitors.map((row) => row.name))].slice(0, 3).join(', ')}.</p>
                  ) : null}
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
              ) : (
                <>
                  <p className="lab-fine" data-testid="customers-loading">Loading customers</p>
                  <div className="lab-personas">
                    {[0, 1, 2, 3].map((item) => <div key={item} className="lab-shimmer" />)}
                  </div>
                </>
              )}
              <div className="lab-go">
                <span className="byb-ring" data-busy={busy ? 'true' : 'false'}>
                  <button type="button" className="byb-primary" disabled={busy || !proposal} onClick={() => bump(3)}>
                    Let the Agent fix it
                  </button>
                </span>
              </div>
            </section>
          ) : null}

          {step === 3 && proposal ? (
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

          {step === 3 && !proposal ? (
            <section className="lab-card">
              <h2 className="lab-section-title">No change is waiting</h2>
              {lastRun?.stopReason ? <p data-testid="stop-reason">{plainStopReason(lastRun.stopReason)}</p> : <p>Test the idea, then come back for the one change.</p>}
            </section>
          ) : null}

          {step === 4 && !reportOpen ? (
            <section className="lab-in lab-result">
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
              {personas.map((persona) => {
                const next = after.find((item) => item.id === persona.id) ?? after.find((item) => item.label === persona.label);
                const api = features.reinterview.find((row) => row.id === persona.id) ?? features.reinterview.find((row) => row.label === persona.label);
                const apiShift = Boolean(api && api.before != null && api.after != null && api.changedMind);
                const shifted = next ? changedMind(persona.fit, next.fit, persona.measuring, next.measuring) || apiShift : false;
                const anchors = next?.anchors.length ? next.anchors : persona.anchors;
                const afterQuote = next
                  ? voiceFor(anchors, next.fit, persona.fit)
                  : 'Still measuring what this person actually likes.';
                const afterSentiment = next ? sentimentOf(next.fit, next.measuring) : 'measuring';
                return (
                  <div key={persona.id} className="lab-card lab-pair">
                    <div>
                      <b>{persona.label}</b>
                      <p className="lab-quote">{persona.interview}</p>
                      <span className="lab-score" data-testid="persona-score"><small>Before</small>{persona.fit || '—'}</span>
                    </div>
                    <span className={`lab-pill ${shifted ? 'is-changed' : 'is-same'}`}>{shifted ? 'Changed mind' : 'Same mind'}</span>
                    <div>
                      <span className={`lab-pill is-${afterSentiment}`}>{sentimentLabel(afterSentiment)}</span>
                      <p className="lab-quote" data-testid="persona-quote">{afterQuote}</p>
                      <span className="lab-score"><small>After</small>{next && next.fit > 0 ? next.fit : '—'}</span>
                    </div>
                  </div>
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
            <article className="lab-card lab-report-sheet" data-testid="launch-report">
              <p className="lab-eyebrow" style={{ color: '#4a5273' }}>Launch report</p>
              <h1>Cultural resonance score</h1>
              <p className="lab-report-score" data-testid="report-score">{v2?.score ?? v1?.score ?? '—'}</p>
              <p className="lab-fine">Not a sales forecast</p>
              <p className="lab-fine">Market-test cost avoided {formatMoney(shownCost)}. Estimate, not a forecast.</p>
              <p className="lab-plain" data-testid="report-text">{lastRun.report}</p>
              <p data-testid="report-stop">{lastRun.stopReason ? plainStopReason(lastRun.stopReason) : lastRun.report}</p>
              <div className="lab-heat" data-testid="heatmap">
                {neighborhoods.map((label) => (
                  <span key={label} className="lab-pill">{label}</span>
                ))}
              </div>
              <button type="button" className="lab-quiet" onClick={() => setReportOpen(false)}>Back</button>
            </article>
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
        <ul className="lab-log">
          {labels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
        <div className={chatOpen ? 'lab-chat is-open' : 'lab-chat'} data-testid={chatOpen ? 'persona-chat' : undefined}>
          <div className="lab-lines">
            {talking ? (
              <p className="lab-chat-who">
                Talking with {talking.label}. Simulated.
                <button type="button" onClick={closeTalk}>Close</button>
              </p>
            ) : null}
            {lines.map((line, index) => (
              <p key={`${line.role}-${index}`} className={line.role === 'you' ? 'is-you' : undefined}>
                {line.text}
                {line.note ? <small className="lab-chat-note">{line.note}</small> : null}
              </p>
            ))}
          </div>
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

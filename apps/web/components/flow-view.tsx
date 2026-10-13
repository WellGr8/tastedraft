'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { Entity, RunSnapshot } from '@tastedraft/contracts';
import { AGENT_STEPS, AgentSteps, CustomizeFold, HeatCard, LoopOutput, PersonaGrid, ScoreTimeline, type HeatSpot } from '@/components/persona-ui';
import { ReferenceSearch } from '@/components/reference-search';
import type { ProposalView, SimulationResponse } from '@/lib/api';
import { AGES, CITIES, POSITIONS, priceLevelFor, uniqueById, type DraftState } from '@/lib/defaults';
import { bandOf } from '@/lib/hex';
import { deltaText, fitOf, passSentence, plainStopReason, typeLabel } from '@/lib/labels';
import { liveDetail, positioningForPrice, similarNames, type PriceLevel, type ProfileControls, type Scarcity } from '@/lib/profile';
import type { DecisionTrace, EvidenceAsk } from '@/lib/run';
import type { LiveScore } from '@/lib/engine-preview';
import type { MindChange, Persona } from '@/lib/personas';

const LEDGER = [
  ['anchor', 'Anchor affinity'],
  ['cross', 'Cross-domain fit'],
  ['local', 'Local fit'],
  ['audience', 'Audience fit'],
  ['friction', 'Cultural friction'],
] as const;

const SCARCITY: Array<{ id: Scarcity; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'limited', label: 'Limited' },
  { id: 'preorder', label: 'Preorder' },
];

function Arrow() {
  return (
    <svg className="byb-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

function Star({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2z" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg className="byb-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function FlowHeader({ onHome, agent }: { onHome: () => void; agent?: ReactNode }) {
  return (
    <header className="byb-header">
      <span className="byb-bl byb-bl1" aria-hidden="true" />
      <span className="byb-bl byb-bl2" aria-hidden="true" />
      <span className="byb-bl byb-bl3" aria-hidden="true" />
      <span className="byb-tint" aria-hidden="true" />
      <button type="button" className="byb-logo" onClick={onHome}>
        <i />
        TasteDraft
      </button>
      <div className="byb-head-actions">{agent}</div>
    </header>
  );
}

export function FlowShell({ children, onHome, bar, dock, agent }: { children: ReactNode; onHome: () => void; bar?: ReactNode; dock?: ReactNode; agent?: ReactNode }) {
  return (
    <div className="byb-root">
      <div className="byb-blob-a" style={{ position: 'absolute', top: -140, right: -100, width: 520, height: 520, borderRadius: '50%', background: '#8FA2FF', filter: 'blur(100px)', opacity: 0.16 }} />
      <div className="byb-blob-b" style={{ position: 'absolute', top: 120, left: -160, width: 460, height: 460, borderRadius: '50%', background: '#B9A2FF', filter: 'blur(100px)', opacity: 0.14 }} />
      <div className="byb-blob-b" style={{ position: 'absolute', bottom: -200, right: '10%', width: 560, height: 560, borderRadius: '50%', background: '#9CC4FF', filter: 'blur(110px)', opacity: 0.16 }} />
      <FlowHeader onHome={onHome} agent={agent} />
      <div className="byb-main">
        <div className="byb-col">{children}</div>
      </div>
      {bar}
      {dock}
    </div>
  );
}

function Cover({ entity, off }: { entity: Entity; off?: boolean }) {
  const fit = fitOf(entity.type);
  const shape = `cv ${fit === 'circle' ? 'rd' : 'sq'}${fit === 'logo' ? ' logo' : ''}`;
  return (
    <figure className={off ? 'pl-card is-off' : 'pl-card'} draggable>
      <span className={shape}>
        <b>{entity.name.slice(0, 1).toUpperCase()}</b>
        {entity.image ? <img alt="" src={entity.image} /> : null}
      </span>
      <figcaption>
        <span className="n">{entity.name}</span>
        <span className="t">{typeLabel(entity.type)}</span>
      </figcaption>
    </figure>
  );
}

function Playlist({
  draft,
  controls,
  onDraft,
  onControls,
  onAddSimilar,
}: {
  draft: DraftState;
  controls: ProfileControls;
  onDraft: (next: DraftState) => void;
  onControls: (next: ProfileControls) => void;
  onAddSimilar: (name: string) => void;
}) {
  const references = uniqueById(draft.references);
  function toggle(id: string) {
    const muted = controls.muted.includes(id) ? controls.muted.filter((item) => item !== id) : [...controls.muted, id];
    onControls({ ...controls, muted });
  }
  function remove(id: string) {
    onDraft({ ...draft, references: draft.references.filter((entity) => entity.id !== id) });
    onControls({ ...controls, muted: controls.muted.filter((item) => item !== id) });
  }
  function reorder(from: number, to: number) {
    if (to < 0 || to >= references.length || from === to) return;
    const next = [...references];
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    onDraft({ ...draft, references: next });
  }
  function add(entity: Entity) {
    if (references.length >= 8) return;
    if (references.some((item) => item.id === entity.id || item.name.toLowerCase() === entity.name.toLowerCase())) return;
    onDraft({ ...draft, references: [...references, entity] });
  }

  return (
    <div className="byb-group">
      <span className="byb-label">
        Cultural references <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none', color: '#4A5273' }}>· 3–8, optional</span>
      </span>
      <p className="byb-help">Brands, artists, films, or places this idea refers to. Drag a cover to reorder. Switch one off to leave it out of the score.</p>
      <div className="pl" aria-label="Taste playlist">
        <div className="pl-cards">
          {references.map((entity, index) => (
            <div
              key={entity.id}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                reorder(Number(event.dataTransfer.getData('text/plain')), index);
              }}
            >
              <Cover entity={entity} off={controls.muted.includes(entity.id)} />
            </div>
          ))}
        </div>
      </div>
      <div className="pl-list">
        {references.map((entity, index) => {
          const on = !controls.muted.includes(entity.id);
          const fit = fitOf(entity.type);
          const shape = `cv pl-cv ${fit === 'circle' ? 'rd' : 'sq'}${fit === 'logo' ? ' logo' : ''}`;
          return (
            <div
              key={entity.id}
              className={on ? 'pl-row' : 'pl-row is-off'}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                reorder(Number(event.dataTransfer.getData('text/plain')), index);
              }}
            >
              <span className={shape}>
                <b>{entity.name.slice(0, 1).toUpperCase()}</b>
                {entity.image ? <img alt="" src={entity.image} /> : null}
              </span>
              <span className="pl-nm">
                {entity.name}
                <small>{typeLabel(entity.type)}</small>
              </span>
              <button type="button" className={on ? 'byb-qk is-on' : 'byb-qk'} role="switch" aria-checked={on} aria-label={`Use ${entity.name} as evidence`} onClick={() => toggle(entity.id)}>
                <i />
              </button>
              <button type="button" className="pl-rm" aria-label={`Remove ${entity.name}`} onClick={() => remove(entity.id)}>
                ×
              </button>
            </div>
          );
        })}
      </div>
      <ReferenceSearch city={draft.city} onPick={add} />
    </div>
  );
}

function Sliders({
  draft,
  controls,
  live,
  quiet,
  onDraft,
  onControls,
}: {
  draft: DraftState;
  controls: ProfileControls;
  live: LiveScore | null;
  quiet?: boolean;
  onDraft: (next: DraftState) => void;
  onControls: (next: ProfileControls) => void;
}) {
  const priceName = positioningForPrice(controls.priceLevel);
  return (
    <div className="byb-group">
      {quiet ? (
        <p className="byb-note">
          Live <b>{live?.total ?? '—'}</b> · {priceName}
        </p>
      ) : (
        <div className="td-live">
          <span className="byb-label" style={{ margin: 0 }}>
            Live resonance
          </span>
          <b>{live?.total ?? '—'}</b>
        </div>
      )}
      <label className="byb-label" htmlFor="price-slider">
        Price · {priceName}
      </label>
      <input
        id="price-slider"
        className="td-range"
        data-testid="price-slider"
        type="range"
        min={1}
        max={4}
        step={1}
        value={controls.priceLevel}
        aria-valuetext={priceName}
        onChange={(event) => {
          const priceLevel = Number(event.target.value) as PriceLevel;
          onControls({ ...controls, priceLevel });
          onDraft({ ...draft, positioning: positioningForPrice(priceLevel) });
        }}
      />
      <p className="byb-note">Mass · Independent · Premium · Luxury. The number updates in the browser before you test.</p>
      <span className="byb-label">Scarcity</span>
      <div className="byb-seg" role="group" aria-label="Scarcity">
        {SCARCITY.map((item) => (
          <label key={item.id}>
            <input
              type="radio"
              name="scarcity"
              checked={controls.scarcity === item.id}
              onChange={() => onControls({ ...controls, scarcity: item.id })}
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function InputPhase({
  draft,
  controls,
  live,
  error,
  ask,
  busy,
  onDraft,
  onControls,
  onSubmit,
  onAddSimilar,
  onAsk,
  onExample,
}: {
  draft: DraftState;
  controls: ProfileControls;
  live: LiveScore | null;
  error: string;
  ask: EvidenceAsk | null;
  busy: boolean;
  onDraft: (next: DraftState) => void;
  onControls: (next: ProfileControls) => void;
  onSubmit: () => void;
  onAddSimilar: (name: string) => void;
  onAsk: () => void;
  onExample: () => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const priceName = positioningForPrice(controls.priceLevel);
  return (
    <div data-testid="input-screen">
      <div className="byb-hero byb-rise">
        <h1 className="byb-h1">
          <span>Test your launch</span>
          <span className="byb-grad">with simulated customers before you spend</span>
        </h1>
        <p className="byb-sub">Not another AI focus group. Every change is traceable to cultural evidence.</p>
        <p className="byb-note">A Bangkok streetwear brand, launching in Tokyo, is one click away.</p>
        <button type="button" className="byb-ghost" data-testid="try-example" onClick={onExample} disabled={busy}>
          Try example
        </button>
      </div>
      <form
        className="byb-glass byb-modal byb-rise"
        style={{ animationDelay: '200ms', marginTop: 56 }}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="byb-group">
          <label htmlFor="idea" className="byb-label">
            The idea you are making
          </label>
          <textarea
            id="idea"
            className="byb-field byb-text"
            rows={3}
            value={draft.idea}
            placeholder="What are you making, and how should people feel about it?"
            onChange={(event) => onDraft({ ...draft, idea: event.target.value })}
          />
        </div>
        <div className="byb-two">
          <fieldset className="byb-group">
            <legend className="byb-label" style={{ marginBottom: 12 }}>
              Audience · age
            </legend>
            <div className="byb-seg">
              {AGES.map((age) => (
                <label key={age}>
                  <input type="radio" name="age" checked={draft.age === age} onChange={() => onDraft({ ...draft, age })} />
                  <span>{age}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="byb-group">
            <label htmlFor="city" className="byb-label">
              Location · city
            </label>
            <div className="byb-selectwrap">
              <select id="city" className="byb-field byb-select" value={draft.city} onChange={(event) => onDraft({ ...draft, city: event.target.value })}>
                {[...CITIES, 'Bangkok', 'Tokyo', 'Berlin', 'London', 'Paris', 'Seoul'].map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
              <Chevron />
            </div>
          </div>
        </div>
        <div className="byb-group">
          <label htmlFor="interests" className="byb-label">
            What this audience cares about <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none', color: '#4A5273' }}>· optional</span>
          </label>
          <input
            id="interests"
            className="byb-field byb-line"
            value={draft.interests.map((tag) => tag.name).join(', ')}
            onChange={(event) =>
              onDraft({
                ...draft,
                interests: event.target.value
                  .split(',')
                  .map((name) => name.trim())
                  .filter(Boolean)
                  .map((name) => ({ id: `tag-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, type: 'urn:tag' })),
              })
            }
            placeholder="How does this audience spend its time?"
          />
        </div>
        <Playlist draft={draft} controls={controls} onDraft={onDraft} onControls={onControls} onAddSimilar={onAddSimilar} />
        <CustomizeFold
          open={customOpen}
          onToggle={() => setCustomOpen((open) => !open)}
          summary={
            <>
              Live <b data-testid="live-score">{live?.total ?? '—'}</b> · {priceName}
              {similarNames(draft).length ? ` · ${similarNames(draft).length} similar` : ''}
            </>
          }
        >
          <Sliders draft={draft} controls={controls} live={live} onDraft={onDraft} onControls={onControls} />
          {similarNames(draft).length ? (
            <div className="td-similar" aria-label="Add similar">
              {similarNames(draft).map((name) => (
                <button key={name} type="button" className="byb-chip" onClick={() => onAddSimilar(name)}>
                  Add {name}
                </button>
              ))}
            </div>
          ) : null}
        </CustomizeFold>
        <fieldset className="byb-group">
          <legend className="byb-label" style={{ marginBottom: 12 }}>
            Positioning <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none', color: '#4A5273' }}>· optional</span>
          </legend>
          <div className="byb-seg">
            {POSITIONS.map((pos) => (
              <label key={pos}>
                <input
                  type="radio"
                  name="pos"
                  checked={draft.positioning === pos}
                  onChange={() => {
                    onDraft({ ...draft, positioning: pos });
                    onControls({ ...controls, priceLevel: priceLevelFor(pos) });
                  }}
                />
                <span>{pos}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="byb-cta" style={{ paddingTop: 6 }}>
          <span className="byb-ring" data-busy={busy ? 'true' : 'false'}>
            <button type="submit" className="byb-primary" disabled={busy}>
              <span>TEST CONCEPT</span>
              <Arrow />
            </button>
          </span>
        </div>
        {ask ? (
          <div className="byb-state is-warn" role="status" data-testid="evidence-ask">
            <p>{ask.question}</p>
            <div className="byb-state-acts">
              <button type="button" className="byb-solid" data-testid="evidence-ask-action" onClick={onAsk} disabled={busy}>
                {ask.kind === 'city' ? 'Add a city' : 'Add another reference'}
              </button>
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="byb-state is-error" role="alert">
            <p>{plainStopReason(error)}</p>
          </div>
        ) : null}
      </form>
    </div>
  );
}

function useElapsed(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const tick = () => setSeconds(Math.floor((Date.now() - started) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return seconds;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  return reduced;
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export function AnalysisPhase({
  city,
  personas,
  proposal,
  step = 0,
  status,
  calls = 0,
  total = 0,
}: {
  city: string;
  personas: Persona[];
  proposal: ProposalView | null;
  step?: number;
  status?: string;
  calls?: number;
  total?: number;
}) {
  const elapsed = useElapsed();
  const reduced = useReducedMotion();
  const liveStatus = status?.trim() || `Asking Qloo for ${city} tastes…`;
  const fraction = total > 0 ? Math.min(1, calls / total) : 0;
  const width = Math.max(reduced ? 8 : 14, Math.round(fraction * 100));
  return (
    <div className="byb-glass byb-an byb-rise" data-testid="analysis-screen" role="status" aria-live="polite" aria-busy="true" data-motion={reduced ? 'reduce' : 'ok'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p className="byb-over">Agent loop</p>
        <h2 className="byb-h2">Testing your idea against the culture of {city}</h2>
      </div>
      <AgentSteps step={Math.min(step, AGENT_STEPS.length - 1)} />
      <p className="td-live" data-testid="analysis-status">
        {liveStatus}
      </p>
      <p className="td-elapsed" data-testid="analysis-elapsed">
        Elapsed {formatElapsed(elapsed)}
      </p>
      <LoopOutput personas={personas} proposal={proposal} />
      <div className={reduced ? 'byb-bar' : 'byb-bar is-busy'} data-testid="analysis-bar" aria-hidden="true">
        <i style={{ width: `${width}%` }} />
      </div>
      <div className="byb-qtag">
        <span className="byb-avatar" style={{ width: 24, height: 24 }} aria-hidden="true">
          <Star size={12} />
        </span>
        Personas from Qloo
      </div>
    </div>
  );
}

function useCount(target: number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const duration = 700;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

function ledgerRows(simulation: SimulationResponse | null, live: LiveScore | null, draft: DraftState, controls: ProfileControls, diverged: boolean) {
  const provenance = simulation?.story?.provenance ?? [];
  return LEDGER.map(([id, label]) => {
    const row = provenance.find((item) => item.id === id);
    const server = simulation?.ledger?.[id] ?? row?.points ?? null;
    const liveRow = live?.rows.find((item) => item.id === id);
    const points = diverged && liveRow ? liveRow.points : server;
    const detail = diverged ? liveDetail(id, draft, controls) : row?.detail ?? '';
    return { id, label, points, detail };
  });
}

function StepEyebrow({ n, label }: { n: number; label: string }) {
  return (
    <p className="td-step">
      <i>{n}</i>
      {label}
    </p>
  );
}

function pips(level: string) {
  const rank = /strong/i.test(level) ? 3 : /mod/i.test(level) ? 2 : 1;
  const cls = rank === 2 ? 'byb-pips is-mod' : 'byb-pips';
  return (
    <span className={cls}>
      <i className="on" />
      <i className={rank >= 2 ? 'on' : ''} />
      <i className={rank >= 3 ? 'on' : ''} />
    </span>
  );
}

export function ResultPhase({
  draft,
  controls,
  live,
  v1,
  v2,
  view,
  personas,
  heatSpots,
  heatNote,
  changes,
  timeline,
  trace,
  target,
  stop,
  pending,
  personaNote,
  reinterviewed,
  ledgerOpen,
  frictionOpen,
  dismissed,
  canDecide = true,
  decisions,
  onView,
  onToggleLedger,
  onToggleFriction,
  onOpenProposal,
  onOpenPlaylist,
  onNew,
  onDraft,
  onControls,
  onAddSimilar,
  onTarget,
  onChase,
  onRevert,
  onTalk,
  onApprovePending,
  onRejectPending,
  grounding,
  compare,
  onWhyQloo,
  onLaunch,
}: {
  draft: DraftState;
  controls: ProfileControls;
  live: LiveScore | null;
  v1: SimulationResponse;
  v2: SimulationResponse | null;
  view: 1 | 2;
  personas: Persona[];
  heatSpots: HeatSpot[];
  heatNote: string | null;
  changes: MindChange[];
  timeline: number[];
  trace: DecisionTrace;
  target: string;
  stop: string | null;
  pending: ProposalView | null;
  personaNote: string | null;
  reinterviewed: boolean;
  ledgerOpen: boolean;
  frictionOpen: number | null;
  dismissed: boolean;
  /** False once the server run is no longer waiting for a decision. */
  canDecide?: boolean;
  /** Open proposals from the latest snapshot. Falls back to Version 1 when omitted. */
  decisions?: ProposalView[];
  onView: (version: 1 | 2) => void;
  onToggleLedger: () => void;
  onToggleFriction: (index: number) => void;
  onOpenProposal: () => void;
  onOpenPlaylist: () => void;
  onNew: () => void;
  onDraft: (next: DraftState) => void;
  onControls: (next: ProfileControls) => void;
  onAddSimilar: (name: string) => void;
  onTarget: (value: string) => void;
  onChase: () => void;
  onRevert: () => void;
  onTalk: (persona: Persona) => void;
  onApprovePending: () => void;
  onRejectPending: () => void;
  grounding: 'qloo' | 'recorded' | 'llm-only';
  compare: RunSnapshot | 'loading' | null;
  onWhyQloo: () => void;
  onLaunch: () => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const current = view === 2 && v2 ? v2 : v1;
  const score = current.score ?? 0;
  const band = bandOf(score);
  const diverged = view === 1 && live != null && v1.score != null && live.total !== v1.score;
  const shown = diverged && live ? live.total : score;
  const counted = useCount(shown);
  const shownBand = bandOf(shown);
  const fits = (current.fits ?? []).length ? current.fits : v1.fits;
  const frictions = (current.frictions ?? []).length ? current.frictions : v1.frictions;
  const signals = (current.signals ?? []).length ? current.signals : v1.signals;
  const rows = ledgerRows(current, live, draft, controls, diverged && view === 1);
  const proposals = dismissed || canDecide === false ? [] : (decisions ?? v1.proposals);
  const reviewing = proposals.length > 0 && !v2;
  const gain = v1.score != null && v2?.score != null ? v2.score - v1.score : 0;

  return (
    <div className="ws" data-testid="results-screen">
      <header className="ws-head">
        <div className="ws-top">
          <p className="byb-over">Concept · {view === 2 ? 'Version 2' : 'Version 1'}</p>
          <div className="ws-ver" role="group" aria-label="Version">
            <button type="button" className={view === 1 ? 'is-on' : ''} onClick={() => onView(1)}>
              V1
            </button>
            <button type="button" className={view === 2 ? 'is-on' : ''} disabled={!v2} onClick={() => onView(2)}>
              V2
            </button>
          </div>
        </div>
        <h1 className="ws-title">{draft.idea}</h1>
        <div className="ws-meta">
          <span className="byb-tbtn">{draft.age}</span>
          <span className="sep">·</span>
          <span className="byb-tbtn">{draft.city}</span>
          <span className="sep">·</span>
          <span className="byb-tbtn">{draft.positioning}</span>
        </div>
        <div className="pl" aria-label="Taste playlist">
          <div className="pl-cards">
            {uniqueById(draft.references).map((entity) => (
              <Cover key={entity.id} entity={entity} off={controls.muted.includes(entity.id)} />
            ))}
          </div>
          <button type="button" className="byb-tbtn" onClick={onOpenPlaylist}>
            Manage taste playlist
          </button>
        </div>
        <CustomizeFold
          open={customOpen}
          onToggle={() => setCustomOpen((open) => !open)}
          summary={`Price · ${positioningForPrice(controls.priceLevel)} · ${controls.scarcity}`}
        >
          <Sliders quiet draft={draft} controls={controls} live={live} onDraft={onDraft} onControls={onControls} />
          {similarNames(draft).length ? (
            <div className="td-similar">
              {similarNames(draft).map((name) => (
                <button key={name} type="button" className="byb-chip" onClick={() => onAddSimilar(name)}>
                  Add {name}
                </button>
              ))}
            </div>
          ) : null}
        </CustomizeFold>
        {view === 2 && v2?.score != null && v1.score != null ? (
          <p className="ws-changes">
            {v1.score} → {v2.score}
          </p>
        ) : null}
      </header>

      <nav className="byb-rail" aria-label="Result path">
        <a className="byb-rn" href="#sec-evidence">
          <i />
          Evidence
        </a>
        <span className="byb-rl" />
        <a className="byb-rn" href="#sec-score">
          <i />
          Resonance
        </a>
        <span className="byb-rl" />
        <a className="byb-rn" href="#sec-friction">
          <i />
          Friction
        </a>
        <span className="byb-rl" />
        <a className="byb-rn" href="#sec-agent">
          <i />
          Agent
        </a>
        <span className="byb-rl" />
        <a className="byb-rn is-v2" href="#sec-agent">
          <i />
          Version 2
        </a>
      </nav>

      <section className="ws-ev td-stepsec" id="sec-evidence" aria-label="Cultural evidence">
        <StepEyebrow n={1} label="Evidence" />
        <div className="byb-who">
          <span className="byb-avatar" aria-hidden="true">
            <Star />
          </span>
          <p className="byb-over">Cultural evidence · {current.story?.mode === 'insights' ? 'Live evidence' : 'Sample data'}</p>
        </div>
        <p className="byb-prose" style={{ fontSize: 19 }}>
          {fits[0]?.text ?? 'Cultural references'} in {draft.city}
          {fits[1] ? `, with ${fits[1].text.toLowerCase()}` : ''}. {signals.length} signals from the references on this brief.
        </p>
        <div>
          {signals.map((signal, index) => (
            <div key={`${signal.domain}-${signal.name}-${index}`} className="ws-sr" style={{ cursor: 'default' }}>
              <span className="byb-sdom">{signal.domain}</span>
              <span className="byb-sname">{signal.name}</span>
              <span className="byb-str">
                {pips(signal.level)}
                {signal.level}
              </span>
            </div>
          ))}
        </div>
        <HeatCard city={draft.city} spots={heatSpots} note={heatNote} />
      </section>

      <section className="td-stepsec" aria-label="Simulated customers">
        <StepEyebrow n={2} label="Simulated customers" />
        <PersonaGrid personas={personas} onTalk={onTalk} />
        {personaNote ? <p className="byb-note">{personaNote}</p> : null}
      </section>

      <section className="ws-score" id="sec-score" aria-label="Cultural resonance">
        <StepEyebrow n={3} label="Cultural resonance score" />
        <div className="ws-big">
          <span className="ws-bn" data-testid={view === 2 ? 'score-v2' : 'score-v1'}>
            {counted}
          </span>
          <span className="byb-bd">/ 100</span>
        </div>
        <div className="ws-side">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className={shownBand.cls}>{shownBand.label}</span>
            {view === 2 && v2 ? <span className="ws-gain">{gain > 0 ? `+${gain}` : gain} from V1</span> : null}
          </div>
          <p className="byb-note">Not a sales forecast</p>
          <p className="byb-note">
            <b style={{ color: '#0A0F2E', fontWeight: 600 }}>Evidence confidence {current.evidenceStrength ?? 'MEDIUM'}</b> · {draft.references.length} references · {signals.length} signals ·{' '}
            <span className="td-wasm" data-testid="engine-badge">
              Rust/WASM
            </span>
            {grounding === 'recorded' ? ' · Recorded run' : ''}
          </p>
          <button type="button" className="byb-quiet" data-testid="why-qloo" aria-pressed={compare != null} onClick={onWhyQloo}>
            Why Qloo
          </button>
          {compare === 'loading' ? <p className="byb-note">Comparing the same brief without Qloo.</p> : null}
          {compare && compare !== 'loading' ? (
            <WhyQloo groundedScore={current.score} groundedStrength={current.evidenceStrength ?? 'MEDIUM'} compare={compare} />
          ) : null}
        </div>
        <p className="ws-sent">
          This idea meets people aged {draft.age} in {draft.city} at a {shownBand.label.toLowerCase()} level
          {frictions.length ? `, with ${frictions.length} point${frictions.length === 1 ? '' : 's'} of cultural friction` : ''}.
        </p>
        <p className="td-score-which">{diverged ? `Preview ${shown} · Saved V${view} ${score}` : `Saved V${view} ${score}`}</p>
        {diverged ? (
          <p className="byb-note">The large number is the live preview. Saved Version {view} stays {score} until you test again or approve a change.</p>
        ) : null}
      </section>

      <section className="ws-fc" id="sec-friction" aria-label="Fit and friction">
        <StepEyebrow n={4} label="Fit and friction" />
        <div className="ws-col g">
          <h3>What fits</h3>
          <ul className="byb-list">
            {(fits.length ? fits : [{ text: 'Concept references' }]).map((fit, index) => (
              <li key={`${fit.text}-${index}`} className="byb-li">
                <svg className="byb-ic" style={{ color: '#0C5F38' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" fill="currentColor" fillOpacity="0.14" stroke="none" />
                  <path d="M7.5 12.5l3 3 6-6.5" />
                </svg>
                <span>
                  {fit.text}
                  {fit.isNew ? <span className="ws-new">New</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="ws-col r">
          <h3>Cultural friction</h3>
          <div className="byb-list">
            {(frictions.length ? frictions : [{ text: 'Premium pricing signals', why: '' }]).map((item, index) => (
              <div key={`${item.text}-${index}`} className="byb-why">
                <button type="button" className="byb-whyb" aria-expanded={frictionOpen === index} onClick={() => onToggleFriction(index)}>
                  <span className="t">
                    <svg className="byb-ic" style={{ color: '#A02B28' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" fill="currentColor" fillOpacity="0.14" stroke="none" />
                      <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" />
                    </svg>
                    {item.text}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    <span className="byb-wtag">Why?</span>
                  </span>
                </button>
                {frictionOpen === index && item.why ? <p className="byb-wtext">{item.why}</p> : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ws-agent2" id="sec-agent" aria-label="Agent">
        <StepEyebrow n={5} label="Agent" />
        <div className="byb-aw">
          <span className="byb-avatar" style={{ width: 34, height: 34 }} aria-hidden="true">
            <Star size={17} />
          </span>
          Agent
        </div>
        <p className="byb-lead">
          {v2 && view === 2
            ? `The change moved resonance from ${v1.score} to ${v2.score}.`
            : proposals.length
              ? `The culture snags in ${frictions.length || proposals.length} place${(frictions.length || proposals.length) === 1 ? '' : 's'}. This is what I would change.`
              : 'This evidence does not point to a change yet.'}
        </p>
        {proposals.length && !v2 ? (
          <div className="byb-crit">
            {proposals.slice(0, 2).map((proposal) => (
              <div key={proposal.id} className="ag-row">
                <span className="byb-cbefore">{proposal.before}</span>
                <svg className="byb-darrow" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14" />
                  <path d="M13 6l6 6-6 6" />
                </svg>
                <span className="byb-cafter">{proposal.after}</span>
              </div>
            ))}
          </div>
        ) : null}
        {v2 && v1.score != null && v2.score != null ? (
          <div className="ag-vs">
            <div className="ag-n">
              <span className="v">V1</span>
              <span className="n">{v1.score}</span>
            </div>
            <svg className="byb-darrow" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="M13 6l6 6-6 6" />
            </svg>
            <div className="ag-n is-new">
              <span className="v">V2</span>
              <span className="n">{v2.score}</span>
            </div>
            <span className="ag-gain">{gain > 0 ? `+${gain}` : gain}</span>
          </div>
        ) : null}
        {personas.length ? (
          <p className="byb-note" data-testid="reject-list">
            {passSentence(personas)}
          </p>
        ) : null}
        {reinterviewed ? (
          <div data-testid="reinterview">
            {changes.length ? (
              changes.map((change) => (
                <p key={change.id} className="byb-note">
                  {change.label} changed their mind, {change.from} to {change.to}. Fit {change.fitBefore} → {change.fitAfter}.
                </p>
              ))
            ) : (
              <p className="byb-note">Re-interviewed. Nobody&apos;s fit crossed the line on this evidence.</p>
            )}
          </div>
        ) : null}
        <ScoreTimeline scores={timeline} stop={stop} onRevert={onRevert} />
        <TraceWhy trace={trace} />
        {stop ? (
          <p className="byb-note" data-testid="stop-reason">
            {plainStopReason(stop)}
          </p>
        ) : null}
        {pending && canDecide ? (
          <div className="prop" data-testid="target-proposal">
            <div className="ba">
              <span className="bf">{pending.before}</span>
              <span className="af">{pending.after}</span>
            </div>
            <p>{pending.why}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="byb-quiet" onClick={onApprovePending}>
                Approve
              </button>
              <button type="button" className="byb-quiet" onClick={onRejectPending}>
                Reject
              </button>
            </div>
          </div>
        ) : null}
        <div className="byb-cta" style={{ alignItems: 'flex-start' }}>
          {stop ? (
            <span className="byb-ring">
              <button type="button" className="byb-primary is-light" data-testid="open-report" onClick={onLaunch}>
                <span>Launch report</span>
                <Arrow />
              </button>
            </span>
          ) : v2 || reviewing ? (
            <span className="byb-ring">
              <button type="button" className="byb-primary is-light" onClick={onOpenProposal}>
                <span>{v2 ? 'Compare V1 and V2' : 'Review proposal'}</span>
                <Arrow />
              </button>
            </span>
          ) : null}
          {stop && v2 ? (
            <button type="button" className="byb-quiet" onClick={onOpenProposal}>
              Compare V1 and V2
            </button>
          ) : null}
          <p className="byb-hint" style={{ textAlign: 'left' }}>
            {v2
              ? 'The comparison keeps Version 1 beside the approved change.'
              : canDecide
                ? 'Nothing changes until you approve. Version 2 is scored only after that.'
                : 'This version is the latest result.'}
          </p>
        </div>
        <form
          className="byb-group td-chase"
          onSubmit={(event) => {
            event.preventDefault();
            onChase();
          }}
        >
          <label className="byb-label" htmlFor="target-score">
            Agent task · target score
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              id="target-score"
              data-testid="target-score"
              className="byb-field byb-line"
              inputMode="numeric"
              value={target}
              placeholder="90"
              onChange={(event) => onTarget(event.target.value.replace(/[^\d]/g, '').slice(0, 3))}
            />
            <button type="submit" className="byb-quiet" data-testid="chase-target">
              Chase
            </button>
          </div>
        </form>
      </section>

      <div className="ws-fold">
        <button type="button" className="ws-foldb" aria-expanded={ledgerOpen} onClick={onToggleLedger}>
          <span>
            Why?
            <small>How this score is built.</small>
          </span>
        </button>
        {ledgerOpen ? (
          <div className="ws-foldc">
            <div className="byb-led" style={{ paddingBottom: 0 }}>
              <div className="byb-lr is-h">
                <span />
                <span className="n" style={{ textAlign: 'right' }}>
                  V1
                </span>
                <span className="n" style={{ textAlign: 'right' }}>
                  {v2 ? 'V2' : ''}
                </span>
              </div>
              {rows.map((row) => (
                <div key={row.id} className="byb-lr">
                  <span>
                    {row.label}
                    {row.detail ? <small style={{ display: 'block', marginTop: 4, fontSize: 13, fontWeight: 400, color: '#4A5273', lineHeight: 1.5 }}>{row.detail}</small> : null}
                  </span>
                  <span className="n">{row.points ?? '—'}</span>
                  <span className="n">{v2?.ledger ? (v2.ledger[row.id] ?? '—') : '—'}</span>
                </div>
              ))}
              <div className="byb-lr is-t">
                <span>Cultural resonance</span>
                <span className="n">{v1.score ?? '—'}</span>
                <span className="n">{v2?.score ?? '—'}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="ws-foot">
        <button type="button" className="byb-ghost" onClick={onNew}>
          New idea
        </button>
      </div>
    </div>
  );
}

export function NowPlaying({
  draft,
  score,
  band,
  version,
  hasV2,
  caption,
  parked = false,
  showAgent = true,
  onView,
  onAgent,
}: {
  draft: DraftState;
  score: number | null;
  band: string;
  version: 1 | 2;
  hasV2: boolean;
  caption?: string | null;
  parked?: boolean;
  showAgent?: boolean;
  onView: (version: 1 | 2) => void;
  onAgent: () => void;
}) {
  const tone = bandOf(score ?? 0);
  return (
    <div className={parked ? 'np is-parked' : 'np'} role="region" aria-label="Current concept" aria-hidden={parked || undefined}>
      <i className="np-cv" style={{ background: 'linear-gradient(135deg,#2F3FD6,#8B5CFF)' }}>
        {draft.idea.slice(0, 1).toUpperCase()}
      </i>
      <div className="np-tx">
        <span className="np-t">{draft.idea}</span>
        <span className="np-m">{caption ?? `${version === 2 ? 'Version 2' : 'Version 1'} · ${draft.age} · ${draft.city}`}</span>
      </div>
      <div className="np-sc">
        <span className="np-n">{score ?? '—'}</span>
        <span className={tone.cls}>{band}</span>
      </div>
      <div className="ws-ver np-ver" role="group" aria-label="Version">
        <button type="button" className={version === 1 ? 'is-on' : ''} onClick={() => onView(1)}>
          V1
        </button>
        <button type="button" className={version === 2 ? 'is-on' : ''} disabled={!hasV2} onClick={() => onView(2)}>
          V2
        </button>
      </div>
      {showAgent ? (
        <button type="button" className="np-go" data-testid="chat-toggle" onClick={onAgent} aria-label="Go to agent">
          <Star />
          <span>Agent</span>
        </button>
      ) : null}
    </div>
  );
}

export function ProposalModal({
  proposals,
  busy,
  onApprove,
  onReject,
  onClose,
}: {
  proposals: ProposalView[];
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mdl-back" onClick={onClose}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="mdl-t" data-testid="proposal-modal" onClick={(event) => event.stopPropagation()}>
        <div className="mdl-h">
          <div>
            <h2 id="mdl-t">The agent proposes {proposals.length} change{proposals.length === 1 ? '' : 's'}</h2>
            <p>See what would change, and why, before you decide.</p>
          </div>
          <button type="button" className="mdl-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="mdl-b">
          <div>
            {proposals.map((proposal, index) => (
              <div key={proposal.id} className="prop" data-testid={`proposal-${index}`}>
                <div className="ba">
                  <span className="bf">{proposal.before}</span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5273" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14" />
                    <path d="M13 6l6 6-6 6" />
                  </svg>
                  <span className="af">{proposal.after}</span>
                </div>
                <p>{proposal.why}</p>
                <p className="ev">
                  <b>Evidence</b> · {proposal.evidence}
                  {proposal.predictedDelta != null ? ` · About ${deltaText(proposal.predictedDelta)}` : ''}
                </p>
              </div>
            ))}
          </div>
          <p className="byb-note">Approve runs the same evaluation again and keeps Version 1 so you can compare. Reject leaves the concept as it is.</p>
        </div>
        <div className="mdl-f">
          <button type="button" className="byb-quiet" onClick={onReject} disabled={busy}>
            Reject
          </button>
          <button type="button" className="byb-solid" onClick={onApprove} disabled={busy || !proposals.length}>
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

export function CompareModal({
  v1,
  v2,
  onClose,
  onViewV2,
}: {
  v1: SimulationResponse;
  v2: SimulationResponse;
  onClose: () => void;
  onViewV2: () => void;
}) {
  const rows = [
    { label: 'Resonance', a: v1.score, b: v2.score },
    { label: 'Audience fit', a: v1.ledger?.audience, b: v2.ledger?.audience },
    { label: 'Local fit', a: v1.ledger?.local, b: v2.ledger?.local },
    { label: 'Friction', a: v1.ledger?.friction, b: v2.ledger?.friction },
  ];
  return (
    <div className="mdl-back" onClick={onClose}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="cmp-t" data-testid="compare-modal" onClick={(event) => event.stopPropagation()}>
        <div className="mdl-h">
          <div>
            <h2 id="cmp-t">V1 compared with V2</h2>
            <p>The new simulation beside the original concept.</p>
          </div>
          <button type="button" className="mdl-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="mdl-b">
          <div className="byb-cmp">
            <div className="byb-cmr is-h">
              <span />
              <span style={{ textAlign: 'right' }}>V1</span>
              <span />
              <span style={{ textAlign: 'right' }}>V2</span>
              <span style={{ textAlign: 'right' }}>Δ</span>
            </div>
            {rows.map((row) => {
              const delta = row.a != null && row.b != null ? row.b - row.a : null;
              return (
                <div key={row.label} className="byb-cmr">
                  <span>{row.label}</span>
                  <span className="n">{row.a ?? '—'}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4A5273" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14" />
                    <path d="M13 6l6 6-6 6" />
                  </svg>
                  <span className="n">{row.b ?? '—'}</span>
                  <span className="d">{delta == null ? '—' : delta > 0 ? `+${delta}` : String(delta)}</span>
                </div>
              );
            })}
          </div>
          {v1.score != null && v2.score != null ? (
            <p className="byb-wi">
              {v1.score} → {v2.score}
            </p>
          ) : null}
        </div>
        <div className="mdl-f">
          <button type="button" className="byb-quiet" onClick={onClose}>
            Close
          </button>
          <button type="button" className="byb-solid" onClick={onViewV2}>
            View V2
          </button>
        </div>
      </div>
    </div>
  );
}

function WhyQloo({
  groundedScore,
  groundedStrength,
  compare,
}: {
  groundedScore: number | null;
  groundedStrength: string;
  compare: RunSnapshot;
}) {
  const quote = compare.personas[0]?.quote ?? 'A generic reaction, with no cultural evidence.';
  return (
    <div className="td-compare" data-testid="why-qloo-panel">
      <article>
        <p className="byb-over">Qloo-grounded</p>
        <p className="byb-note">Cultural resonance score {groundedScore ?? '—'}</p>
        <p className="byb-note">Evidence confidence {groundedStrength}</p>
        <p className="byb-note">Entities, tags, and heatmap cells stay attached to each change.</p>
      </article>
      <article>
        <p className="byb-over">LLM-only</p>
        <p className="byb-note">No score. Not a sales forecast.</p>
        <p className="byb-note">Evidence confidence LIMITED. This pass cannot clear the evidence gate.</p>
        <p className="byb-note">{quote}</p>
        <p className="byb-note" data-testid="llm-stop">
          {plainStopReason(compare.stopReason ?? 'insufficient_evidence')}
        </p>
      </article>
    </div>
  );
}

function TraceWhy({ trace }: { trace: DecisionTrace }) {
  if (!trace.summary && !trace.steps.length && !trace.raw.length) return null;
  return (
    <div className="td-tracebox">
      {trace.summary ? (
        <p className="byb-note" data-testid="trace-summary">
          {trace.summary}
        </p>
      ) : null}
      <details className="td-why">
        <summary className="byb-wtag" data-testid="trace-why">
          Why?
        </summary>
        <div className="td-trace-panel" data-testid="decision-trace">
          {trace.steps.length ? (
            <ol className="td-trace">
              {trace.steps.map((line, index) => (
                <li key={`${index}-${line}`}>{line}</li>
              ))}
            </ol>
          ) : null}
          {trace.raw.length ? <p className="td-raw">{trace.raw.join('\n')}</p> : null}
        </div>
      </details>
    </div>
  );
}

export function ReportPhase({
  score,
  strength,
  grounding,
  city,
  spots,
  applied,
  stop,
  trace,
  onExport,
  onBack,
}: {
  score: number | null;
  strength: string;
  grounding: 'qloo' | 'recorded' | 'llm-only';
  city: string;
  spots: HeatSpot[];
  applied: ProposalView[];
  stop: string | null;
  trace: DecisionTrace;
  onExport: () => void;
  onBack: () => void;
}) {
  return (
    <article className="td-report" data-testid="launch-report">
      <p className="byb-over">Launch report</p>
      <h1 className="ws-title">Cultural resonance score</h1>
      <p className="ws-bn" data-testid="report-score">
        {score ?? '—'}
      </p>
      <p className="byb-note">Not a sales forecast</p>
      <p className="byb-note">Evidence confidence {strength}</p>
      {grounding === 'recorded' ? <p className="byb-note">Recorded run</p> : null}
      <HeatCard city={city} spots={spots} note={grounding === 'recorded' ? 'Recorded run' : 'Qloo heatmap'} />
      <h2 className="byb-over">Approved changes</h2>
      {applied.length ? (
        applied.map((proposal) => (
          <p key={proposal.id} className="byb-note">
            {proposal.before} → {proposal.after}. Evidence {proposal.evidence}
          </p>
        ))
      ) : (
        <p className="byb-note">No change was approved.</p>
      )}
      <p className="byb-note" data-testid="report-stop">
        {plainStopReason(stop)}
      </p>
      <TraceWhy trace={trace} />
      <div className="byb-cta no-print">
        <span className="byb-ring">
          <button type="button" className="byb-primary is-light" onClick={onExport}>
            <span>Export</span>
            <Arrow />
          </button>
        </span>
        <button type="button" className="byb-quiet" onClick={onBack}>
          Back
        </button>
      </div>
    </article>
  );
}

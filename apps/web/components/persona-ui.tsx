'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { ProposalView } from '@/lib/api';
import { hexLayout } from '@/lib/hex';
import { uniqueById } from '@/lib/defaults';
import { fitOf, passSentence } from '@/lib/labels';
import type { EvidenceChip, Persona } from '@/lib/personas';

export const AGENT_STEPS = [
  'Build personas from Qloo',
  'Interview each persona',
  'Diagnose who rejects it',
  'Search Qloo for fixes',
  'Simulate options with the engine',
  'Propose the best change',
] as const;

export function AgentSteps({ step = 0, done, labels }: { step?: number; done?: boolean; labels?: readonly string[] }) {
  const live = labels != null;
  const rows = live ? labels : [...AGENT_STEPS];
  return (
    <ul className="byb-steps td-loop" data-testid="agent-loop">
      {rows.map((label, index) => {
        const finished = done || (live ? index < rows.length - 1 : index < step);
        const on = !done && (live ? index === rows.length - 1 : index === step);
        const cls = `byb-step${finished ? ' is-done' : on ? ' is-on' : ''}`;
        return (
          <li key={`${label}-${index}`} className={cls} data-testid={on ? 'analysis-step' : undefined}>
            <span className="byb-sd">{on ? <i /> : null}</span>
            <span>{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

function anchorStyle(type: string): string {
  const fit = fitOf(type);
  return `cv ${fit === 'circle' ? 'rd' : 'sq'}${fit === 'logo' ? ' logo' : ''}`;
}

export interface HeatSpot {
  id: string;
  label: string;
  weight: number;
  lat?: number;
  lng?: number;
}

export function PersonaGrid({
  personas,
  onTalk,
}: {
  personas: Persona[];
  onTalk: (persona: Persona) => void;
}) {
  if (!personas.length) return null;
  return (
    <section aria-label="Personas" data-testid="personas">
      <p className="byb-over">Simulated customers</p>
      <div className="td-personas">
        {personas.map((persona) => (
          <article key={persona.id} className={persona.rejects ? 'td-persona is-no' : 'td-persona'} data-testid="persona-card">
            <div className="who">
              <span className="td-av" aria-hidden="true">
                {persona.initials}
              </span>
              <span className="td-who-name">
                <b>{persona.label}</b>
                <span className="td-sim">Simulated</span>
              </span>
              <span className="fit">{persona.measuring ? '—' : persona.fit}</span>
            </div>
            {persona.anchors.length ? (
              <div className="td-anchors">
                {uniqueById(persona.anchors).map((anchor) => (
                  <figure key={anchor.id} className="td-anchor" title={anchor.name}>
                    <span className={anchorStyle(anchor.type)}>
                      <b>{anchor.name.slice(0, 1).toUpperCase()}</b>
                      {anchor.image ? <img alt="" src={anchor.image} /> : null}
                    </span>
                    <small>{anchor.name}</small>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="td-anchors" aria-hidden="true">
                <span className="td-skel" />
                <span className="td-skel" />
                <span className="td-skel" />
              </div>
            )}
            <SimulatedQuote>{persona.interview}</SimulatedQuote>
            <button type="button" className="byb-tbtn" style={{ marginLeft: -12 }} onClick={() => onTalk(persona)}>
              Talk
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function cssToStyle(css: string): CSSProperties {
  const style: Record<string, string> = {};
  css.split(';').forEach((rule) => {
    const split = rule.indexOf(':');
    if (split < 0) return;
    const prop = rule.slice(0, split).trim();
    const value = rule.slice(split + 1).trim();
    if (!prop || !value) return;
    if (prop.startsWith('--')) style[prop] = value;
    else style[prop.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
  });
  return style;
}

export function HeatCard({ city, spots, note }: { city: string; spots: HeatSpot[]; note: string | null }) {
  const ranked = [...spots].sort((a, b) => b.weight - a.weight);
  const map = hexLayout(city || 'city', false, ranked);
  return (
    <aside className="td-heat" aria-label={`District heatmap of ${city}`} data-testid="heatmap">
      <p className="byb-over">Districts</p>
      <div className="byb-mapbox">
        <div className="byb-map" role="img" aria-label={`District heatmap of ${city}`}>
          {map.cells.map((cell, index) => (
            <div key={index} className="byb-hex" style={cssToStyle(cell.style)} />
          ))}
          {map.pins.map((pin, index) => (
            <span key={`${pin.id}-${index}`} className="td-mappin" style={cssToStyle(pin.style)} title={`${pin.label} · affinity ${pin.weight.toFixed(2)}`}>
              {pin.label}
              {map.pins.some((other) => Math.round(other.weight * 100) !== Math.round(pin.weight * 100)) ? (
                <small>{Math.round(pin.weight * 100)}</small>
              ) : null}
            </span>
          ))}
        </div>
      </div>
      {!spots.length ? <p className="byb-note">Still measuring where this shows up in {city}.</p> : null}
      {note ? <p className="byb-note">{note}</p> : null}
    </aside>
  );
}

function SimulatedQuote({ children }: { children: ReactNode }) {
  return (
    <figure className="td-say">
      <figcaption className="td-sim">Simulated response</figcaption>
      <blockquote className="td-quote">
        <q>{children}</q>
      </blockquote>
    </figure>
  );
}

export function LoopOutput({
  personas,
  proposal,
}: {
  personas: Persona[];
  proposal: ProposalView | null;
}) {
  const quotes = personas.filter((persona) => persona.interview).slice(0, 3);
  const rejecting = personas.filter((persona) => persona.rejects);
  return (
    <div className="td-loopout" data-testid="loop-output">
      <div className="td-looppeople">
        {personas.length
          ? personas.map((persona) => (
              <span key={persona.id} className="td-av" title={persona.label}>
                {persona.initials}
              </span>
            ))
          : [0, 1, 2, 3].map((slot) => <span key={slot} className="td-skel td-skel-av" />)}
      </div>
      {quotes.length ? (
        <ul className="td-quotes">
          {quotes.map((persona) => (
            <li key={persona.id}>
              <SimulatedQuote>
                <b>{persona.label}.</b> {persona.interview}
              </SimulatedQuote>
            </li>
          ))}
        </ul>
      ) : null}
      {rejecting.length ? <p className="td-quote">{passSentence(rejecting)}</p> : null}
      {proposal ? (
        <p className="td-quote">
          Simulated option: {proposal.before} → {proposal.after}
          {proposal.predictedDelta != null ? ` (${proposal.predictedDelta > 0 ? '+' : ''}${proposal.predictedDelta})` : ''}
        </p>
      ) : null}
    </div>
  );
}

export function CustomizeFold({
  open,
  summary,
  onToggle,
  children,
}: {
  open: boolean;
  summary: ReactNode;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="ws-fold" data-testid="customize">
      <button type="button" className="ws-foldb" aria-expanded={open} onClick={onToggle}>
        <span>
          Customize
          <small>{summary}</small>
        </span>
        <span className={open ? 'chv is-open' : 'chv'} aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? <div className="ws-foldc">{children}</div> : null}
    </div>
  );
}

export function ScoreTimeline({
  scores,
  stop,
  onRevert,
}: {
  scores: number[];
  stop: string | null;
  onRevert: () => void;
}) {
  if (scores.length < 2 && !stop) return null;
  return (
    <div data-testid="score-timeline">
      <ol className="td-timeline">
        {scores.map((score, index) => (
          <li key={`${score}-${index}`}>
            {index > 0 ? <span style={{ fontWeight: 500, color: '#4A5273', marginRight: 8 }}>→</span> : null}
            {score}
          </li>
        ))}
      </ol>
      {stop ? (
        <p className="byb-note" data-testid="evidence-stop">
          {stop}
        </p>
      ) : null}
      {scores.length > 1 ? (
        <button type="button" className="byb-tbtn" data-testid="revert-step" onClick={onRevert}>
          Revert
        </button>
      ) : null}
    </div>
  );
}

export function PersonaChat({
  persona,
  say,
  evidence,
  draft,
  busy,
  onDraft,
  onSend,
  onBack,
}: {
  persona: Persona;
  say: string;
  evidence: EvidenceChip[];
  draft: string;
  busy: boolean;
  onDraft: (value: string) => void;
  onSend: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="persona-chat">
      <div className="td-loop">
        <button type="button" className="byb-tbtn" onClick={onBack}>
          All customers
        </button>
        <div className="who" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="td-av">{persona.initials}</span>
          <span className="td-who-name">
            <b>{persona.label}</b>
            <span className="td-sim">Simulated</span>
          </span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <p className="byb-p" style={{ fontSize: 16 }} data-testid="persona-say">
          {say || persona.interview}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(evidence.length ? evidence : persona.evidence).slice(0, 5).map((chip) => (
            <span key={`${chip.label}-${chip.detail}`} className="td-chip" data-testid="evidence-chip">
              {chip.label}
              <span style={{ fontWeight: 500 }}>{chip.detail}</span>
            </span>
          ))}
        </div>
      </div>
      <form
        className="flex items-center gap-2 border-t border-[rgba(120,125,170,0.16)] p-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <input
          data-testid="persona-chat-input"
          value={draft}
          aria-label={`Message ${persona.label}`}
          placeholder="Ask from their evidence"
          className="h-11 min-w-0 flex-1 rounded-full bg-[rgba(30,34,70,0.045)] px-4 text-sm outline-none"
          onChange={(event) => onDraft(event.target.value)}
        />
        <button type="submit" className="byb-solid" data-testid="persona-chat-send" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

export function bestProposal(proposals: ProposalView[], applied: ReadonlySet<string>): ProposalView | null {
  const open = proposals.filter((proposal) => (proposal.predictedDelta ?? 0) > 0 && !applied.has(proposal.id));
  open.sort((a, b) => (b.predictedDelta ?? 0) - (a.predictedDelta ?? 0) || a.id.localeCompare(b.id));
  return open[0] ?? null;
}

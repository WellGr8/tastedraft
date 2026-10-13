'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { BriefV2 } from '@tastedraft/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import type { MapPayload, ProposalView, SimulationResponse, VersionList } from '@/lib/api';
import { deltaText, humanProposalLabel, providerLabel, strengthTone } from '@/lib/labels';

const DistrictMap = dynamic(() => import('@/components/district-map').then((mod) => mod.DistrictMap), {
  ssr: false,
  loading: () => <div className="h-[240px] rounded-2xl bg-[#E4E8FA] sm:h-[360px]" />,
});

const ROW_LABEL: Record<string, string> = {
  anchor: 'Anchor affinity',
  cross: 'Cross-domain fit',
  local: 'Local fit',
  audience: 'Audience fit',
  friction: 'Cultural friction',
};

export function ResultsScreen({
  v1,
  v2,
  v1Brief,
  v2Brief,
  versions,
  map,
  demo,
  captionIndex,
  onApprove,
  onDemo,
  onEdit,
  busy,
}: {
  v1: SimulationResponse;
  v2: SimulationResponse | null;
  v1Brief: BriefV2;
  v2Brief: BriefV2 | null;
  versions: VersionList | null;
  map: MapPayload | null;
  demo: boolean;
  captionIndex: number;
  onApprove: () => void;
  onDemo: () => void;
  onEdit: () => void;
  busy: boolean;
}) {
  const captions = v1.story?.captions ?? [];
  const tone = strengthTone(v1.evidenceStrength);
  const gain = v1.score != null && v2?.score != null ? v2.score - v1.score : null;
  const before = fieldsOf(v1Brief);
  const after = v2Brief ? fieldsOf(v2Brief) : before.map((field) => ({ ...field, value: '—' }));
  const proposals = v1.proposals.slice(0, 3);
  const considered = v1.story?.considered ?? proposals.length;
  const previewKey = proposals.map((item) => `${item.id}:${item.param ?? ''}:${item.from ?? ''}:${item.to ?? ''}`).join('|');
  const [previews, setPreviews] = useState<Record<string, number>>({});

  useEffect(() => {
    if (v2) return;
    const jobs = proposals.filter((item) => item.param);
    if (!jobs.length) return;
    let cancel = false;
    void import('@/lib/engine-preview')
      .then((mod) =>
        mod.previewDeltas(
          v1Brief,
          jobs.map((item) => ({
            id: item.id,
            param: item.param ?? '',
            from: item.from,
            to: item.to,
          })),
        ),
      )
      .then((deltas) => {
        if (!cancel) setPreviews(deltas);
      })
      .catch(() => {
        if (!cancel) setPreviews({});
      });
    return () => {
      cancel = true;
    };
    // previewKey captures the proposal diffs. The proposals array is a new object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, v1Brief, v2]);

  return (
    <div
      data-testid="results-screen"
      data-demo-ready={demo && v2 ? 'true' : 'false'}
      className="mx-auto flex w-full max-w-[1120px] flex-col gap-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1" data-testid="demo-captions">
          {demo ? (
            <div className="flex flex-col gap-1.5">
              {captions.map((line, index) => (
                <p key={line} className={index === Math.min(captionIndex, captions.length - 1) ? 'text-sm leading-6 text-ink' : 'text-sm leading-6 text-slate'}>
                  {line}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm leading-6 text-slate">{captions[0] ?? 'Score, then approve the top diff.'}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" onClick={onEdit}>
            Edit brief
          </Button>
          <Button type="button" onClick={onDemo}>
            Demo mode
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card aria-label="Cultural resonance">
          <CardTitle>Cultural resonance</CardTitle>
          <div className="flex flex-wrap items-end gap-6">
            <Score label="Version 1" value={v1.score} testId="score-v1" />
            <Score label="Version 2" value={v2?.score ?? null} testId="score-v2" muted={!v2} />
            {gain != null ? <span className="pb-1 text-lg font-bold text-good">Engine {deltaText(gain)}</span> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={tone}>{v1.evidenceStrength ?? 'LIMITED'}</Badge>
            <Badge variant="meta">{providerLabel(v1.provider, v1.story?.mode)}</Badge>
          </div>
        </Card>

        <Card aria-label="Agent shortlist">
          <CardTitle>
            {proposals.length ? `Top ${proposals.length} of ${considered} simulated` : 'Agent'}
          </CardTitle>
          {proposals.length ? (
            <div className="flex flex-col gap-3">
              {proposals.map((item, index) => (
                <ProposalCard
                  key={item.id}
                  item={item}
                  index={index}
                  done={!!v2}
                  busy={busy}
                  preview={v2 ? null : previews[item.id]}
                  onApprove={onApprove}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate">No measured lift to propose.</p>
          )}
        </Card>

        <Card className="md:col-span-2" aria-label="Provenance ledger">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Provenance ledger</CardTitle>
            <Badge variant="meta" data-testid="engine-badge" className="px-2.5 py-0.5 text-[11px]">
              Engine: Rust/WASM
            </Badge>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 text-xs font-semibold tracking-[0.08em] text-slate uppercase">
            <span />
            <span>V1</span>
            <span>V2</span>
          </div>
          <Ledger v1={v1} v2={v2} />
        </Card>

        <Card className="md:col-span-2" aria-label="Version 1 and Version 2">
          <CardTitle>What changed</CardTitle>
          <p className="text-sm leading-6 text-slate">
            {v2 ? (proposals[0]?.why ?? 'Version 2 is the approved diff.') : 'Version 2 appears when a person approves the top diff.'}
          </p>
          <div className="flex flex-col">
            <div className="hidden sm:grid sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] sm:gap-4 sm:pb-1">
              <span />
              <span className="text-xs font-semibold tracking-[0.08em] text-slate uppercase">Version 1</span>
              <span className="text-xs font-semibold tracking-[0.08em] text-slate uppercase">Version 2</span>
            </div>
            {before.map((field, index) => {
              const next = after[index]?.value ?? '—';
              const changed = !!v2 && field.value !== next;
              return (
                <div
                  key={field.label}
                  className="grid grid-cols-1 gap-1 border-t border-[rgba(120,125,170,0.16)] py-3 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-baseline sm:gap-4"
                >
                  <span className="text-xs font-semibold tracking-[0.08em] text-slate uppercase">{field.label}</span>
                  <span className={`text-sm break-words ${changed ? 'text-bad line-through' : 'text-ink'}`}>
                    <span className="mr-2 text-[11px] font-semibold tracking-[0.08em] text-slate uppercase sm:hidden">V1</span>
                    {field.value}
                  </span>
                  <span className={`text-sm break-words ${changed ? 'font-bold text-good' : 'text-ink'}`}>
                    <span className="mr-2 text-[11px] font-semibold tracking-[0.08em] text-slate uppercase sm:hidden">V2</span>
                    {v2 ? next : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="md:col-span-2" aria-label="Version timeline">
          <CardTitle>Timeline</CardTitle>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(versions?.versions ?? fallbackVersions(v1, v2)).map((version) => (
              <li key={version.id} className="min-w-0 rounded-2xl bg-white/70 p-4">
                <p className="text-xs font-semibold tracking-[0.08em] text-slate uppercase">Version {version.number}</p>
                <p className="mt-1 text-3xl font-bold tracking-tight text-ink">{scoreFor(version.number, v1, v2)}</p>
                <p className="mt-1 text-sm leading-6 text-slate">{versionNote(version.origin, proposals[0])}</p>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="md:col-span-2" aria-label="District map">
          <CardTitle>District map</CardTitle>
          <DistrictMap payload={map} />
        </Card>
      </div>
    </div>
  );
}

function Score({ label, value, testId, muted }: { label: string; value: number | null; testId: string; muted?: boolean }) {
  return (
    <div>
      <span className="text-sm text-slate">{label}</span>
      <b data-testid={testId} className={`block text-5xl leading-none font-bold tracking-[-0.04em] sm:text-6xl ${muted ? 'text-[#2A3150]' : 'text-ink'}`}>
        {value == null ? '—' : value}
      </b>
    </div>
  );
}

function ProposalCard({
  item,
  index,
  done,
  busy,
  preview,
  onApprove,
}: {
  item: ProposalView;
  index: number;
  done: boolean;
  busy: boolean;
  preview?: number | null;
  onApprove: () => void;
}) {
  const title = item.param
    ? humanProposalLabel(item.param, item.from ?? null, item.to ?? null)
    : `${item.before} → ${item.after}`;
  return (
    <article data-testid={`proposal-${index}`} className="min-w-0 border-t border-[rgba(120,125,170,0.16)] pt-3">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-sm">
        <span className="text-bad line-through">{item.from ?? item.before}</span>
        <span className="text-slate"> → </span>
        <span className="font-bold text-good">{item.to ?? item.after}</span>
      </p>
      <p className="mt-1 text-sm leading-6 text-ink-soft">{item.why}</p>
      <p className="mt-1 text-[13px] text-slate">
        Engine {deltaText(item.predictedDelta)}
        {item.evidence ? ` · ${item.evidence}` : ''}
      </p>
      {preview != null ? (
        <p data-testid={index === 0 ? 'engine-preview' : undefined} className="mt-1 text-[13px] font-semibold text-iris">
          Live preview {deltaText(preview)} before Apply
        </p>
      ) : null}
      {index === 0 && !done ? (
        <Button type="button" size="sm" className="mt-2" onClick={onApprove} disabled={busy}>
          {busy ? 'Scoring' : 'Approve top diff'}
        </Button>
      ) : null}
    </article>
  );
}

function Ledger({ v1, v2 }: { v1: SimulationResponse; v2: SimulationResponse | null }) {
  const rows = v1.story?.provenance?.length
    ? v1.story.provenance
    : ['anchor', 'cross', 'local', 'audience', 'friction'].map((id) => ({
        id,
        label: ROW_LABEL[id] ?? id,
        points: v1.ledger?.[id as 'anchor'] ?? null,
        detail: '',
      }));
  return (
    <div>
      {rows.map((row) => {
        const next = v2 ? pointOf(v2, row.id) : null;
        const changed = v2 != null && next != null && next !== row.points;
        return (
          <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-4 border-t border-[rgba(120,125,170,0.16)] py-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{row.label}</span>
              {row.detail ? <span className="mt-0.5 block text-[13px] leading-5 text-slate">{row.detail}</span> : null}
            </span>
            <b className="text-sm tabular-nums">{row.points ?? '—'}</b>
            <b className={`text-sm tabular-nums ${changed ? 'text-good' : ''}`}>{v2 ? (next ?? '—') : '—'}</b>
          </div>
        );
      })}
    </div>
  );
}

function pointOf(sim: SimulationResponse, id: string): number | null {
  const story = sim.story?.provenance.find((row) => row.id === id)?.points;
  if (story != null) return story;
  const ledger = sim.ledger;
  if (!ledger) return null;
  if (id === 'anchor' || id === 'cross' || id === 'local' || id === 'audience' || id === 'friction') return ledger[id];
  return null;
}

function fieldsOf(brief: BriefV2): Array<{ label: string; value: string }> {
  const district = brief.locations[0]?.name;
  const location = district && district !== brief.city ? `${district}, ${brief.city}` : brief.city;
  const channel =
    brief.constraints.find((item) => /pre-?order|limited|exclusive|scarce/i.test(item)) ??
    (/limited/i.test(brief.idea) ? 'limited runs' : 'open');
  return [
    { label: 'Price level', value: brief.priceLevel == null ? 'Not set' : String(brief.priceLevel) },
    { label: 'Age', value: brief.age },
    { label: 'Gender', value: brief.gender ?? 'Not set' },
    { label: 'Location', value: location },
    { label: 'Channel', value: channel },
    { label: 'Positioning', value: brief.positioning },
    { label: 'References', value: brief.references.map((reference) => reference.name).join(', ') },
  ];
}

function fallbackVersions(v1: SimulationResponse, v2: SimulationResponse | null) {
  const rows = [{ id: v1.id, number: v1.versionNumber || 1, origin: 'initial' }];
  if (v2) rows.push({ id: v2.id, number: v2.versionNumber || 2, origin: 'recommendation_applied' });
  return rows;
}

function scoreFor(number: number, v1: SimulationResponse, v2: SimulationResponse | null): string {
  if (number === v1.versionNumber) return v1.score == null ? '—' : String(v1.score);
  if (v2 && number === v2.versionNumber) return v2.score == null ? '—' : String(v2.score);
  if (number === 1) return v1.score == null ? '—' : String(v1.score);
  if (number === 2 && v2) return v2.score == null ? '—' : String(v2.score);
  return '—';
}

function versionNote(origin: string, top: ProposalView | undefined): string {
  if (origin === 'recommendation_applied' && top?.param) {
    return humanProposalLabel(top.param, top.from ?? null, top.to ?? null);
  }
  if (origin === 'recommendation_applied') return top?.why ?? 'Approved diff';
  if (origin === 'brief_edit') return 'Brief edited';
  return 'Default brief';
}

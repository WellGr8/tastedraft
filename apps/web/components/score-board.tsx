'use client';

import dynamic from 'next/dynamic';
import type { BriefV2 } from '@tastedraft/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import type { MapPayload, SimulationResponse, VersionList } from '@/lib/api';
import { deltaText, strengthTone } from '@/lib/labels';
import { ROW_LABEL, liveDetail, type ProfileControls } from '@/lib/profile';
import type { DraftState } from '@/lib/defaults';
import type { LiveScore } from '@/lib/engine-preview';

const DistrictMap = dynamic(() => import('@/components/district-map').then((mod) => mod.DistrictMap), {
  ssr: false,
  loading: () => <div className="h-[220px] rounded-2xl bg-[#E4E8FA]" />,
});

export interface AlbumCard {
  id: string;
  name: string;
  score: number | null;
  covers: string[];
  note: string;
}

export function ScoreBoard({
  draft,
  controls,
  live,
  v1,
  v2,
  versions,
  albums,
  map,
  scoring,
  onScore,
  onSave,
  onDuplicate,
  onOpenAlbum,
}: {
  draft: DraftState;
  controls: ProfileControls;
  live: LiveScore | null;
  v1: SimulationResponse | null;
  v2: SimulationResponse | null;
  versions: VersionList | null;
  albums: AlbumCard[];
  map: MapPayload | null;
  scoring: boolean;
  onScore: () => void;
  onSave: () => void;
  onDuplicate: () => void;
  onOpenAlbum: (id: string) => void;
}) {
  const diverged = v1 != null && live != null && live.total !== (v2?.score ?? v1.score);
  const tone = strengthTone(v1?.evidenceStrength);
  const rows = ledgerRows(draft, controls, live, diverged ? null : v1, diverged ? null : v2);

  return (
    <div className="flex flex-col gap-4">
      <Card aria-label="Cultural resonance">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-8">
            <div>
              <span className="text-sm text-slate">Live</span>
              <b data-testid="live-score" className="block text-5xl leading-none font-bold tracking-[-0.04em] text-ink sm:text-6xl">
                {live ? live.total : '…'}
              </b>
            </div>
            {v1 ? (
              <div>
                <span className="text-sm text-slate">Scored</span>
                <b data-testid="score-v1" className="block text-4xl leading-none font-bold tracking-[-0.04em] text-ink">
                  {v1.score ?? '—'}
                </b>
              </div>
            ) : null}
            {v2 ? (
              <div>
                <span className="text-sm text-slate">Approved</span>
                <b data-testid="score-v2" className="block text-4xl leading-none font-bold tracking-[-0.04em] text-good">
                  {v2.score ?? '—'}
                </b>
              </div>
            ) : null}
            {v1?.score != null && v2?.score != null ? (
              <span className="pb-1 text-lg font-bold text-good">{deltaText(v2.score - v1.score)}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onScore} disabled={scoring || !draft.idea.trim()}>
              {scoring ? 'Scoring' : 'Score profile'}
            </Button>
            <Button type="button" variant="outline" onClick={onSave}>
              Save
            </Button>
            <Button type="button" variant="outline" onClick={onDuplicate}>
              Duplicate
            </Button>
          </div>
        </div>
        {v1 ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant={tone}>{v1.evidenceStrength ?? 'LIMITED'}</Badge>
          </div>
        ) : (
          <p className="text-sm text-slate">Sliders rescore here. Score profile when you want the ledger saved.</p>
        )}
      </Card>

      <Card aria-label="Provenance ledger">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Provenance ledger</CardTitle>
          <Badge variant="meta" data-testid="engine-badge" className="px-2.5 py-0.5 text-[11px]">
            Engine: Rust/WASM
          </Badge>
        </div>
        {v2 ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 text-xs font-semibold tracking-[0.08em] text-slate uppercase">
            <span />
            <span>V1</span>
            <span>V2</span>
          </div>
        ) : null}
        <div>
          {rows.map((row) => (
            <div
              key={row.id}
              className={
                v2
                  ? 'grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-4 border-t border-[rgba(120,125,170,0.16)] py-3'
                  : 'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 border-t border-[rgba(120,125,170,0.16)] py-3'
              }
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{row.label}</span>
                {row.detail ? <span className="mt-0.5 block text-[13px] leading-5 text-slate">{row.detail}</span> : null}
              </span>
              <b className="text-sm tabular-nums">{row.points ?? '—'}</b>
              {v2 ? <b className="text-sm tabular-nums text-good">{row.after ?? '—'}</b> : null}
            </div>
          ))}
        </div>
      </Card>

      <Card aria-label="Versions">
        <CardTitle>Versions</CardTitle>
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {albumCards(albums, versions, v1, v2).map((album) => (
            <li key={album.id}>
              <button type="button" onClick={() => onOpenAlbum(album.id)} className="w-full rounded-2xl bg-white/80 p-3 text-left">
                <span className="mb-2 flex h-14 gap-1 overflow-hidden rounded-xl bg-[#E4E8FA]">
                  {album.covers.slice(0, 3).map((src) => (
                    <img key={src} src={src} alt="" className="h-full flex-1 object-cover" />
                  ))}
                </span>
                <span className="block truncate text-sm font-semibold text-ink">{album.name}</span>
                <span className="block text-2xl font-bold tracking-tight text-ink">{album.score ?? '—'}</span>
                <span className="block truncate text-xs text-slate">{album.note}</span>
              </button>
            </li>
          ))}
        </ol>
      </Card>

      <Card aria-label="District map">
        <CardTitle>District map</CardTitle>
        <DistrictMap payload={map} />
      </Card>
    </div>
  );
}

function ledgerRows(
  draft: DraftState,
  controls: ProfileControls,
  live: LiveScore | null,
  v1: SimulationResponse | null,
  v2: SimulationResponse | null,
) {
  const ids = ['anchor', 'cross', 'local', 'audience', 'friction'];
  return ids.map((id) => {
    const server = v1?.story?.provenance.find((row) => row.id === id);
    const liveRow = live?.rows.find((row) => row.id === id);
    const after = v2?.story?.provenance.find((row) => row.id === id)?.points ?? pointOf(v2, id);
    return {
      id,
      label: server?.label || ROW_LABEL[id] || id,
      points: server?.points ?? liveRow?.points ?? null,
      after,
      detail: server?.detail || liveDetail(id, draft, controls),
    };
  });
}

function pointOf(sim: SimulationResponse | null, id: string): number | null {
  if (!sim?.ledger) return null;
  if (id === 'anchor' || id === 'cross' || id === 'local' || id === 'audience' || id === 'friction') return sim.ledger[id];
  return null;
}

function albumCards(albums: AlbumCard[], versions: VersionList | null, v1: SimulationResponse | null, v2: SimulationResponse | null): AlbumCard[] {
  const server = (versions?.versions ?? []).map((version) => ({
    id: version.id,
    name: `Version ${version.number}`,
    score: version.number === v2?.versionNumber ? (v2.score ?? null) : version.number === v1?.versionNumber ? (v1?.score ?? null) : version.number === 1 ? (v1?.score ?? null) : version.number === 2 ? (v2?.score ?? null) : null,
    covers: [],
    note: version.origin === 'recommendation_applied' ? 'Approved' : version.origin === 'brief_edit' ? 'Brief edit' : 'Saved score',
  }));
  return [...server, ...albums];
}

export function coversOf(brief: BriefV2 | null, draft: DraftState): string[] {
  const rows = brief?.references ?? draft.references;
  return rows.map((entity) => entity.image).filter((src): src is string => Boolean(src));
}

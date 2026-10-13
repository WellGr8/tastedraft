'use client';

import { useMemo, useState } from 'react';
import Map, { Marker } from 'react-map-gl/maplibre';
import type { MapLayer } from '@tastedraft/contracts';
import type { MapPayload } from '@/lib/api';
import 'maplibre-gl/dist/maplibre-gl.css';

const REMOTE_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const EMPTY_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#E4E8FA' } }],
};

type District = 'fits' | 'friction';
type Version = 'v1' | 'v2' | 'both';

interface Spot {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color: string;
}

function spots(layer: MapLayer | null, color: string, prefix: string): Spot[] {
  if (!layer) return [];
  if (layer.kind === 'heatmap') {
    return layer.cells.map((cell) => ({
      id: `${prefix}-${cell.id}`,
      lat: cell.lat,
      lng: cell.lng,
      label: cell.label ?? '',
      color,
    }));
  }
  return layer.pins.map((pin) => ({
    id: `${prefix}-${pin.id}`,
    lat: pin.lat,
    lng: pin.lng,
    label: pin.name,
    color,
  }));
}

export function DistrictMap({ payload }: { payload: MapPayload | null }) {
  const [district, setDistrict] = useState<District>('fits');
  const [version, setVersion] = useState<Version>('both');
  const [style, setStyle] = useState<string | typeof EMPTY_STYLE>(REMOTE_STYLE);

  const markers = useMemo(() => {
    if (!payload) return [];
    const pack = payload[district];
    const list: Spot[] = [];
    if (version !== 'v2') list.push(...spots(pack.v1, district === 'fits' ? '#0C5F38' : '#A02B28', 'v1'));
    if (version !== 'v1') list.push(...spots(pack.v2, district === 'fits' ? '#3B6CFF' : '#B8892B', 'v2'));
    return list;
  }, [payload, district, version]);

  const center = payload?.center ?? { lat: 34.0522, lng: -118.2437 };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(240px,0.72fr)]">
      <div className="h-[240px] overflow-hidden rounded-2xl bg-[#E4E8FA] sm:h-[360px] lg:h-[420px]" data-testid="district-map">
        <Map
          mapStyle={style}
          initialViewState={{ longitude: center.lng, latitude: center.lat, zoom: 11 }}
          style={{ width: '100%', height: '100%' }}
          attributionControl={false}
          onError={() => setStyle(EMPTY_STYLE)}
        >
          {markers.map((spot) => (
            <Marker key={spot.id} longitude={spot.lng} latitude={spot.lat} anchor="center">
              <span className="inline-flex max-w-[140px] items-center gap-1.5 rounded-full bg-white/95 px-2 py-1 text-[11px] font-semibold text-ink shadow-[0_4px_12px_rgba(30,34,70,0.14)]">
                <i className="size-1.5 shrink-0 rounded-full" style={{ background: spot.color }} />
                <span className="truncate">{spot.label || 'District'}</span>
              </span>
            </Marker>
          ))}
        </Map>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-xs font-semibold tracking-[0.14em] text-slate uppercase">{payload?.city ?? 'Map'}</p>
        <p className="text-sm leading-6 text-slate">{payload?.note ?? 'The district map loads with the simulation.'}</p>
        <Toggle
          label="Fits or friction"
          value={district}
          options={[
            ['fits', 'Fits'],
            ['friction', 'Friction'],
          ]}
          onChange={setDistrict}
        />
        <Toggle
          label="Version"
          value={version}
          options={[
            ['v1', 'V1'],
            ['v2', 'V2'],
            ['both', 'V1 vs V2'],
          ]}
          onChange={setVersion}
        />
        <p className="text-xs text-slate">{payload ? `${payload.basis} · ${payload.mode}` : 'Waiting for layers'}</p>
      </div>
    </div>
  );
}

function Toggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`min-h-9 rounded-full px-3 text-sm font-semibold ${
            value === id ? 'bg-primary text-primary-foreground' : 'border border-[rgba(120,125,170,0.3)] bg-white text-ink'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

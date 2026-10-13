'use client';

import { useState } from 'react';
import type { Entity } from '@tastedraft/contracts';
import { entityMeta, fitOf } from '@/lib/labels';
import { cn } from '@/lib/utils';

/** Shared 44px frame so cards, suggestions, and tag rows crop the same way. */
const THUMB = 'size-11';

export function Thumb({
  name,
  image,
  fit,
}: {
  name: string;
  image?: string;
  fit: 'logo' | 'circle' | 'cover';
}) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(image) && !broken;
  return (
    <span
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden bg-white shadow-[inset_0_0_0_1px_rgba(30,34,70,0.08)]',
        THUMB,
        fit === 'circle' ? 'rounded-full' : 'rounded-lg',
      )}
    >
      {showImage ? (
        <img
          src={image}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <b className="text-sm font-semibold text-label">{name.slice(0, 1).toUpperCase()}</b>
      )}
    </span>
  );
}

export const entityGridClass = 'grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3';

export function EntityCard({ entity, onRemove }: { entity: Entity; onRemove: () => void }) {
  const fit = fitOf(entity.type);
  return (
    <li className="relative flex h-16 min-w-0 items-center gap-3 rounded-2xl bg-white/95 pr-9 pl-2 shadow-[0_2px_8px_rgba(30,34,70,0.08),inset_0_1px_0_rgba(255,255,255,0.9)]">
      <Thumb name={entity.name} image={entity.image} fit={fit} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-5 font-semibold text-ink">{entity.name}</span>
        <span className="block truncate text-xs leading-4 text-slate">{entityMeta(entity)}</span>
      </span>
      <button
        type="button"
        aria-label={`Remove ${entity.name}`}
        onClick={onRemove}
        className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-[rgba(30,34,70,0.07)] text-sm leading-none text-label hover:bg-[rgba(160,43,40,0.14)] hover:text-bad"
      >
        ×
      </button>
    </li>
  );
}

export function EntityOption({ entity, active }: { entity: Entity; active: boolean }) {
  const fit = fitOf(entity.type);
  return (
    <span className={cn('flex h-14 w-full min-w-0 items-center gap-3 rounded-xl px-2 text-left', active && 'bg-[rgba(79,107,255,0.12)]')}>
      <Thumb name={entity.name} image={entity.image} fit={fit} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-5 font-semibold text-ink">{entity.name}</span>
        <span className="block truncate text-xs leading-4 text-slate">{entityMeta(entity)}</span>
      </span>
    </span>
  );
}

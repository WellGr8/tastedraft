'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Entity, Tag } from '@tastedraft/contracts';
import { GripVertical, Volume2, VolumeX } from 'lucide-react';
import { EntityOption, Thumb } from '@/components/entity-card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { TasteDraftClient } from '@/lib/api';
import { AGES, mergeEntities, suggestEntities, uniqueById, type DraftState } from '@/lib/defaults';
import { typeLabel } from '@/lib/labels';
import {
  MOODS,
  PROFILE_CITIES,
  type PriceLevel,
  type ProfileControls,
  type Scarcity,
  similarNames,
} from '@/lib/profile';
import { cn } from '@/lib/utils';

export function TasteProfile({
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
  const ageIndex = Math.max(0, AGES.indexOf(draft.age as (typeof AGES)[number]));
  const scarcityIndex = controls.scarcity === 'open' ? 0 : controls.scarcity === 'preorder' ? 2 : 1;
  const suggestions = similarNames(draft);
  const references = uniqueById(draft.references);
  const locations = uniqueById(draft.locations);

  function move(from: number, to: number) {
    if (to < 0 || to >= references.length || from === to) return;
    const next = [...references];
    const [row] = next.splice(from, 1);
    if (!row) return;
    next.splice(to, 0, row);
    onDraft({ ...draft, references: next });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-[0.14em] text-label uppercase">Taste profile</p>
        <h1 className="text-3xl leading-tight font-bold tracking-[-0.03em] text-ink sm:text-4xl">
          Before you make <span className="td-grad">anything</span>
        </h1>
      </header>

      <Textarea
        aria-label="Idea"
        value={draft.idea}
        className="min-h-[88px] text-base"
        onChange={(event) => onDraft({ ...draft, idea: event.target.value })}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-xs font-semibold tracking-[0.12em] text-label uppercase">
          City
          <select
            aria-label="City"
            value={draft.city}
            onChange={(event) => onDraft({ ...draft, city: event.target.value })}
            className="h-[52px] w-full appearance-none rounded-full border border-transparent bg-[rgba(30,34,70,0.045)] px-5 text-base font-medium tracking-normal text-ink normal-case outline-none focus-visible:bg-white focus-visible:shadow-[0_0_0_4px_rgba(91,110,255,0.14)]"
          >
            {PROFILE_CITIES.map((city) => (
              <option key={city}>{city}</option>
            ))}
            {PROFILE_CITIES.includes(draft.city as (typeof PROFILE_CITIES)[number]) ? null : <option>{draft.city}</option>}
          </select>
        </label>
        <ReferenceSearch
          city={draft.city}
          onPick={(entity) => {
            if (references.length >= 8) return;
            if (references.some((item) => item.id === entity.id || item.name.toLowerCase() === entity.name.toLowerCase())) return;
            const nextReferences = [...references, entity];
            const nextLocations =
              typeLabel(entity.type) === 'Place' &&
              !locations.some((item) => item.id === entity.id || item.name.toLowerCase() === entity.name.toLowerCase())
                ? [...locations, { ...entity, city: entity.city || draft.city }]
                : locations;
            onDraft({ ...draft, references: nextReferences, locations: nextLocations });
          }}
        />
      </div>

      <ul className="flex flex-col gap-2" aria-label="Reference playlist">
        {references.map((entity, index) => {
          const muted = controls.muted.includes(entity.id);
          return (
            <li
              key={entity.id}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const from = Number(event.dataTransfer.getData('text/plain'));
                if (Number.isFinite(from)) move(from, index);
              }}
              className={cn(
                'flex h-[4.5rem] min-w-0 items-center gap-3 rounded-2xl bg-white/95 pr-2 pl-2 shadow-[0_2px_8px_rgba(30,34,70,0.08)]',
                muted && 'opacity-45',
              )}
            >
              <button type="button" className="grid size-8 shrink-0 cursor-grab place-items-center text-slate" aria-label={`Reorder ${entity.name}`}>
                <GripVertical className="size-4" />
              </button>
              <Thumb name={entity.name} image={entity.image} fit={typeLabel(entity.type) === 'Artist' ? 'circle' : typeLabel(entity.type) === 'Brand' ? 'logo' : 'cover'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{entity.name}</span>
                <span className="block truncate text-xs text-slate">
                  {typeLabel(entity.type)} · weight {Math.max(1, 3 - Math.min(2, Math.floor(index / 2)))}
                </span>
              </span>
              <button
                type="button"
                aria-label={muted ? `Unmute ${entity.name}` : `Mute ${entity.name}`}
                aria-pressed={muted}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-[rgba(30,34,70,0.06)] text-label"
                onClick={() =>
                  onControls({
                    ...controls,
                    muted: muted ? controls.muted.filter((id) => id !== entity.id) : [...controls.muted, entity.id],
                  })
                }
              >
                {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </button>
            </li>
          );
        })}
      </ul>

      {suggestions.length ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold tracking-[0.12em] text-label uppercase">Add similar</span>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {suggestions.map((name) => (
              <button
                key={name}
                type="button"
                className="inline-flex h-9 shrink-0 items-center rounded-full bg-white px-3.5 text-sm font-medium text-ink shadow-[0_2px_8px_rgba(30,34,70,0.08)]"
                onClick={() => onAddSimilar(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold tracking-[0.12em] text-label uppercase">Mood</span>
        <div className="flex flex-wrap gap-2">
          {MOODS.map((mood) => {
            const on = draft.interests.some((tag) => tag.id === mood.id);
            return (
              <button
                key={mood.id}
                type="button"
                aria-pressed={on}
                className={cn(
                  'inline-flex h-9 items-center rounded-full px-3.5 text-sm font-medium',
                  on ? 'bg-ink text-white' : 'bg-white text-ink shadow-[0_2px_8px_rgba(30,34,70,0.08)]',
                )}
                onClick={() => onDraft({ ...draft, interests: toggleTag(draft.interests, mood, on) })}
              >
                {mood.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Slider
          label="Audience age"
          min={0}
          max={3}
          value={ageIndex}
          display={draft.age}
          onChange={(index) => onDraft({ ...draft, age: AGES[index] ?? draft.age })}
        />
        <Slider
          label="Price level"
          testId="price-slider"
          min={1}
          max={4}
          value={controls.priceLevel}
          display={String(controls.priceLevel)}
          onChange={(value) => onControls({ ...controls, priceLevel: value as PriceLevel })}
        />
        <Slider
          label="Scarcity"
          min={0}
          max={2}
          value={scarcityIndex}
          display={controls.scarcity}
          onChange={(value) => onControls({ ...controls, scarcity: (['open', 'limited', 'preorder'] as Scarcity[])[value] ?? 'limited' })}
        />
      </div>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  display,
  testId,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  display: string;
  testId?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-baseline justify-between gap-3 text-xs font-semibold tracking-[0.12em] text-label uppercase">
        {label}
        <b className="text-sm font-semibold tracking-normal text-ink normal-case">{display}</b>
      </span>
      <input
        data-testid={testId}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        className="w-full accent-[#4b3aa8]"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function toggleTag(tags: Tag[], mood: Tag, on: boolean): Tag[] {
  if (on) return tags.filter((tag) => tag.id !== mood.id);
  return [...tags, mood];
}

function ReferenceSearch({ city, onPick }: { city: string; onPick: (entity: Entity) => void }) {
  const clientRef = useRef<TasteDraftClient | null>(null);
  if (!clientRef.current) clientRef.current = new TasteDraftClient();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Entity[]>([]);
  const [open, setOpen] = useState(false);
  const listId = useId();

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setItems([]);
      setOpen(false);
      return;
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        const local = suggestEntities(q, 'reference', city);
        let remote: Entity[] = [];
        try {
          remote = (await clientRef.current!.search(q)).entities;
        } catch {
          remote = [];
        }
        const next = mergeEntities(remote, local);
        setItems(next);
        setOpen(next.length > 0);
      })();
    }, 280);
    return () => window.clearTimeout(handle);
  }, [query, city]);

  return (
    <div className="relative flex flex-col gap-2">
      <span className="text-xs font-semibold tracking-[0.12em] text-label uppercase">Add a reference</span>
      <Input
        data-testid="reference-search"
        value={query}
        placeholder="Search a band, brand, or film"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        onChange={(event) => setQuery(event.target.value)}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-[4.75rem] z-30 max-h-72 w-full overflow-auto rounded-[18px] bg-white p-1.5 shadow-[0_18px_50px_rgba(30,34,70,0.18)]"
        >
          {items.map((entity) => (
            <li key={entity.id}>
              <button
                type="button"
                role="option"
                data-testid="search-hit"
                className="w-full"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onPick(entity);
                  setQuery('');
                  setOpen(false);
                }}
              >
                <EntityOption entity={entity} active={false} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

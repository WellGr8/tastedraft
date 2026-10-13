'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Entity, Tag } from '@tastedraft/contracts';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EntityCard, EntityOption, Thumb, entityGridClass } from '@/components/entity-card';
import { TasteDraftClient } from '@/lib/api';
import {
  AGES,
  CITIES,
  POSITIONS,
  mergeEntities,
  mergeTags,
  suggestEntities,
  suggestTags,
  uniqueById,
  type DraftState,
} from '@/lib/defaults';
import { typeLabel } from '@/lib/labels';
import { applySpelling, spellSuggestions, type Spelling } from '@/lib/spell';
import { cn } from '@/lib/utils';

type Kind = 'reference' | 'location' | 'interests';

export function InputScreen({
  draft,
  onChange,
  onSubmit,
  error,
  busy,
}: {
  draft: DraftState;
  onChange: (next: DraftState) => void;
  onSubmit: () => void;
  error: string;
  busy: boolean;
}) {
  const ideaSpells = spellSuggestions(draft.idea);
  return (
    <div data-testid="input-screen" className="mx-auto flex w-full max-w-[760px] flex-col gap-10 xl:max-w-[1080px]">
      <header className="td-rise flex flex-col items-center gap-5 text-center">
        <h1 className="text-[2.5rem] leading-[1.15] font-bold tracking-[-0.035em] text-ink sm:text-5xl lg:text-[4rem]">
          <span className="block">Before you make</span>
          <span className="td-grad">anything</span>
        </h1>
        <p className="max-w-xl text-base leading-7 text-[#2A3150] sm:text-xl sm:leading-8">
          Test whether a concept <strong className="font-semibold text-ink">resonates</strong> with an audience in a city.
          The engine scores. A person approves the change.
        </p>
      </header>

      <form
        className="td-glass td-rise flex flex-col gap-8 rounded-[36px] px-4 py-8 sm:px-11 sm:py-11"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Field label="Idea" htmlFor="idea">
          <Textarea
            id="idea"
            spellCheck
            value={draft.idea}
            onChange={(event) => onChange({ ...draft, idea: event.target.value })}
          />
          <SpellRow
            suggestions={ideaSpells}
            onPick={(item) => onChange({ ...draft, idea: applySpelling(draft.idea, item) })}
          />
        </Field>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-xs font-semibold tracking-[0.12em] text-label uppercase">Audience · age</legend>
          <Segment
            name="age"
            value={draft.age}
            options={AGES}
            onChange={(age) => onChange({ ...draft, age })}
          />
        </fieldset>

        <div className="grid grid-cols-1 gap-7 sm:grid-cols-2">
          <Field label="Location · city" htmlFor="city">
            <select
              id="city"
              value={draft.city}
              onChange={(event) => onChange({ ...draft, city: event.target.value })}
              className="h-[52px] w-full appearance-none rounded-full border border-transparent bg-[rgba(30,34,70,0.045)] px-5 text-base text-ink outline-none focus-visible:bg-white focus-visible:shadow-[0_0_0_4px_rgba(91,110,255,0.14)]"
            >
              {CITIES.map((city) => (
                <option key={city}>{city}</option>
              ))}
              {CITIES.includes(draft.city as (typeof CITIES)[number]) ? null : <option>{draft.city}</option>}
            </select>
          </Field>
          <Field label="Positioning">
            <Segment
              name="positioning"
              value={draft.positioning}
              options={POSITIONS}
              onChange={(positioning) => onChange({ ...draft, positioning })}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold tracking-[0.12em] text-label uppercase">Interests</span>
          <p className="text-[13px] leading-6 text-slate">Optional tags. Search adds a chip. Spelling suggestions sit under the field.</p>
          {draft.interests.length ? (
            <ul className="flex flex-wrap gap-2">
              {draft.interests.map((tag) => (
                <li key={tag.id} className="inline-flex h-9 max-w-full items-center gap-2 rounded-full bg-white/95 pr-1 pl-3 text-sm leading-none font-medium text-ink shadow-[0_2px_8px_rgba(30,34,70,0.08)]">
                  <span className="truncate">{tag.name}</span>
                  {tag.type && typeLabel(tag.type) !== 'Tag' ? (
                    <small className="text-[11px] font-semibold tracking-wide text-slate uppercase">{typeLabel(tag.type)}</small>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Remove ${tag.name}`}
                    className="grid size-6 shrink-0 place-items-center rounded-full bg-[rgba(30,34,70,0.07)] text-sm leading-none text-label hover:bg-[rgba(160,43,40,0.14)] hover:text-bad"
                    onClick={() => onChange({ ...draft, interests: draft.interests.filter((item) => item.id !== tag.id) })}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <TagSearch
            city={draft.city}
            onPick={(tag) => {
              if (draft.interests.some((item) => item.name.toLowerCase() === tag.name.toLowerCase())) return;
              onChange({ ...draft, interests: [...draft.interests, tag] });
            }}
          />
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold tracking-[0.12em] text-label uppercase">Cultural references</span>
          <p className="text-[13px] leading-6 text-slate">Three to eight cards. One column on a phone, up to three across on a desktop.</p>
          <ul className={entityGridClass}>
            {uniqueById(draft.references).map((entity) => (
              <EntityCard
                key={entity.id}
                entity={entity}
                onRemove={() =>
                  onChange({
                    ...draft,
                    references: draft.references.filter((item) => item.id !== entity.id),
                  })
                }
              />
            ))}
          </ul>
          <EntitySearch
            kind="reference"
            city={draft.city}
            placeholder="Search a brand, artist, film, or place"
            onPick={(entity) => {
              const selected = uniqueById(draft.references);
              if (selected.length >= 8) return;
              if (selected.some((item) => item.id === entity.id || item.name.toLowerCase() === entity.name.toLowerCase())) return;
              const references = [...selected, entity];
              const places = uniqueById(draft.locations);
              const locations =
                typeLabel(entity.type) === 'Place' &&
                !places.some((item) => item.id === entity.id || item.name.toLowerCase() === entity.name.toLowerCase())
                  ? [...places, { ...entity, city: entity.city || draft.city }]
                  : places;
              onChange({ ...draft, references, locations });
            }}
          />
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold tracking-[0.12em] text-label uppercase">Neighbourhoods</span>
          <p className="text-[13px] leading-6 text-slate">Places are biased toward {draft.city}. The city is named once, on the card.</p>
          {draft.locations.length ? (
            <ul className={entityGridClass}>
              {uniqueById(draft.locations).map((entity) => (
                <EntityCard
                  key={entity.id}
                  entity={entity}
                  onRemove={() => onChange({ ...draft, locations: draft.locations.filter((item) => item.id !== entity.id) })}
                />
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-slate">No neighbourhood yet. Search one below.</p>
          )}
          <EntitySearch
            kind="location"
            city={draft.city}
            placeholder={`Search a place in ${draft.city}`}
            onPick={(entity) => {
              const row = { ...entity, type: entity.type || 'urn:entity:place', city: entity.city || draft.city };
              if (draft.locations.some((item) => item.name.toLowerCase() === row.name.toLowerCase())) return;
              onChange({ ...draft, locations: [...draft.locations, row] });
            }}
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-2xl bg-bad-bg px-4 py-3 text-sm leading-6 text-bad">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col items-center gap-3">
          <div className={cn('td-ring', busy && 'pointer-events-none')}>
            <Button type="submit" size="lg" className="w-full" disabled={busy || !draft.idea.trim()}>
              {busy ? 'Testing' : 'Test this brief'}
              <ArrowRight />
            </Button>
          </div>
          <p className="text-center text-[13px] text-slate">Sample data scores the default brief at 71 until a person approves a change.</p>
        </div>
      </form>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  const className = 'text-xs font-semibold tracking-[0.12em] text-label uppercase';
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={className}>
          {label}
        </label>
      ) : (
        <span className={className}>{label}</span>
      )}
      {children}
    </div>
  );
}

function Segment<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-3xl bg-[rgba(30,34,70,0.06)] p-1 shadow-[inset_0_1px_3px_rgba(30,34,70,0.1)] sm:grid-cols-4">
      {options.map((option) => (
        <label key={option} className="relative block min-w-0">
          <input
            className="peer absolute inset-0 cursor-pointer opacity-0"
            type="radio"
            name={name}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          <span className="flex min-h-11 items-center justify-center rounded-full px-2 text-center text-sm font-medium text-[#343C5E] peer-checked:bg-white peer-checked:text-ink peer-checked:shadow-[0_1px_2px_rgba(30,34,70,0.14),0_6px_14px_rgba(30,34,70,0.1)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ink">
            {option}
          </span>
        </label>
      ))}
    </div>
  );
}

function SpellRow({ suggestions, onPick }: { suggestions: Spelling[]; onPick: (item: Spelling) => void }) {
  if (!suggestions.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="spellcheck">
      <p className="text-[13px] text-slate">Spelling</p>
      {suggestions.map((item) => (
        <button
          key={`${item.index}-${item.to}`}
          type="button"
          className="inline-flex h-9 items-center rounded-full bg-white px-3.5 text-sm leading-none font-medium text-ink shadow-[0_2px_8px_rgba(30,34,70,0.08)]"
          onClick={() => onPick(item)}
        >
          {item.from} → {item.to}
        </button>
      ))}
    </div>
  );
}

function EntitySearch({
  kind,
  city,
  placeholder,
  onPick,
}: {
  kind: 'reference' | 'location';
  city: string;
  placeholder: string;
  onPick: (entity: Entity) => void;
}) {
  const clientRef = useRef<TasteDraftClient | null>(null);
  if (!clientRef.current) clientRef.current = new TasteDraftClient();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Entity[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setItems([]);
      setOpen(false);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        const local = suggestEntities(q, kind, city);
        let remote: Entity[] = [];
        try {
          const result = await clientRef.current!.search(q, kind === 'location' ? 'urn:entity:place' : undefined, kind === 'location' ? city : undefined);
          remote = result.entities;
        } catch {
          remote = [];
        }
        const next = mergeEntities(remote, local);
        setItems(next);
        setActive(0);
        setOpen(next.length > 0);
      })();
    }, 280);
    return () => clearTimeout(handle);
  }, [query, kind, city]);

  function commit(entity: Entity | undefined) {
    if (!entity) return;
    onPick(entity);
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        value={query}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(items.length - 1, index + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === 'Escape') {
            setOpen(false);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            commit(items[active] ?? freeEntity(query, kind, city));
          }
        }}
      />
      {open ? (
        <ul id={listId} role="listbox" className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-[18px] bg-white p-1.5 shadow-[0_18px_50px_rgba(30,34,70,0.18),0_0_0_1px_rgba(30,34,70,0.06)]">
          {items.map((entity, index) => (
            <li key={entity.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className="w-full"
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(entity)}
              >
                <EntityOption entity={entity} active={index === active} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TagSearch({ city, onPick }: { city: string; onPick: (tag: Tag) => void }) {
  const clientRef = useRef<TasteDraftClient | null>(null);
  if (!clientRef.current) clientRef.current = new TasteDraftClient();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Tag[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const spells = spellSuggestions(query);
  const listId = useId();

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setItems([]);
      setOpen(false);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        let remote: Tag[] = [];
        try {
          const result = await clientRef.current!.tags(q);
          remote = result.tags;
          const corrected = spells[0];
          if (corrected && corrected.to.toLowerCase() !== q.toLowerCase()) {
            const extra = await clientRef.current!.tags(corrected.to);
            remote = mergeTags(remote, extra.tags);
          }
        } catch {
          remote = [];
        }
        const next = mergeTags(remote, suggestTags(q));
        setItems(next);
        setActive(0);
        setOpen(next.length > 0);
      })();
    }, 280);
    return () => clearTimeout(handle);
  }, [query]);

  function commit(tag: Tag | undefined) {
    if (!tag) return;
    onPick(tag);
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="relative flex flex-col gap-2">
      <Input
        value={query}
        placeholder={`Interests in ${city}`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(items.length - 1, index + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            commit(items[active] ?? (query.trim() ? { id: `tag-${query.trim().toLowerCase()}`, name: query.trim(), type: 'urn:tag' } : undefined));
          }
        }}
      />
      <SpellRow suggestions={spells} onPick={(item) => setQuery(applySpelling(query, item))} />
      {open ? (
        <ul id={listId} role="listbox" className="absolute top-14 z-30 max-h-72 w-full overflow-auto rounded-[18px] bg-white p-1.5 shadow-[0_18px_50px_rgba(30,34,70,0.18)]">
          {items.map((tag, index) => (
            <li key={tag.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className={cn('flex h-14 w-full items-center gap-3 rounded-xl px-2 text-left', index === active && 'bg-[rgba(79,107,255,0.12)]')}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(tag)}
              >
                <Thumb name={tag.name} fit="cover" />
                <span className="min-w-0">
                  <span className="block truncate text-sm leading-5 font-semibold">{tag.name}</span>
                  <span className="block truncate text-xs leading-4 text-slate">{tag.type ? typeLabel(tag.type) : 'Tag'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function freeEntity(query: string, kind: 'reference' | 'location', city: string): Entity | undefined {
  const name = query.trim();
  if (!name) return undefined;
  return {
    id: `free-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    type: kind === 'location' ? 'urn:entity:place' : 'urn:entity',
    source: 'sample',
    ...(kind === 'location' ? { city } : {}),
  };
}

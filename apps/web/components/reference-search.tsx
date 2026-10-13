'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Entity } from '@tastedraft/contracts';
import { EntityOption } from '@/components/entity-card';
import { TasteDraftClient } from '@/lib/api';
import { mergeEntities, suggestEntities, withImage } from '@/lib/defaults';

export function ReferenceSearch({
  city,
  onPick,
  placeholder = 'A brand, artist, film, or place this idea feels like',
}: {
  city: string;
  onPick: (entity: Entity) => void;
  placeholder?: string;
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
        const local = suggestEntities(q, 'reference', city);
        let remote: Entity[] = [];
        try {
          remote = (await clientRef.current!.search(q)).entities;
        } catch {
          remote = [];
        }
        const next = mergeEntities(remote, local).map((entity) => withImage(entity));
        setItems(next);
        setActive(0);
        setOpen(next.length > 0);
      })();
    }, 280);
    return () => clearTimeout(handle);
  }, [query, city]);

  function commit(entity: Entity | undefined) {
    if (!entity) return;
    onPick(withImage(entity));
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="td-search byb-addrow">
      <input
        className="byb-field byb-line"
        data-testid="reference-search"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Add reference"
        autoComplete="off"
        placeholder={placeholder}
        value={query}
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
            commit(items[active]);
          }
        }}
      />
      <button type="button" className="byb-addbtn" onClick={() => commit(items[active])}>
        Add
      </button>
      {open ? (
        <ul id={listId} role="listbox" className="td-hits">
          {items.map((entity, index) => (
            <li key={entity.id}>
              <button
                type="button"
                role="option"
                data-testid="search-hit"
                aria-selected={index === active}
                className={index === active ? 'is-on' : undefined}
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

const LEADING_MARK = /^([^\p{L}\p{N}]+)(\s+)(.*)$/u;

/**
 * Search strings for a reference name.
 * A leading symbol plus a space becomes one token ("% Arabica" → "%Arabica"),
 * and the symbol-free name is kept as a later try.
 */
export function entityQueries(name: string): string[] {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) return [];
  const match = LEADING_MARK.exec(trimmed);
  const glued = match ? `${match[1]}${match[3]}`.replace(/\s+/g, ' ').trim() : trimmed;
  const stripped = trimmed.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const queries: string[] = [];
  for (const query of [glued, trimmed, stripped]) {
    if (query && !queries.includes(query)) queries.push(query);
  }
  return queries;
}

/** True when cleanup produced a different string than the typed name. */
export function hasLeadingMark(name: string): boolean {
  const queries = entityQueries(name);
  return queries.length > 1;
}

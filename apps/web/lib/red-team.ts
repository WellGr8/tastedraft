import { stripEntityIds } from '@tastedraft/contracts';
import type { Persona, PersonaAnchor } from './personas.ts';

function namesOf(anchors: readonly PersonaAnchor[]): string {
  const names = anchors.map((anchor) => stripEntityIds(anchor.name)).filter(Boolean).slice(0, 3);
  if (names.length <= 1) return names[0] ?? 'that taste';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A first-person objection that cites this persona's measured anchors. */
export function redTeamLine(anchors: readonly PersonaAnchor[], frictions: readonly string[]): string {
  const names = namesOf(anchors);
  const friction = frictions.map((line) => stripEntityIds(line)).find((line) => line.length > 0);
  if (friction) {
    return `I'd argue against it. ${names} are the taste in the room, and ${friction} is where this misses them.`;
  }
  return `I'd argue against it. ${names} already have a lane, and this idea does not sit in it.`;
}

/**
 * One skeptic built from the weakest grounded persona.
 * Returns null while Qloo anchors are still missing, so the card never invents a taste.
 */
export function redTeamOf(personas: readonly Persona[], frictions: readonly string[]): Persona | null {
  const grounded = personas.filter((persona) => !persona.measuring && persona.anchors.length > 0 && persona.fit > 0);
  if (!grounded.length) return null;
  const weakest = [...grounded].sort((a, b) => a.fit - b.fit || a.label.localeCompare(b.label))[0]!;
  const anchors = weakest.anchors.slice(0, 3);
  return {
    ...weakest,
    id: `red-team-${weakest.id}`,
    label: `Red team · ${weakest.label}`,
    role: 'Red team',
    initials: 'R',
    anchors,
    taste: weakest.taste.slice(0, 3),
    rejects: true,
    rejectWhy: redTeamLine(anchors, frictions),
    interview: redTeamLine(anchors, frictions),
  };
}

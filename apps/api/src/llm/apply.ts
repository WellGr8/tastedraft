import { isFacetToken } from './brief.ts';
import { ChangeApplyError } from './errors.ts';
import { BriefSchema, type Brief, type Change, type ChangeField, type CritiqueResult } from './schemas.ts';

export type ApplyResult = { ok: true; brief: Brief } | { ok: false; reason: string };

const SCALAR_FIELDS = new Set<ChangeField>([
  'productType',
  'audience.age',
  'audience.description',
  'city',
  'positioning',
]);

export function applyChangeSet(brief: Brief, changes: Change[]): Brief {
  const result = tryApplyChangeSet(brief, changes);
  if (!result.ok) throw new ChangeApplyError(result.reason);
  return result.brief;
}

export function applyCritique(brief: Brief, result: CritiqueResult): Brief {
  if (result.status === 'needs more evidence') return brief;
  return applyChangeSet(brief, result.proposals);
}

export function tryApplyChangeSet(brief: Brief, changes: Change[]): ApplyResult {
  if (changes.length === 0) return { ok: false, reason: 'change set is empty' };
  let current = cloneBrief(brief);
  const usedScalars = new Set<ChangeField>();
  const usedListKeys = new Set<string>();

  for (const change of changes) {
    const before = change.before.trim();
    const after = change.after.trim();
    if (!before || !after) return { ok: false, reason: `${change.field} is missing before or after` };
    if (before === after) return { ok: false, reason: `${change.field} before and after are the same` };
    if (SCALAR_FIELDS.has(change.field)) {
      if (usedScalars.has(change.field)) return { ok: false, reason: `${change.field} is changed more than once` };
      usedScalars.add(change.field);
    }
    const listKey = `${change.field}::${before}`;
    if (!SCALAR_FIELDS.has(change.field)) {
      if (usedListKeys.has(listKey)) return { ok: false, reason: `${change.field} value ${before} is changed more than once` };
      usedListKeys.add(listKey);
    }
    const applied = applyOne(current, change.field, before, after);
    if (!applied.ok) return applied;
    current = applied.brief;
  }

  const checked = BriefSchema.safeParse(current);
  if (!checked.success) return { ok: false, reason: 'the next brief does not match the brief schema' };
  return { ok: true, brief: checked.data };
}

function applyOne(brief: Brief, field: ChangeField, before: string, after: string): ApplyResult {
  if (field === 'productType') return replaceScalar(brief, 'productType', before, after);
  if (field === 'city') return replaceScalar(brief, 'city', before, after);
  if (field === 'positioning') return replaceScalar(brief, 'positioning', before, after);
  if (field === 'audience.age') return replaceAudience(brief, 'age', before, after);
  if (field === 'audience.description') return replaceAudience(brief, 'description', before, after);
  if (field === 'facets') return replaceFacet(brief, before, after);
  if (field === 'references') return replaceReference(brief, before, after);
  return replaceConstraint(brief, before, after);
}

function replaceScalar(brief: Brief, field: 'productType' | 'city' | 'positioning', before: string, after: string): ApplyResult {
  if (brief[field] !== before) return { ok: false, reason: `${field} before does not match the brief` };
  return { ok: true, brief: { ...brief, [field]: after } };
}

function replaceAudience(brief: Brief, field: 'age' | 'description', before: string, after: string): ApplyResult {
  if (brief.audience[field] !== before) return { ok: false, reason: `audience.${field} before does not match the brief` };
  return { ok: true, brief: { ...brief, audience: { ...brief.audience, [field]: after } } };
}

function replaceFacet(brief: Brief, before: string, after: string): ApplyResult {
  if (!isFacetToken(after)) return { ok: false, reason: 'facet after must be a lowercase token' };
  const index = brief.facets.indexOf(before);
  if (index < 0) return { ok: false, reason: 'facet before is not on the brief' };
  if (brief.facets.includes(after)) return { ok: false, reason: 'facet after is already on the brief' };
  const facets = brief.facets.slice();
  facets[index] = after;
  return { ok: true, brief: { ...brief, facets } };
}

function replaceReference(brief: Brief, before: string, after: string): ApplyResult {
  const index = brief.references.findIndex((reference) => reference.name === before);
  if (index < 0) return { ok: false, reason: 'reference before is not on the brief' };
  if (brief.references.some((reference, i) => i !== index && reference.name.toLowerCase() === after.toLowerCase())) {
    return { ok: false, reason: 'reference after is already on the brief' };
  }
  const references = brief.references.map((reference, i) => (i === index ? { ...reference, name: after } : reference));
  return { ok: true, brief: { ...brief, references } };
}

function replaceConstraint(brief: Brief, before: string, after: string): ApplyResult {
  const matches = brief.constraints.filter((constraint) => constraint.text === before);
  if (matches.length === 0) return { ok: false, reason: 'constraint before is not on the brief' };
  if (matches.length > 1) return { ok: false, reason: 'constraint before matches more than one constraint' };
  const constraints = brief.constraints.map((constraint) =>
    constraint.text === before ? { ...constraint, text: after } : constraint,
  );
  return { ok: true, brief: { ...brief, constraints } };
}

function cloneBrief(brief: Brief): Brief {
  return {
    ...brief,
    facets: brief.facets.slice(),
    audience: { ...brief.audience },
    references: brief.references.map((reference) => ({ ...reference })),
    constraints: brief.constraints.map((constraint) => ({ ...constraint })),
  };
}

import type { BriefV2 } from '@tastedraft/contracts';
import type { LiveBrief } from '@/lib/engine-preview';

/**
 * Audience segments the screen can render.
 * `loadPersonas` posts `{ brief, location, audiences }` to POST /api/persona.
 * Each card keeps its own Qloo anchors. Empty insights stay a measuring
 * skeleton — brief references are never copied onto every persona.
 * Affinities stay null unless Qloo measured them.
 */

export interface PersonaAnchor {
  id: string;
  name: string;
  type: string;
  affinity: number | null;
  provenance: string;
  image?: string | null;
}

export interface TasteLink {
  name: string;
  type: string;
  affinity: number | null;
}

export interface EvidenceChip {
  label: string;
  detail: string;
}

export interface Persona {
  id: string;
  label: string;
  city: string;
  age: string;
  gender: string | null;
  role: string;
  initials: string;
  anchors: PersonaAnchor[];
  taste: TasteLink[];
  fit: number;
  measuring: boolean;
  evidenceStrength: string;
  rejects: boolean;
  rejectWhy: string | null;
  interview: string;
  evidence: EvidenceChip[];
  provenance: string[];
  source: string;
}

export interface PersonaBuild {
  personas: Persona[];
  thin: boolean;
  source: 'endpoint' | 'engine';
  note: string | null;
}

export interface PersonaReply {
  say: string;
  evidence: EvidenceChip[];
}

export interface PersonaQuery {
  brief: BriefV2;
  posture?: string;
  scarcity?: string;
}

export interface MindChange {
  id: string;
  label: string;
  from: 'reject' | 'accept';
  to: 'reject' | 'accept';
  fitBefore: number;
  fitAfter: number;
}

export type PersonaScorer = (brief: LiveBrief) => Promise<number> | number;

const AGES = ['18–25', '26–35', '36–45', '46+'] as const;
const REJECT_BELOW = 70;
const INSIGHT_KEYS = ['artists', 'brands', 'places', 'dining', 'film'] as const;
const MEASURING = 'Still measuring what this person actually likes.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function affinityOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const unit = value > 1 && value <= 100 ? value / 100 : value;
  if (unit < 0 || unit > 1) return null;
  return unit;
}

function roleFor(idea: string, types: readonly string[]): string {
  if (/sneaker|streetwear|fashion|apparel|clothing/i.test(idea)) return 'sneakerhead';
  if (types.some((type) => /artist/.test(type)) || /\bmusic\b|\bvenue\b|\bdj\b|\bband\b/i.test(idea)) return 'listener';
  if (types.some((type) => /movie|film/.test(type)) || /\bfilm\b|\bmovie\b|cinema/i.test(idea)) return 'film fan';
  if (/food|snack|dining|restaurant|grill|noodle/i.test(idea) || types.some((type) => /dining|restaurant/.test(type))) return 'regular';
  if (types.some((type) => /place|destination/.test(type))) return 'local';
  return 'customer';
}

function ageLabel(value: string): string {
  const known: Record<string, string> = {
    '24_and_younger': '18–25',
    '25_to_29': '26–35',
    '30_to_34': '26–35',
    '35_and_younger': '18–25',
    '35_to_44': '36–45',
    '36_to_55': '36–45',
    '45_to_54': '46+',
    '55_and_older': '46+',
  };
  return known[value] ?? value;
}

export function audienceSlices(brief: BriefV2): Array<{ id: string; label: string; age: string; gender?: 'female' | 'male' }> {
  const ages: string[] = [...AGES];
  const age = ages.includes(brief.age) ? brief.age : ages[0]!;
  const index = ages.indexOf(age);
  const stated = brief.gender === 'female' || brief.gender === 'male' ? brief.gender : null;
  const other: 'female' | 'male' = stated === 'male' ? 'female' : 'male';
  const older = ages[Math.min(ages.length - 1, index + 1)]!;
  const younger = ages[Math.max(0, index - 1)]!;
  const third = older !== age ? older : younger;
  const fourth = younger !== age && younger !== third ? younger : ages[(index + 2) % ages.length]!;
  const raw: Array<{ age: string; gender: 'female' | 'male' | null }> = [
    { age, gender: stated },
    { age, gender: stated === 'female' ? 'male' : stated === 'male' ? 'female' : 'female' },
    { age: third, gender: stated ?? other },
    { age: fourth, gender: other },
  ];
  const seen = new Set<string>();
  const out: Array<{ id: string; label: string; age: string; gender?: 'female' | 'male' }> = [];
  for (const row of raw) {
    const key = `${row.age}|${row.gender ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const role = roleFor(brief.idea, []);
    const label = [brief.city, row.age, row.gender, role].filter(Boolean).join(' ');
    out.push({
      id: slug(`persona-${brief.city}-${row.age}-${row.gender ?? 'any'}-${role}`),
      label,
      age: row.age,
      ...(row.gender ? { gender: row.gender } : {}),
    });
  }
  return out.slice(0, 4);
}

function initialsOf(label: string): string {
  const words = label.split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word[0] ?? ''));
  const first = words[0]?.[0] ?? 'P';
  const last = words.length > 1 ? words[words.length - 1]?.[0] ?? '' : '';
  return `${first}${last}`.toUpperCase();
}

function quoteOf(anchors: readonly PersonaAnchor[], rejects: boolean): string {
  if (!anchors.length) return MEASURING;
  const [first, second] = anchors;
  if (!first) return MEASURING;
  if (!second) {
    return rejects
      ? `Not for me. I already live in ${first.name}, and this doesn't belong there.`
      : `I'd try it. It sits next to ${first.name}, which is already how I spend my time.`;
  }
  return rejects
    ? `Not for me. ${first.name} and ${second.name} are my taste. This concept doesn't share it.`
    : `I'd try it. It sits next to ${first.name} and ${second.name}, which is already how I spend my time.`;
}

function evidenceOf(persona: Pick<Persona, 'fit' | 'city' | 'age' | 'measuring' | 'anchors'>): EvidenceChip[] {
  if (persona.measuring || !persona.anchors.length) return [{ label: 'Taste', detail: 'still measuring' }];
  return [
    { label: 'Fit', detail: String(persona.fit) },
    { label: persona.city, detail: persona.age },
    ...persona.anchors.slice(0, 3).map((anchor) => ({
      label: anchor.name,
      detail: anchor.affinity == null ? 'from Qloo' : `affinity ${anchor.affinity}`,
    })),
  ].slice(0, 5);
}

function readAnchor(value: unknown, source: string): PersonaAnchor | null {
  if (!isRecord(value)) return null;
  const name = text(value.name) ?? text(value.title);
  if (!name) return null;
  const type = text(value.type) ?? text(value.subtype) ?? text(value.category) ?? 'urn:entity';
  const affinity = affinityOf(value.affinity ?? value.score);
  const id = text(value.id) ?? text(value.entity_id) ?? slug(name);
  const image = text(value.image);
  const provenance =
    affinity == null ? `${source}; affinity unmeasured` : `${source}; affinity ${affinity}`;
  if (!image || image.includes('example.invalid')) return { id, name, type, affinity, provenance };
  return { id, name, type, affinity, provenance, image };
}

function takeDistinct(items: unknown[], used: Set<string>, source: string, limit: number): PersonaAnchor[] {
  const picked: PersonaAnchor[] = [];
  for (const item of items) {
    const anchor = readAnchor(item, source);
    if (!anchor) continue;
    const key = anchor.name.toLowerCase();
    const idKey = `\0${anchor.id}`;
    if (used.has(key) || used.has(idKey)) continue;
    used.add(key);
    used.add(idKey);
    picked.push(anchor);
    if (picked.length === limit) break;
  }
  return picked;
}

/** Up to three anchors, one per category, skipping names already given to an earlier persona. */
function anchorsFromSegment(segment: Record<string, unknown>, source: string, used: Set<string>): PersonaAnchor[] {
  const insights = isRecord(segment.insights) ? segment.insights : null;
  if (insights && INSIGHT_KEYS.some((key) => Array.isArray(insights[key]))) {
    const picked: PersonaAnchor[] = [];
    for (const key of INSIGHT_KEYS) {
      const bucket = insights[key];
      if (!Array.isArray(bucket)) continue;
      const [next] = takeDistinct(bucket, used, source, 1);
      if (next) picked.push(next);
      if (picked.length === 3) break;
    }
    return picked;
  }
  const flat = segment.anchors ?? segment.tastes ?? segment.entities;
  if (Array.isArray(flat)) return takeDistinct(flat, used, source, 3);
  return [];
}

function segmentList(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (!isRecord(body)) return null;
  const list = body.personas ?? body.segments ?? body.audience ?? body.audiences;
  return Array.isArray(list) ? list : null;
}

function finishPersona(persona: Persona): Persona {
  persona.interview = quoteOf(persona.anchors, persona.rejects);
  persona.evidence = evidenceOf(persona);
  if (!persona.provenance.length) {
    persona.provenance = persona.measuring
      ? ['Qloo has not returned taste anchors for this person yet.']
      : persona.anchors.map((anchor) => `${anchor.name}: ${anchor.provenance}`);
  }
  return persona;
}

/** Map a /api/persona payload into the screen model. Returns null when it is not that payload. */
export function normalizePersonaPayload(body: unknown, brief: BriefV2): PersonaBuild | null {
  const list = segmentList(body);
  if (!list) return null;
  const mode = isRecord(body) ? text(body.mode) : null;
  const sourceName = isRecord(body) && text(body.source) ? text(body.source)! : mode === 'live' ? 'qloo:/v2/insights' : 'qloo:/v2/insights';
  const used = new Set<string>();
  const personas: Persona[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const demographics = isRecord(item.demographics) ? item.demographics : {};
    const age = ageLabel(text(item.age) ?? text(demographics.age) ?? brief.age);
    const genderRaw = text(item.gender) ?? text(demographics.gender);
    const gender = genderRaw === 'female' || genderRaw === 'male' ? genderRaw : null;
    const location = item.location;
    const city =
      text(item.city) ??
      text(location) ??
      (isRecord(location) ? text(location.query) : null) ??
      brief.city;
    const anchors = anchorsFromSegment(item, sourceName, used);
    const measuring = anchors.length === 0;
    const role = text(item.role) ?? roleFor(brief.idea, anchors.map((anchor) => anchor.type));
    const label = text(item.label) ?? text(item.name) ?? [city, age, gender, role].filter(Boolean).join(' ');
    const fitRaw = item.fit ?? item.fitScore ?? item.score;
    const fit = typeof fitRaw === 'number' && Number.isFinite(fitRaw) ? Math.round(fitRaw) : 0;
    const rejects = measuring ? false : typeof item.rejects === 'boolean' ? item.rejects : fit > 0 ? fit < REJECT_BELOW : false;
    const persona = finishPersona({
      id: text(item.id) ?? slug(`persona-${city}-${age}-${gender ?? 'any'}-${role}`),
      label,
      city,
      age,
      gender,
      role,
      initials: text(item.initials) ?? initialsOf(label),
      anchors,
      taste: [],
      fit: measuring ? 0 : fit,
      measuring,
      evidenceStrength: measuring ? 'LIMITED' : text(item.evidenceStrength) ?? 'MEDIUM',
      rejects,
      rejectWhy: null,
      interview: '',
      evidence: [],
      provenance: Array.isArray(item.provenance) ? item.provenance.filter((row): row is string => typeof row === 'string') : [],
      source: sourceName,
    });
    personas.push(persona);
    if (personas.length === 4) break;
  }
  if (personas.length < 3) return null;
  const note = isRecord(body) ? text(body.note) : null;
  const thin = personas.some((persona) => persona.measuring) || personas.length < 3;
  return {
    personas,
    thin,
    source: 'endpoint',
    note: note ?? (thin ? 'Still measuring what these people actually like.' : null),
  };
}

function measuringPersona(brief: BriefV2, plan: { id: string; label: string; age: string; gender?: 'female' | 'male' }): Persona {
  return finishPersona({
    id: plan.id,
    label: plan.label,
    city: brief.city,
    age: plan.age,
    gender: plan.gender ?? null,
    role: roleFor(brief.idea, []),
    initials: initialsOf(plan.label),
    anchors: [],
    taste: [],
    fit: 0,
    measuring: true,
    evidenceStrength: 'LIMITED',
    rejects: false,
    rejectWhy: null,
    interview: '',
    evidence: [],
    provenance: ['Qloo has not returned taste anchors for this person yet.'],
    source: 'engine',
  });
}

export async function enginePersonas(query: PersonaQuery, score: PersonaScorer): Promise<PersonaBuild> {
  void score;
  const personas = audienceSlices(query.brief).map((plan) => measuringPersona(query.brief, plan));
  return {
    personas,
    thin: true,
    source: 'engine',
    note: 'Still measuring what these people actually like.',
  };
}

export async function fillMissingFits(build: PersonaBuild, query: PersonaQuery, score: PersonaScorer): Promise<PersonaBuild> {
  const personas: Persona[] = [];
  for (const persona of build.personas) {
    if (persona.measuring || persona.anchors.length === 0) {
      personas.push(persona);
      continue;
    }
    if (persona.fit > 0) {
      personas.push(finishPersona({ ...persona, measuring: false }));
      continue;
    }
    const fit = await score({
      idea: query.brief.idea,
      age: persona.age,
      city: persona.city,
      pos: query.brief.positioning,
      refs: persona.anchors.map((anchor) => anchor.name),
      posture: query.posture ?? null,
      scarcity: query.scarcity ?? null,
    });
    const rejects = fit < REJECT_BELOW;
    personas.push(
      finishPersona({
        ...persona,
        fit,
        measuring: false,
        rejects,
        rejectWhy: null,
        provenance: [`Fit from the deterministic engine for ${persona.age} in ${persona.city}.`, ...persona.provenance],
      }),
    );
  }
  return { ...build, personas };
}

export function personaReply(persona: Persona, message: string): PersonaReply {
  const chips = persona.evidence.slice(0, 5);
  const question = message.trim();
  if (persona.measuring || !persona.anchors.length) return { say: MEASURING, evidence: chips };
  if (!question) return { say: persona.interview, evidence: chips };
  const named = persona.anchors.find((anchor) => question.toLowerCase().includes(anchor.name.toLowerCase()));
  if (named) {
    const affinity = named.affinity == null ? 'Qloo listed it, without a measured affinity.' : `Qloo affinity is ${named.affinity}.`;
    return {
      say: `${named.name} is already part of how I spend my time. ${affinity}`,
      evidence: [{ label: named.name, detail: named.affinity == null ? 'from Qloo' : `affinity ${named.affinity}` }, ...chips].slice(0, 5),
    };
  }
  return { say: persona.interview, evidence: chips };
}

export function mindChanges(before: readonly Persona[], after: readonly Persona[]): MindChange[] {
  const changes: MindChange[] = [];
  for (const previous of before) {
    const next = after.find((persona) => persona.id === previous.id);
    if (!next || previous.rejects === next.rejects) continue;
    changes.push({
      id: previous.id,
      label: previous.label,
      from: previous.rejects ? 'reject' : 'accept',
      to: next.rejects ? 'reject' : 'accept',
      fitBefore: previous.fit,
      fitAfter: next.fit,
    });
  }
  return changes;
}

async function readJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw.trim()) return null;
  return JSON.parse(raw) as unknown;
}

/**
 * POST /api/persona with the brief, a location, and 3–4 audience buckets.
 * A failed route, or a body this screen cannot read, shows measuring skeletons.
 */
export async function loadPersonas(query: PersonaQuery, score: PersonaScorer, fetchImpl: typeof fetch = fetch, base = ''): Promise<PersonaBuild> {
  const root = base.replace(/\/$/, '');
  const audiences = audienceSlices(query.brief);
  if (audiences.length >= 3) {
    try {
      const response = await fetchImpl(`${root}/api/persona`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: query.brief, location: query.brief.city, audiences }),
      });
      if (response.ok) {
        const normalized = normalizePersonaPayload(await readJson(response), query.brief);
        if (normalized && normalized.personas.length >= 3) return fillMissingFits(normalized, query, score);
      }
    } catch {
      // Measuring skeletons below. The screen does not invent anchors.
    }
  }
  return enginePersonas(query, score);
}

export async function chatWithPersona(
  persona: Persona,
  message: string,
  fetchImpl: typeof fetch = fetch,
  base = '',
): Promise<PersonaReply> {
  const root = base.replace(/\/$/, '');
  try {
    const response = await fetchImpl(`${root}/api/personas/chat`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona, message }),
    });
    if (response.ok) {
      const body = await readJson(response);
      if (isRecord(body) && typeof body.say === 'string') {
        const evidence = Array.isArray(body.evidence)
          ? body.evidence.flatMap((chip) => {
              if (!isRecord(chip) || typeof chip.label !== 'string' || typeof chip.detail !== 'string') return [];
              return [{ label: chip.label, detail: chip.detail }];
            })
          : persona.evidence.slice(0, 5);
        return { say: body.say, evidence };
      }
    }
  } catch {
    // Offline template below.
  }
  return personaReply(persona, message);
}

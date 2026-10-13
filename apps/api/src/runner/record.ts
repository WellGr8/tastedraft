/**
 * Derived playback for a failed live Qloo call.
 * A recording keeps ids, names, and heatmap coordinates only.
 * Response bodies, affinity, image URLs, and request URLs stay out.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeatmapCellSchema, type BriefV2, type Evidence, type HeatmapCell } from '@tastedraft/contracts';
import type { EvidenceStrengthName } from '@tastedraft/contracts';

export interface DerivedName {
  id: string;
  name: string;
  ref: string;
}

export interface DerivedRecording {
  v: 1;
  entities: DerivedName[];
  tags: DerivedName[];
  cells: HeatmapCell[];
}

const FIXTURE = fileURLToPath(new URL('./recordings/derived.json', import.meta.url));

export function recordingsDir(): string {
  return join(process.cwd(), 'data', 'recordings');
}

export function recordingKey(brief: BriefV2): string {
  const names = brief.references.map((reference) => reference.name).join('|');
  return `${brief.city}|${names}`.toLowerCase().replace(/[^a-z0-9|]+/g, '-').slice(0, 120);
}

function banned(text: string): boolean {
  return /"affinity"/.test(text) || /hack_/.test(text) || /"results"/.test(text) || /"image"/.test(text);
}

function namesOf(value: unknown): DerivedName[] {
  if (!Array.isArray(value)) return [];
  const rows: DerivedName[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { id?: unknown; name?: unknown; ref?: unknown };
    if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.ref !== 'string') continue;
    if (!row.id.trim() || !row.name.trim() || !row.ref.trim()) continue;
    rows.push({ id: row.id.trim(), name: row.name.trim(), ref: row.ref.trim() });
  }
  return rows;
}

export function parseRecording(text: string): DerivedRecording | null {
  if (banned(text)) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || (body as { v?: unknown }).v !== 1) return null;
  const record = body as { entities?: unknown; tags?: unknown; cells?: unknown };
  const cells: HeatmapCell[] = [];
  if (Array.isArray(record.cells)) {
    for (const cell of record.cells) {
      const parsed = HeatmapCellSchema.safeParse(cell);
      if (parsed.success) cells.push(parsed.data);
    }
  }
  return { v: 1, entities: namesOf(record.entities), tags: namesOf(record.tags), cells: cells.slice(0, 8) };
}

export function saveRecording(brief: BriefV2, recording: DerivedRecording, dir = recordingsDir()): void {
  const clean = parseRecording(JSON.stringify(recording));
  if (!clean || (!clean.entities.length && !clean.tags.length && !clean.cells.length)) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${recordingKey(brief) || 'run'}.json`), `${JSON.stringify(clean)}\n`);
}

export function loadRecording(brief: BriefV2, dir = recordingsDir()): DerivedRecording | null {
  const path = join(dir, `${recordingKey(brief) || 'run'}.json`);
  if (existsSync(path)) {
    const parsed = parseRecording(readFileSync(path, 'utf8'));
    if (parsed) return parsed;
  }
  if (!existsSync(FIXTURE)) return null;
  return parseRecording(readFileSync(FIXTURE, 'utf8'));
}

export function evidenceFromRecording(recording: DerivedRecording, strength: EvidenceStrengthName): Evidence[] {
  const rows: Evidence[] = [];
  for (const entity of recording.entities) {
    rows.push({ id: entity.id, name: entity.name, kind: 'entity', ref: entity.ref, strength, affinity: null, source: 'recorded' });
  }
  for (const tag of recording.tags) {
    rows.push({ id: tag.id, name: tag.name, kind: 'tag', ref: tag.ref, strength, affinity: null, source: 'recorded' });
  }
  return rows;
}

export function readFixtureText(): string {
  return readFileSync(FIXTURE, 'utf8');
}

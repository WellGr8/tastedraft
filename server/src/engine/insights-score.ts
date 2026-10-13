import type { ExplainabilityContribution, LedgerRow, LedgerRowId, ScoreLedger } from '@tastedraft/contracts';
import { FRICTION_FACTOR, WEIGHTS, avg, clamp100, evidenceKey } from './score.ts';
import type { EvidenceStrength } from './types.ts';

/**
 * Maps measured 0–1 affinities onto the existing ledger.
 * A dimension with no affinity stays null. It is not filled from the sample tables.
 * Friction is the gap between the anchor and audience subscores when both were measured.
 */
export interface MeasuredAffinity {
  affinity: number | null;
  contributions: readonly ExplainabilityContribution[];
  evidenceRefs: readonly string[];
}

export interface MeasuredGroup {
  label?: string;
  rows: readonly MeasuredAffinity[];
}

export interface DimensionInput {
  groups: readonly MeasuredGroup[];
  source: string;
}

export interface InsightScoreInput {
  anchor: DimensionInput;
  cross: DimensionInput;
  local: DimensionInput;
  audience: DimensionInput;
  /** Active concept references. Evidence strength uses this count when every row was measured. */
  activeRefCount: number;
}

export interface InsightScore {
  ledger: ScoreLedger;
  evidenceStrength: EvidenceStrength;
  gaps: LedgerRowId[];
  subscores: Record<LedgerRowId, number | null>;
}

const ROW_WEIGHT: Record<LedgerRowId, number> = {
  anchor: WEIGHTS.anchor,
  cross: WEIGHTS.cross,
  local: WEIGHTS.local,
  audience: WEIGHTS.audience,
  friction: FRICTION_FACTOR,
};

function unit(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}

function unitsOf(group: MeasuredGroup): number[] {
  const values: number[] = [];
  for (const row of group.rows) {
    const value = unit(row.affinity);
    if (value != null) values.push(value);
  }
  return values;
}

function meanSubscore(input: DimensionInput): { subscore: number | null; count: number } {
  const values = input.groups.flatMap(unitsOf);
  if (!values.length) return { subscore: null, count: 0 };
  return { subscore: clamp100(avg(values) * 100), count: values.length };
}

function crossSubscore(input: DimensionInput): { subscore: number | null; domains: number; coverage: number; labels: string[] } {
  const means: number[] = [];
  const labels: string[] = [];
  for (const group of input.groups) {
    const values = unitsOf(group);
    if (!values.length) continue;
    means.push(avg(values));
    if (group.label) labels.push(group.label);
  }
  if (!means.length) return { subscore: null, domains: 0, coverage: 0, labels: [] };
  const coverage = Math.min(1, means.length / 3);
  return { subscore: clamp100(avg(means) * coverage * 100), domains: means.length, coverage, labels };
}

function pointsFor(id: LedgerRowId, subscore: number | null): number | null {
  if (subscore == null) return null;
  if (id === 'friction') return -Math.round(subscore * FRICTION_FACTOR);
  return Math.round((subscore * ROW_WEIGHT[id]) / 100);
}

function contributionsOf(input: DimensionInput): ExplainabilityContribution[] {
  const seen = new Set<string>();
  const rows: ExplainabilityContribution[] = [];
  for (const group of input.groups) {
    for (const row of group.rows) {
      for (const contribution of row.contributions) {
        if (contribution.weight < 0 || contribution.weight > 1) continue;
        const key = `${contribution.input}\n${contribution.target}\n${contribution.weight}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(contribution);
      }
    }
  }
  rows.sort((a, b) => b.weight - a.weight || a.input.localeCompare(b.input) || a.target.localeCompare(b.target));
  return rows;
}

function evidenceRefsOf(input: DimensionInput, contributions: readonly ExplainabilityContribution[]): string[] {
  const ids: string[] = [];
  for (const group of input.groups) {
    for (const row of group.rows) ids.push(...row.evidenceRefs);
  }
  for (const contribution of contributions) {
    ids.push(contribution.input, contribution.target);
  }
  return [...new Set(ids.filter((id) => id.length > 0))].sort();
}

function contributionText(contributions: readonly ExplainabilityContribution[]): string {
  if (!contributions.length) return 'Explainability returned no contributions.';
  const parts = contributions.slice(0, 6).map((row) => `${row.input} ${row.weight.toFixed(2)} → ${row.target}`);
  return `Contributions: ${parts.join('; ')}.`;
}

function row(id: LedgerRowId, subscore: number | null, source: string, detail: string, evidenceRefs: string[]): LedgerRow {
  return {
    id,
    subscore,
    weight: ROW_WEIGHT[id],
    points: pointsFor(id, subscore),
    provenance: { source, detail, evidenceRefs },
  };
}

export function scoreInsightMeasurements(input: InsightScoreInput): InsightScore {
  const anchor = meanSubscore(input.anchor);
  const cross = crossSubscore(input.cross);
  const local = meanSubscore(input.local);
  const audience = meanSubscore(input.audience);
  const friction = anchor.subscore == null || audience.subscore == null
    ? null
    : clamp100(Math.max(0, anchor.subscore - audience.subscore));
  const subscores: Record<LedgerRowId, number | null> = {
    anchor: anchor.subscore,
    cross: cross.subscore,
    local: local.subscore,
    audience: audience.subscore,
    friction,
  };

  const anchorContributions = contributionsOf(input.anchor);
  const crossContributions = contributionsOf(input.cross);
  const localContributions = contributionsOf(input.local);
  const audienceContributions = contributionsOf(input.audience);
  const frictionInput: DimensionInput = {
    source: input.anchor.source,
    groups: [...input.anchor.groups, ...input.audience.groups],
  };
  const frictionContributions = contributionsOf(frictionInput);

  const rows: LedgerRow[] = [
    row(
      'anchor',
      anchor.subscore,
      input.anchor.source,
      anchor.subscore == null
        ? 'Anchor was not measured. No affinity was invented.'
        : `Anchor affinity is the mean of ${anchor.count} concept anchors. ${contributionText(anchorContributions)}`,
      evidenceRefsOf(input.anchor, anchorContributions),
    ),
    row(
      'cross',
      cross.subscore,
      input.cross.source,
      cross.subscore == null
        ? 'Cross-domain fit was not measured. No affinity was invented.'
        : `Cross-domain fit is the mean of ${cross.domains} entity types${cross.labels.length ? ` (${cross.labels.join(', ')})` : ''} scaled by coverage ${cross.coverage.toFixed(2)}. ${contributionText(crossContributions)}`,
      evidenceRefsOf(input.cross, crossContributions),
    ),
    row(
      'local',
      local.subscore,
      input.local.source,
      local.subscore == null
        ? 'Local fit was not measured. No affinity was invented.'
        : `Local fit is the mean of ${local.count} place results for the brief city. ${contributionText(localContributions)}`,
      evidenceRefsOf(input.local, localContributions),
    ),
    row(
      'audience',
      audience.subscore,
      input.audience.source,
      audience.subscore == null
        ? 'Audience fit was not measured. No affinity was invented.'
        : `Audience fit is the mean of ${audience.count} demographic affinities. ${contributionText(audienceContributions)}`,
      evidenceRefsOf(input.audience, audienceContributions),
    ),
    row(
      'friction',
      friction,
      input.anchor.source,
      friction == null
        ? 'Friction was not measured. It is the gap between anchor and audience, and one of those was missing.'
        : `Friction is the gap between anchor subscore ${anchor.subscore} and audience subscore ${audience.subscore}. ${contributionText(frictionContributions)}`,
      evidenceRefsOf(frictionInput, frictionContributions),
    ),
  ];

  const present = rows.map((item) => item.points).filter((points): points is number => points != null);
  const gaps = rows.filter((item) => item.points == null).map((item) => item.id);
  return {
    ledger: { rows, total: present.length ? present.reduce((sum, points) => sum + points, 0) : null },
    evidenceStrength: gaps.length ? 'LIMITED' : evidenceKey(input.activeRefCount),
    gaps,
    subscores,
  };
}

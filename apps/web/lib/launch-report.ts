/**
 * One-page launch report. Neighborhood badges reuse the Compare crowded rule.
 * A persona "flipped to yes" only when fit crossed 70. Quotes come from the
 * same voice lines as the cards.
 */
import type { AgentPlan, AgentRound } from './agent-plan.ts';
import { CROWDED_AT } from './compare.ts';
import { voiceFor } from './voice.ts';

export const YES_AT = 70;

export interface ReportArea {
  label: string;
  weight: number;
}

export interface ReportNeighborhood {
  label: string;
  value: number;
  badge: 'best-bet' | 'safe-market' | null;
}

export interface ReportPerson {
  label: string;
  before: number;
  after: number;
  anchors: readonly { name: string }[];
}

export interface ReportFlip {
  label: string;
  before: number;
  after: number;
  quote: string;
  flipped: boolean;
}

export interface LaunchReportModel {
  before: number;
  after: number;
  delta: number;
  flipCount: number;
  panel: number;
  quotes: ReportFlip[];
  changes: Array<{ title: string; delta: number; why: string }>;
  neighborhoods: ReportNeighborhood[];
  action: string;
  week: string[];
  fixes: string[];
  stop: string;
  method: string[];
}

export function neighborhoodBars(areas: readonly ReportArea[]): ReportNeighborhood[] {
  const rows = areas
    .filter((area) => area.label.trim() && Number.isFinite(area.weight))
    .map((area) => ({
      label: area.label.trim(),
      weight: area.weight,
      value: Math.round(area.weight * 100),
    }));
  if (!rows.length) return [];
  const crowded = rows.filter((row) => row.weight >= CROWDED_AT);
  const open = rows.filter((row) => row.weight < CROWDED_AT);
  const best = open.length
    ? [...open].sort((left, right) => right.weight - left.weight || left.label.localeCompare(right.label))[0]
    : [...rows].sort((left, right) => left.weight - right.weight || left.label.localeCompare(right.label))[0];
  const safePool = crowded.filter((row) => row.label !== best?.label);
  const safe = safePool.sort((left, right) => right.weight - left.weight || left.label.localeCompare(right.label))[0] ?? null;
  return rows.map((row) => ({
    label: row.label,
    value: row.value,
    badge: best && row.label === best.label ? 'best-bet' : safe && row.label === safe.label ? 'safe-market' : null,
  }));
}

export function personaMoves(people: readonly ReportPerson[]): ReportFlip[] {
  return people
    .filter((person) => person.before > 0 && person.after > 0 && person.anchors.length > 0)
    .map((person) => ({
      label: person.label,
      before: person.before,
      after: person.after,
      flipped: person.before < YES_AT && person.after >= YES_AT,
      quote: voiceFor(person.anchors, person.after, person.before, person.label),
    }))
    .filter((person) => person.flipped || Math.abs(person.after - person.before) >= 5);
}

function topChanges(rounds: readonly AgentRound[]): LaunchReportModel['changes'] {
  return rounds.slice(0, 3).map((round) => ({ title: round.title, delta: round.delta, why: round.why }));
}

export function buildLaunchReport(input: {
  before: number;
  after: number;
  plan: AgentPlan | null;
  people: readonly ReportPerson[];
  areas: readonly ReportArea[];
  costLabel: string;
}): LaunchReportModel {
  const moves = personaMoves(input.people);
  const flips = moves.filter((person) => person.flipped);
  const quotes = flips.length ? flips : moves.slice(0, 3);
  const plan = input.plan;
  const action = plan?.action || 'Keep this version and test it with four people this week.';
  const stop = plan?.stop || 'Stopped because no measured edit moved the score by at least 4 points.';
  return {
    before: input.before,
    after: input.after,
    delta: input.after - input.before,
    flipCount: flips.length,
    panel: input.people.length,
    quotes,
    changes: plan ? topChanges(plan.rounds) : [],
    neighborhoods: neighborhoodBars(input.areas),
    action,
    week: plan?.week ?? [],
    fixes: plan?.rounds.map((round) => round.title) ?? [],
    stop,
    method: [
      'Not a sales forecast.',
      `Market-test cost avoided ${input.costLabel}. Estimate, not a forecast.`,
      stop,
      'The score is the sample engine on this idea, this price, and these references.',
    ],
  };
}

/**
 * Chat command router for the lab. Deterministic intent parsing (no model call),
 * so every action maps onto an existing run / proposal / compare API and every
 * explain answer is built from the run's own evidence.
 */
export type ChatIntent =
  | { kind: 'test' }
  | { kind: 'city'; city: string }
  | { kind: 'compare'; options: string[] }
  | { kind: 'approve' }
  | { kind: 'reject' }
  | { kind: 'cheaper' }
  | { kind: 'explain'; subject: string | null }
  | { kind: 'server'; text: string };

const clean = (s: string) => s.trim().replace(/[?.!]+$/, '').trim();
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function parseIntent(input: string): ChatIntent {
  const raw = input.trim();
  const text = raw.toLowerCase();
  if (/^(test|run|start|go|score)( (it|this|the idea|again))?\b/.test(text) || /^(rerun|re-run|retest)\b/.test(text)) return { kind: 'test' };
  const compare = /^compare\s+(.+?)\s+(?:vs\.?|versus|and|or|with)\s+(.+)$/i.exec(raw);
  if (compare) return { kind: 'compare', options: [clean(compare[1]!), ...clean(compare[2]!).split(/\s+(?:vs\.?|versus|and|or)\s+|,\s*/i).map(clean)].filter(Boolean).slice(0, 5) };
  const city = /^(?:try|test|move (?:it )?to|launch in|what about|switch to|in)\s+(?:it in\s+)?([a-z][a-z .'-]{1,40})$/i.exec(raw);
  if (city && !/^(it|this|again|cheaper|lower)/i.test(city[1]!)) return { kind: 'city', city: title(clean(city[1]!)) };
  if (/^(approve|yes|accept|apply|do it|ok)\b/.test(text)) return { kind: 'approve' };
  if (/^(reject|dismiss|no|skip)\b/.test(text)) return { kind: 'reject' };
  if (/\b(cheaper|lower (the )?price|less expensive|price down|more affordable)\b/.test(text)) return { kind: 'cheaper' };
  const why = /^(?:why|explain|how come|what makes)\b(.*)$/i.exec(raw);
  if (why) {
    const rest = clean(why[1] ?? '').replace(/^(is|does|did|the|so)\s+/i, '');
    const subject = /^([A-Z][\w'-]*(?:\s[A-Z][\w'-]*)*)/.exec(rest)?.[1] ?? null;
    return { kind: 'explain', subject };
  }
  return { kind: 'server', text: raw };
}

interface EvidenceLike { name: string; kind: string; affinity: number | null; source: string; strength: string }
interface CellLike { label?: string; weight: number }
export interface RunLike {
  score: number | null;
  evidenceStrength: string;
  grounding: string;
  qlooCalls: number;
  evidence: EvidenceLike[];
  districts: CellLike[];
  report: string;
  proposals: Array<{ id: string; label?: string; before?: string; after?: string }>;
}

const pct = (n: number) => `${Math.round(n * 100)}`;

/** An explain answer built only from the run snapshot. */
export function explainFromRun(run: RunLike | null, subject: string | null): string {
  if (!run) return 'There is no scored run yet. Say "test" and I will run it first.';
  if (run.score === null) return `No score for this run: Qloo returned no measured affinities for these references (evidence ${run.evidenceStrength}, ${run.qlooCalls} Qloo calls). I won't guess a number. Try more widely known references or another city.`;
  const lines: string[] = [];
  if (subject) {
    const s = subject.toLowerCase();
    const cell = run.districts.find((c) => c.label?.toLowerCase().includes(s));
    const ev = run.evidence.find((e) => e.name.toLowerCase().includes(s));
    if (cell) lines.push(`${cell.label} is a Qloo heatmap cell at ${pct(cell.weight)}/100 relative taste heat for this audience. Higher means the brief's anchors are more popular there.`);
    if (ev) lines.push(`${ev.name} (${ev.kind}) came from ${ev.source}${ev.affinity !== null ? ` with affinity ${ev.affinity.toFixed(2)}` : ', affinity not measured'}, strength ${ev.strength}.`);
    if (!cell && !ev) lines.push(`${subject} is not in this run's evidence, so I will not invent a reason.`);
  }
  const top = [...run.evidence].filter((e) => e.affinity !== null).sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0)).slice(0, 3);
  lines.push(`Score ${run.score} (${run.evidenceStrength}, ${run.grounding}, ${run.qlooCalls} Qloo calls).`);
  if (top.length) lines.push(`Strongest signals: ${top.map((e) => `${e.name} ${e.affinity!.toFixed(2)}`).join(', ')}.`);
  const hot = [...run.districts].sort((a, b) => b.weight - a.weight).slice(0, 3).filter((c) => c.label);
  if (hot.length && !subject) lines.push(`Hottest areas: ${hot.map((c) => `${c.label} ${pct(c.weight)}`).join(', ')}.`);
  return lines.join(' ');
}

/** Quick-action chips for the current state. */
export function suggestChips(input: { hasRun: boolean; busy: boolean; hasProposal: boolean; city: string; districts: string[] }): string[] {
  if (input.busy) return [];
  if (!input.hasRun) return ['Test this idea', `Try ${input.city === 'Tokyo' ? 'Osaka' : 'Tokyo'}`, 'Cheaper merch'];
  const chips: string[] = [];
  if (input.hasProposal) chips.push('Approve', 'Reject');
  chips.push('Why this score?');
  if (input.districts[0]) chips.push(`Why ${input.districts[0]}?`);
  if (input.districts.length >= 2) chips.push(`Compare ${input.districts[0]} vs ${input.districts[1]}`);
  chips.push('Cheaper merch');
  return chips.slice(0, 5);
}

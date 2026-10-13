import { tryApplyChangeSet } from './apply.ts';
import { canonicalizeBrief } from './brief.ts';
import { resolveClient, type LlmCallOptions } from './client.ts';
import { fallbackCritique, needsMore, tooThin } from './fallback.ts';
import { coerceEvidence, presentedItems, readLedger } from './normalize.ts';
import { CRITIQUE_SYSTEM_PROMPT } from './prompts.ts';
import {
  BriefSchema,
  CritiqueResultSchema,
  LEDGER_DIMENSIONS,
  type Brief,
  type CritiqueResult,
  type EvidencePacket,
  type Ledger,
} from './schemas.ts';
import { allowedNumbersIn, findNovelNumbers, findScoreIssue } from './scores.ts';
import { boundAttempts, completeJson } from './validate.ts';

export async function critique(
  briefInput: unknown,
  evidenceInput: unknown,
  ledgerInput?: unknown,
  options?: LlmCallOptions,
): Promise<CritiqueResult> {
  const brief = canonicalizeBrief(BriefSchema.parse(briefInput));
  const raw = coerceEvidence(evidenceInput);
  const packet: EvidencePacket = { ...raw, items: presentedItems(raw.items) };
  const ledger = readLedger(ledgerInput);
  if (tooThin(packet, ledger)) return guardCritique(needsMore(packet, ledger), brief, packet);

  const client = resolveClient(options);
  if (client.mode === 'offline') return guardCritique(fallbackCritique(brief, packet, ledger), brief, packet);

  const user = critiqueUser(brief, packet, ledger);
  return completeJson({
    client,
    system: CRITIQUE_SYSTEM_PROMPT,
    user,
    schema: CritiqueResultSchema,
    maxAttempts: boundAttempts(options?.maxAttempts),
    refine: (value) => refineCritique(value, brief, new Set(packet.items.map((item) => item.id))),
  });
}

function critiqueUser(brief: Brief, packet: EvidencePacket, ledger: Ledger): string {
  return JSON.stringify({
    brief,
    legalBefores: {
      productType: brief.productType,
      facets: brief.facets,
      'audience.age': brief.audience.age,
      'audience.description': brief.audience.description,
      city: brief.city,
      references: brief.references.map((reference) => reference.name),
      positioning: brief.positioning,
      constraints: brief.constraints.map((constraint) => constraint.text),
    },
    evidence: {
      sourceId: packet.sourceId ?? 'unspecified',
      items: packet.items,
    },
    ledger: {
      dimensions: [...LEDGER_DIMENSIONS],
      evidenceStrength: ledger.evidenceStrength ?? 'unspecified',
    },
  });
}

function refineCritique(data: CritiqueResult, brief: Brief, ids: Set<string>): string | null {
  if (data.status === 'needs more evidence') return null;
  for (const change of data.proposals) {
    for (const id of change.evidenceRefs) {
      if (!ids.has(id)) return 'a proposal cites an unknown evidence id';
    }
  }
  const applied = tryApplyChangeSet(brief, data.proposals);
  if (!applied.ok) return applied.reason;
  return null;
}

function guardCritique(result: CritiqueResult, brief: Brief, packet: EvidencePacket): CritiqueResult {
  const checked = CritiqueResultSchema.parse(result);
  const score = findScoreIssue(checked);
  if (score) throw new Error(`offline critique ${score}`);
  const novel = findNovelNumbers(checked, allowedNumbersIn(`${JSON.stringify(brief)}\n${JSON.stringify(packet)}`));
  if (novel) throw new Error(`offline critique ${novel}`);
  const grounding = refineCritique(checked, brief, new Set(packet.items.map((item) => item.id)));
  if (grounding) throw new Error(`offline critique ${grounding}`);
  return checked;
}

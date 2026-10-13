import { resolveClient, type LlmCallOptions } from './client.ts';
import { fallbackExplain } from './fallback.ts';
import { coerceEvidence, presentedItems, readLedger } from './normalize.ts';
import { EXPLAIN_SYSTEM_PROMPT } from './prompts.ts';
import { ExplainResultSchema, LEDGER_DIMENSIONS, type EvidencePacket, type ExplainResult, type Ledger } from './schemas.ts';
import { allowedNumbersIn, findNovelNumbers, findScoreIssue } from './scores.ts';
import { boundAttempts, completeJson } from './validate.ts';

export async function explain(evidenceInput: unknown, ledgerInput?: unknown, options?: LlmCallOptions): Promise<ExplainResult> {
  const packet = presentPacket(coerceEvidence(evidenceInput));
  const ledger = readLedger(ledgerInput);
  const client = resolveClient(options);
  if (packet.items.length === 0 || client.mode === 'offline') return guardExplain(fallbackExplain(packet, ledger), packet);

  const user = explainUser(packet, ledger);
  return completeJson({
    client,
    system: EXPLAIN_SYSTEM_PROMPT,
    user,
    schema: ExplainResultSchema,
    maxAttempts: boundAttempts(options?.maxAttempts),
    refine: (value) => refineExplain(value, new Set(packet.items.map((item) => item.id))),
  });
}

function presentPacket(packet: EvidencePacket): EvidencePacket {
  return { ...packet, items: presentedItems(packet.items) };
}

function explainUser(packet: EvidencePacket, ledger: Ledger): string {
  return JSON.stringify({
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

function refineExplain(data: ExplainResult, ids: Set<string>): string | null {
  if (!data.prose.includes('หลักฐาน') || !data.prose.includes('อนุมาน')) {
    return 'prose must separate evidence (หลักฐาน) from inference (อนุมาน)';
  }
  for (const note of data.evidence) {
    if (!ids.has(note.evidenceId)) return 'an evidence statement cites an unknown id';
    if (!data.prose.includes(`[${note.evidenceId}]`)) return 'prose does not cite an evidence statement';
  }
  const claimRefs = [
    ...data.inferences.map((item) => item.evidenceRefs),
    ...data.fits.map((item) => item.evidenceRefs),
    ...data.frictions.map((item) => item.evidenceRefs),
  ];
  if (ids.size > 0 && data.inferences.length === 0) return 'inferences must contain a grounded claim';
  const used = new Set<string>();
  for (const refs of claimRefs) {
    for (const id of refs) {
      if (!ids.has(id)) return 'a claim cites an unknown evidence id';
      used.add(id);
    }
  }
  const stated = new Set(data.evidence.map((note) => note.evidenceId));
  for (const id of used) {
    if (!stated.has(id)) return 'a claim cites an id that is not restated in evidence';
    if (!data.prose.includes(`[${id}]`)) return 'prose does not cite every evidence id used in a claim';
  }
  return null;
}

function guardExplain(result: ExplainResult, packet: EvidencePacket): ExplainResult {
  const checked = ExplainResultSchema.parse(result);
  const score = findScoreIssue(checked);
  if (score) throw new Error(`offline explanation ${score}`);
  const novel = findNovelNumbers(checked, allowedNumbersIn(explainUser(packet, {})));
  if (novel) throw new Error(`offline explanation ${novel}`);
  const grounding = refineExplain(checked, new Set(packet.items.map((item) => item.id)));
  if (grounding) throw new Error(`offline explanation ${grounding}`);
  return checked;
}

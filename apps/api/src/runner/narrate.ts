/**
 * Proposal copy may only repeat evidence ids.
 * Offline (no live LLM key) uses a template. A live rewrite is stripped
 * down to sentences that cite an id. Scores never enter the sentence.
 */
import { CLAIM_LABEL } from '@tastedraft/contracts';
import type { LlmClient } from '../llm/client.ts';
import { findScoreIssue } from '../llm/scores.ts';

export function offlineClaim(hypothesis: string, evidenceIds: readonly string[]): string {
  const ids = evidenceIds.filter((id) => id.length > 0);
  const lead = ids[0] ?? 'evidence';
  return `${CLAIM_LABEL} (${lead}): ${hypothesis} Supported by ${ids.join(', ')}.`;
}

/** Drop sentences that do not name one of the evidence ids. */
export function keepCited(text: string, evidenceIds: readonly string[]): string {
  const ids = evidenceIds.filter((id) => id.length > 0);
  if (!ids.length) return '';
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && ids.some((id) => sentence.includes(id)))
    .join(' ');
}

export async function narrate(
  input: { hypothesis: string; evidenceIds: readonly string[]; llm?: LlmClient },
): Promise<string> {
  const fallback = offlineClaim(input.hypothesis, input.evidenceIds);
  const llm = input.llm;
  if (!llm || llm.mode !== 'live') return fallback;
  try {
    const written = await llm.complete([
      {
        role: 'system',
        content:
          'Write one or two sentences. Every sentence must contain an evidence id from the user message. Do not mention a score, points, a rating, or a percentage. Do not add an evidence id that was not provided.',
      },
      {
        role: 'user',
        content: JSON.stringify({ hypothesis: input.hypothesis, evidenceIds: input.evidenceIds }),
      },
    ]);
    if (findScoreIssue(written)) return fallback;
    const cited = keepCited(written, input.evidenceIds);
    return cited || fallback;
  } catch {
    return fallback;
  }
}

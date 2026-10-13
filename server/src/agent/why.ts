/**
 * The model writes the reason only. Predicted lift is already on the proposal
 * before this runs, and it is never put in the prompt.
 */
import type { QlooParamDiff } from '@tastedraft/contracts';
import { z } from 'zod';
import { resolveClient, type LlmCallOptions } from '../llm/client.ts';
import { LlmTransportError, LlmValidationError } from '../llm/errors.ts';
import { allowedNumbersIn, findNovelNumbers, findScoreIssue } from '../llm/scores.ts';
import { completeJson } from '../llm/validate.ts';

const WhySchema = z.object({ why: z.string().min(1).max(500) }).strict();

const WHY_SYSTEM = `You write one reason a person can read before they approve a Qloo parameter change.
Return one JSON object and nothing else: { "why": string }
Rules:
- why is one or two English sentences.
- Use only the friction, the parameter names, and the evidence ids in the user message.
- Do not mention a score, a rating, points, a percentage, a total, or a predicted lift.
- Do not invent a city, a reference, or an evidence id.
- JSON only.`;

const FALLBACK: Record<string, string> = {
  'price-level':
    'The price evidence conflicts with this audience, so the Qloo price filter should move to the level that evidence can support.',
  positioning:
    'Premium positioning fights the indie place in the evidence. The interest tag should move toward independent.',
  'audience-age':
    'The current age band is a tighter fit against this price than the next band. The demographic signal should follow that evidence.',
  'audience-gender':
    'A measured audience signal disagrees with the gender on the brief. The demographic signal should match that evidence.',
  location:
    'Price drag is heavier in this city than in the indie district the evidence points to. The location filter should move there.',
  channel:
    'A limited run conflicts with how this audience takes in new work. The channel tag should switch to pre-order.',
  'references-swap':
    'One reference sits far from the idea relative to the others. It should leave the entity signal so the graph is asked about a tighter set.',
  'references-add':
    'The electronic idea has no artist in the entity signal. Adding one asks the music domain the graph was missing.',
};

export function fallbackWhy(id: string): string {
  return FALLBACK[id] ?? 'The cited evidence conflicts with the current Qloo parameters, so this diff follows that evidence.';
}

export async function writeWhy(
  input: { id: string; frictionText: string; changes: readonly QlooParamDiff[]; evidenceRefs: readonly string[] },
  options?: LlmCallOptions,
): Promise<string> {
  const fallback = fallbackWhy(input.id);
  const client = resolveClient(options);
  if (client.mode === 'offline') return fallback;
  const user = JSON.stringify({
    friction: input.frictionText,
    changes: input.changes.map((change) => ({ param: change.param, from: change.from, to: change.to })),
    evidenceRefs: input.evidenceRefs,
  });
  try {
    const written = await completeJson({
      client,
      system: WHY_SYSTEM,
      user,
      schema: WhySchema,
      maxAttempts: 2,
      refine: (value) => {
        if (findScoreIssue(value)) return 'why contains a score';
        return findNovelNumbers(value, allowedNumbersIn(user));
      },
    });
    return written.why;
  } catch (error) {
    if (error instanceof LlmValidationError || error instanceof LlmTransportError || error instanceof Error) {
      return fallback;
    }
    return fallback;
  }
}

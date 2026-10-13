import { ZodError, type ZodType } from 'zod';
import type { ChatMessage, LlmClient } from './client.ts';
import { LlmValidationError } from './errors.ts';
import { repairUserPrompt } from './prompts.ts';
import { allowedNumbersIn, findNovelNumbers, findScoreIssue } from './scores.ts';

export const MAX_LLM_ATTEMPTS = 3;

export function boundAttempts(value: number | undefined): number {
  if (value == null) return MAX_LLM_ATTEMPTS;
  if (!Number.isInteger(value) || value < 1) return 1;
  return Math.min(value, MAX_LLM_ATTEMPTS);
}

export function extractJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fence ? fence[1] : trimmed).trim();
  const direct = parseJson(body);
  if (direct.ok) return direct;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = parseJson(body.slice(start, end + 1));
    if (sliced.ok) return sliced;
  }
  return { ok: false, error: 'Response is not valid JSON' };
}

function parseJson(body: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false, error: 'Response is not valid JSON' };
  }
}

export function formatZod(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join('.') || '(root)';
      if (issue.code === 'too_big' || issue.code === 'too_small') return `${path}: length is outside the allowed range`;
      if (issue.code === 'unrecognized_keys') return `${path}: extra keys are not allowed (${issue.keys.join(', ')})`;
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export async function completeJson<T>(args: {
  client: LlmClient;
  system: string;
  user: string;
  schema: ZodType<T>;
  maxAttempts: number;
  refine?: (value: T) => string | null;
}): Promise<T> {
  const allowed = allowedNumbersIn(args.user);
  const reasons: string[] = [];
  const messages: ChatMessage[] = [
    { role: 'system', content: args.system },
    { role: 'user', content: args.user },
  ];

  for (let attempt = 0; attempt < args.maxAttempts; attempt++) {
    const raw = await args.client.complete(messages);
    const reason = rejectRaw(raw, args.schema, allowed, args.refine);
    if (reason == null) {
      const extracted = extractJson(raw);
      if (!extracted.ok) throw new LlmValidationError(['Response is not valid JSON']);
      return args.schema.parse(extracted.value);
    }
    reasons.push(reason);
    messages.push({ role: 'user', content: repairUserPrompt(reason) });
  }

  throw new LlmValidationError(reasons);
}

function rejectRaw<T>(
  raw: string,
  schema: ZodType<T>,
  allowed: Set<string>,
  refine: ((value: T) => string | null) | undefined,
): string | null {
  const extracted = extractJson(raw);
  if (!extracted.ok) return extracted.error;
  const parsed = schema.safeParse(extracted.value);
  if (!parsed.success) return formatZod(parsed.error);
  const score = findScoreIssue(parsed.data);
  if (score) return score;
  const novel = findNovelNumbers(parsed.data, allowed);
  if (novel) return novel;
  return refine ? refine(parsed.data) : null;
}

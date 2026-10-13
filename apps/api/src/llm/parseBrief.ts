import { canonicalizeBrief, overlayForm } from './brief.ts';
import { resolveClient, type LlmCallOptions } from './client.ts';
import { FormValidationError } from './errors.ts';
import { fallbackBrief } from './fallback.ts';
import { PARSE_BRIEF_SYSTEM_PROMPT } from './prompts.ts';
import { BriefFormSchema, BriefSchema, type Brief, type BriefForm } from './schemas.ts';
import { allowedNumbersIn, findNovelNumbers, findScoreIssue } from './scores.ts';
import { boundAttempts, completeJson, formatZod } from './validate.ts';

const MAX_TEXT = 4000;

export async function parseBrief(text: string, formInput?: BriefForm, options?: LlmCallOptions): Promise<Brief> {
  if (typeof text !== 'string') throw new FormValidationError('text must be a string');
  const form = readForm(formInput);
  const idea = (text.trim() || form.idea?.trim() || '').slice(0, MAX_TEXT);
  const client = resolveClient(options);
  if (client.mode === 'offline') return guardBrief(fallbackBrief(idea, form), idea, form);

  const draft = await completeJson({
    client,
    system: PARSE_BRIEF_SYSTEM_PROMPT,
    user: JSON.stringify({
      text: idea,
      form: {
        age: form.age ?? '',
        city: form.city ?? '',
        positioning: form.positioning ?? form.pos ?? '',
        references: form.references ?? form.refs ?? [],
        interests: form.interests ?? '',
      },
    }),
    schema: BriefSchema,
    maxAttempts: boundAttempts(options?.maxAttempts),
  });
  return overlayForm(canonicalizeBrief(draft), form);
}

function readForm(formInput?: BriefForm): BriefForm {
  const parsed = BriefFormSchema.safeParse(formInput ?? {});
  if (!parsed.success) throw new FormValidationError(formatZod(parsed.error));
  return parsed.data;
}

function guardBrief(brief: Brief, idea: string, form: BriefForm): Brief {
  const checked = BriefSchema.parse(brief);
  const score = findScoreIssue(checked);
  if (score) throw new Error(`offline brief ${score}`);
  const novel = findNovelNumbers(checked, allowedNumbersIn(`${idea}\n${JSON.stringify(form)}`));
  if (novel) throw new Error(`offline brief ${novel}`);
  return checked;
}

/**
 * Persona chat drafting.
 * Each turn sends the system prompt plus the prior conversation as real chat
 * turns. A live model may speak only as this persona, from this persona's
 * Qloo anchors. A repeat, a second-person slip, or a timeout becomes a
 * question-specific template.
 */
import { offlinePersonaMessage, stripEntityIds, type PersonaChatRequest, type PersonaChatResult } from '@tastedraft/contracts';
import { PERSONA_MAX_TOKENS, PERSONA_TIMEOUT_MS, type ChatMessage, type LlmClient } from './client.ts';

export const PERSONA_LABEL = 'Simulated persona response';
export const PERSONA_MAX_CHARS = 480;
/** High enough that two short follow-ups do not collapse to the same sentence. */
export const PERSONA_TEMPERATURE = 0.8;

type Citation = PersonaChatResult['citations'][number];

export interface PersonaDraft {
  source: 'llm' | 'template';
  message: string;
  citations: Citation[];
  warning?: string;
}

const THAI_SCRIPT = /[\u0E00-\u0E7F]/;

const GROUNDED_WARNING = 'The model reply was not grounded in this persona\'s Qloo anchors. The reply is the template fallback.';
const UNAVAILABLE_WARNING = 'The language model was unavailable. The reply is the template fallback.';
const REPEAT_WARNING = 'The model repeated a previous reply. The reply is the template fallback.';
const PERSPECTIVE_WARNING = 'The model addressed the interviewer as the persona. The reply is the template fallback.';

function readable(value: string): string {
  return stripEntityIds(value).replace(/^simulated persona response\.?\s*/i, '').trim();
}

function categoryOf(type: string | undefined): string {
  const raw = readable(type ?? '');
  if (!raw) return '';
  const tail = raw.split(':').filter(Boolean).pop() ?? raw;
  return tail.replace(/_/g, ' ').trim();
}

function normalizedReply(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!?…]+$/g, '');
}

function sameReply(left: string, right: string): boolean {
  const a = normalizedReply(left);
  const b = normalizedReply(right);
  return a.length > 0 && a === b;
}

/** The interviewer is being spoken to as if they were this persona. */
function talksToInterviewerAsSelf(message: string): boolean {
  return /\byou(?:'d|’d| would)\b/i.test(message) || /\byour (?:preferred |own )?(?:style|taste)\b/i.test(message);
}

function priorPersonaLines(request: PersonaChatRequest): string[] {
  return (request.history ?? [])
    .filter((turn) => turn.role === 'persona')
    .map((turn) => readable(turn.content))
    .filter((line) => line.length > 0);
}

function repeatsPrior(message: string, request: PersonaChatRequest): boolean {
  return priorPersonaLines(request).some((line) => sameReply(line, message));
}

type ReplyProblem = 'repeat' | 'perspective';

function replyProblem(message: string, request: PersonaChatRequest): ReplyProblem | null {
  if (repeatsPrior(message, request)) return 'repeat';
  if (talksToInterviewerAsSelf(message)) return 'perspective';
  return null;
}

function anchorAliases(request: PersonaChatRequest) {
  return request.persona.anchors.slice(0, 8).map((anchor, index) => ({
    alias: `a${index + 1}`,
    id: anchor.id,
    name: readable(anchor.name) || anchor.name,
    type: anchor.type,
    affinity: anchor.affinity ?? null,
    reason: anchor.reason ? readable(anchor.reason) : '',
  }));
}

function systemPrompt(request: PersonaChatRequest): string {
  const label = readable(request.persona.label) || 'this customer';
  const location = readable(request.persona.location) || 'this city';
  const age = request.persona.age ? readable(request.persona.age) : '';
  const gender = request.persona.gender ? readable(request.persona.gender) : '';
  const who = [label, age, gender].filter(Boolean).join(', ');
  const anchorText = anchorAliases(request)
    .map((anchor) => {
      const category = categoryOf(anchor.type);
      const affinity = anchor.affinity == null ? 'affinity not measured' : `affinity ${anchor.affinity.toFixed(2)}`;
      const reason = anchor.reason
        || (category
          ? `Qloo measured this ${category} as a taste I already have`
          : 'Qloo measured this as a taste I already have');
      const categoryBit = category ? `, category ${category}` : '';
      return `${anchor.alias}: ${anchor.name}${categoryBit}, ${affinity}. Reason: ${reason}.`;
    })
    .join(' ');
  const idea = readable(request.context?.idea ?? '');
  const verdict = readable(request.context?.verdict ?? '');
  const frictions = (request.context?.frictions ?? []).map((line) => readable(line)).filter(Boolean);
  const redTeam = request.context?.stance === 'red-team';
  return [
    redTeam
      ? `You ARE the red team for ${who} in ${location}. Argue against the idea being tested.`
      : `You ARE ${who} in ${location}. You are this persona, not an assistant describing them.`,
    redTeam
      ? 'Every objection names a Qloo anchor and a concrete reason from that evidence. Stay specific. Do not insult. Do not invent entities.'
      : '',
    'Speak only in the first person: I, me, my. The interviewer is a different person.',
    'Never address the interviewer as if they were you. Do not say "you\'d", "you would", or "your preferred style". If they ask about "your style", they mean your style, and you answer as yourself.',
    `Your Qloo taste anchors are the only evidence you may use: ${anchorText}`,
    idea ? `The idea being tested: ${idea}.` : '',
    verdict ? `Your verdict on that idea: ${verdict}.` : '',
    frictions.length ? `Frictions: ${frictions.join('; ')}.` : '',
    'Answer the specific question in this turn. Give concrete reasons tied to those Qloo anchors.',
    'Reply in the same language as the user\'s latest message. A Thai question gets a Thai answer. Keep every anchor name exactly as written. Do not translate entity names. The anchor name must appear in the reply in its original spelling.',
    'A recorded run, or a run with zero Qloo calls, does not change this. You still answer from the anchors you were given.',
    'Write 1 to 3 sentences. Never repeat a previous reply verbatim.',
    'Return JSON only: {"message":"...","citationIds":["a1"]}. citationIds must be alias values from the anchor list. Name those anchors in the message. Do not include identifiers. Do not invent entities or forecasts.',
  ]
    .filter(Boolean)
    .join('\n');
}

function priorTurns(request: PersonaChatRequest): ChatMessage[] {
  const turns: ChatMessage[] = [];
  for (const turn of request.history ?? []) {
    const content = readable(turn.content);
    if (!content) continue;
    turns.push({ role: turn.role === 'persona' ? 'assistant' : 'user', content });
  }
  const question = readable(request.message);
  const last = turns[turns.length - 1];
  if (last?.role === 'user' && last.content === question) turns.pop();
  return turns;
}

function messagesFor(request: PersonaChatRequest, extra: ChatMessage[] = []): ChatMessage[] {
  const question = readable(request.message) || request.message;
  return [
    { role: 'system', content: systemPrompt(request) },
    ...priorTurns(request),
    { role: 'user', content: question },
    ...extra,
  ];
}

function asksInThai(message: string): boolean {
  return THAI_SCRIPT.test(message);
}

function hasThai(message: string): boolean {
  return THAI_SCRIPT.test(message);
}

function thaiNudge(request: PersonaChatRequest): string {
  const question = readable(request.message) || request.message;
  return `That answer is not in Thai. The question was "${question}". Answer it in Thai, in the first person, as yourself. Keep every anchor name exactly as written. Do not translate entity names. Do not answer in English. Return JSON {"message":"...","citationIds":["a1"]}.`;
}

function nudge(problem: ReplyProblem, request: PersonaChatRequest): string {
  const question = readable(request.message) || request.message;
  const lead = problem === 'repeat'
    ? 'That repeats a previous reply verbatim.'
    : 'That addresses the interviewer as if they were you.';
  return `${lead} Answer "${question}" in the first person, as yourself, in the same language as that question. Keep anchor names exactly as written. Do not say "you'd" or "your preferred style". Give a concrete reason from your Qloo anchors, in 1 to 3 sentences, and do not repeat any earlier reply. Return JSON {"message":"...","citationIds":["a1"]}.`;
}

export function templatePersona(request: PersonaChatRequest): PersonaDraft {
  const anchors = [...request.persona.anchors].sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1)).slice(0, 3);
  const message = offlinePersonaMessage(request);
  return {
    source: 'template',
    message: capPersonaMessage(message),
    citations: anchors.map((anchor) => ({
      id: anchor.id,
      name: readable(anchor.name) || anchor.name,
      affinity: anchor.affinity ?? null,
    })),
  };
}

function freshTemplate(request: PersonaChatRequest): PersonaDraft {
  const draft = templatePersona(request);
  if (!replyProblem(draft.message, request)) return draft;
  const question = readable(request.message) || request.message;
  const message = capPersonaMessage(`${draft.message} I am answering "${question}" as myself.`);
  if (!replyProblem(message, request)) return { ...draft, message };
  return draft;
}

export function capPersonaMessage(text: string): string {
  const cleaned = readable(text);
  if (cleaned.length <= PERSONA_MAX_CHARS) return cleaned;
  const room = PERSONA_MAX_CHARS - 1;
  const slice = cleaned.slice(0, room);
  const cut = slice.lastIndexOf(' ');
  const stem = (cut > 24 ? slice.slice(0, cut) : slice).trimEnd();
  return `${stem}…`;
}

/**
 * Accept a model reply only when every citation is one of this persona's anchors
 * and the prose names at least one of those anchors.
 */
function parseModelJson(raw: string): { message?: unknown; citationIds?: unknown } | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? trimmed).trim();
  const candidates = [body];
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(body.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as { message?: unknown; citationIds?: unknown };
    } catch {
      // try the next slice
    }
  }
  return null;
}

function groundPersonaReply(raw: string, request: PersonaChatRequest): PersonaDraft | null {
  const parsed = parseModelJson(raw);
  if (!parsed) return null;
  const text = typeof parsed.message === 'string' ? parsed.message.trim() : '';
  if (!text) return null;
  const aliases = anchorAliases(request);
  const byKey = new Map<string, (typeof aliases)[number]>();
  for (const anchor of aliases) {
    byKey.set(anchor.alias, anchor);
    byKey.set(anchor.id, anchor);
  }
  const ids = Array.isArray(parsed.citationIds) ? parsed.citationIds.filter((id): id is string => typeof id === 'string') : [];
  const citations = ids
    .map((id) => byKey.get(id))
    .filter((anchor): anchor is (typeof aliases)[number] => Boolean(anchor))
    .map((anchor) => ({ id: anchor.id, name: anchor.name, affinity: anchor.affinity }));
  if (!citations.length) return null;
  const message = capPersonaMessage(text);
  if (!citations.some((citation) => message.includes(citation.name))) return null;
  return { source: 'llm', message, citations };
}

const PERSONA_OPTIONS = { maxTokens: PERSONA_MAX_TOKENS, timeoutMs: PERSONA_TIMEOUT_MS, temperature: PERSONA_TEMPERATURE };

async function inThai(llm: LlmClient, request: PersonaChatRequest, current: PersonaDraft): Promise<PersonaDraft> {
  if (!asksInThai(readable(request.message) || request.message) || hasThai(current.message)) return current;
  try {
    const raw = await llm.complete(
      messagesFor(request, [
        { role: 'assistant', content: current.message },
        { role: 'user', content: thaiNudge(request) },
      ]),
      PERSONA_OPTIONS,
    );
    const retry = groundPersonaReply(raw, request);
    if (retry && hasThai(retry.message) && !replyProblem(retry.message, request)) return retry;
  } catch {
    // The Thai retry failed. Keep the model reply instead of a template.
  }
  return current;
}

export async function draftPersonaReply(llm: LlmClient, request: PersonaChatRequest): Promise<PersonaDraft> {
  // A recorded run (zero Qloo calls) still uses the model. Templates are only for an unavailable model.
  if (llm.mode !== 'live') return freshTemplate(request);
  try {
    const firstRaw = await llm.complete(messagesFor(request), PERSONA_OPTIONS);
    const first = groundPersonaReply(firstRaw, request);
    if (!first) return { ...freshTemplate(request), warning: GROUNDED_WARNING };
    const problem = replyProblem(first.message, request);
    if (!problem) return inThai(llm, request, first);
    try {
      const secondRaw = await llm.complete(
        messagesFor(request, [
          { role: 'assistant', content: first.message },
          { role: 'user', content: nudge(problem, request) },
        ]),
        PERSONA_OPTIONS,
      );
      const second = groundPersonaReply(secondRaw, request);
      if (second && !replyProblem(second.message, request)) return inThai(llm, request, second);
    } catch {
      // The retry failed. A Thai question still gets one Thai attempt before the template.
    }
    const thai = await inThai(llm, request, first);
    if (thai !== first && !replyProblem(thai.message, request)) return thai;
    return {
      ...freshTemplate(request),
      warning: problem === 'repeat' ? REPEAT_WARNING : PERSPECTIVE_WARNING,
    };
  } catch {
    return { ...freshTemplate(request), warning: UNAVAILABLE_WARNING };
  }
}

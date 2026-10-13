/**
 * Persona chat drafting.
 * A live model may speak only from this persona's Qloo anchors.
 * Anything else, including a timeout, becomes the template.
 */
import type { PersonaChatRequest, PersonaChatResult } from '@tastedraft/contracts';
import { PERSONA_MAX_TOKENS, PERSONA_TIMEOUT_MS, type LlmClient } from './client.ts';

export const PERSONA_LABEL = 'Simulated persona response';
export const PERSONA_MAX_CHARS = 480;

type Citation = PersonaChatResult['citations'][number];

export interface PersonaDraft {
  source: 'llm' | 'template';
  message: string;
  citations: Citation[];
  warning?: string;
}

export function templatePersona(request: PersonaChatRequest): PersonaDraft {
  const anchors = [...request.persona.anchors].sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1)).slice(0, 3);
  const cited = anchors.map((anchor) => {
    const affinity = anchor.affinity == null ? '' : `, affinity ${anchor.affinity.toFixed(2)}`;
    return `${anchor.name} (${anchor.id}${affinity})`;
  });
  const message = [
    `${PERSONA_LABEL}.`,
    `I'm ${request.persona.label} in ${request.persona.location}.`,
    `You asked: ${request.message.trim()}`,
    cited.length
      ? `I would answer from the Qloo anchors I actually have: ${cited.join('; ')}.`
      : 'I have no Qloo anchors, so I cannot ground an answer.',
    'Those anchors are the only evidence for this reply.',
  ].join(' ');
  return {
    source: 'template',
    message: capPersonaMessage(message),
    citations: anchors.map((anchor) => ({
      id: anchor.id,
      name: anchor.name,
      affinity: anchor.affinity ?? null,
    })),
  };
}

export function capPersonaMessage(text: string): string {
  const trimmed = text.trim();
  const labeled = trimmed.startsWith(PERSONA_LABEL) ? trimmed : `${PERSONA_LABEL}. ${trimmed}`;
  if (labeled.length <= PERSONA_MAX_CHARS) return labeled;
  const room = PERSONA_MAX_CHARS - 1;
  const slice = labeled.slice(0, room);
  const cut = slice.lastIndexOf(' ');
  const stem = (cut > PERSONA_LABEL.length + 2 ? slice.slice(0, cut) : slice).trimEnd();
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

export function groundPersonaReply(raw: string, request: PersonaChatRequest): PersonaDraft | null {
  const parsed = parseModelJson(raw);
  if (!parsed) return null;
  const text = typeof parsed.message === 'string' ? parsed.message.trim() : '';
  if (!text) return null;
  const ids = Array.isArray(parsed.citationIds) ? parsed.citationIds.filter((id): id is string => typeof id === 'string') : [];
  const known = new Map(request.persona.anchors.map((anchor) => [anchor.id, anchor]));
  const citations = ids.filter((id) => known.has(id)).map((id) => {
    const anchor = known.get(id)!;
    return { id, name: anchor.name, affinity: anchor.affinity ?? null };
  });
  if (!citations.length) return null;
  const message = capPersonaMessage(text);
  if (!citations.some((citation) => message.includes(citation.name))) return null;
  return { source: 'llm', message, citations };
}

export async function draftPersonaReply(llm: LlmClient, request: PersonaChatRequest): Promise<PersonaDraft> {
  const fallback = templatePersona(request);
  if (llm.mode !== 'live') return fallback;
  try {
    const raw = await llm.complete(
      [
        {
          role: 'system',
          content:
            'You speak as a simulated persona. Return JSON {"message":"...","citationIds":["..."]}. The message must start with "Simulated persona response." Cite only the provided Qloo anchor ids, and use those anchor names in the message. Do not invent entities, scores, or forecasts.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            persona: {
              label: request.persona.label,
              location: request.persona.location,
              age: request.persona.age ?? null,
              gender: request.persona.gender ?? null,
            },
            anchors: request.persona.anchors.map((anchor) => ({
              id: anchor.id,
              name: anchor.name,
              affinity: anchor.affinity ?? null,
            })),
            history: request.history ?? [],
            message: request.message,
          }),
        },
      ],
      { maxTokens: PERSONA_MAX_TOKENS, timeoutMs: PERSONA_TIMEOUT_MS },
    );
    const grounded = groundPersonaReply(raw, request);
    if (!grounded) {
      return {
        ...fallback,
        warning: 'The model reply was not grounded in this persona\'s Qloo anchors. The reply is the template fallback.',
      };
    }
    return grounded;
  } catch {
    return {
      ...fallback,
      warning: 'The language model was unavailable. The reply is the template fallback.',
    };
  }
}

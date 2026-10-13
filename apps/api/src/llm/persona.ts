/**
 * Persona chat drafting.
 * A live model may speak only from this persona's Qloo anchors.
 * Anything else, including a timeout, becomes the template.
 */
import { stripEntityIds, type PersonaChatRequest, type PersonaChatResult } from '@tastedraft/contracts';
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

function readable(value: string): string {
  return stripEntityIds(value).replace(/^simulated persona response\.?\s*/i, '').trim();
}

export function templatePersona(request: PersonaChatRequest): PersonaDraft {
  const anchors = [...request.persona.anchors].sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1)).slice(0, 3);
  const cited = anchors.map((anchor) => {
    const name = readable(anchor.name) || 'that reference';
    return anchor.affinity == null ? name : `${name}, affinity ${anchor.affinity.toFixed(2)}`;
  });
  const message = [
    `I'm ${readable(request.persona.label) || 'a simulated customer'} in ${readable(request.persona.location) || 'this city'}.`,
    `You asked: ${readable(request.message)}`,
    cited.length
      ? `I would answer from what I already like: ${cited.join('; ')}.`
      : 'I have no anchors, so I cannot ground an answer.',
  ].join(' ');
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

function anchorAliases(request: PersonaChatRequest) {
  return request.persona.anchors.slice(0, 8).map((anchor, index) => ({
    alias: `a${index + 1}`,
    id: anchor.id,
    name: readable(anchor.name) || anchor.name,
    affinity: anchor.affinity ?? null,
  }));
}

export function groundPersonaReply(raw: string, request: PersonaChatRequest): PersonaDraft | null {
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

export async function draftPersonaReply(llm: LlmClient, request: PersonaChatRequest): Promise<PersonaDraft> {
  const fallback = templatePersona(request);
  if (llm.mode !== 'live') return fallback;
  try {
    const raw = await llm.complete(
      [
        {
          role: 'system',
          content:
            'You speak as a simulated customer. Return JSON {"message":"...","citationIds":["a1"]}. citationIds must be the alias values from the anchor list. Use those anchor names in the message. Do not include identifiers, and do not invent entities or forecasts.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            persona: {
              label: readable(request.persona.label),
              location: readable(request.persona.location),
              age: request.persona.age ?? null,
              gender: request.persona.gender ?? null,
            },
            anchors: anchorAliases(request).map((anchor) => ({
              alias: anchor.alias,
              name: anchor.name,
              affinity: anchor.affinity,
            })),
            history: (request.history ?? []).map((turn) => ({
              role: turn.role,
              content: readable(turn.content),
            })),
            message: readable(request.message),
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

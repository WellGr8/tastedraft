/**
 * One short live persona reply. Prints a redacted summary only.
 * Refuses to run without LLM_API_KEY. Never prints the key.
 */
import '../src/load-env.ts';
import { createLlmClient, OPENROUTER_FALLBACK_MODEL, OPENROUTER_MODEL, redactSecrets } from '../src/llm/client.ts';
import { draftPersonaReply, PERSONA_LABEL } from '../src/llm/persona.ts';

const anchorId = 'billie-eilish';
const llm = createLlmClient();
if (llm.mode !== 'live') {
  console.error('LLM_API_KEY is not set');
  process.exit(1);
}

const draft = await draftPersonaReply(llm, {
  persona: {
    id: 'tokyo-fan',
    label: 'Tokyo fan',
    location: 'Tokyo',
    age: '24_and_younger',
    anchors: [{ id: anchorId, name: 'Billie Eilish', type: 'artist', affinity: 0.72 }],
  },
  message: 'Would you see this show?',
});

const message = redactSecrets(draft.message);
const labeled = message.startsWith(PERSONA_LABEL);
const cites = draft.citations.some((citation) => citation.id === anchorId && citation.name === 'Billie Eilish');
const named = message.includes('Billie Eilish');
const report = {
  provider: llm.provider ?? 'offline',
  model: process.env.LLM_MODEL?.trim() || OPENROUTER_MODEL,
  fallback: process.env.LLM_FALLBACK_MODEL?.trim() || OPENROUTER_FALLBACK_MODEL,
  source: draft.source,
  labeled,
  citesAnchor: cites && named,
  chars: message.length,
  warning: draft.warning ? redactSecrets(draft.warning) : '',
  preview: message.slice(0, 220),
};
console.log(JSON.stringify(report));
if (draft.source !== 'llm' || !labeled || !cites || !named) process.exit(1);

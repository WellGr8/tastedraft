import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createLlmClient,
  OPENROUTER_FALLBACK_MODEL,
  OPENROUTER_MODEL,
  PERSONA_MAX_TOKENS,
  PERSONA_TIMEOUT_MS,
  redactSecrets,
  resolveLlmProvider,
} from './client.ts';
import { capPersonaMessage, draftPersonaReply, PERSONA_LABEL, PERSONA_MAX_CHARS } from './persona.ts';
import type { PersonaChatRequest } from '@tastedraft/contracts';

const ANCHOR = '11111111-1111-1111-1111-111111111111';

function request(): PersonaChatRequest {
  return {
    persona: {
      id: 'p1',
      label: 'Fans',
      location: 'Tokyo',
      anchors: [{ id: ANCHOR, name: 'Billie Eilish', type: 'artist', affinity: 0.72 }],
    },
    message: 'Would you go to this show?',
  };
}

describe('LLM providers', () => {
  it('defaults to OpenRouter and still accepts the other providers', () => {
    assert.equal(resolveLlmProvider({}), 'openrouter');
    assert.equal(resolveLlmProvider({ LLM_PROVIDER: 'openrouter' }), 'openrouter');
    assert.equal(resolveLlmProvider({ LLM_PROVIDER: 'grok' }), 'xai');
    assert.equal(resolveLlmProvider({ LLM_PROVIDER: 'OpenAI' }), 'openai');
    assert.equal(resolveLlmProvider({ LLM_BASE_URL: 'https://api.anthropic.com' }), 'anthropic');
    assert.equal(resolveLlmProvider({ LLM_BASE_URL: 'https://api.openai.com/v1' }), 'openai');
    assert.throws(() => resolveLlmProvider({ LLM_PROVIDER: 'local' }), /openrouter/);
  });

  it('posts OpenRouter chat completions with a cheap model and a cheaper fallback', async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      seen.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    };
    const llm = createLlmClient({ LLM_API_KEY: 'sk-or-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, fetchImpl);
    assert.equal(llm.provider, 'openrouter');
    assert.equal(await llm.complete([{ role: 'user', content: 'hi' }], { maxTokens: PERSONA_MAX_TOKENS, timeoutMs: PERSONA_TIMEOUT_MS }), '{"ok":true}');
    assert.equal(seen[0]?.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(seen[0]?.body.model, OPENROUTER_MODEL);
    assert.deepEqual(seen[0]?.body.models, [OPENROUTER_MODEL, OPENROUTER_FALLBACK_MODEL]);
    assert.equal(seen[0]?.body.max_tokens, PERSONA_MAX_TOKENS);
    assert.equal(seen[0]?.headers['X-Title'], 'TasteDraft');
    assert.match(seen[0]?.headers.Authorization ?? '', /^Bearer sk-or-v1-/);
    assert.doesNotMatch(JSON.stringify(seen[0]?.body), /sk-or-v1-/);
    assert.equal(redactSecrets('failed sk-or-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'failed [redacted]');
    assert.equal(redactSecrets('{"user_id":"user_example"}'), '{"user_id":"[redacted]"}');
  });

  it('posts OpenAI and xAI chat completions and Anthropic messages without putting the key in the body', async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const headers = init?.headers as Record<string, string>;
      seen.push({ url: String(url), headers, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      if (String(url).includes('anthropic')) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    };

    const openai = createLlmClient({ LLM_PROVIDER: 'openai', LLM_API_KEY: 'sk-testkeyvalue1234', LLM_MODEL: 'gpt-test' }, fetchImpl);
    assert.equal(await openai.complete([{ role: 'user', content: 'hi' }], { maxTokens: 40, timeoutMs: 1000 }), '{"ok":true}');

    const xai = createLlmClient({ LLM_PROVIDER: 'xai', LLM_API_KEY: 'xai-testkeyvalue1234' }, fetchImpl);
    assert.equal(await xai.complete([{ role: 'user', content: 'hi' }]), '{"ok":true}');

    const anthropic = createLlmClient({
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: 'sk-ant-testkeyvalue1234',
      LLM_MODEL: 'claude-test',
    }, fetchImpl);
    assert.equal(await anthropic.complete([
      { role: 'system', content: 'json only' },
      { role: 'user', content: 'hi' },
    ], { maxTokens: PERSONA_MAX_TOKENS, timeoutMs: PERSONA_TIMEOUT_MS }), '{"ok":true}');

    assert.equal(seen[0]?.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(seen[0]?.headers.Authorization, 'Bearer sk-testkeyvalue1234');
    assert.equal(seen[0]?.body.max_tokens, 40);
    assert.equal(seen[0]?.body.model, 'gpt-test');
    assert.doesNotMatch(JSON.stringify(seen[0]?.body), /sk-testkeyvalue1234/);

    assert.equal(seen[1]?.url, 'https://api.x.ai/v1/chat/completions');
    assert.equal(seen[1]?.body.model, 'grok-3');
    assert.equal(seen[1]?.headers.Authorization, 'Bearer xai-testkeyvalue1234');

    assert.equal(seen[2]?.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(seen[2]?.headers['x-api-key'], 'sk-ant-testkeyvalue1234');
    assert.equal(seen[2]?.headers['anthropic-version'], '2023-06-01');
    assert.equal(seen[2]?.body.model, 'claude-test');
    assert.equal(seen[2]?.body.max_tokens, PERSONA_MAX_TOKENS);
    assert.equal(seen[2]?.body.system, 'json only');
    assert.equal((seen[2]?.body.messages as Array<{ role: string }>).some((message) => message.role === 'system'), false);
    assert.doesNotMatch(JSON.stringify(seen[2]?.body), /sk-ant-testkeyvalue1234/);
  });

  it('aborts when the provider exceeds the timeout and the persona draft uses the template', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      await new Promise<void>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 500);
        const fail = () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
        };
        if (init?.signal?.aborted) fail();
        else init?.signal?.addEventListener('abort', fail, { once: true });
      });
      return new Response('');
    };
    const llm = createLlmClient({ LLM_PROVIDER: 'openrouter', LLM_API_KEY: 'sk-or-v1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }, fetchImpl);
    await assert.rejects(() => llm.complete([{ role: 'user', content: 'hi' }], { timeoutMs: 40 }), /timeout|aborted/i);
    const draft = await draftPersonaReply({
      mode: 'live',
      async complete() {
        throw new Error('timeout');
      },
    }, request());
    assert.equal(draft.source, 'template');
    assert.match(draft.message, new RegExp(`^${PERSONA_LABEL}`));
    assert.match(draft.message, /Billie Eilish/);
    assert.match(draft.warning ?? '', /unavailable/);
  });
});

describe('persona grounding', () => {
  it('keeps a short reply that names a real anchor and drops invented citations', async () => {
    const llm = {
      mode: 'live' as const,
      provider: 'openai' as const,
      async complete() {
        return JSON.stringify({
          message: 'Simulated persona response. I would go because Billie Eilish is already my taste.',
          citationIds: [ANCHOR, 'not-a-real-anchor'],
        });
      },
    };
    const draft = await draftPersonaReply(llm, request());
    assert.equal(draft.source, 'llm');
    assert.equal(draft.citations.length, 1);
    assert.equal(draft.citations[0]?.id, ANCHOR);
    assert.match(draft.message, new RegExp(`^${PERSONA_LABEL}`));
  });

  it('accepts JSON wrapped in a fence', async () => {
    const llm = {
      mode: 'live' as const,
      async complete() {
        return '```json\n{"message":"Simulated persona response. Billie Eilish is the reason I would go.","citationIds":["' + ANCHOR + '"]}\n```';
      },
    };
    const draft = await draftPersonaReply(llm, request());
    assert.equal(draft.source, 'llm');
    assert.match(draft.message, /^Simulated persona response/);
    assert.equal(draft.citations[0]?.name, 'Billie Eilish');
  });

  it('uses the template when the model invents an entity or omits the anchor name', async () => {
    const invented = {
      mode: 'live' as const,
      async complete() {
        return JSON.stringify({
          message: 'Simulated persona response. I only listen to Made Up Artist.',
          citationIds: ['made-up'],
        });
      },
    };
    const unnamed = {
      mode: 'live' as const,
      async complete() {
        return JSON.stringify({
          message: 'Simulated persona response. Sure, I would go.',
          citationIds: [ANCHOR],
        });
      },
    };
    for (const llm of [invented, unnamed]) {
      const draft = await draftPersonaReply(llm, request());
      assert.equal(draft.source, 'template');
      assert.match(draft.message, new RegExp(ANCHOR));
      assert.match(draft.warning ?? '', /grounded/);
    }
  });

  it('caps a long grounded reply', () => {
    const long = `${PERSONA_LABEL}. ${'Billie Eilish '.repeat(80)}`;
    const capped = capPersonaMessage(long);
    assert.ok(capped.length <= PERSONA_MAX_CHARS);
    assert.match(capped, new RegExp(`^${PERSONA_LABEL}`));
    assert.match(capped, /…$/);
  });
});

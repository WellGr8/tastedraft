import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chatCompletionsUrl,
  createLlmClient,
  OPENROUTER_FALLBACK_MODEL,
  OPENROUTER_MODEL,
  PERSONA_MAX_TOKENS,
  PERSONA_TIMEOUT_MS,
  redactSecrets,
  resolveLlmProvider,
} from './client.ts';
import { capPersonaMessage, draftPersonaReply, PERSONA_MAX_CHARS, PERSONA_TEMPERATURE, templatePersona } from './persona.ts';
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

  it('posts OpenRouter at LLM_BASE_URL and retries without JSON mode after a 400', async () => {
    const seen: string[] = [];
    let calls = 0;
    const fetchImpl: typeof fetch = async (url) => {
      seen.push(String(url));
      calls += 1;
      if (calls === 1) return new Response('{"error":"json"}', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    };
    const llm = createLlmClient(
      {
        LLM_PROVIDER: 'openrouter',
        LLM_BASE_URL: 'https://openrouter.example/api/v1/chat/completions',
        LLM_API_KEY: ('sk-or-v1-' + 'c'.repeat(64)),
      },
      fetchImpl,
    );
    assert.equal(chatCompletionsUrl('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(chatCompletionsUrl('https://openrouter.example/api/v1/chat/completions'), 'https://openrouter.example/api/v1/chat/completions');
    assert.equal(await llm.complete([{ role: 'user', content: 'hi' }]), '{"ok":true}');
    assert.deepEqual(seen, [
      'https://openrouter.example/api/v1/chat/completions',
      'https://openrouter.example/api/v1/chat/completions',
    ]);
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
    const llm = createLlmClient({ LLM_API_KEY: ('sk-or-v1-' + 'a'.repeat(64)) }, fetchImpl);
    assert.equal(llm.provider, 'openrouter');
    assert.equal(await llm.complete([{ role: 'user', content: 'hi' }], { maxTokens: PERSONA_MAX_TOKENS, timeoutMs: PERSONA_TIMEOUT_MS }), '{"ok":true}');
    assert.equal(seen[0]?.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(seen[0]?.body.model, OPENROUTER_MODEL);
    assert.deepEqual(seen[0]?.body.models, [OPENROUTER_MODEL, OPENROUTER_FALLBACK_MODEL]);
    assert.equal(seen[0]?.body.max_tokens, PERSONA_MAX_TOKENS);
    assert.equal(seen[0]?.body.temperature, 0);
    assert.equal(seen[0]?.headers['X-Title'], 'TasteDraft');
    assert.match(seen[0]?.headers.Authorization ?? '', /^Bearer sk-or-v1-/);
    assert.doesNotMatch(JSON.stringify(seen[0]?.body), /sk-or-v1-/);
    assert.equal(redactSecrets(`failed sk-or-v1-${'a'.repeat(64)}`), 'failed [redacted]');
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
    assert.equal(seen[2]?.body.temperature, 0);
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
    const llm = createLlmClient({ LLM_PROVIDER: 'openrouter', LLM_API_KEY: ('sk-or-v1-' + 'b'.repeat(64)) }, fetchImpl);
    await assert.rejects(() => llm.complete([{ role: 'user', content: 'hi' }], { timeoutMs: 40 }), /timeout|aborted/i);
    const draft = await draftPersonaReply({
      mode: 'live',
      async complete() {
        throw new Error('timeout');
      },
    }, request());
    assert.equal(draft.source, 'template');
    assert.doesNotMatch(draft.message, /Simulated persona response/);
    assert.doesNotMatch(draft.message, new RegExp(ANCHOR, 'i'));
    assert.match(draft.message, /Billie Eilish/);
    assert.match(draft.warning ?? '', /unavailable/);
  });
});

describe('persona grounding', () => {
  it('accepts an alias citation and keeps raw ids out of the prompt', async () => {
    let prompt = '';
    const llm = {
      mode: 'live' as const,
      async complete(messages: Array<{ content: string }>) {
        prompt = messages.map((message) => message.content).join('\n');
        return JSON.stringify({
          message: 'I would go because Billie Eilish is already my taste.',
          citationIds: ['a1'],
        });
      },
    };
    const draft = await draftPersonaReply(llm, request());
    assert.equal(draft.source, 'llm');
    assert.equal(draft.citations[0]?.id, ANCHOR);
    assert.doesNotMatch(prompt, new RegExp(ANCHOR, 'i'));
    assert.doesNotMatch(draft.message, /Simulated persona response/);
  });

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
    assert.match(draft.message, /Billie Eilish/);
    assert.doesNotMatch(draft.message, /Simulated persona response/);
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
    assert.match(draft.message, /Billie Eilish/);
    assert.doesNotMatch(draft.message, /[0-9a-f]{8}-[0-9a-f]{4}-/i);
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
      assert.match(draft.message, /Billie Eilish/);
      assert.doesNotMatch(draft.message, new RegExp(ANCHOR, 'i'));
      assert.match(draft.warning ?? '', /grounded/);
    }
  });

  it('caps a long grounded reply', () => {
    const long = `${'Billie Eilish '.repeat(80)}`;
    const capped = capPersonaMessage(long);
    assert.ok(capped.length <= PERSONA_MAX_CHARS);
    assert.doesNotMatch(capped, /Simulated persona response/);
    assert.match(capped, /…$/);
  });

  it('varies the template by question, in the first person', () => {
    const base = request();
    const replies = [
      templatePersona({ ...base, message: 'why?' }),
      templatePersona({ ...base, message: 'Is the price too high?' }),
      templatePersona({ ...base, message: 'Where would you look?' }),
      templatePersona({ ...base, message: 'What would change your mind?' }),
      templatePersona({ ...base, message: "maybe it's your style?" }),
    ].map((draft) => draft.message);
    assert.equal(new Set(replies).size, replies.length);
    for (const message of replies) {
      assert.match(message, /Billie Eilish/);
      assert.match(message, /\bI\b|\bmy\b/i);
      assert.doesNotMatch(message, /Simulated persona response/);
      assert.doesNotMatch(message, /your preferred style/i);
      assert.doesNotMatch(message, /\byou'd\b/i);
      assert.doesNotMatch(message, new RegExp(ANCHOR, 'i'));
    }
    assert.match(replies[0] ?? '', /because/i);
    assert.match(replies[1] ?? '', /price/i);
    assert.match(replies[2] ?? '', /Tokyo/);
    assert.match(replies[3] ?? '', /change my mind/i);
    assert.match(replies[4] ?? '', /would go/i);
  });
});

describe('persona conversation', () => {
  const opening = 'Not for me. I would walk past. Billie Eilish is the taste, and this is not.';
  const go = 'I would not go. Billie Eilish is the taste I keep, and this show is not it.';
  const why = 'I walk past because Billie Eilish is what I already choose, and this show is not that.';
  const style = 'My style is Billie Eilish. This show belongs to someone else.';
  const mind = 'A version next to Billie Eilish would change my mind. This one does not.';

  function chatContext(): PersonaChatRequest['context'] {
    return {
      idea: 'An indie artist launching a Tokyo tour',
      verdict: 'Would pass',
      frictions: ['Premium price'],
    };
  }

  it('sends full history as turns at temperature 0.8 and retries a repeated reply', async () => {
    const questions = ['Would you go to this show?', 'why?', "maybe it's your style?", 'What would change your mind?'];
    const queue = [go, go, why, style, mind];
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const message = queue.shift() ?? mind;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ message, citationIds: ['a1'] }) } }],
      }), { status: 200 });
    };
    const llm = createLlmClient({
      LLM_API_KEY: ('sk-or-v1-' + 'd'.repeat(64)),
    }, fetchImpl);
    const history: NonNullable<PersonaChatRequest['history']> = [{ role: 'persona', content: opening }];
    const answers: string[] = [];
    for (const question of questions) {
      const draft = await draftPersonaReply(llm, {
        ...request(),
        message: question,
        history: history.slice(-8),
        context: chatContext(),
      });
      assert.equal(draft.source, 'llm');
      assert.match(draft.message, /Billie Eilish/);
      assert.doesNotMatch(draft.message, /\byou'd\b|your preferred style/i);
      answers.push(draft.message);
      history.push({ role: 'user', content: question });
      history.push({ role: 'persona', content: draft.message });
    }

    assert.equal(bodies.length, 5);
    assert.deepEqual(answers, [go, why, style, mind]);
    assert.equal(new Set(answers).size, 4);
    for (const body of bodies) assert.equal(body.temperature, PERSONA_TEMPERATURE);

    const turns = (body: Record<string, unknown>) => body.messages as Array<{ role: string; content: string }>;
    const first = turns(bodies[0]!);
    assert.equal(first[0]?.role, 'system');
    assert.match(first[0]?.content ?? '', /You ARE/);
    assert.match(first[0]?.content ?? '', /first person/i);
    assert.match(first[0]?.content ?? '', /Billie Eilish/);
    assert.match(first[0]?.content ?? '', /category artist/);
    assert.match(first[0]?.content ?? '', /affinity 0\.72/);
    assert.match(first[0]?.content ?? '', /Tokyo tour/);
    assert.match(first[0]?.content ?? '', /Would pass/);
    assert.match(first[0]?.content ?? '', /Premium price/);
    assert.match(first[0]?.content ?? '', /Never repeat a previous reply verbatim/);
    assert.equal(first[1]?.role, 'assistant');
    assert.equal(first[1]?.content, opening);
    assert.equal(first.at(-1)?.role, 'user');
    assert.equal(first.at(-1)?.content, questions[0]);
    assert.doesNotMatch(JSON.stringify(first), /"history"/);
    assert.doesNotMatch(JSON.stringify(first), new RegExp(ANCHOR, 'i'));

    const repeated = turns(bodies[1]!);
    assert.equal(repeated.at(-1)?.content, 'why?');
    assert.ok(repeated.some((message) => message.role === 'assistant' && message.content === go));
    const retry = turns(bodies[2]!);
    assert.match(retry.at(-1)?.content ?? '', /repeats a previous reply/i);
    assert.match(retry.at(-1)?.content ?? '', /first person/i);
    assert.equal(retry.filter((message) => message.role === 'assistant').at(-1)?.content, go);

    const last = turns(bodies[4]!);
    assert.equal(last[0]?.role, 'system');
    assert.equal(last.at(-1)?.content, 'What would change your mind?');
    assert.ok(last.some((message) => message.role === 'user' && message.content === 'why?'));
    assert.ok(last.some((message) => message.role === 'user' && message.content === "maybe it's your style?"));
    assert.doesNotMatch(JSON.stringify(last), /"history"/);
  });

  it('retries once when the reply talks to the interviewer as the persona', async () => {
    const bad = "I'm not sure why you'd walk past Billie Eilish. They seem to be your preferred style.";
    const good = 'I walk past because Billie Eilish is my taste and this show is not.';
    const seen: string[] = [];
    let calls = 0;
    const llm = {
      mode: 'live' as const,
      async complete(messages: Array<{ content: string }>) {
        calls += 1;
        seen.push(messages[messages.length - 1]?.content ?? '');
        const message = calls === 1 ? bad : good;
        return JSON.stringify({ message, citationIds: ['a1'] });
      },
    };
    const draft = await draftPersonaReply(llm, {
      ...request(),
      message: 'why?',
      history: [{ role: 'persona', content: opening }],
    });
    assert.equal(calls, 2);
    assert.match(seen[1] ?? '', /interviewer/i);
    assert.equal(draft.source, 'llm');
    assert.equal(draft.message, good);
  });

  it('tells a red-team persona to argue against the idea', async () => {
    let system = '';
    const llm = {
      mode: 'live' as const,
      async complete(messages: Array<{ role: string; content: string }>) {
        system = messages.find((message) => message.role === 'system')?.content ?? '';
        return JSON.stringify({
          message: 'I would argue against it because Billie Eilish is the taste this misses.',
          citationIds: ['a1'],
        });
      },
    };
    const draft = await draftPersonaReply(llm, {
      ...request(),
      message: 'why?',
      context: { idea: 'A Tokyo tour', verdict: 'Argues against this idea', stance: 'red-team', frictions: ['Premium price'] },
    });
    assert.match(system, /red team/i);
    assert.match(system, /Argue against/);
    assert.match(system, /Premium price/);
    assert.equal(draft.source, 'llm');
  });

  it('uses a different template when the retry still repeats', async () => {
    const llm = {
      mode: 'live' as const,
      async complete() {
        return JSON.stringify({ message: go, citationIds: ['a1'] });
      },
    };
    const draft = await draftPersonaReply(llm, {
      ...request(),
      message: 'why?',
      history: [{ role: 'persona', content: go }],
    });
    assert.equal(draft.source, 'template');
    assert.match(draft.warning ?? '', /repeated/);
    assert.notEqual(draft.message, go);
    assert.match(draft.message, /Billie Eilish/);
    assert.match(draft.message, /because/i);
    assert.doesNotMatch(draft.message, /\byou'd\b|your preferred style/i);
  });

  it('answers why, a change, price, and where in a new sentence, including Thai', () => {
    const history: NonNullable<PersonaChatRequest['history']> = [];
    const questions = ['why?', 'what if we add a late show?', 'Is the price too high?', 'Where would you look?', 'แล้วถ้าเราเพิ่มมาละ', 'ทำไมไม่สนใจ', 'why?'];
    const messages: string[] = [];
    for (const message of questions) {
      const draft = templatePersona({ ...request(), message, ...(history.length ? { history } : {}) });
      messages.push(draft.message);
      history.push({ role: 'user', content: message }, { role: 'persona', content: draft.message });
    }
    assert.equal(new Set(messages).size, messages.length);
    assert.match(messages[0] ?? '', /because/i);
    assert.match(messages[1] ?? '', /added/i);
    assert.match(messages[2] ?? '', /price/i);
    assert.match(messages[3] ?? '', /Tokyo/);
    assert.match(messages[4] ?? '', /Billie Eilish/);
    assert.match(messages[4] ?? '', /[\u0E00-\u0E7F]/);
    assert.match(messages[5] ?? '', /[\u0E00-\u0E7F]/);
    assert.doesNotMatch(messages[4] ?? '', /Billiei|บิลลี/i);
  });

  it('retries a Thai question answered in English and keeps the model reply if the retry is not grounded', async () => {
    const english = 'I would not go because Billie Eilish is already my taste.';
    const thai = 'ฉันไม่ไปเพราะ Billie Eilish คือรสนิยมของฉัน';
    let calls = 0;
    const llm = {
      mode: 'live' as const,
      async complete(messages: Array<{ content: string }>) {
        calls += 1;
        const last = messages.at(-1)?.content ?? '';
        if (calls === 1) {
          assert.match(last, /ทำไมไม่สนใจ/);
          return JSON.stringify({ message: english, citationIds: ['a1'] });
        }
        assert.match(last, /Thai/);
        return JSON.stringify({ message: thai, citationIds: ['a1'] });
      },
    };
    const draft = await draftPersonaReply(llm, { ...request(), message: 'ทำไมไม่สนใจ' });
    assert.equal(calls, 2);
    assert.equal(draft.source, 'llm');
    assert.match(draft.message, /[\u0E00-\u0E7F]/);
    assert.match(draft.message, /Billie Eilish/);
  });

  it('keeps the English model reply when the Thai retry is not grounded', async () => {
    const english = 'I would not go because Billie Eilish is already my taste.';
    let calls = 0;
    const llm = {
      mode: 'live' as const,
      async complete() {
        calls += 1;
        if (calls === 1) return JSON.stringify({ message: english, citationIds: ['a1'] });
        return JSON.stringify({ message: 'Sure.', citationIds: ['missing'] });
      },
    };
    const draft = await draftPersonaReply(llm, { ...request(), message: 'ทำไมไม่สนใจ' });
    assert.equal(calls, 2);
    assert.equal(draft.source, 'llm');
    assert.equal(draft.message, english);
  });

  it('calls the live model for a recorded persona whose affinity was never measured', async () => {
    let calls = 0;
    let system = '';
    const llm = {
      mode: 'live' as const,
      async complete(messages: Array<{ role: string; content: string }>) {
        calls += 1;
        system = messages.find((message) => message.role === 'system')?.content ?? '';
        return JSON.stringify({
          message: 'ฉันไม่สนใจเพราะ Billie Eilish คือรสนิยมที่ฉันมีอยู่แล้ว',
          citationIds: ['a1'],
        });
      },
    };
    const draft = await draftPersonaReply(llm, {
      ...request(),
      message: 'ทำไมไม่สนใจ',
      persona: {
        ...request().persona,
        anchors: [{ id: ANCHOR, name: 'Billie Eilish', type: 'artist', affinity: null }],
      },
    });
    assert.equal(calls, 1);
    assert.equal(draft.source, 'llm');
    assert.match(draft.message, /Billie Eilish/);
    assert.match(draft.message, /[\u0E00-\u0E7F]/);
    assert.match(system, /same language/i);
    assert.match(system, /Do not translate entity names/);
    assert.match(system, /zero Qloo calls/);
  });
});

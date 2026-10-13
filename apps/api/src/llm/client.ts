import { LlmTransportError } from './errors.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompleteOptions {
  /** Upper bound sent to the provider. Persona chat uses a short cap. */
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LlmClient {
  readonly mode: 'live' | 'offline';
  /** Set by createLlmClient. Test doubles may omit it. */
  readonly provider?: LlmProviderName | 'offline';
  complete(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<string>;
}

export const LLM_PROVIDERS = ['openrouter', 'openai', 'xai', 'anthropic'] as const;
export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

/** Cheap and fast. Gemini 2.0 Flash no longer has OpenRouter endpoints. */
export const OPENROUTER_MODEL = 'google/gemini-2.5-flash-lite';
/** Cheaper prompt price if the primary model is down. */
export const OPENROUTER_FALLBACK_MODEL = 'meta-llama/llama-3.2-3b-instruct';

export const PERSONA_MAX_TOKENS = 120;
export const PERSONA_TIMEOUT_MS = 8_000;

export interface LlmCallOptions {
  client?: LlmClient;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULTS: Record<LlmProviderName, { baseUrl: string; model: string }> = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: OPENROUTER_MODEL },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  xai: { baseUrl: 'https://api.x.ai/v1', model: 'grok-3' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest' },
};

export function resolveLlmProvider(env: Record<string, string | undefined>): LlmProviderName {
  const raw = env.LLM_PROVIDER?.trim().toLowerCase() ?? '';
  if (raw === 'openrouter') return 'openrouter';
  if (raw === 'grok' || raw === 'xai') return 'xai';
  if (raw === 'openai') return 'openai';
  if (raw === 'anthropic') return 'anthropic';
  if (raw) throw new LlmTransportError('LLM_PROVIDER must be openrouter, xai, openai, or anthropic');
  const base = env.LLM_BASE_URL?.trim().toLowerCase() ?? '';
  if (base.includes('openrouter.ai')) return 'openrouter';
  if (base.includes('api.x.ai')) return 'xai';
  if (base.includes('anthropic.com')) return 'anthropic';
  if (base.includes('api.openai.com')) return 'openai';
  return 'openrouter';
}

export function fallbackModel(env: Record<string, string | undefined>, provider: LlmProviderName, model: string): string | null {
  if (provider !== 'openrouter') return null;
  if (env.LLM_FALLBACK_MODEL === undefined) {
    return OPENROUTER_FALLBACK_MODEL === model ? null : OPENROUTER_FALLBACK_MODEL;
  }
  const trimmed = env.LLM_FALLBACK_MODEL.trim();
  if (!trimmed || trimmed === model) return null;
  return trimmed;
}

export function redactSecrets(text: string): string {
  return text
    .replace(/hack_[a-z0-9]+/gi, '[redacted]')
    .replace(/\bsk-or-v1-[a-z0-9]+\b/gi, '[redacted]')
    .replace(/"user_id"\s*:\s*"[^"]*"/g, '"user_id":"[redacted]"')
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/\bxai-[a-z0-9_-]{8,}\b/gi, '[redacted]');
}

export function describeLlm(env: Record<string, string | undefined> = process.env): { mode: 'live' | 'offline'; provider: LlmProviderName | 'offline' } {
  const apiKey = env.LLM_API_KEY?.trim() ?? '';
  if (!apiKey) return { mode: 'offline', provider: 'offline' };
  try {
    return { mode: 'live', provider: resolveLlmProvider(env) };
  } catch {
    return { mode: 'offline', provider: 'offline' };
  }
}

export function createLlmClient(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): LlmClient {
  const apiKey = env.LLM_API_KEY?.trim() ?? '';
  if (!apiKey) {
    return {
      mode: 'offline',
      provider: 'offline',
      async complete() {
        throw new LlmTransportError('LLM_API_KEY is not set');
      },
    };
  }

  const provider = resolveLlmProvider(env);
  const defaults = DEFAULTS[provider];
  const baseUrl = (env.LLM_BASE_URL?.trim() || defaults.baseUrl).replace(/\/+$/, '');
  const model = env.LLM_MODEL?.trim() || defaults.model;
  const fallback = fallbackModel(env, provider, model);

  return {
    mode: 'live',
    provider,
    async complete(messages, options) {
      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const maxTokens = options?.maxTokens;
      const response = provider === 'anthropic'
        ? await postAnthropic({ fetchImpl, baseUrl, apiKey, model, messages, maxTokens, timeoutMs })
        : await postChat({
            fetchImpl,
            baseUrl,
            apiKey,
            model,
            messages,
            maxTokens,
            timeoutMs,
            fallback,
            openRouter: provider === 'openrouter',
          });
      if (!response.ok) {
        const body = redactSecrets(await response.text()).slice(0, 180);
        throw new LlmTransportError(`LLM request failed (${response.status}): ${body}`);
      }
      const payload = (await response.json()) as unknown;
      const text = provider === 'anthropic' ? readAnthropic(payload) : readContent(chatContent(payload));
      if (!text.trim()) throw new LlmTransportError('LLM response was empty');
      return text;
    },
  };
}

async function postChat(input: {
  fetchImpl: typeof fetch;
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number | undefined;
  timeoutMs: number;
  fallback: string | null;
  openRouter: boolean;
}): Promise<Response> {
  const body: Record<string, unknown> = {
    model: input.model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: input.messages,
  };
  if (input.maxTokens != null) body.max_tokens = input.maxTokens;
  if (input.fallback) body.models = [input.model, input.fallback];
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (input.openRouter) headers['X-Title'] = 'TasteDraft';
  return input.fetchImpl(`${input.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
}

async function postAnthropic(input: {
  fetchImpl: typeof fetch;
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number | undefined;
  timeoutMs: number;
}): Promise<Response> {
  const system = input.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  const messages = input.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role, content: message.content }));
  return input.fetchImpl(`${input.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: input.maxTokens ?? 400,
      temperature: 0,
      ...(system ? { system } : {}),
      messages,
    }),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
}

function chatContent(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  return choices?.[0]?.message?.content;
}

function readAnthropic(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const content = (payload as { content?: unknown }).content;
  return readContent(content);
}

function readContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
        return (part as { text: string }).text;
      }
      return '';
    })
    .join('');
}

export function resolveClient(options?: LlmCallOptions): LlmClient {
  if (options?.client) return options.client;
  return createLlmClient(options?.env ?? process.env, options?.fetchImpl);
}

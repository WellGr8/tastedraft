import { LlmTransportError } from './errors.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmClient {
  readonly mode: 'live' | 'offline';
  complete(messages: ChatMessage[]): Promise<string>;
}

export interface LlmCallOptions {
  client?: LlmClient;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

export function createLlmClient(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): LlmClient {
  const apiKey = env.LLM_API_KEY?.trim() ?? '';
  const baseUrl = (env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = env.LLM_MODEL?.trim() || DEFAULT_MODEL;

  if (!apiKey) {
    return {
      mode: 'offline',
      async complete() {
        throw new LlmTransportError('LLM_API_KEY is not set');
      },
    };
  }

  return {
    mode: 'live',
    async complete(messages) {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new LlmTransportError(`LLM request failed (${response.status}): ${body.slice(0, 180)}`);
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      const text = readContent(content);
      if (!text.trim()) throw new LlmTransportError('LLM response was empty');
      return text;
    },
  };
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

export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface CreateChatCompletionOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

export interface LlmEnvironmentConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function errorMessageFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
  return undefined;
}

async function readResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export function resolveLlmEnvironmentConfig(overrides: Partial<LlmEnvironmentConfig> = {}): LlmEnvironmentConfig {
  const apiKey = overrides.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
  const model = overrides.model || process.env.LLM_MODEL || '';
  const baseUrl = overrides.baseUrl || process.env.LLM_BASE_URL || DEFAULT_BASE_URL;

  if (!apiKey) {
    throw new Error('Missing LLM API key. Set LLM_API_KEY or OPENAI_API_KEY.');
  }
  if (!model) {
    throw new Error('Missing LLM model. Set LLM_MODEL or pass --model.');
  }

  return { apiKey, model, baseUrl: trimTrailingSlash(baseUrl) };
}

export async function createChatCompletion(options: CreateChatCompletionOptions): Promise<string> {
  const config = resolveLlmEnvironmentConfig({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
  });
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const response = await fetchImpl(`${trimTrailingSlash(config.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
      ...(typeof options.maxTokens === 'number' ? { max_tokens: options.maxTokens } : {}),
    }),
  });

  const body = await readResponseJson(response);
  if (!response.ok) {
    const detail = errorMessageFromBody(body);
    throw new Error(`LLM request failed (${response.status}${detail ? `: ${detail}` : ''})`);
  }

  const content = (body as any)?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('LLM response did not include message content.');
  }

  return content.trim();
}

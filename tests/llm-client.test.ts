import { afterEach, describe, expect, it } from 'bun:test';
import { createChatCompletion, resolveLlmEnvironmentConfig } from '../scripts/lib/llm-client.ts';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('llm-client', () => {
  it('resolves config from explicit overrides and trims base URL', () => {
    const config = resolveLlmEnvironmentConfig({
      apiKey: 'key',
      model: 'model',
      baseUrl: 'https://llm.example/v1/',
    });

    expect(config).toEqual({
      apiKey: 'key',
      model: 'model',
      baseUrl: 'https://llm.example/v1',
    });
  });

  it('requires an API key and model', () => {
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_MODEL;

    expect(() => resolveLlmEnvironmentConfig({ model: 'model' })).toThrow('Missing LLM API key');
    expect(() => resolveLlmEnvironmentConfig({ apiKey: 'key' })).toThrow('Missing LLM model');
  });

  it('calls an OpenAI-compatible chat completions endpoint', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Generated description.' } }],
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const content = await createChatCompletion({
      apiKey: 'secret',
      model: 'test-model',
      baseUrl: 'https://llm.example/v1/',
      messages: [{ role: 'user', content: 'hello' }],
      fetchImpl,
    });

    expect(content).toBe('Generated description.');
    expect(calls[0].url).toBe('https://llm.example/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer secret');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    });
  });

  it('reports API errors with response details', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })) as unknown as typeof fetch;

    await expect(
      createChatCompletion({
        apiKey: 'secret',
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello' }],
        fetchImpl,
      })
    ).rejects.toThrow('LLM request failed (401: bad key)');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createGatewayClient, readGatewayConfig } from './gateway';
import type { GatewayMessage } from './gateway';

const config = { url: 'https://gateway.example', apiKey: 'unit-test-key', model: 'test-model' };
const messages: GatewayMessage[] = [{ role: 'user', content: 'Select the next tool.' }];
const reply = '{"tool":"retrieve_board","args":{}}';
const ok = () => new Response(JSON.stringify({ message: { role: 'assistant', content: reply }, done: true }));

function fakeClient(implementation: () => Promise<Response>, extra: { retries?: number; timeoutMs?: number } = {}) {
  const fetcher = vi.fn(implementation);
  const client = createGatewayClient(config, { protocol: 'strict_json', fetch: fetcher as typeof fetch, backoffMs: 0, ...extra });
  return { client, fetcher };
}

describe('organiser gateway (offline HTTP doubles)', () => {
  it('reads LLM_MODEL and requires all three server-side variables', () => {
    expect(readGatewayConfig({ LLM_GATEWAY_URL: config.url, LLM_GATEWAY_API_KEY: config.apiKey, LLM_MODEL: config.model })).toEqual(config);
    expect(() => readGatewayConfig({ LLM_GATEWAY_URL: config.url, LLM_GATEWAY_API_KEY: config.apiKey })).toThrow('GATEWAY_CONFIG_MISSING');
  });

  it.each(['', '/', '/api', '/api/', '/api/chat', '/api/chat/'])('normalizes endpoint suffix %s in explicit strict JSON mode', async (suffix) => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok());
    const client = createGatewayClient({ ...config, url: config.url + suffix }, { protocol: 'strict_json', fetch: fetcher as typeof fetch });
    await expect(client.model.chooseTool(messages)).resolves.toBe(reply);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://gateway.example/api/chat');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', 'X-API-Key': 'unit-test-key' });
    expect(init?.redirect).toBe('error');
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe('test-model');
    expect(body.stream).toBe(false);
    expect(body).not.toHaveProperty('tools');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['http://gateway.example', 'https://user:password@gateway.example', 'https://gateway.example?key=bad'])('rejects unsafe URL %s', (url) => {
    expect(() => createGatewayClient({ ...config, url })).toThrow('GATEWAY_CONFIG_INVALID');
  });

  it.each([401, 403])('does not retry HTTP %s or expose the response body', async (status) => {
    const { client, fetcher } = fakeClient(async () => new Response('private upstream diagnostic', { status }));
    await expect(client.model.chooseTool(messages)).rejects.toThrow(`GATEWAY_HTTP_${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('bounds transient retries to three total attempts', async () => {
    const { client, fetcher } = fakeClient(async () => new Response('unavailable', { status: 503 }));
    await expect(client.model.chooseTool(messages)).rejects.toThrow('GATEWAY_HTTP_503');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('recovers from a transient rate limit', async () => {
    let calls = 0;
    const { client } = fakeClient(async () => ++calls === 1 ? new Response('', { status: 429 }) : ok());
    await expect(client.model.chooseTool(messages)).resolves.toBe(reply);
    expect(calls).toBe(2);
  });

  it.each([
    'not JSON',
    JSON.stringify({ message: { role: 'assistant', content: reply }, done: false }),
    JSON.stringify({ message: { role: 'user', content: reply } }),
  ])('rejects malformed or incomplete responses without echoing content', async (body) => {
    const { client } = fakeClient(async () => new Response(body));
    await expect(client.model.chooseTool(messages)).rejects.toThrow('GATEWAY_RESPONSE_INVALID');
  });

  it('rejects oversized requests before fetching', async () => {
    const { client, fetcher } = fakeClient(async () => ok());
    await expect(client.model.chooseTool([{ role: 'user', content: 'a'.repeat(7_501) }])).rejects.toThrow('GATEWAY_REQUEST_TOO_LARGE');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds response bytes', async () => {
    const { client } = fakeClient(async () => new Response('a'.repeat(65_537)));
    await expect(client.model.chooseTool(messages)).rejects.toThrow('GATEWAY_RESPONSE_TOO_LARGE');
  });

  it('bounds a hung HTTP request', async () => {
    const { client, fetcher } = fakeClient(() => new Promise<Response>(() => {}), { timeoutMs: 20, retries: 0 });
    await expect(client.model.chooseTool(messages)).rejects.toThrow('GATEWAY_TIMEOUT');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not fetch when cancelled before the call', async () => {
    const { client, fetcher } = fakeClient(async () => ok());
    const controller = new AbortController();
    controller.abort();
    await expect(client.model.chooseTool(messages, controller.signal)).rejects.toThrow('AGENT_ABORTED');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not expose network exception details', async () => {
    const { client } = fakeClient(async () => { throw new Error('sensitive upstream diagnostics'); }, { retries: 0 });
    await expect(client.model.chooseTool(messages)).rejects.toThrow('GATEWAY_NETWORK_ERROR');
  });

  it('refuses unexpected native calls in strict JSON production mode', async () => {
    const { client } = fakeClient(async () => new Response(JSON.stringify({ message: {
      role: 'assistant', content: '', tool_calls: [{ function: { name: 'retrieve_board', arguments: {} } }],
    } })));
    await expect(client.model.chooseTool(messages)).rejects.toThrow('UNEXPECTED_NATIVE_TOOL_CALL');
  });
});

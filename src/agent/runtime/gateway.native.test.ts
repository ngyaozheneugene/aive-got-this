import { describe, expect, it, vi } from 'vitest';
import { createGatewayClient, DEFAULT_GATEWAY_PROTOCOL } from './gateway';
import type { GatewayMessage, GatewayProtocol } from './gateway';
import type { UrgentToolCall } from '../tools/protocol';
import { nativeToolsForCalls } from '../tools/native';

const config = { url: 'https://gateway.example', apiKey: 'unit-test-key', model: 'test-model' };
const messages: GatewayMessage[] = [{ role: 'user', content: 'Choose one permitted native tool.' }];
const retrieve: UrgentToolCall = { tool: 'retrieve_board', args: {} };
const call = (name = 'retrieve_board', args: unknown = {}) => ({ function: { name, arguments: args } });

function setup(reply: Record<string, unknown>) {
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ message: { role: 'assistant', content: '', ...reply }, done: true })));
  return { fetcher, client: createGatewayClient(config, { fetch: fetcher as typeof fetch, retries: 0 }) };
}

describe('native gateway client (offline HTTP doubles)', () => {
  it('defaults to native, advertises only the current tool name and normalizes the native call', async () => {
    const h = setup({ tool_calls: [call()], content: 'This prose is not execution evidence.' });
    expect(DEFAULT_GATEWAY_PROTOCOL).toBe('native');
    expect(h.client.protocol).toBe('native');
    expect(h.client.model.protocol).toBe('native');
    expect(await h.client.model.chooseTool(messages, undefined, [retrieve])).toBe(JSON.stringify(retrieve));
    const request = JSON.parse(h.fetcher.mock.calls[0]![1]!.body as string);
    expect(request.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(['retrieve_board']);
    expect(request.tools[0].function.parameters.additionalProperties).toBe(false);
    expect(request.messages).toEqual(messages);
    expect(request.stream).toBe(false);
  });

  it('advertises only three read/planning tools when no frontier is supplied', () => {
    expect(nativeToolsForCalls().map((tool) => (tool.function as { name: string }).name))
      .toEqual(['retrieve_board', 'propose', 'validate']);
  });

  it.each([
    ['missing calls', {}, 'NATIVE_TOOLS_NOT_RETURNED'],
    ['text imitation', { content: JSON.stringify(retrieve) }, 'NATIVE_TOOLS_NOT_RETURNED'],
    ['empty calls', { tool_calls: [] }, 'NATIVE_TOOLS_NOT_RETURNED'],
    ['parallel calls', { tool_calls: [call(), call()] }, 'MULTIPLE_NATIVE_TOOL_CALLS'],
    ['forbidden tool', { tool_calls: [call('commit')] }, 'INVALID_NATIVE_TOOL_CALL'],
    ['unknown tool', { tool_calls: [call('assign', { technicianId: 'tech_wei' })] }, 'INVALID_NATIVE_TOOL_CALL'],
    ['extra argument', { tool_calls: [call('retrieve_board', { approved: true })] }, 'INVALID_NATIVE_TOOL_CALL'],
    ['array arguments', { tool_calls: [call('retrieve_board', [])] }, 'INVALID_NATIVE_TOOL_CALL'],
    ['string arguments', { tool_calls: [call('retrieve_board', '{}')] }, 'INVALID_NATIVE_TOOL_CALL'],
    ['missing arguments', { tool_calls: [{ function: { name: 'retrieve_board' } }] }, 'INVALID_NATIVE_TOOL_CALL'],
    ['wrong argument type', { tool_calls: [call('propose', { eventId: 5, profile: 'sla_first' })] }, 'INVALID_NATIVE_TOOL_CALL'],
    ['prototype argument', { tool_calls: [call('retrieve_board', JSON.parse('{"__proto__":{"admin":true}}'))] }, 'INVALID_NATIVE_TOOL_CALL'],
  ] as const)('rejects %s without retrying or silently switching to text JSON', async (_name, reply, code) => {
    const h = setup(reply);
    await expect(h.client.model.chooseTool(messages)).rejects.toThrow(code);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty explicit frontier before fetching', async () => {
    const h = setup({ tool_calls: [call()] });
    await expect(h.client.model.chooseTool(messages, undefined, [])).rejects.toThrow('EMPTY_TOOL_FRONTIER');
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it('rejects a forged frontier before fetching', async () => {
    const h = setup({ tool_calls: [call()] });
    const forged = [{ tool: 'commit', args: {} }] as unknown as UrgentToolCall[];
    await expect(h.client.model.chooseTool(messages, undefined, forged)).rejects.toThrow('INVALID_TOOL_FRONTIER');
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it('does not permit callers to mutate the shared advertised schemas', () => {
    const first = nativeToolsForCalls();
    (first[0]!.function as { name: string }).name = 'commit';
    expect((nativeToolsForCalls()[0]!.function as { name: string }).name).toBe('retrieve_board');
  });

  it('rejects an unknown protocol rather than accidentally enabling a fallback', () => {
    expect(() => createGatewayClient(config, { protocol: 'other' as GatewayProtocol }))
      .toThrow('GATEWAY_CONFIG_INVALID');
  });

  it('keeps explicit strict JSON mode free of native definitions', async () => {
    const h = setup({ content: JSON.stringify(retrieve) });
    const client = createGatewayClient(config, { fetch: h.fetcher as typeof fetch, protocol: 'strict_json' });
    expect(client.model.protocol).toBe('strict_json');
    expect(await client.model.chooseTool(messages)).toBe(JSON.stringify(retrieve));
    expect(JSON.parse(h.fetcher.mock.calls[0]![1]!.body as string)).not.toHaveProperty('tools');
  });
});

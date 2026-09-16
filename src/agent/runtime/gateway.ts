import { z } from 'zod';
import { GATEWAY_RETRIES } from '../../shared/config/timeouts';
import { AgentError } from './errors';
import { bounded } from './bounds';
import { nativeToolsForCalls, parseNativeToolCall } from '../tools/native';
import type { UrgentToolCall } from '../tools/protocol';

export const GATEWAY_MAX_REQUEST_BYTES = 7_500;
const MAX_RESPONSE_BYTES = 65_536;

export type GatewayProtocol = 'native' | 'strict_json';
// Native support was measured in gateway-smoke-1789419656751.json. Never auto-downgrade.
export const DEFAULT_GATEWAY_PROTOCOL: GatewayProtocol = 'native';

export interface GatewayMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  tool_calls?: Array<{ function: { name: string; arguments?: unknown } }>;
}
export interface GatewayConfig { url: string; apiKey: string; model: string }
export interface ToolModel {
  readonly protocol?: GatewayProtocol;
  chooseTool(messages: GatewayMessage[], signal?: AbortSignal, allowedCalls?: readonly UrgentToolCall[]): Promise<string>;
}
export interface GatewayOptions {
  protocol?: GatewayProtocol;
  fetch?: typeof fetch;
  retries?: number;
  timeoutMs?: number;
  backoffMs?: number;
}

const messageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string().default(''),
  tool_calls: z.array(z.object({
    function: z.object({ name: z.string(), arguments: z.unknown() }),
  })).optional(),
});
const responseSchema = z.object({ message: messageSchema, done: z.boolean().optional() });

function serverOnly(): void {
  if (typeof window !== 'undefined') throw new AgentError('GATEWAY_SERVER_ONLY');
}

export function readGatewayConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  serverOnly();
  const url = env.LLM_GATEWAY_URL?.trim();
  const apiKey = env.LLM_GATEWAY_API_KEY?.trim();
  const model = env.LLM_MODEL?.trim();
  if (!url || !apiKey || !model) throw new AgentError('GATEWAY_CONFIG_MISSING');
  return { url, apiKey, model };
}

function chatEndpoint(base: string): string {
  try {
    const url = new URL(base);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error();
    if (url.username || url.password || url.search || url.hash) throw new Error();
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/api/chat') ? path : path.endsWith('/api') ? `${path}/chat` : `${path}/api/chat`;
    return url.toString();
  } catch {
    throw new AgentError('GATEWAY_CONFIG_INVALID');
  }
}

async function responseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new AgentError('GATEWAY_RESPONSE_INVALID');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AgentError('GATEWAY_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Organiser's Ollama dialect. Default native; strict JSON is an explicit diagnostic mode. */
export function createGatewayClient(config: GatewayConfig, options: GatewayOptions = {}) {
  serverOnly();
  const endpoint = chatEndpoint(config.url);
  const protocol = options.protocol ?? DEFAULT_GATEWAY_PROTOCOL;
  if (protocol !== 'native' && protocol !== 'strict_json') throw new AgentError('GATEWAY_CONFIG_INVALID');
  if (!config.apiKey.trim() || !config.model.trim()) throw new AgentError('GATEWAY_CONFIG_MISSING');
  const fetcher = options.fetch ?? globalThis.fetch;
  const retries = options.retries ?? GATEWAY_RETRIES;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const backoffMs = options.backoffMs ?? 3_000;
  if (!Number.isInteger(retries) || retries < 0 || retries > GATEWAY_RETRIES ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000 ||
      !Number.isFinite(backoffMs) || backoffMs < 0 || backoffMs > 10_000) {
    throw new AgentError('GATEWAY_CONFIG_INVALID');
  }

  async function chat(
    messages: GatewayMessage[],
    signal?: AbortSignal,
    nativeTools?: Record<string, unknown>[],
  ): Promise<z.infer<typeof messageSchema>> {
    const body = JSON.stringify({
      model: config.model, messages, stream: false,
      options: { temperature: 0, num_predict: 500 },
      ...(nativeTools ? { tools: nativeTools } : {}),
    });
    if (Buffer.byteLength(body) > GATEWAY_MAX_REQUEST_BYTES) throw new AgentError('GATEWAY_REQUEST_TOO_LARGE');
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await bounded(async (requestSignal) => {
          let response: Response;
          try {
            response = await fetcher(endpoint, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': config.apiKey },
              body, signal: requestSignal, redirect: 'error', cache: 'no-store',
            });
          } catch {
            throw new AgentError('GATEWAY_NETWORK_ERROR');
          }
          if (!response.ok) {
            await response.body?.cancel();
            throw new AgentError(`GATEWAY_HTTP_${response.status}`);
          }
          let json: unknown;
          try { json = JSON.parse(await responseText(response)); }
          catch (error) {
            if (error instanceof AgentError) throw error;
            throw new AgentError('GATEWAY_RESPONSE_INVALID');
          }
          const parsed = responseSchema.safeParse(json);
          if (!parsed.success || parsed.data.done === false) throw new AgentError('GATEWAY_RESPONSE_INVALID');
          return parsed.data.message;
        }, timeoutMs, signal, 'GATEWAY_TIMEOUT');
      } catch (error) {
        const code = error instanceof AgentError ? error.code : 'GATEWAY_FAILED';
        const retryable = ['GATEWAY_TIMEOUT', 'GATEWAY_NETWORK_ERROR', 'GATEWAY_HTTP_408',
          'GATEWAY_HTTP_429', 'GATEWAY_HTTP_500', 'GATEWAY_HTTP_502', 'GATEWAY_HTTP_503', 'GATEWAY_HTTP_504'].includes(code);
        if (signal?.aborted) throw new AgentError('AGENT_ABORTED');
        if (!retryable || attempt === retries) throw new AgentError(code);
        const delay = backoffMs * (attempt + 1);
        await bounded(() => new Promise<void>((resolve) => setTimeout(resolve, delay)), delay + 1_000, signal);
      }
    }
    throw new AgentError('GATEWAY_FAILED');
  }

  const model: ToolModel = {
    protocol,
    async chooseTool(messages, signal, allowedCalls) {
      const reply = await chat(messages, signal,
        protocol === 'native' ? nativeToolsForCalls(allowedCalls) : undefined);
      if (protocol === 'native') {
        // Normalize into the existing graph dispatcher, which re-checks schema, size and state.
        // Assistant prose is never an action, an explanation or execution evidence.
        return JSON.stringify(parseNativeToolCall(reply));
      }
      if (reply.tool_calls?.length) throw new AgentError('UNEXPECTED_NATIVE_TOOL_CALL');
      return reply.content;
    },
  };
  return { chat, model, protocol };
}

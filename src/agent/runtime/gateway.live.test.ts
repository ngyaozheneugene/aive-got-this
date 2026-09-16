/** Opt-in only. Default npm test never loads credentials or sends gateway requests. */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { createGatewayClient, readGatewayConfig } from './gateway';
import type { GatewayMessage } from './gateway';
import { AgentError, errorCode } from './errors';
import { parseToolCall, sameToolCall } from '../tools/protocol';
import { nativeToolsForCalls, parseNativeToolCall } from '../tools/native';
import type { UrgentToolCall } from '../tools/protocol';

const enabled = process.env.RUN_GATEWAY_SMOKE === '1';
// Exercise the same definitions and decoder as the production client.
const nativeTools = nativeToolsForCalls([
  { tool: 'retrieve_board', args: {} },
  { tool: 'propose', args: { eventId: 'schema-only', profile: 'sla_first' } },
]);

interface SmokeResult { status: 'passed' | 'failed'; durationMs: number; steps: string[]; reason?: string }

it.skipIf(!enabled)('LIVE: strict JSON versus native tools on the configured organiser gateway', async () => {
  // Never print the loaded values. The local environment file must be populated by its owner.
  if (existsSync('.env.local')) loadEnvFile('.env.local');
  else if (existsSync('.env')) loadEnvFile('.env');
  const config = readGatewayConfig();
  // One attempt per request makes protocol evidence distinguishable from retries.
  const client = createGatewayClient(config, { retries: 0, timeoutMs: 30_000 });
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 150_000);
  const signal = controller.signal;
  const retrieve: UrgentToolCall = { tool: 'retrieve_board', args: {} };

  async function check(mode: 'strict_json' | 'native'): Promise<SmokeResult> {
    const started = Date.now();
    const steps: string[] = [];
    try {
      // This ID is disclosed only in the tool result, not the initial request.
      const eventId = `smoke_${randomUUID()}`;
      const expected: UrgentToolCall = { tool: 'propose', args: { eventId, profile: 'sla_first' } };
      const instructions = mode === 'strict_json'
        ? 'Return ONLY a JSON object {"tool":"name","args":{...}}, with no markdown or other fields. First call retrieve_board with empty args. After its result call propose with the returned eventId and profile sla_first. Never invent an event ID.'
        : 'Use native function calls, not text JSON. First call retrieve_board with empty arguments. After its result call propose with the returned eventId and profile sla_first. Never invent an event ID.';
      const messages: GatewayMessage[] = [
        { role: 'system', content: instructions }, { role: 'user', content: instructions },
      ];
      const first = await client.chat(messages, signal, mode === 'native' ? nativeTools : undefined);
      const decode = (message: typeof first): UrgentToolCall => {
        if (mode === 'strict_json') {
          if (message.tool_calls?.length) throw new AgentError('UNEXPECTED_NATIVE_TOOL_CALL');
          return parseToolCall(message.content);
        }
        return parseNativeToolCall(message);
      };
      if (!sameToolCall(decode(first), retrieve)) throw new AgentError('WRONG_FIRST_TOOL');
      steps.push('retrieve_board');
      const result = JSON.stringify({ eventId, sourceSnapshotId: 'smoke_snapshot', synthetic: true });
      messages.push(first);
      messages.push(mode === 'native'
        ? { role: 'tool', tool_name: 'retrieve_board', content: result }
        : { role: 'user', content: `Tool result for retrieve_board: ${result}\n${instructions}` });
      await sleep(3_000, undefined, { signal });
      const second = await client.chat(messages, signal, mode === 'native' ? nativeTools : undefined);
      if (!sameToolCall(decode(second), expected)) throw new AgentError('TOOL_RESULT_NOT_CONSUMED');
      steps.push('propose');
      // Deliberately stop before executing propose: this smoke cannot modify schedules.
      return { status: 'passed', durationMs: Date.now() - started, steps };
    } catch (error) {
      return { status: 'failed', durationMs: Date.now() - started, steps, reason: errorCode(error, 'SMOKE_FAILED') };
    }
  }

  try {
    const strict = await check('strict_json');
    await sleep(3_000, undefined, { signal });
    const native = await check('native');
    const report = {
      checkedAt: new Date().toISOString(), node: process.version,
      gatewayOrigin: new URL(config.url).origin, model: config.model,
      strictJson: strict, nativeTools: native,
      productionProtocol: client.protocol, nativeToolsEnabled: client.protocol === 'native',
      configurationScope: 'Local source default only; this test does not deploy or change configuration.',
      evidenceScope: 'Synthetic tool-result round trip only; not scheduling or full-agent acceptance.',
    };
    const directory = 'docs/team/member-3';
    mkdirSync(directory, { recursive: true });
    const filename = `${directory}/gateway-smoke-${Date.now()}.json`;
    // Unique, non-overwriting evidence. Contains neither credentials nor raw gateway responses.
    writeFileSync(filename, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.info(`Gateway smoke evidence: ${filename}; strict=${strict.status}; native=${native.status}`);
    // Require the selected production protocol, not whichever protocol happened to succeed.
    const selected = client.protocol === 'native' ? native : strict;
    expect(selected.status, `Selected ${client.protocol} smoke failed; inspect sanitized evidence.`).toBe('passed');
    // The separate native-agent.live.test.ts must also prove the actual graph/client path.
    // No automatic downgrade to strict JSON after a native failure.
  } finally {
    clearTimeout(deadline);
  }
}, 160_000);

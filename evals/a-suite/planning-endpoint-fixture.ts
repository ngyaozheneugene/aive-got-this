import { vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDatabase } from '../../src/db';
import { propose } from '../../src/matching/propose';
import { validatePlan } from '../../src/matching/validate';
import { POST } from '../../src/app/api/events/[id]/plan/route';
import { permittedCalls, setupAgent } from './fixtures';

// Each consuming test file explicitly mocks getDatabase + scheduler/validator imports.
// The HTTP handler, native client, graph and persistence are the real implementations.
export async function setupPlanningEndpoint(rawText = '') {
  const h = await setupAgent(rawText);
  vi.mocked(getDatabase).mockReturnValue(h.db);
  vi.mocked(propose).mockImplementation(h.scheduler.propose);
  vi.mocked(validatePlan).mockImplementation(h.scheduler.validate);
  vi.stubEnv('LLM_GATEWAY_URL', 'https://gateway.example');
  vi.stubEnv('LLM_GATEWAY_API_KEY', 'unit-test-key');
  vi.stubEnv('LLM_MODEL', 'test-model');
  const reply = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const call = permittedCalls(body.messages)[0]!;
    return new Response(JSON.stringify({ message: { role: 'assistant', content: '',
      tool_calls: [{ function: { name: call.tool, arguments: call.args } }] }, done: true }));
  };
  const fetcher = vi.fn(reply);
  vi.stubGlobal('fetch', fetcher);
  const request = (body: unknown = {}, signal?: AbortSignal) => new NextRequest('http://localhost/api/events/test/plan',
    { method: 'POST', body: JSON.stringify(body), signal });
  const run = (body: unknown = {}, eventId = h.event.id, signal?: AbortSignal) =>
    POST(request(body, signal), { params: Promise.resolve({ id: eventId }) });
  return { ...h, fetcher, reply, request, run, before: structuredClone(await h.db.assignments.listAll()) };
}

export function restorePlanningTest() {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
}

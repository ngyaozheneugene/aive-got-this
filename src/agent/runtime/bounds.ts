import { AgentError } from './errors';

/** Async work is bounded; cooperative HTTP requests also receive an abort signal. */
export async function bounded<T>(
  work: (signal: AbortSignal) => T | Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
  timeoutCode = 'TOOL_TIMEOUT',
): Promise<T> {
  const controller = new AbortController();
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => {
      controller.abort();
      reject(new AgentError('AGENT_ABORTED'));
    };
    if (parent?.aborted) return onAbort();
    parent?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new AgentError(timeoutCode));
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([
      interrupted,
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new AgentError('AGENT_ABORTED');
        return work(controller.signal);
      }),
    ]);
    // A synchronous scheduler cannot be preempted; reject an over-budget result.
    if (Date.now() - started > timeoutMs) throw new AgentError(timeoutCode);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) parent?.removeEventListener('abort', onAbort);
  }
}

/** Stable codes only: never surface gateway bodies, credentials or raw exceptions. */
export class AgentError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'AgentError';
  }
}

export function errorCode(error: unknown, fallback = 'AGENT_FAILED'): string {
  return error instanceof AgentError ? error.code : fallback;
}

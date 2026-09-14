import { NextResponse } from 'next/server';

export function notImplemented(gate: string) {
  return NextResponse.json({ error: 'not_implemented', gate }, { status: 501 });
}

export function badRequest(error: string, details?: unknown) {
  return NextResponse.json({ error, details }, { status: 400 });
}

/** Backend-owned reason code plus a human-readable detail. */
export function fail(code: string, status: number, detail?: string) {
  return NextResponse.json({ error: code, detail }, { status });
}

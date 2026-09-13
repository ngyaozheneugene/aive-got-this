import { NextResponse } from 'next/server';

export function notImplemented(gate: string) {
  return NextResponse.json({ error: 'not_implemented', gate }, { status: 501 });
}

export function badRequest(error: string, details?: unknown) {
  return NextResponse.json({ error, details }, { status: 400 });
}

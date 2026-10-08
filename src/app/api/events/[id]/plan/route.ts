import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDatabase } from '../../../../../db';
import { planUrgentEvent } from '../../../../../dispatch/plan-event';
import { planProfileSchema } from '../../../../../shared/contracts/propose';
import { fail } from '../../../_lib/http';
import { workspaceOf } from '../../../_lib/workspace';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// Local HTTP envelope; shared tool and solver contracts remain unchanged.
const bodySchema = z.object({ profile: planProfileSchema.default('sla_first') }).strict();
const MAX_BODY_BYTES = 2_048;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  if (!eventId || eventId.length > 200) return fail('invalid_event_id', 400, 'A valid event id is required.');
  let json: unknown = {};
  const reader = request.body?.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          return fail('request_too_large', 413, 'Planning requests are limited to 2048 bytes.');
        }
        chunks.push(value);
      }
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (text.trim()) json = JSON.parse(text);
  } catch {
    return fail('invalid_json', 400, 'The request body must be valid JSON.');
  } finally { reader?.releaseLock(); }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return fail('invalid_plan_request', 400, 'Only an optional valid profile is accepted.');
  try {
    const workspace = workspaceOf(request);
    const result = await planUrgentEvent(getDatabase(workspace), { eventId, profile: parsed.data.profile, signal: request.signal });
    // Naming the workspace makes a request sent to the wrong one obvious on screen.
    if (!result.ok) return fail(result.code, result.httpStatus, `${result.detail} (workspace: ${workspace})`);
    const { ok: _ok, ...body } = result;
    return NextResponse.json(body, { status: 201 });
  } catch {
    return fail('planning_failed', 500, 'Planning could not be completed. No schedule was committed.');
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '../../../db';
import { updateSettings } from '../../../dispatch/settings';
import { updateSettingsBodySchema } from '../../../shared/contracts/settings';
import { badRequest, fail } from '../_lib/http';
import { workspaceOf } from '../_lib/workspace';

export const dynamic = 'force-dynamic';

/** The company's settings for this workspace. ADR 011. */
export async function GET(request: Request) {
  return NextResponse.json(await getDatabase(workspaceOf(request)).settings.get());
}

/** Change any of them. The working day applies from the next board load and plan. */
export async function PATCH(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest('invalid_json');
  }
  const parsed = updateSettingsBodySchema.safeParse(json);
  if (!parsed.success) return badRequest('invalid_settings', parsed.error.flatten());
  const result = await updateSettings(getDatabase(workspaceOf(request)), parsed.data);
  if (!result.ok) return fail(result.code, result.httpStatus, result.detail);
  return NextResponse.json(result.settings);
}

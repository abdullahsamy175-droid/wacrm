// ============================================================
// GET   /api/v1/deals/{id} — read a deal    (scope: deals:read)
// PATCH /api/v1/deals/{id} — update a deal  (scope: deals:write)
//
// Account-scoped: another account's deal returns 404. PATCH updates
// only the fields present; a new `stage_id` must be in the deal's own
// pipeline.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isUuid } from '@/lib/api/v1/pagination';
import { DEAL_SELECT, isDealStatus, serializeDeal } from '@/lib/api/v1/deals';

async function findDeal(db: SupabaseClient, accountId: string, id: string) {
  if (!isUuid(id)) return null;
  const { data, error } = await db
    .from('deals')
    .select(DEAL_SELECT)
    .eq('id', id)
    .eq('account_id', accountId)
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');
    const { id } = await params;
    const deal = await findDeal(ctx.supabase, ctx.accountId, id);
    if (!deal) return fail('not_found', 'Deal not found', 404);
    return ok(serializeDeal(deal));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const deal = await findDeal(ctx.supabase, ctx.accountId, id);
    if (!deal) return fail('not_found', 'Deal not found', 404);

    const updates: Record<string, unknown> = {};

    if ('title' in body) {
      if (typeof body.title !== 'string' || !body.title.trim()) {
        return fail('bad_request', "'title' must be a non-empty string", 400);
      }
      updates.title = body.title.trim();
    }
    if ('value' in body) {
      if (typeof body.value !== 'number' || !Number.isFinite(body.value) || body.value < 0) {
        return fail('bad_request', "'value' must be a non-negative number", 400);
      }
      updates.value = body.value;
    }
    if ('status' in body) {
      if (!isDealStatus(body.status)) {
        return fail('bad_request', "'status' must be one of: open, won, lost", 400);
      }
      updates.status = body.status;
    }
    for (const field of ['notes', 'expected_close_date'] as const) {
      if (!(field in body)) continue;
      if (body[field] !== null && typeof body[field] !== 'string') {
        return fail('bad_request', `'${field}' must be a string or null`, 400);
      }
      updates[field] = body[field];
    }
    if ('stage_id' in body) {
      const stageId = typeof body.stage_id === 'string' ? body.stage_id : '';
      if (!isUuid(stageId)) return fail('bad_request', "'stage_id' must be a UUID", 400);
      const { data: stage, error: stageError } = await ctx.supabase
        .from('pipeline_stages')
        .select('id')
        .eq('id', stageId)
        .eq('pipeline_id', deal.pipeline_id as string)
        .maybeSingle();
      if (stageError) throw stageError;
      if (!stage) return fail('bad_request', 'Stage not found in this pipeline', 400);
      updates.stage_id = stageId;
    }

    if (Object.keys(updates).length === 0) return ok(serializeDeal(deal));

    const { data, error } = await ctx.supabase
      .from('deals')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(DEAL_SELECT)
      .single();

    if (error || !data) {
      console.error('[api/v1/deals] update error:', error);
      return fail('internal', 'Failed to update deal', 500);
    }
    return ok(serializeDeal(data as Record<string, unknown>));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

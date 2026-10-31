// ============================================================
// GET  /api/v1/deals — list deals            (scope: deals:read)
// POST /api/v1/deals — create a deal         (scope: deals:write)
//
// List is keyset-paginated and filters on `pipeline_id`, `stage_id`,
// `contact_id`, `status` and `updated_after` (poll with this one to
// follow stage changes). Deals of archived contacts are left out.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseListParams, keysetFilter, buildPage, isUuid } from '@/lib/api/v1/pagination';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';
import { DEAL_SELECT, isDealStatus, serializeDeal } from '@/lib/api/v1/deals';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');
    const { limit, cursor } = parseListParams(request);
    const params = new URL(request.url).searchParams;

    let query = ctx.supabase
      .from('deals')
      .select(DEAL_SELECT)
      .eq('account_id', ctx.accountId)
      .is('archived_at', null);

    for (const filter of ['pipeline_id', 'stage_id', 'contact_id'] as const) {
      const value = params.get(filter);
      if (!value) continue;
      if (!isUuid(value)) return fail('bad_request', `'${filter}' must be a UUID`, 400);
      query = query.eq(filter, value);
    }

    const status = params.get('status');
    if (status) {
      if (!isDealStatus(status)) {
        return fail('bad_request', "'status' must be one of: open, won, lost", 400);
      }
      query = query.eq('status', status);
    }

    const updatedAfter = params.get('updated_after');
    if (updatedAfter) {
      if (Number.isNaN(Date.parse(updatedAfter))) {
        return fail('bad_request', "'updated_after' must be an ISO 8601 timestamp", 400);
      }
      query = query.gt('updated_at', new Date(updatedAfter).toISOString());
    }

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/deals] list error:', error);
      return fail('internal', 'Failed to list deals', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((row) => serializeDeal(row as Record<string, unknown>)),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return fail('bad_request', "'title' is required", 400);

    const contactId = typeof body.contact_id === 'string' ? body.contact_id : '';
    if (!isUuid(contactId)) return fail('bad_request', "'contact_id' must be a UUID", 400);

    const value = body.value ?? 0;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return fail('bad_request', "'value' must be a non-negative number", 400);
    }

    const { data: contact, error: contactError } = await ctx.supabase
      .from('contacts')
      .select('id, archived_at')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (contactError) {
      console.error('[api/v1/deals] contact lookup error:', contactError);
      return fail('internal', 'Failed to create deal', 500);
    }
    if (!contact) return fail('not_found', 'Contact not found', 404);
    if (contact.archived_at) return fail('contact_archived', 'This contact is archived', 409);

    // Pipeline: the one asked for, else the account's oldest.
    let pipelineQuery = ctx.supabase
      .from('pipelines')
      .select('id, stages:pipeline_stages(id, position)')
      .eq('account_id', ctx.accountId);
    if (typeof body.pipeline_id === 'string') {
      if (!isUuid(body.pipeline_id)) return fail('bad_request', "'pipeline_id' must be a UUID", 400);
      pipelineQuery = pipelineQuery.eq('id', body.pipeline_id);
    }
    const { data: pipelines, error: pipelineError } = await pipelineQuery
      .order('created_at', { ascending: true })
      .limit(1);
    if (pipelineError) {
      console.error('[api/v1/deals] pipeline lookup error:', pipelineError);
      return fail('internal', 'Failed to create deal', 500);
    }
    const pipeline = pipelines?.[0] as
      | { id: string; stages: { id: string; position: number }[] }
      | undefined;
    if (!pipeline) return fail('not_found', 'Pipeline not found', 404);

    // Stage: the one asked for, which must be in this pipeline, else the first.
    const stages = [...pipeline.stages].sort((a, b) => a.position - b.position);
    const stage =
      typeof body.stage_id === 'string'
        ? stages.find((s) => s.id === body.stage_id)
        : stages[0];
    if (!stage) return fail('bad_request', 'Stage not found in this pipeline', 400);

    const userId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const { data: deal, error } = await ctx.supabase
      .from('deals')
      .insert({
        account_id: ctx.accountId,
        user_id: userId,
        pipeline_id: pipeline.id,
        stage_id: stage.id,
        contact_id: contactId,
        title,
        value,
        currency: typeof body.currency === 'string' ? body.currency : undefined,
        notes: typeof body.notes === 'string' ? body.notes : null,
        expected_close_date:
          typeof body.expected_close_date === 'string' ? body.expected_close_date : null,
      })
      .select(DEAL_SELECT)
      .single();

    if (error || !deal) {
      console.error('[api/v1/deals] create error:', error);
      return fail('internal', 'Failed to create deal', 500);
    }
    return ok(serializeDeal(deal as Record<string, unknown>), 201);
  } catch (err) {
    if (err instanceof ContactError) return fail('internal', err.message, err.status);
    return toApiErrorResponse(err);
  }
}

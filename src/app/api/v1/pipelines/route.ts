// ============================================================
// GET /api/v1/pipelines — pipelines with their stages in board order
// (scope: deals:read). Not paginated: an account has a handful.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

interface StageRow {
  id: string;
  name: string;
  position: number;
  color: string;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');

    const { data, error } = await ctx.supabase
      .from('pipelines')
      .select('id, name, created_at, stages:pipeline_stages(id, name, position, color)')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[api/v1/pipelines] list error:', error);
      return fail('internal', 'Failed to list pipelines', 500);
    }

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      name: string;
      created_at: string;
      stages: StageRow[];
    }>;
    return ok(
      rows.map((pipeline) => ({
        ...pipeline,
        stages: [...pipeline.stages].sort((a, b) => a.position - b.position),
      }))
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

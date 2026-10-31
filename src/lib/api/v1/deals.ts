// ============================================================
// Bnerd: shared deal logic for the public API (v1) deal endpoints.
//
// Upstream's dashboard writes deals straight to Supabase from the
// browser, so there is no server hook to fire a webhook from. Callers
// poll `GET /api/v1/deals?updated_after=` instead; `updated_at` is
// maintained by a trigger, so it moves with every stage change.
// ============================================================

export const DEAL_SELECT = '*, stage:pipeline_stages(name)';

export const DEAL_STATUSES = ['open', 'won', 'lost'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const isDealStatus = (value: unknown): value is DealStatus =>
  typeof value === 'string' && (DEAL_STATUSES as readonly string[]).includes(value);

export interface ApiDeal {
  id: string;
  title: string;
  value: number;
  currency: string | null;
  status: string;
  pipeline_id: string;
  stage_id: string;
  stage_name: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  assigned_to: string | null;
  notes: string | null;
  expected_close_date: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Flatten a `DEAL_SELECT` row into the public deal shape. */
export function serializeDeal(row: Record<string, unknown>): ApiDeal {
  const stage = row.stage as { name?: string } | null | undefined;
  return {
    id: row.id as string,
    title: row.title as string,
    value: Number(row.value ?? 0),
    currency: (row.currency as string | null) ?? null,
    status: row.status as string,
    pipeline_id: row.pipeline_id as string,
    stage_id: row.stage_id as string,
    stage_name: stage?.name ?? null,
    contact_id: (row.contact_id as string | null) ?? null,
    conversation_id: (row.conversation_id as string | null) ?? null,
    assigned_to: (row.assigned_to as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    expected_close_date: (row.expected_close_date as string | null) ?? null,
    closed_at: (row.closed_at as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

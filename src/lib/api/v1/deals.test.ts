import { describe, expect, it } from 'vitest';
import { isDealStatus, serializeDeal } from './deals';

describe('serializeDeal', () => {
  it('projects the public fields and flattens the stage name', () => {
    const deal = serializeDeal({
      id: 'd1',
      user_id: 'internal',
      account_id: 'internal',
      archived_at: null,
      title: 'Mona trial',
      value: '250.00',
      currency: 'EGP',
      status: 'open',
      pipeline_id: 'p1',
      stage_id: 's1',
      stage: { name: 'Trial' },
      contact_id: 'c1',
      created_at: '2026-10-31T10:00:00Z',
      updated_at: '2026-10-31T11:00:00Z',
    });
    expect(deal).toMatchObject({ id: 'd1', value: 250, stage_name: 'Trial', notes: null });
    expect(deal).not.toHaveProperty('account_id');
    expect(deal).not.toHaveProperty('user_id');
  });
});

describe('isDealStatus', () => {
  it('accepts only the three statuses', () => {
    expect(['open', 'won', 'lost'].every(isDealStatus)).toBe(true);
    expect(isDealStatus('active')).toBe(false);
    expect(isDealStatus(null)).toBe(false);
  });
});

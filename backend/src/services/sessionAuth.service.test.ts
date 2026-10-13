import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));
vi.mock('./userAssociations.service', () => ({
  fetchUserScopeAssociations: vi.fn(async () => ({ plants: [], group_plants: [], products: [] })),
}));

import { buildSessionUserPayload } from './sessionAuth.service';

const baseRow = {
  id: '11111111-1111-1111-1111-111111111111',
  username: 'jdoe',
  email: 'jdoe@example.com',
  full_name: 'J Doe',
  role: 'ADMIN',
  is_active: true,
  is_first_login: false,
};

/**
 * The Downstream Hub SDK identifies a user by the Hub `sub`, and starts a new analytics session
 * whenever the identity it is handed changes. Login and /auth/me both build their user through
 * this function, so it is the one place that keeps the two in agreement.
 */
describe('buildSessionUserPayload — hub_user_id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes the stored Hub OIDC sub as hub_user_id', async () => {
    const sub = '0f8c2a4e-9b1d-4c3a-8e7f-2a6b5c4d3e21';
    const payload = await buildSessionUserPayload({ ...baseRow, hub_oidc_sub: sub });
    expect(payload.hub_user_id).toBe(sub);
  });

  it('is null for a user who has never signed in through the Hub', async () => {
    const payload = await buildSessionUserPayload({ ...baseRow, hub_oidc_sub: null });
    expect(payload.hub_user_id).toBeNull();
  });

  it('is null when the column is absent from the row', async () => {
    const payload = await buildSessionUserPayload({ ...baseRow });
    expect(payload.hub_user_id).toBeNull();
  });

  it('leaves the existing fields unchanged', async () => {
    const payload = await buildSessionUserPayload({ ...baseRow, hub_oidc_sub: 'x' });
    expect(payload).toMatchObject({
      id: baseRow.id,
      username: 'jdoe',
      email: 'jdoe@example.com',
      full_name: 'J Doe',
      role: 'ADMIN',
      is_active: true,
      is_first_login: false,
      plants: [],
      group_plants: [],
      products: [],
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
vi.mock('../database/connection', () => ({ query: (...a: unknown[]) => queryMock(...a) }));
const optionsMock = vi.fn();
vi.mock('./sapUsers.service', () => ({ listCreatorOptions: () => optionsMock() }));

import { resolveCreatorForUser, setUserCreatorMapping } from './userCreators.service';

const OPTIONS = [
  { userId: '04124040143', name: 'VICKY' },
  { userId: '62237590905', name: 'DEWI SISWANTI' },
  { userId: '99999999999', name: '99999999999' }, // a creator without a name in the SAP user master
];

beforeEach(() => {
  queryMock.mockReset();
  optionsMock.mockReset();
  optionsMock.mockResolvedValue(OPTIONS);
});

describe('resolveCreatorForUser', () => {
  it("the administrator's mapping wins over the name", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ sap_user_id: '62237590905' }] });
    const r = await resolveCreatorForUser('u1', { email: 'vicky.vicky@energi-up.com', fullName: 'Vicky' });
    expect(r).toEqual({ creator: { userId: '62237590905', name: 'DEWI SISWANTI' }, source: 'mapping' });
  });
  it('a mapping to a NIK that is not in the creator list still pre-selects it (name = NIK)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ sap_user_id: '11111111111' }] });
    const r = await resolveCreatorForUser('u1', { email: 'x@y.z', fullName: 'X' });
    expect(r).toEqual({ creator: { userId: '11111111111', name: '11111111111' }, source: 'mapping' });
  });
  it('without a mapping the name decides', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await resolveCreatorForUser('u1', { email: 'vicky.vicky@energi-up.com', fullName: '' });
    expect(r).toEqual({ creator: { userId: '04124040143', name: 'VICKY' }, source: 'name' });
  });
  it('no mapping and no name match leaves it empty', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await resolveCreatorForUser('u1', { email: 'budi.santoso@energi-up.com', fullName: 'Budi Santoso' })).toEqual({ creator: null, source: null });
  });
});

describe('setUserCreatorMapping', () => {
  it('null clears the mapping', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await setUserCreatorMapping('u1', null, 'admin');
    expect(String(queryMock.mock.calls[0][0])).toContain('DELETE FROM commercial_user_creators');
  });
  it('a NIK is upserted with who set it', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await setUserCreatorMapping('u1', '04124040143', 'admin');
    expect(String(queryMock.mock.calls[0][0])).toContain('ON CONFLICT (user_id) DO UPDATE');
    expect(queryMock.mock.calls[0][1]).toEqual(['u1', '04124040143', 'admin']);
  });
});

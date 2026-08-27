import { describe, expect, it, vi, beforeEach } from 'vitest';
import { applyContractFilterAlias, resolveContractFilterParam } from './contractFilterParam';

vi.mock('../database/connection', () => ({
  query: vi.fn(),
}));

import { query } from '../database/connection';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const UUID = 'd93f8a46-5340-48e8-8887-97a084badb30';

describe('contractFilterParam', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('passes an explicit contract through untouched and never queries', async () => {
    expect(await resolveContractFilterParam({ contract: '1584000902' })).toBe('1584000902');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('leaves the query alone when no contract identifier is supplied', async () => {
    const q: Record<string, unknown> = { limit: '10' };
    await applyContractFilterAlias(q);
    expect('contract' in q).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('treats a non-uuid alias as a contract number without a lookup', async () => {
    expect(await resolveContractFilterParam({ contractId: '1584000902' })).toBe('1584000902');
    expect(await resolveContractFilterParam({ contract_id: '1584000902' })).toBe('1584000902');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('resolves a uuid alias to the contract number the lists filter on', async () => {
    mockQuery.mockResolvedValue({ rows: [{ contract_id: '1584000902' }] });
    expect(await resolveContractFilterParam({ contractId: UUID })).toBe('1584000902');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('yields a value that matches nothing when a uuid resolves to no contract', async () => {
    // The dangerous outcome is "no filter": the caller asked for one contract and would receive
    // every row, presented as the answer. That is the defect this guards - a request for one
    // contract's shipments came back with all 340 and no error raised anywhere.
    mockQuery.mockResolvedValue({ rows: [] });
    const resolved = await resolveContractFilterParam({ contractId: UUID });
    expect(resolved).toBeDefined();
    expect(resolved).not.toBe('');
    expect(resolved).toBe('__no_such_contract__');
  });

  it('contains no control characters — a NUL reaches Postgres as a 22021 encoding error', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const resolved = (await resolveContractFilterParam({ contractId: UUID })) as string;
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u001F]/.test(resolved)).toBe(false);
  });

  it('prefers an explicit contract over the aliases', async () => {
    const q: Record<string, unknown> = { contract: 'explicit', contractId: UUID };
    await applyContractFilterAlias(q);
    expect(q.contract).toBe('explicit');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('writes the resolved value back onto the query as `contract`', async () => {
    mockQuery.mockResolvedValue({ rows: [{ contract_id: '1584000902' }] });
    const q: Record<string, unknown> = { contractId: UUID };
    await applyContractFilterAlias(q);
    expect(q.contract).toBe('1584000902');
  });
});

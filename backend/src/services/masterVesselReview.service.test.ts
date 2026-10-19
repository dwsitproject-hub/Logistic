import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const clientQuery = vi.fn();
const release = vi.fn();
const planMock = vi.fn();
const applyMock = vi.fn();

vi.mock('../database/connection', () => ({
  query: (...args: unknown[]) => queryMock(...args),
  getClient: async () => ({ query: (...args: unknown[]) => clientQuery(...args), release }),
}));
vi.mock('./masterVesselMerge.service', () => ({
  planMasterVesselMerge: (...args: unknown[]) => planMock(...args),
  applyMasterVesselMerge: (...args: unknown[]) => applyMock(...args),
}));

import { approveVesselReview, countVesselsForReview, listVesselsForReview, mergeVesselForReview } from './masterVesselReview.service';

beforeEach(() => {
  queryMock.mockReset();
  clientQuery.mockReset();
  release.mockReset();
  planMock.mockReset();
  applyMock.mockReset();
});

describe('listVesselsForReview', () => {
  it('lists only vessels waiting for review, newest first, with the reasons as a list and the merge candidates', async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          id: 'v1',
          vessel_name: 'BG. PRIMA SAMUDR',
          vessel_code: 'MPRIMA6',
          vessel_role: 'BG',
          vessel_type: 'BARGE',
          vessel_owner: 'PT. X',
          code_status: 'OFFICIAL',
          review_reason: 'truncated, no_prefix',
          review_sap_name: 'TB. PRIMA SAKTI VI/BG. PRIMA SAMUDR',
          created_at: '2026-10-16T08:00:00Z',
          pair_code: 'TBG-040',
          pair_partner_name: 'TB. PRIMA SAKTI VI',
          candidates: [{ id: 'v9', vessel_name: 'BG. PRIMA SAMUDRA VI', vessel_code: 'MPRIMASAM6' }],
        },
      ],
    });
    const items = await listVesselsForReview();
    const sql = String(queryMock.mock.calls[0][0]).replace(/\s+/g, ' ');
    expect(sql).toContain("mv.review_status = 'PENDING'");
    expect(sql).toContain('ORDER BY mv.created_at DESC');
    // a candidate is never another vessel waiting for review, and never the vessel itself
    expect(sql).toContain("o.review_status IS DISTINCT FROM 'PENDING'");
    expect(sql).toContain('o.id <> mv.id');
    expect(items).toEqual([
      expect.objectContaining({
        id: 'v1',
        review_reasons: ['truncated', 'no_prefix'],
        pair_code: 'TBG-040',
        candidates: [{ id: 'v9', vessel_name: 'BG. PRIMA SAMUDRA VI', vessel_code: 'MPRIMASAM6' }],
      }),
    ]);
  });

  it('a vessel with no reason text and no candidates still lists', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 'v2', vessel_name: 'X', vessel_code: 'M', review_reason: null, candidates: null, created_at: null }] });
    const [item] = await listVesselsForReview();
    expect(item.review_reasons).toEqual([]);
    expect(item.candidates).toEqual([]);
  });

  it('counts them', async () => {
    queryMock.mockResolvedValue({ rows: [{ n: 7 }] });
    expect(await countVesselsForReview()).toBe(7);
  });
});

describe('approveVesselReview', () => {
  it('approves a vessel that is waiting and says so', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 'v1' }] });
    expect(await approveVesselReview('v1')).toBe(true);
    expect(String(queryMock.mock.calls[0][0]).replace(/\s+/g, ' ')).toContain("review_status = 'PENDING'");
  });

  it('says false for one that was not waiting (already approved, or never registered from SAP)', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    expect(await approveVesselReview('v1')).toBe(false);
  });
});

describe('mergeVesselForReview', () => {
  it('refuses a vessel that is not waiting for review, and writes nothing', async () => {
    clientQuery.mockImplementation(async (sql: string) => (/SELECT 1 FROM master_vessels/.test(sql) ? { rows: [] } : { rows: [] }));
    const result = await mergeVesselForReview('from', 'into');
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(applyMock).not.toHaveBeenCalled();
    expect(clientQuery.mock.calls.some((c) => String(c[0]) === 'ROLLBACK')).toBe(true);
    expect(release).toHaveBeenCalled();
  });

  it('refuses what the merge rules refuse (a DHM-linked row, two roles, a tug into a barge), with their reasons', async () => {
    clientQuery.mockImplementation(async (sql: string) => (/SELECT 1 FROM master_vessels/.test(sql) ? { rows: [{ '?column?': 1 }] } : { rows: [] }));
    planMock.mockResolvedValue({ from: { id: 'from' }, into: { id: 'into', vessel_name: 'BG. A' }, counts: {}, blockers: ['peran berbeda (TB vs BG): dua kapal, bukan satu'] });
    const result = await mergeVesselForReview('from', 'into');
    expect(result).toEqual({ ok: false, status: 422, error: 'peran berbeda (TB vs BG): dua kapal, bukan satu' });
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('merges inside one transaction and reports what moved', async () => {
    clientQuery.mockImplementation(async (sql: string) => (/SELECT 1 FROM master_vessels/.test(sql) ? { rows: [{ '?column?': 1 }] } : { rows: [] }));
    planMock.mockResolvedValue({ from: { id: 'from' }, into: { id: 'into', vessel_name: 'BG. PRIMA SAMUDRA VI' }, counts: {}, blockers: [] });
    applyMock.mockResolvedValue({ aliases: 1, shipments: 4, pairsMoved: 1, pairsDropped: 0 });
    const result = await mergeVesselForReview('from', 'into');
    expect(result).toEqual({ ok: true, into: { id: 'into', vessel_name: 'BG. PRIMA SAMUDRA VI' }, moved: { aliases: 1, shipments: 4, pairsMoved: 1, pairsDropped: 0 } });
    const texts = clientQuery.mock.calls.map((c) => String(c[0]).trim());
    expect(texts[0]).toBe('BEGIN');
    expect(texts[texts.length - 1]).toBe('COMMIT');
    expect(release).toHaveBeenCalled();
  });

  it('rolls back and rethrows when the merge itself fails', async () => {
    clientQuery.mockImplementation(async (sql: string) => (/SELECT 1 FROM master_vessels/.test(sql) ? { rows: [{ '?column?': 1 }] } : { rows: [] }));
    planMock.mockResolvedValue({ from: { id: 'from' }, into: { id: 'into', vessel_name: 'BG. A' }, counts: {}, blockers: [] });
    applyMock.mockRejectedValue(new Error('constraint'));
    await expect(mergeVesselForReview('from', 'into')).rejects.toThrow('constraint');
    expect(clientQuery.mock.calls.some((c) => String(c[0]) === 'ROLLBACK')).toBe(true);
    expect(release).toHaveBeenCalled();
  });
});

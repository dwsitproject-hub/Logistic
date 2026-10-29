import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('../database/connection', () => ({ query: queryMock }));
vi.mock('./client', () => ({ jpsRequest: vi.fn() }));
vi.mock('./applyInstruction', () => ({ applyJpsInstruction: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { pollSubmittedInstructions } from './poll';
import { JPS_LIVE_STATUSES, JPS_LIVE_STATUSES_SQL, isJpsClosedStatus } from './types';

/**
 * JPS v5.7 (2026-10-29): after Allocated the status goes Berthed -> Start Cargo -> Cargo Done -> Sailed Off. The poller knew only Pending / Approved / Allocated, so an instruction
 * that reached Berthed stopped being polled and the cargo window (Hose On / Hose Off) and the departure would have arrived only by webhook.
 */
describe('which instructions the poller keeps asking about', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });
  });

  it('every stage that can still move: Pending, Approved, Allocated, Berthed, Start Cargo, Cargo Done', async () => {
    expect([...JPS_LIVE_STATUSES]).toEqual(['Pending', 'Approved', 'Allocated', 'Berthed', 'Start Cargo', 'Cargo Done']);
    await pollSubmittedInstructions();
    const sql = String(queryMock.mock.calls[0][0]);
    for (const status of JPS_LIVE_STATUSES) expect(sql).toContain(`'${status}'`);
  });

  it('never a terminal one: Rejected, Deleted, Sailed Off, and the older Sailed', async () => {
    await pollSubmittedInstructions();
    const sql = String(queryMock.mock.calls[0][0]);
    const inList = /jps_status, 'Pending'\) IN \(([^)]*)\)/.exec(sql)?.[1] ?? '';
    for (const status of ['Rejected', 'Deleted', 'Sailed Off', 'Sailed']) expect(inList).not.toContain(`'${status}'`);
  });

  it('the SQL list is the constant, quoted, for an IN (...)', () => {
    expect(JPS_LIVE_STATUSES_SQL).toBe("'Pending', 'Approved', 'Allocated', 'Berthed', 'Start Cargo', 'Cargo Done'");
  });

  it('closed (a new instruction under the next revision) stays Rejected and Deleted; the stages are not closed', () => {
    expect(isJpsClosedStatus('Rejected')).toBe(true);
    expect(isJpsClosedStatus('Deleted')).toBe(true);
    for (const s of ['Berthed', 'Start Cargo', 'Cargo Done', 'Sailed Off', 'Sailed']) expect(isJpsClosedStatus(s)).toBe(false);
  });
});

describe('the partial index behind the poll (migration 251) has the same predicate', () => {
  it('lists exactly the live statuses', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', '251_jps_poll_index_v57_statuses.sql'), 'utf8');
    expect(sql).toContain(`jps_status IN (${JPS_LIVE_STATUSES_SQL})`);
  });
});

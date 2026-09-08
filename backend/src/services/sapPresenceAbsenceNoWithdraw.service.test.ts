import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { applyPresenceState } from './sapPresence.service';

/**
 * Absence must never withdraw a contract on its own.
 *
 * SAP export files are produced per period, so a 2026-only file contains no 2025 PO at all.
 * On 2026-09-07 that withdrew 370 contracts - 143 with no SAP cancellation flag - hiding
 * 83,623 MT the 2025 file still reported as Open. Cancellation now comes only from SAP's
 * explicit Delete PO / Delete STO flags, or from an operator naming the PO.
 */
function fakeClient(): { client: PoolClient; sql: string[] } {
  const sql: string[] = [];
  const client = {
    query: async (text: string) => {
      sql.push(String(text));
      return { rowCount: 0, rows: [{ n: 0 }] };
    },
  } as unknown as PoolClient;
  return { client, sql };
}

/**
 * Statements that actually *cause* a withdrawal. Matching `sap_presence = 'WITHDRAWN'` alone is
 * not enough: the restore statement carries that same text in its WHERE clause while setting
 * PRESENT. It has to be the assignment right after SET, or an audit row whose to_state is
 * WITHDRAWN - a laxer pattern spans from SET across into that WHERE and matches the restore.
 */
const withdrawStatements = (sql: string[]) =>
  sql.filter(
    (s) =>
      /SET\s+sap_presence\s*=\s*'WITHDRAWN'/.test(s) ||
      (/INSERT INTO sap_presence_audit/.test(s) && /'WITHDRAWN',/.test(s)),
  );

describe('applyPresenceState - absence is a signal, not a withdrawal', () => {
  it('issues no withdrawal at all when no operator named a PO', async () => {
    const { client, sql } = fakeClient();
    const outcome = await applyPresenceState(client, { importId: null });

    expect(withdrawStatements(sql)).toHaveLength(0);
    expect(outcome.withdrawn).toBe(0);
    // The absence counters are still read - the signal itself must survive.
    expect(sql.some((s) => s.includes('consecutive_misses'))).toBe(true);
  });

  it('never derives a withdrawal from the miss threshold', async () => {
    const { client, sql } = fakeClient();
    await applyPresenceState(client, { importId: null, minMisses: 2 });

    /*
     * No statement that withdraws may reference the miss counter - that combination is exactly
     * the inference this fix removes. The restore path legitimately reads
     * `consecutive_misses = 0` to detect a PO that reappeared, so it is not in scope here.
     */
    for (const s of withdrawStatements(sql)) {
      expect(s).not.toContain('consecutive_misses');
    }
  });

  it('still withdraws POs an operator explicitly named', async () => {
    const { client, sql } = fakeClient();
    await applyPresenceState(client, { importId: null, extraPos: ['1001030860'] });

    // One audit insert + one update, both operator-reasoned.
    const causes = withdrawStatements(sql);
    expect(causes).toHaveLength(2);
    for (const c of causes) expect(c).toContain('Operator-approved withdrawal');
  });

  it('keeps restoring anything that reappeared in SAP', async () => {
    const { client, sql } = fakeClient();
    await applyPresenceState(client, { importId: null });
    expect(sql.some((s) => /sap_presence\s*=\s*'PRESENT'/.test(s))).toBe(true);
  });
});

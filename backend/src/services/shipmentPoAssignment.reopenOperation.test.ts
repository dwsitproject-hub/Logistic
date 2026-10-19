import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../database/connection', () => ({ query: queryMock, default: { query: queryMock } }));

import { groupDischargeCompleteAta, OPERATION_ALREADY_COMPLETED } from './shipmentPoAssignment.service';

describe('groupDischargeCompleteAta', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('is null for an empty group without touching the database', async () => {
    await expect(groupDischargeCompleteAta([])).resolves.toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns the latest discharge-complete ATA as YYYY-MM-DD', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ atc: '2026-09-30' }] });
    await expect(groupDischargeCompleteAta(['a', 'b'])).resolves.toBe('2026-09-30');
    const [sql, params] = queryMock.mock.calls[0];
    expect(params).toEqual([['a', 'b']]);
    // the same lanes the Shipments list reads: JPS while open, manual override, stored value, discharge port row
    const flat = String(sql).replace(/\s+/g, ' ');
    expect(flat).toContain("CASE WHEN s.status IS DISTINCT FROM 'COMPLETED' THEN sao.jps_ata_discharge_complete END");
    expect(flat).toContain('sao.ata_discharge_complete');
    expect(flat).toContain('s.ata_discharge_complete');
    expect(flat).toContain('v.ata_loading_completed');
  });

  it('is null when no member has one', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ atc: null }] });
    await expect(groupDischargeCompleteAta(['a'])).resolves.toBeNull();
  });
});

describe('attachPurchaseOrderToShipment reopens a finished operation', () => {
  const src = readFileSync(resolve(__dirname, 'shipmentPoAssignment.service.ts'), 'utf8');

  it('answers 409 with a code, before anything is written, unless the caller confirmed', () => {
    expect(OPERATION_ALREADY_COMPLETED).toBe('OPERATION_ALREADY_COMPLETED');
    const gate = src.indexOf('priorAta && !args.reopenOperation');
    expect(gate).toBeGreaterThan(0);
    expect(src.slice(gate, gate + 400)).toContain('status: 409');
    // the first write of the attach is the UPDATE / INSERT on shipments: the gate comes before both
    expect(gate).toBeLessThan(src.indexOf('UPDATE shipments SET'));
    expect(gate).toBeLessThan(src.indexOf('INSERT INTO shipments ('));
  });

  it('clears the discharge-complete ATA on the whole group only after the PO is linked, and reports what is still in effect', () => {
    const link = src.indexOf('await upsertPoQtyAssignment(context.lookup_key');
    const clear = src.indexOf('{ ata_vessel_complete_discharge: null }');
    expect(clear).toBeGreaterThan(link);
    expect(src).toContain('upsertShipmentAtaOverrideForStoGroup(');
    expect(src).toContain('remainingAta = await groupDischargeCompleteAta(memberIds)');
  });
});

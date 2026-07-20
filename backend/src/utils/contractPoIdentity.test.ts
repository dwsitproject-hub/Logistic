import { describe, expect, it } from 'vitest';
import {
  contractSurvivorScore,
  extractContractExtNoFromSpdJson,
  isPlaceholderExtNo,
  normalizePoNumber,
  normalizeStoNumber,
  poStoProcessedKey,
} from './contractPoIdentity';
import { pickContractSurvivor, type ContractRowRef } from '../services/contractMerge.service';

describe('contractPoIdentity', () => {
  it('normalizePoNumber trims and rejects empty', () => {
    expect(normalizePoNumber(' 1001030797 ')).toBe('1001030797');
    expect(normalizePoNumber('')).toBeNull();
    expect(normalizePoNumber(null)).toBeNull();
  });

  it('normalizeStoNumber treats missing STO as empty key', () => {
    expect(normalizeStoNumber(null)).toBe('');
    expect(normalizeStoNumber(' 1586004884 ')).toBe('1586004884');
  });

  it('isPlaceholderExtNo ignores TBA and blanks', () => {
    expect(isPlaceholderExtNo('TBA')).toBe(true);
    expect(isPlaceholderExtNo('tba')).toBe(true);
    expect(isPlaceholderExtNo('')).toBe(true);
    expect(isPlaceholderExtNo('-')).toBe(true);
    expect(isPlaceholderExtNo('SJ01VI07-00643')).toBe(false);
  });

  it('extractContractExtNoFromSpdJson reads raw field', () => {
    expect(
      extractContractExtNoFromSpdJson({
        raw: { 'Contract Ext No': 'CO/CKG/HPS/002/05/26' },
      }),
    ).toBe('CO/CKG/HPS/002/05/26');
  });

  it('poStoProcessedKey supports PO-only and PO+STO; rejects missing PO', () => {
    expect(poStoProcessedKey('1001', 'STO1')).toEqual({ po: '1001', sto: 'STO1' });
    expect(poStoProcessedKey('1001', null)).toEqual({ po: '1001', sto: '' });
    expect(poStoProcessedKey('', 'STO1')).toBeNull();
  });

  it('same STO with different POs produce distinct processed keys', () => {
    const a = poStoProcessedKey('1001030797', '1586004884');
    const b = poStoProcessedKey('1001031094', '1586004884');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(`${a!.po}|${a!.sto}`).not.toBe(`${b!.po}|${b!.sto}`);
  });

  it('contractSurvivorScore prefers Open status', () => {
    const open = contractSurvivorScore({ status: 'Open', updated_at: '2020-01-01' });
    const closed = contractSurvivorScore({ status: 'Close', updated_at: '2026-01-01' });
    expect(open).toBeGreaterThan(closed);
  });
});

describe('PO ↔ Ext No cleanup selection', () => {
  it('1 Ext No with 2 POs picks latest-SPD canonical PO when present', () => {
    const rows: ContractRowRef[] = [
      {
        id: 'a',
        contract_id: 'C-OLD',
        po_number: '1001030797',
        status: 'Open',
        updated_at: '2025-01-01',
        created_at: '2025-01-01',
      },
      {
        id: 'b',
        contract_id: 'C-NEW',
        po_number: '1001031094',
        status: 'Open',
        updated_at: '2026-01-01',
        created_at: '2026-01-01',
      },
    ];
    const canonicalPo = '1001031094';
    const survivor =
      rows.find((r) => normalizePoNumber(r.po_number) === canonicalPo) ?? pickContractSurvivor(rows);
    expect(survivor.po_number).toBe('1001031094');
  });

  it('1 PO with 2 contract rows picks Open survivor', () => {
    const rows: ContractRowRef[] = [
      {
        id: '1',
        contract_id: '6030100953',
        po_number: '1001030346',
        status: 'Close',
        updated_at: '2026-06-01',
        created_at: '2026-01-01',
      },
      {
        id: '2',
        contract_id: 'CO/CKG/HPS/002/05/26',
        po_number: '1001030346',
        status: 'Open',
        updated_at: '2026-05-01',
        created_at: '2026-02-01',
      },
    ];
    expect(pickContractSurvivor(rows).id).toBe('2');
  });

  it('ignores TBA when deciding Ext No placeholders', () => {
    expect(isPlaceholderExtNo('TBA')).toBe(true);
    expect(isPlaceholderExtNo('001/BPN/PKS/III/2026')).toBe(false);
  });
});

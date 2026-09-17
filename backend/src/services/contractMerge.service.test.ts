import { describe, expect, it } from 'vitest';
import { pickContractSurvivor, type ContractRowRef } from '../services/contractMerge.service';

describe('contractMerge.service', () => {
  it('pickContractSurvivor prefers Open then latest updated', () => {
    const rows: ContractRowRef[] = [
      {
        id: '1',
        contract_id: 'C1',
        po_number: '1001',
        status: 'Close',
        updated_at: '2026-01-01',
        created_at: '2025-01-01',
      },
      {
        id: '2',
        contract_id: 'C2',
        po_number: '1001',
        status: 'Open',
        updated_at: '2020-01-01',
        created_at: '2020-01-01',
      },
    ];
    expect(pickContractSurvivor(rows).id).toBe('2');
  });
});

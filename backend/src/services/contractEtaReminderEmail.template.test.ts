import { describe, expect, it } from 'vitest';
import {
  buildContractEtaReminderEmailHtml,
  buildContractEtaReminderEmailSubject,
  resolveMissingEtaLabel,
  type ContractEtaReminderRow,
} from './contractEtaReminderEmail.template';

function makeRow(overrides: Partial<ContractEtaReminderRow> = {}): ContractEtaReminderRow {
  return {
    contract_id: 'C-1',
    contract_ext_no: 'EXT-1',
    po_number: '1001000001',
    supplier: 'Test Supplier',
    product: 'Coal',
    incoterm: 'FOB',
    transport_mode: 'SEA',
    cargo_readiness_date: '2026-08-10',
    days_to_cargo_readiness: 5,
    sea_missing_eta: true,
    land_missing_eta: false,
    ...overrides,
  };
}

describe('buildContractEtaReminderEmailSubject', () => {
  it('pluralizes correctly for multiple contracts', () => {
    expect(buildContractEtaReminderEmailSubject([makeRow(), makeRow()])).toBe(
      'KLIP Alert: 2 Open Contracts Missing ETA — Cargo Ready Within 7 Days',
    );
  });

  it('uses singular wording for exactly one contract', () => {
    expect(buildContractEtaReminderEmailSubject([makeRow()])).toBe(
      'KLIP Alert: 1 Open Contract Missing ETA — Cargo Ready Within 7 Days',
    );
  });
});

describe('resolveMissingEtaLabel', () => {
  it('returns Shipment for a SEA contract missing shipment ETA', () => {
    expect(resolveMissingEtaLabel(makeRow({ transport_mode: 'SEA', sea_missing_eta: true }))).toBe(
      'Shipment',
    );
  });

  it('returns Trucking for a LAND contract missing trucking ETA', () => {
    expect(
      resolveMissingEtaLabel(
        makeRow({ transport_mode: 'LAND', sea_missing_eta: false, land_missing_eta: true }),
      ),
    ).toBe('Trucking');
  });

  it('returns combined label for a MIX contract missing both', () => {
    expect(
      resolveMissingEtaLabel(
        makeRow({ transport_mode: 'MIX', sea_missing_eta: true, land_missing_eta: true }),
      ),
    ).toBe('Shipment & Trucking');
  });

  it('returns a dash when neither leg is missing (defensive default)', () => {
    expect(
      resolveMissingEtaLabel(
        makeRow({ transport_mode: 'SEA', sea_missing_eta: false, land_missing_eta: false }),
      ),
    ).toBe('-');
  });
});

describe('buildContractEtaReminderEmailHtml', () => {
  it('includes row data, the contract performance link, and row count', () => {
    const html = buildContractEtaReminderEmailHtml([makeRow()], 'http://localhost:3001');
    expect(html).toContain('1001000001');
    expect(html).toContain('Test Supplier');
    expect(html).toContain('http://localhost:3001/contract-performance');
    expect(html).toContain('<strong>1</strong>');
  });

  it('shows an overdue label for negative days remaining', () => {
    const html = buildContractEtaReminderEmailHtml(
      [makeRow({ days_to_cargo_readiness: -2 })],
      'http://localhost:3001',
    );
    expect(html).toContain('Overdue by 2 days');
  });

  it('shows a "days left" label for upcoming dates', () => {
    const html = buildContractEtaReminderEmailHtml(
      [makeRow({ days_to_cargo_readiness: 5 })],
      'http://localhost:3001',
    );
    expect(html).toContain('5 days left');
  });

  it('caps inline rows at 100 and shows a "+N more" note beyond that', () => {
    const rows = Array.from({ length: 105 }, (_, i) => makeRow({ contract_id: `C-${i}`, po_number: `PO-${i}` }));
    const html = buildContractEtaReminderEmailHtml(rows, 'http://localhost:3001');
    expect(html).toContain('+5 more');
    expect(html).not.toContain('PO-104');
    expect(html).toContain('PO-99');
  });

  it('does not show a "more" note when under the cap', () => {
    const html = buildContractEtaReminderEmailHtml([makeRow()], 'http://localhost:3001');
    expect(html).not.toContain('more — please check KLIP');
  });
});

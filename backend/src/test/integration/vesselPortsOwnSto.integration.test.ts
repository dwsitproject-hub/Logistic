import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../database/connection';
import { resolveLatestSapRowForShipment } from '../../services/vesselLoadingPortsFromSap.service';

/**
 * The SAP row a shipment takes its ports and dates from must be the shipment's OWN STO's (shipment_id / operation_id), never the contract's sto_number.
 *
 * Operation OP-1004030473-49138234 (2026-11-12): five shipments of a manual STO (MNL-...) were given the ATC of the same POs' finished voyage on another STO, because the
 * resolver also matched contracts.sto_number and, failing that, used any SAP row of the contract whole.
 */
const P = 'ITEST-OWNSTO';
const OLD_STO = `${P}-STO-OLD`;

describe('Integration: the SAP row of a shipment is its own STO\'s', () => {
  const ids: { manual?: string; own?: string; bare?: string } = {};

  const cleanup = async () => {
    await query(`DELETE FROM shipments WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE $1)`, [`${P}-%`]);
    await query(`DELETE FROM sap_processed_data WHERE contract_number LIKE $1`, [`${P}-%`]);
    await query(`DELETE FROM sap_data_imports spi WHERE NOT EXISTS (SELECT 1 FROM sap_processed_data s WHERE s.import_id = spi.id) AND spi.total_records = 777`);
    await query(`DELETE FROM contracts WHERE contract_id LIKE $1`, [`${P}-%`]);
  };

  beforeAll(async () => {
    await cleanup();
    const imp = await query(`INSERT INTO sap_data_imports (import_date, status, total_records, processed_records) VALUES (CURRENT_DATE, 'completed', 777, 777) RETURNING id`);
    const importId = imp.rows[0].id as string;
    // the contract's own STO is the OLD voyage's, as contracts.sto_number was for PO 1001029445
    const c = await query(
      `INSERT INTO contracts (contract_id, buyer, supplier, product, quantity_ordered, unit, unit_price, contract_date, delivery_end_date, contract_value, currency, status, incoterm, sto_number)
       VALUES ($1, 'B', 'IT-Supplier-OwnSto', 'CPO', 1000, 'MT', 10, '2026-01-15', '2026-12-31', 10000, 'USD', 'Open', 'FOB', $2) RETURNING id`,
      [`${P}-CTR`, OLD_STO],
    );
    const contractId = c.rows[0].id as string;
    // the finished voyage on the old STO, then a PO-level row with no STO (newer)
    await query(`INSERT INTO sap_processed_data (import_id, contract_number, sto_number, data, status) VALUES ($1, $2, $3, $4::jsonb, 'processed')`, [
      importId,
      `${P}-CTR`,
      OLD_STO,
      JSON.stringify({ marker: 'old-voyage' }),
    ]);
    await query(`INSERT INTO sap_processed_data (import_id, contract_number, sto_number, data, status) VALUES ($1, $2, NULL, $3::jsonb, 'processed')`, [
      importId,
      `${P}-CTR`,
      JSON.stringify({ marker: 'po-level' }),
    ]);
    // shipments.shipment_id is NOT NULL: "no STO reference of its own" is an empty one
    const ins = async (shipmentId: string, operationId: string | null) =>
      (
        await query(`INSERT INTO shipments (shipment_id, operation_id, contract_id, vessel_name, status) VALUES ($1, $2, $3, 'IT VESSEL', 'PLANNED') RETURNING id`, [
          shipmentId,
          operationId,
          contractId,
        ])
      ).rows[0].id as string;
    ids.manual = await ins(`MNL-${P}-1`, `OP-${P}-1`); // a manual STO SAP does not know
    ids.own = await ins(OLD_STO, null); // the shipment of the old STO itself
    ids.bare = await ins('', null); // no STO reference at all
  }, 60000);

  afterAll(async () => {
    await cleanup();
  });

  it('a manual STO is NOT given the old voyage\'s row as its own, although it is the contract\'s sto_number', async () => {
    const r = await resolveLatestSapRowForShipment(ids.manual!);
    expect(r).not.toBeNull();
    expect(r!.ownStoMatch).toBe(false); // a fallback: the caller keeps the port names only
  });

  it('the shipment of the old STO resolves to its own row', async () => {
    const r = await resolveLatestSapRowForShipment(ids.own!);
    expect(r).not.toBeNull();
    expect(r!.ownStoMatch).toBe(true);
    expect((r!.data as { marker?: string }).marker).toBe('old-voyage');
  });

  it('a shipment with no STO reference of its own still resolves through the contract\'s sto_number, as before', async () => {
    const r = await resolveLatestSapRowForShipment(ids.bare!);
    expect(r).not.toBeNull();
    expect(r!.ownStoMatch).toBe(true);
    expect((r!.data as { marker?: string }).marker).toBe('old-voyage');
  });
});

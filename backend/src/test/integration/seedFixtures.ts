import { query } from '../../database/connection';

export type IntegrationFixtureIds = {
  contractAId: string;
  contractBId: string;
  paymentId: string;
};

/**
 * Deterministic rows for integration tests (prefix ITEST-). Safe to re-run.
 */
export async function seedIntegrationFixtures(): Promise<IntegrationFixtureIds> {
  await query(`DELETE FROM documents WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE 'ITEST-%')`);
  await query(`DELETE FROM payments WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE 'ITEST-%')`);
  await query(`DELETE FROM sap_processed_data WHERE contract_number LIKE 'ITEST-%'`);
  await query(`
    DELETE FROM sap_data_imports spi
    WHERE NOT EXISTS (SELECT 1 FROM sap_processed_data s WHERE s.import_id = spi.id)
  `);
  await query(`DELETE FROM contracts WHERE contract_id LIKE 'ITEST-%'`);

  const imp = await query(
    `INSERT INTO sap_data_imports (import_date, status, total_records, processed_records)
     VALUES (CURRENT_DATE, 'completed', 1, 1) RETURNING id`
  );
  const importId = imp.rows[0].id as string;

  const dataA = {
    contract: {
      status: 'Open',
      sto_quantity: '400',
    },
    payment: {
      due_date_payment: '2020-06-01',
    },
  };

  const dataA2 = {
    contract: {
      status: 'Open',
      sto_quantity: '100',
    },
  };

  const cA = await query(
    `INSERT INTO contracts (
       contract_id, buyer, supplier, product, quantity_ordered, unit, unit_price,
       contract_date, delivery_end_date, contract_value, currency, status, incoterm
     ) VALUES (
       'ITEST-A', 'Buyer A', 'IT-Supplier-Unique', 'Palm Oil', 1000, 'MT', 10,
       '2024-01-15', '2024-12-31', 10000, 'USD', 'Open', 'FOB'
     ) RETURNING id`
  );
  const contractAId = cA.rows[0].id as string;

  const cB = await query(
    `INSERT INTO contracts (
       contract_id, buyer, supplier, product, quantity_ordered, unit, unit_price,
       contract_date, delivery_end_date, contract_value, currency, status, incoterm
     ) VALUES (
       'ITEST-B', 'Buyer B', 'Other Supplier', 'Soy', 500, 'MT', 20,
       '2024-02-01', '2024-11-30', 5000, 'USD', 'Close', 'CIF'
     ) RETURNING id`
  );
  const contractBId = cB.rows[0].id as string;

  await query(
    `INSERT INTO sap_processed_data (import_id, contract_number, sto_number, data, status)
     VALUES ($1, 'ITEST-A', 'ITSTO-A1', $2::jsonb, 'processed')`,
    [importId, JSON.stringify(dataA)]
  );
  await query(
    `INSERT INTO sap_processed_data (import_id, contract_number, sto_number, data, status)
     VALUES ($1, 'ITEST-A', 'ITSTO-A2', $2::jsonb, 'processed')`,
    [importId, JSON.stringify(dataA2)]
  );

  await query(
    `INSERT INTO sap_processed_data (import_id, contract_number, sto_number, data, status)
     VALUES ($1, 'ITEST-B', 'ITSTO-B1', $2::jsonb, 'processed')`,
    [
      importId,
      JSON.stringify({
        contract: { status: 'Close', sto_quantity: '500' },
      }),
    ]
  );

  await query(`REFRESH MATERIALIZED VIEW mv_contract_payment_dates`);

  const pay = await query(
    `INSERT INTO payments (
       contract_id, invoice_number, payment_amount, currency, payment_due_date, payment_status
     ) VALUES ($1, 'INV-ITEST-1', 0, 'USD', '2020-06-01', 'PENDING')
     RETURNING id`,
    [contractAId]
  );
  const paymentId = pay.rows[0].id as string;

  return { contractAId, contractBId, paymentId };
}

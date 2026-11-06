import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../database/connection';
import { SapMasterV2ImportService } from '../../services/sapMasterV2Import.service';
import { SapDataDistributionService } from '../../services/sapDataDistribution.service';
import { buildKlipEditedFieldsSetSql } from '../../utils/klipEditedFields';

/**
 * The SAP Phase 3 template (2026-11) through the real import pipeline against a real Postgres:
 * - the material lands on the contract and contracts.product keeps the commercial name;
 * - SAP's SFAL / SFBD go to sap_sfal_qty / sap_sfbd_qty (a zero is no figure) and fill sfal_qty / sfbd_qty only where no user wrote one, on an STO with one row;
 * - a multi-PO STO keeps SAP's figure as a reference only (SAP repeats the voyage figure on some of them).
 * Cells are text, as the importer reads a sheet formatted: SAP's 0 arrives as "0.000", a quantity as "497,100.000".
 */

const PREFIX = 'ITEST-PH3';

const HEADERS = [
  'Contract No.', 'PO No.', 'Supplier', 'Product', 'Material Code', 'Material Description', 'Contract Quantity', 'Contract Qty UoM', 'Sea / Land',
  'Incoterm', 'STO No.', 'STO Quantity', 'GR PO Status', 'GR STO Status', 'Vessel Name', 'SFAL Qty', 'SFAL UoM', 'SFBD Qty', 'SFBD UoM',
];

interface Row {
  key: string; // short id: contract <PREFIX>-CTR-<key>, PO <PREFIX>-PO-<key>
  sto: string;
  sfal: string;
  sfbd: string;
  material?: string;
  description?: string;
}

const cell = (r: Row): string[] => [
  `${PREFIX}-CTR-${r.key}`, `${PREFIX}-PO-${r.key}`, 'IT-Supplier-Ph3', 'CPO', r.material ?? '8010-10.11102', r.description ?? 'CRUDE PALM OIL FFA 3.5-5',
  '1000', 'MT', 'SEA', 'FOB', `${PREFIX}-STO-${r.sto}`, '500', 'Open', 'Open', 'MV Phase Three', r.sfal, r.sfal === '0.000' ? '' : 'KG', r.sfbd, r.sfbd === '0.000' ? '' : 'KG',
];

function writeWorkbook(filePath: string, rows: Row[]): void {
  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows.map(cell)]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Logistic Report');
  XLSX.writeFile(book, filePath);
}

async function cleanup(importIds: string[] = []): Promise<void> {
  await query(`DELETE FROM shipments WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE $1)`, [`${PREFIX}-%`]);
  await query(`DELETE FROM contract_stos WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE $1)`, [`${PREFIX}-%`]);
  await query(`DELETE FROM contracts WHERE contract_id LIKE $1`, [`${PREFIX}-%`]);
  if (importIds.length > 0) await query(`DELETE FROM sap_data_imports WHERE id = ANY($1::uuid[])`, [importIds]);
  await query(
    `DELETE FROM sap_data_imports WHERE id IN (SELECT DISTINCT import_id FROM sap_processed_data WHERE contract_number LIKE $1)`,
    [`${PREFIX}-%`],
  );
}

const shipmentOf = async (key: string) => {
  const r = await query(
    `SELECT s.sfal_qty, s.sap_sfal_qty, s.sfbd_qty, s.sap_sfbd_qty, s.klip_edited_fields
       FROM shipments s JOIN contracts c ON c.id = s.contract_id WHERE c.contract_id = $1`,
    [`${PREFIX}-CTR-${key}`],
  );
  return r.rows;
};
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

describe('Integration: SAP Phase 3 template - SFAL / SFBD and the material', () => {
  const tmp = path.join(os.tmpdir(), 'itest-phase3.xlsx');
  const importIds: string[] = [];
  const run = async (rows: Row[]) => {
    writeWorkbook(tmp, rows);
    const result = await SapMasterV2ImportService.importMasterV2File(tmp, { source: 'manual' });
    if (result.importId) importIds.push(result.importId);
    expect(result.success).toBe(true);
    expect(result.failedRecords).toBe(0);
  };

  beforeAll(async () => {
    await cleanup();
  }, 30000);

  afterAll(async () => {
    await cleanup(importIds);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  });

  it('first import: the material is on the contract, the product keeps its commercial name, SAP figures fill an empty single-PO STO, a zero is no figure', async () => {
    await run([
      { key: 'S1', sto: 'S1', sfal: '497,100.000', sfbd: '0.000' }, // figure for SFAL, none for SFBD
      { key: 'S2', sto: 'S2', sfal: '300,000.000', sfbd: '290,000.000' }, // the user will own SFAL later
      { key: 'S4', sto: 'S4', sfal: '0.000', sfbd: '0.000' }, // SAP has nothing
      { key: 'M1', sto: 'M', sfal: '4,006,260.000', sfbd: '0.000', material: '8010-10.11103', description: 'CRUDE PALM OIL FFA > 5 (CPO)' }, // multi-PO STO, voyage figure repeated
      { key: 'M2', sto: 'M', sfal: '4,006,260.000', sfbd: '0.000' },
    ]);

    const c = await query(`SELECT product, material_code, material_description FROM contracts WHERE contract_id = $1`, [`${PREFIX}-CTR-S1`]);
    expect(c.rows[0].product).toBe('CPO');
    expect(c.rows[0].material_code).toBe('8010-10.11102');
    expect(c.rows[0].material_description).toBe('CRUDE PALM OIL FFA 3.5-5');
    const m1 = await query(`SELECT material_code FROM contracts WHERE contract_id = $1`, [`${PREFIX}-CTR-M1`]);
    expect(m1.rows[0].material_code).toBe('8010-10.11103');

    const s1 = (await shipmentOf('S1'))[0];
    expect(num(s1.sap_sfal_qty)).toBe(497100);
    expect(num(s1.sfal_qty)).toBe(497100); // filled: SAP has it, no user wrote one, one row on the STO
    expect(num(s1.sap_sfbd_qty)).toBeNull(); // "0.000" is no figure, not 0
    expect(num(s1.sfbd_qty)).toBeNull();

    const s4 = (await shipmentOf('S4'))[0];
    expect(num(s4.sap_sfal_qty)).toBeNull();
    expect(num(s4.sfal_qty)).toBeNull();

    const m = [...(await shipmentOf('M1')), ...(await shipmentOf('M2'))];
    expect(m).toHaveLength(2);
    for (const row of m) {
      expect(num(row.sap_sfal_qty)).toBe(4006260); // kept as the reference
      expect(num(row.sfal_qty)).toBeNull(); // not auto-filled on a multi-PO STO
    }
  }, 120000);

  it('a figure a user wrote is never replaced; a figure SAP filled follows SAP; a SAP zero changes nothing', async () => {
    // a user saves SFAL on S2 (what the Edit Shipment save does: the value and the marker)
    await query(
      `UPDATE shipments SET sfal_qty = 111000, klip_edited_fields = ARRAY['sfal_qty']
        WHERE contract_id = (SELECT id FROM contracts WHERE contract_id = $1)`,
      [`${PREFIX}-CTR-S2`],
    );

    await run([
      { key: 'S1', sto: 'S1', sfal: '500,000.000', sfbd: '0.000' }, // SAP changed its figure; it filled the value, so it follows
      { key: 'S2', sto: 'S2', sfal: '305,000.000', sfbd: '0.000' }, // SAP changed SFAL (user owns it) and sent 0 for SFBD (SAP's earlier 290,000 stays)
      { key: 'S4', sto: 'S4', sfal: '0.000', sfbd: '0.000' },
      { key: 'M1', sto: 'M', sfal: '4,006,260.000', sfbd: '0.000' },
      { key: 'M2', sto: 'M', sfal: '4,006,260.000', sfbd: '0.000' },
    ]);

    const s1 = (await shipmentOf('S1'))[0];
    expect(num(s1.sap_sfal_qty)).toBe(500000);
    expect(num(s1.sfal_qty)).toBe(500000); // followed SAP

    const s2 = (await shipmentOf('S2'))[0];
    expect(num(s2.sfal_qty)).toBe(111000); // the user's figure is untouched
    expect(num(s2.sap_sfal_qty)).toBe(305000); // SAP's own is still recorded beside it
    expect(num(s2.sap_sfbd_qty)).toBe(290000); // a SAP zero did not erase the reference
    expect(num(s2.sfbd_qty)).toBe(290000); // SFBD was SAP's (no marker) and stays; the zero did not write 0
  }, 120000);

  it('a user who cleared a figure keeps it cleared (the marker is on the column)', async () => {
    await query(
      `UPDATE shipments SET sfal_qty = NULL, klip_edited_fields = ARRAY['sfal_qty']
        WHERE contract_id = (SELECT id FROM contracts WHERE contract_id = $1)`,
      [`${PREFIX}-CTR-S1`],
    );
    const filled = await SapDataDistributionService.fillSapFigures({ query });
    const s1 = (await shipmentOf('S1'))[0];
    expect(num(s1.sfal_qty)).toBeNull();
    expect(num(s1.sap_sfal_qty)).toBe(500000);
    expect(filled.sfal).toBe(0);
  }, 60000);

  it('a cancelled sibling does not make the STO multi-PO, and running the fill again changes nothing', async () => {
    // M2 cancelled: M1 is then the only live row of STO M, so SAP's figure fills it
    await query(
      `UPDATE shipments SET status = 'CANCELLED' WHERE contract_id = (SELECT id FROM contracts WHERE contract_id = $1)`,
      [`${PREFIX}-CTR-M2`],
    );
    const first = await SapDataDistributionService.fillSapFigures({ query });
    expect(first.sfal).toBeGreaterThanOrEqual(1);
    const m1 = (await shipmentOf('M1'))[0];
    expect(num(m1.sfal_qty)).toBe(4006260);
    const m2 = (await shipmentOf('M2'))[0];
    expect(num(m2.sfal_qty)).toBeNull(); // the cancelled row is never filled

    const second = await SapDataDistributionService.fillSapFigures({ query });
    expect(second).toEqual({ sfal: 0, sfbd: 0 });
  }, 60000);

  it('the same file in the 93-column format (no material, no SFAL columns) leaves the material and the figures as they are', async () => {
    const oldHeaders = HEADERS.filter((h) => !/^(Material|SFAL|SFBD)/.test(h));
    const oldCell = (r: Row) => cell(r).filter((_, i) => !/^(Material|SFAL|SFBD)/.test(HEADERS[i]));
    const rows: Row[] = [{ key: 'S1', sto: 'S1', sfal: '0.000', sfbd: '0.000' }];
    const sheet = XLSX.utils.aoa_to_sheet([oldHeaders, ...rows.map(oldCell)]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Logistic Report');
    XLSX.writeFile(book, tmp);
    const result = await SapMasterV2ImportService.importMasterV2File(tmp, { source: 'manual' });
    if (result.importId) importIds.push(result.importId);
    expect(result.success).toBe(true);
    expect(result.failedRecords).toBe(0);

    const c = await query(`SELECT product, material_code FROM contracts WHERE contract_id = $1`, [`${PREFIX}-CTR-S1`]);
    expect(c.rows[0].product).toBe('CPO');
    expect(c.rows[0].material_code).toBe('8010-10.11102'); // kept: an empty cell does not erase it
    const s1 = (await shipmentOf('S1'))[0];
    expect(num(s1.sap_sfal_qty)).toBe(500000);
  }, 120000);
});

describe('Integration: migration 255 backfill', () => {
  it('marks the SFAL / SFBD figures that exist as the users\' and is idempotent', async () => {
    const sqlFile = path.join(__dirname, '../../database/migrations/255_sap_phase3_figures_and_material.sql');
    // Only the UPDATEs of the file: the ALTER TABLEs already ran with the migrations, and re-running them here would wait for the exclusive lock behind the
    // snapshot refreshes the imports above leave running in the background (a deadlock in this test, which a migration at start-up never meets).
    const whole = fs.readFileSync(sqlFile, 'utf8');
    const migration = whole.slice(whole.indexOf('UPDATE shipments'));
    expect(migration.startsWith('UPDATE shipments')).toBe(true);
    expect(migration).not.toMatch(/ALTER TABLE/);
    const PFX = 'ITEST-PH3-BF';
    await query(`DELETE FROM shipments WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE $1)`, [`${PFX}-%`]);
    await query(`DELETE FROM contracts WHERE contract_id LIKE $1`, [`${PFX}-%`]);
    try {
      const c = await query(
        `INSERT INTO contracts (contract_id, supplier, buyer, product, quantity_ordered, unit, status, created_by)
         VALUES ($1, 'S', 'B', 'CPO', 1000, 'KG', 'Open', (SELECT id FROM users LIMIT 1)) RETURNING id`,
        [`${PFX}-C1`],
      );
      const contractId = c.rows[0].id;
      const mk = async (sto: string, sfal: number | null, sfbd: number | null, marked: string[]) =>
        query(
          `INSERT INTO shipments (shipment_id, contract_id, status, sfal_qty, sfbd_qty, klip_edited_fields) VALUES ($1, $2, 'PLANNED', $3, $4, $5::text[])`,
          [`${PFX}-${sto}`, contractId, sfal, sfbd, marked],
        );
      await mk('A', 100, 200, []); // both figures, nothing marked
      await mk('B', 100, null, ['ata_arrival']); // SFAL only, another marker already there
      await mk('C', null, null, []); // no figure: nothing to mark
      await mk('D', 100, 200, ['sfal_qty', 'sfbd_qty']); // already marked

      await query(migration); // the backfill UPDATEs, guarded by NOT (... = ANY(klip_edited_fields))
      await query(migration); // and once more: idempotent

      const get = async (sto: string) =>
        (await query(`SELECT klip_edited_fields FROM shipments WHERE shipment_id = $1`, [`${PFX}-${sto}`])).rows[0].klip_edited_fields as string[];
      expect(await get('A')).toEqual(['sfal_qty', 'sfbd_qty']);
      expect(await get('B')).toEqual(['ata_arrival', 'sfal_qty']); // the other marker is kept
      expect(await get('C')).toEqual([]);
      expect(await get('D')).toEqual(['sfal_qty', 'sfbd_qty']); // no duplicates
    } finally {
      await query(`DELETE FROM shipments WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE $1)`, [`${PFX}-%`]);
      await query(`DELETE FROM contracts WHERE contract_id LIKE $1`, [`${PFX}-%`]);
    }
  }, 60000);
});

describe('Integration: a user save marks SFAL / SFBD only when it changes them', () => {
  // The Edit Shipment modal submits sfal_qty / sfbd_qty on EVERY save. Marking whatever was submitted would make a figure SAP filled the user's the first time
  // anyone saved an unrelated edit, and SAP would never fill it again. The statement is the one the update controller builds.
  const PFX = 'ITEST-PH3-SV';

  const save = async (shipmentId: string, sfal: number | null, sfbd: number | null, provided: string[] = []) => {
    const pairs = [
      { column: 'sfal_qty', placeholder: '$1::numeric' },
      { column: 'sfbd_qty', placeholder: '$2::numeric' },
    ];
    await query(
      `UPDATE shipments SET sfal_qty = $1::numeric, sfbd_qty = $2::numeric, ${buildKlipEditedFieldsSetSql('$3', pairs)} WHERE id = $4`,
      [sfal, sfbd, provided, shipmentId],
    );
    const r = await query(`SELECT sfal_qty, sfbd_qty, klip_edited_fields FROM shipments WHERE id = $1`, [shipmentId]);
    return { sfal: num(r.rows[0].sfal_qty), sfbd: num(r.rows[0].sfbd_qty), marked: r.rows[0].klip_edited_fields as string[] };
  };

  it('same figures: no marker; a changed figure: marked; a cleared one: marked; the markers already there are kept', async () => {
    await query(`DELETE FROM shipments WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE $1)`, [`${PFX}-%`]);
    await query(`DELETE FROM contracts WHERE contract_id LIKE $1`, [`${PFX}-%`]);
    try {
      const c = await query(
        `INSERT INTO contracts (contract_id, supplier, buyer, product, quantity_ordered, unit, status, created_by)
         VALUES ($1, 'S', 'B', 'CPO', 1000, 'KG', 'Open', (SELECT id FROM users LIMIT 1)) RETURNING id`,
        [`${PFX}-C1`],
      );
      // a figure SAP filled (no marker) and one the user already owns
      const a = (
        await query(
          `INSERT INTO shipments (shipment_id, contract_id, status, sfal_qty, sfbd_qty, klip_edited_fields) VALUES ($1, $2, 'PLANNED', 497100, 290000, '{}') RETURNING id`,
          [`${PFX}-A`, c.rows[0].id],
        )
      ).rows[0].id as string;

      expect(await save(a, 497100, 290000)).toEqual({ sfal: 497100, sfbd: 290000, marked: [] }); // an unrelated save sends the same figures
      expect(await save(a, 497100, 290000, ['ata_arrival'])).toEqual({ sfal: 497100, sfbd: 290000, marked: ['ata_arrival'] }); // other columns still recorded, the figures not
      expect(await save(a, 520000, 290000)).toEqual({ sfal: 520000, sfbd: 290000, marked: ['ata_arrival', 'sfal_qty'] }); // changed
      expect(await save(a, 520000, null)).toEqual({ sfal: 520000, sfbd: null, marked: ['ata_arrival', 'sfal_qty', 'sfbd_qty'] }); // cleared (NULL differs from a value)
      expect(await save(a, 520000, null)).toEqual({ sfal: 520000, sfbd: null, marked: ['ata_arrival', 'sfal_qty', 'sfbd_qty'] }); // and saving again changes nothing
    } finally {
      await query(`DELETE FROM shipments WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE $1)`, [`${PFX}-%`]);
      await query(`DELETE FROM contracts WHERE contract_id LIKE $1`, [`${PFX}-%`]);
    }
  }, 60000);

  it('the builder without pairs is byte for byte what it was before (every other caller)', () => {
    expect(buildKlipEditedFieldsSetSql('$7')).toBe(
      `klip_edited_fields = (\n    SELECT COALESCE(ARRAY(SELECT DISTINCT unnest(COALESCE(klip_edited_fields, '{}') || $7::text[]) ORDER BY 1), '{}')\n  )`,
    );
  });
});

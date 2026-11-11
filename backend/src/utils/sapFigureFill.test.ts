import { describe, expect, it } from 'vitest';
import {
  SAP_FIGURE_BL_TOLERANCE,
  buildSapFigureDecisionPreviewSql,
  buildSapFigureFillStatements,
  normalizeSapFigureKg,
} from './sapFigureFill';

describe('a SFAL / SFBD figure in tonnes under a KG label is read as kg, by the B/L of the same row', () => {
  it('the cases measured on the 11 Nov 2026 file', () => {
    expect(normalizeSapFigureKg(497.799, 500000)).toBe(497799); // STO 1006018902
    expect(normalizeSapFigureKg(2282.685, 2234530)).toBe(2282685); // STO 1006016749, 2% off the B/L
    expect(normalizeSapFigureKg(1966.379, 2000000)).toBe(1966379); // STO 1006017070
  });

  it('a real small load is left alone: x1000 is nowhere near its B/L', () => {
    expect(normalizeSapFigureKg(9956, 9960)).toBe(9956); // STO 1016010151
    expect(normalizeSapFigureKg(5997, 6000)).toBe(5997);
  });

  it('a row whose B/L is itself in tonnes has nothing to compare with, and is left alone', () => {
    expect(normalizeSapFigureKg(307.696, 308.58)).toBe(307.696); // STO 1006018144
  });

  it('a normal figure, no B/L, no figure: unchanged', () => {
    expect(normalizeSapFigureKg(497100, 500000)).toBe(497100);
    expect(normalizeSapFigureKg(497.799, null)).toBe(497.799);
    expect(normalizeSapFigureKg(497.799, 0)).toBe(497.799);
    expect(normalizeSapFigureKg(null, 500000)).toBeNull();
    expect(normalizeSapFigureKg(0, 500000)).toBe(0);
  });

  it('the 10% bound: a figure x1000 that is 11% off its B/L is not tonnes', () => {
    expect(normalizeSapFigureKg(555, 500000)).toBe(555);
    expect(normalizeSapFigureKg(540, 500000)).toBe(540000); // 8% off
  });
});

describe('the per-STO fill statements', () => {
  const sfal = buildSapFigureFillStatements('sfal_qty');
  const flat = (s: string) => s.replace(/\s+/g, ' ');

  it('write only the column and the STO-level reference of their own column', () => {
    expect(flat(sfal.setWorking)).toContain('SET sfal_qty = t.total');
    expect(flat(sfal.setWorking)).not.toContain('sfbd_qty');
    expect(flat(sfal.setReference)).toContain('SET sap_sfal_sto_qty = t.total');
    expect(flat(sfal.clearReference)).toContain('SET sap_sfal_sto_qty = NULL');
    const sfbd = buildSapFigureFillStatements('sfbd_qty');
    expect(flat(sfbd.setWorking)).toContain('SET sfbd_qty = t.total');
    expect(flat(sfbd.setWorking)).not.toContain('sfal_qty');
    expect(flat(sfbd.setReference)).toContain('SET sap_sfbd_sto_qty = t.total');
  });

  it('never write the working figure of an STO a user owns, nor a cancelled row', () => {
    expect(flat(sfal.setWorking)).toContain('AND NOT t.any_owned');
    expect(flat(sfal.clearSiblings)).toContain('AND NOT t.any_owned');
    expect(flat(sfal.clearSiblings)).toContain("NOT IN ('CANCELLED', 'CANCELED')");
    // the ownership test reads the marker of the column, on every live row of the STO
    expect(flat(sfal.setWorking)).toContain("'sfal_qty' = ANY(COALESCE(s.klip_edited_fields, '{}'))");
    expect(flat(sfal.setWorking)).toContain("UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED')");
  });

  it('put the figure on the row the Shipments list opens, with the list\'s own ordering', () => {
    const s = flat(sfal.setWorking);
    expect(s).toContain('DISTINCT ON (TRIM(s.shipment_id::text))');
    expect(s).toContain('LEFT JOIN contract_stos cs_sto');
    expect(s).toContain('LEFT JOIN shipment_ata_overrides sao');
    expect(s).toContain('ORDER BY TRIM(s.shipment_id::text),');
    expect(s).toContain('s.created_at DESC'); // the tail of sqlShipmentListPrimaryOrderBy
    expect(s).toContain('s.id = t.carrier_id');
  });

  it('decide the STO figure in the documented order: one row, repeated, sum of shares, shares of one ratio', () => {
    const s = flat(sfal.setWorking);
    const oneRow = s.indexOf('WHEN n_rows = 1 THEN sum_sap');
    const repeated = s.indexOf('THEN max_sap');
    const sumFits = s.indexOf(`WHEN ABS(sum_sap / sum_bl - 1) <= ${SAP_FIGURE_BL_TOLERANCE}`);
    const ratio = s.indexOf('AND max_ratio / min_ratio <=');
    expect(oneRow).toBeGreaterThan(-1);
    expect(repeated).toBeGreaterThan(oneRow);
    expect(sumFits).toBeGreaterThan(repeated); // two POs of 500,000 repeating 1,000,000 are not shares of 2,000,000
    expect(ratio).toBeGreaterThan(sumFits);
    // without a B/L nothing can be decided for a multi-row STO
    expect(s).toContain('WHEN COALESCE(sum_bl, 0) <= 0 THEN NULL');
  });

  it('the preview reads the same decision and writes nothing', () => {
    const p = flat(buildSapFigureDecisionPreviewSql('sfal_qty'));
    expect(p).toContain('decided AS (');
    expect(p).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b/);
    expect(p).toContain("WHEN d.total IS NULL THEN 'undecided'");
  });
});

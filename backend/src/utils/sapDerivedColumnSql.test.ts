import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  SAP_DERIVED_COLUMNS,
  SAP_DERIVED_COLUMN_NAMES,
  SAP_FIELD_ARMS,
  sapDataSource,
  sapDerivedJsonExpr,
  sapRowSource,
  sqlSapCoalesceArms,
  sqlSapField,
  type SapDerivedColumn,
} from './sapDerivedColumnSql';
import {
  sqlSapQtyTruckingFromData,
  sqlSapQtyTruckingFromSpd,
  sqlSapQtyVesselFromData,
  sqlSapQtyVesselFromSpd,
  sqlSapGrPoStatusFromJson,
  sqlSapGrPoStatusFromRow,
  sqlSapGrStoStatusFromJson,
  sqlSapGrStoStatusFromRow,
  sqlIncotermImportStatusFromJson,
  sqlIncotermImportStatusFromRow,
} from './sapIncotermMetrics';
import {
  sqlSpdHasDeletePoFlagExpr,
  sqlSpdHasDeletePoFlagFromRow,
  sqlSpdHasDeleteStoFlagExpr,
  sqlSpdHasDeleteStoFlagFromRow,
} from './sapMasterV2UatFormat';
import {
  sqlSapQtyDeliveredAnyFromData,
  sqlSapQtyDeliveredAnyFromSpd,
} from './contractLogisticsStoDetailSql';

/**
 * Migration 162 stores 28 SAP fields as generated columns so the read path stops re-detoasting
 * `data` (measured: 23 values per row is 1,864,385 buffers as jsonb, 1,110 as columns). The
 * danger is not slowness, it is a column mapped to the wrong path - that returns a plausible
 * wrong number with nothing failing. So the mapping is checked against the migration itself, and
 * the row/data forms are checked to differ only in how each arm is reached.
 */
const migration = readFileSync(
  join(__dirname, '..', 'database', 'migrations', '162_sap_processed_data_derived_columns.sql'),
  'utf8',
);

describe('sap derived column mapping', () => {
  it('every column maps to the path migration 162 generates it from', () => {
    for (const column of SAP_DERIVED_COLUMN_NAMES) {
      const def = SAP_DERIVED_COLUMNS[column];
      const generated =
        def.section === null
          ? `${column} text\n    GENERATED ALWAYS AS (data->>'${def.key}') STORED`
          : `${column} text\n    GENERATED ALWAYS AS (data->'${def.section}'->>'${def.key}') STORED`;
      expect(migration, `${column} is not generated from the path the mapping claims`).toContain(
        generated,
      );
    }
  });

  it('the migration generates no column the mapping does not know about', () => {
    const inMigration = [...migration.matchAll(/ADD COLUMN IF NOT EXISTS (\w+) text/g)].map(
      (m) => m[1] as SapDerivedColumn,
    );
    expect(inMigration.length).toBe(SAP_DERIVED_COLUMN_NAMES.length);
    expect([...inMigration].sort()).toEqual([...SAP_DERIVED_COLUMN_NAMES].sort());
  });

  it('a row source reads a column and a data source reads the path', () => {
    expect(sqlSapField(sapRowSource('spd'), 'raw_gr_po_status')).toBe('spd.raw_gr_po_status');
    expect(sqlSapField(sapDataSource('spd.data'), 'raw_gr_po_status')).toBe(
      "spd.data->'raw'->>'GR PO Status'",
    );
    // A top-level key has no section in between.
    expect(sapDerivedJsonExpr('x.data', 'root_gr_po_status')).toBe("x.data->>'gr_po_status'");
  });

  it('keeps the arm order, which decides which spelling wins in a COALESCE', () => {
    expect(sqlSapCoalesceArms(sapRowSource('s'), SAP_FIELD_ARMS.deletePoStatus)).toBe(
      [
        's.raw_delete_po_status',
        's.contract_delete_po_status',
        's.shipment_delete_po_status',
        's.root_delete_po_status',
      ].join(',\n    '),
    );
  });
});

describe('row and data forms of the same expression', () => {
  const cases: Array<[string, string, string]> = [
    ['GR PO status', sqlSapGrPoStatusFromRow('spd'), sqlSapGrPoStatusFromJson('spd.data')],
    ['GR STO status', sqlSapGrStoStatusFromRow('spd'), sqlSapGrStoStatusFromJson('spd.data')],
    [
      'delete PO flag',
      sqlSpdHasDeletePoFlagFromRow('spd'),
      sqlSpdHasDeletePoFlagExpr('spd.data'),
    ],
    [
      'delete STO flag',
      sqlSpdHasDeleteStoFlagFromRow('spd'),
      sqlSpdHasDeleteStoFlagExpr('spd.data'),
    ],
    [
      'incoterm import status',
      sqlIncotermImportStatusFromRow('spd', 'c.incoterm', 'NULL'),
      sqlIncotermImportStatusFromJson('spd.data', 'c.incoterm', 'NULL'),
    ],
    [
      'trucking quantity',
      sqlSapQtyTruckingFromSpd('spd'),
      sqlSapQtyTruckingFromData('spd.data'),
    ],
    ['vessel quantity', sqlSapQtyVesselFromSpd('spd'), sqlSapQtyVesselFromData('spd.data')],
    [
      'delivered quantity by incoterm',
      sqlSapQtyDeliveredAnyFromSpd('spd', 'c.incoterm'),
      sqlSapQtyDeliveredAnyFromData('spd.data', 'c.incoterm'),
    ],
  ];

  it('the row form touches no jsonb at all', () => {
    for (const [label, rowSql] of cases) {
      expect(rowSql, `${label} row form still reads jsonb`).not.toContain('->');
      expect(rowSql, `${label} row form still names data`).not.toContain('.data');
    }
  });

  it('the two forms are the same expression with different arms', () => {
    for (const [label, rowSql, dataSql] of cases) {
      /**
       * Rewriting each column reference back to its path must reproduce the data form exactly.
       * That is what makes the swap an access-path change rather than a rewrite: any difference
       * in structure, order, or wrapping shows up here.
       */
      let rebuilt = rowSql;
      /*
       * Longest name first: `raw_quantity_delivery` is a prefix of
       * `raw_quantity_delivery_trucking`, so rewriting in declaration order would chop the
       * longer name in half and report a difference that is not there.
       */
      for (const column of [...SAP_DERIVED_COLUMN_NAMES].sort((a, b) => b.length - a.length)) {
        rebuilt = rebuilt.split(`spd.${column}`).join(sapDerivedJsonExpr('spd.data', column));
      }
      expect(rebuilt, `${label} differs beyond the access path`).toBe(dataSql);
    }
  });
});

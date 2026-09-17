/**
 * The SAP fields that migration 162 stores as generated columns, and the one place that knows
 * which column holds which jsonb path.
 *
 * WHY
 *
 * Reading `data->'raw'->>'GR PO Status'` re-detoasts the whole jsonb blob. Measured on the dev
 * copy (27,003 rows, 138 MB of TOAST), root-node buffers from EXPLAIN (ANALYZE, BUFFERS):
 *
 *   count(*), no jsonb                       463 buffers        36 ms
 *   1 jsonb value per row                 85,402 buffers     1,477 ms
 *   23 jsonb values per row            1,864,385 buffers    14,922 ms
 *   the same 23 as stored columns          1,110 buffers        20 ms
 *
 * The Shipments hydrate path makes 1,076 such accesses, over 52 distinct paths - a 17x repeat
 * factor - and `sto_metrics` alone accounts for 885 of them. The shell path makes none, which is
 * why the two differ by 8x on the same 668 rows.
 *
 * HOW TO USE IT
 *
 * An expression built for `sap_processed_data` directly (alias `spd`, `spd_gr`, `spd_del`, ...)
 * can read the columns. An expression built for something that only carries `data` - a CTE that
 * selected it, `contract_latest_spd_snapshot`, an import-time row - cannot. So every helper takes
 * a *source* rather than an alias or an expression, and the two source kinds produce the same
 * expression tree over different arms. That keeps the stored and live forms from drifting: a
 * caller cannot pick a column that does not match the path it means.
 *
 * The generated columns cannot drift from `data` either - Postgres recomputes them on write - and
 * all 28 were verified equal to their expressions across all 27,003 rows when 162 was applied.
 */

/** One stored column: which jsonb path it holds. `section` null means a top-level key. */
export interface SapDerivedColumnDef {
  section: 'raw' | 'contract' | 'shipment' | null;
  key: string;
}

/**
 * Column name -> the path it stores. Must match migration 162 exactly; a test reads the migration
 * file and asserts it does, because a mismatch here would silently return the wrong field.
 */
export const SAP_DERIVED_COLUMNS = {
  raw_quantity_delivery: { section: 'raw', key: 'Quantity Delivery' },
  shipment_quantity_delivery: { section: 'shipment', key: 'quantity_delivery' },

  raw_gr_po_status: { section: 'raw', key: 'GR PO Status' },
  contract_gr_po_status: { section: 'contract', key: 'gr_po_status' },
  root_gr_po_status: { section: null, key: 'gr_po_status' },
  raw_gr_sto_status: { section: 'raw', key: 'GR STO Status' },
  contract_gr_sto_status: { section: 'contract', key: 'gr_sto_status' },
  root_gr_sto_status: { section: null, key: 'gr_sto_status' },

  raw_delete_po_status: { section: 'raw', key: 'Delete PO Status' },
  contract_delete_po_status: { section: 'contract', key: 'delete_po_status' },
  shipment_delete_po_status: { section: 'shipment', key: 'delete_po_status' },
  root_delete_po_status: { section: null, key: 'delete_po_status' },
  raw_delete_sto_status: { section: 'raw', key: 'Delete STO Status' },
  contract_delete_sto_status: { section: 'contract', key: 'delete_sto_status' },
  shipment_delete_sto_status: { section: 'shipment', key: 'delete_sto_status' },
  root_delete_sto_status: { section: null, key: 'delete_sto_status' },

  raw_quantity_delivery_trucking: { section: 'raw', key: 'Quantity Delivery Trucking' },
  raw_quantity_delivered_trucking: { section: 'raw', key: 'Quantity Delivered Trucking' },
  raw_quantity_delivered_via_trucking: { section: 'raw', key: 'Quantity Delivered via Trucking' },
  shipment_quantity_delivery_trucking: { section: 'shipment', key: 'quantity_delivery_trucking' },
  contract_quantity_delivery_trucking: { section: 'contract', key: 'quantity_delivery_trucking' },
  root_quantity_delivered_via_trucking: { section: null, key: 'quantity_delivered_via_trucking' },

  raw_quantity_delivery_vessel: { section: 'raw', key: 'Quantity Delivery Vessel' },
  raw_quantity_delivered: { section: 'raw', key: 'Quantity Delivered' },
  shipment_quantity_delivered: { section: 'shipment', key: 'quantity_delivered' },
  contract_quantity_delivery: { section: 'contract', key: 'quantity_delivery' },

  raw_quantity_receive: { section: 'raw', key: 'Quantity Receive' },
  raw_qty_receive: { section: 'raw', key: 'Qty Receive' },
} as const satisfies Record<string, SapDerivedColumnDef>;

export type SapDerivedColumn = keyof typeof SAP_DERIVED_COLUMNS;

export const SAP_DERIVED_COLUMN_NAMES = Object.keys(SAP_DERIVED_COLUMNS) as SapDerivedColumn[];

/**
 * Where a helper is reading from.
 *
 * `row` is a real `sap_processed_data` alias, so the stored columns are available. `data` is only
 * a jsonb expression - a CTE that carried `data`, a snapshot table, an import-time value - and
 * has to extract from it. Nothing else is a valid source, which is the point: the choice is made
 * once, where the FROM clause is known.
 */
export type SapFieldSource =
  | { kind: 'row'; alias: string }
  | { kind: 'data'; dataExpr: string };

export function sapRowSource(alias: string): SapFieldSource {
  return { kind: 'row', alias };
}

export function sapDataSource(dataExpr: string): SapFieldSource {
  return { kind: 'data', dataExpr };
}

/** The jsonb extraction for one column's path, against an arbitrary `data` expression. */
export function sapDerivedJsonExpr(dataExpr: string, column: SapDerivedColumn): string {
  const def: SapDerivedColumnDef = SAP_DERIVED_COLUMNS[column];
  return def.section === null
    ? `${dataExpr}->>'${def.key}'`
    : `${dataExpr}->'${def.section}'->>'${def.key}'`;
}

/**
 * One arm of a COALESCE, resolved for the source: a column reference when the source is a real
 * SAP row, the equivalent jsonb extraction otherwise. Same value either way - verified for all
 * 27,003 rows when migration 162 was applied.
 */
export function sqlSapField(source: SapFieldSource, column: SapDerivedColumn): string {
  return source.kind === 'row'
    ? `${source.alias}.${column}`
    : sapDerivedJsonExpr(source.dataExpr, column);
}

/** The arms of a COALESCE, in order, resolved for the source. */
export function sqlSapFields(
  source: SapFieldSource,
  columns: readonly SapDerivedColumn[],
): string[] {
  return columns.map((c) => sqlSapField(source, c));
}

/**
 * The arms as a COALESCE argument list, one per line.
 *
 * Joining lives here rather than at each call site so the arm order and the layout come from one
 * place - and so a caller cannot accidentally join with something that changes the SQL.
 */
export function sqlSapCoalesceArms(
  source: SapFieldSource,
  columns: readonly SapDerivedColumn[],
  indent = '    ',
): string {
  return sqlSapFields(source, columns).join(`,\n${indent}`);
}

/**
 * The ordered arms behind each logical field, exactly as the expressions read them today.
 *
 * Order is load-bearing: these feed COALESCE, so changing it changes which spelling wins when a
 * row carries more than one. Taken from the expressions being replaced, not chosen afresh.
 */
export const SAP_FIELD_ARMS = {
  grPoStatus: ['raw_gr_po_status', 'contract_gr_po_status', 'root_gr_po_status'],
  grStoStatus: ['raw_gr_sto_status', 'contract_gr_sto_status', 'root_gr_sto_status'],
  deletePoStatus: [
    'raw_delete_po_status',
    'contract_delete_po_status',
    'shipment_delete_po_status',
    'root_delete_po_status',
  ],
  deleteStoStatus: [
    'raw_delete_sto_status',
    'contract_delete_sto_status',
    'shipment_delete_sto_status',
    'root_delete_sto_status',
  ],

  /**
   * Trucking-delivered quantity: five spellings of the trucking figure, then the two plain
   * delivery fields as a last resort. Copied arm for arm from sqlSapQtyTruckingFromSpd - the
   * order decides which spelling wins on a row carrying more than one, so it is not ours to tidy.
   *
   * 168 of the 513 accesses left in `sto_metrics` after the status group moved.
   */
  qtyTrucking: [
    'raw_quantity_delivery_trucking',
    'raw_quantity_delivered_trucking',
    'raw_quantity_delivered_via_trucking',
    'root_quantity_delivered_via_trucking',
    'shipment_quantity_delivery_trucking',
    'contract_quantity_delivery_trucking',
    'raw_quantity_delivery',
    'shipment_quantity_delivery',
  ],

  /** Vessel-delivered quantity, arm for arm from sqlSapQtyVesselFromSpd. */
  qtyVessel: [
    'raw_quantity_delivery_vessel',
    'raw_quantity_delivered',
    'raw_quantity_delivery',
    'shipment_quantity_delivery',
    'shipment_quantity_delivered',
    'contract_quantity_delivery',
  ],

  /** Received quantity - only the two raw spellings are read on this path. */
  qtyReceive: ['raw_quantity_receive', 'raw_qty_receive'],
} as const satisfies Record<string, readonly SapDerivedColumn[]>;

/**
 * The columns `spd_keyed` carries forward, so `sk` can be a row source.
 *
 * `spd_keyed` selects from `sap_processed_data`, so it *can* pass the stored columns down - and
 * once it does, the CTEs above it read `sk.<column>` instead of extracting from `sk.data`. That
 * turns 14 blob accesses per row in `sap_agg` into 14 column reads of a value the table already
 * has, with no extraction anywhere.
 *
 * Only the quantity families are listed: the other things read off `sk` (vessel fields, PO
 * spellings, incoterm, source type, B2B flag, contract ext no, STO quantity) have no stored
 * columns yet, so `spd_keyed` still carries `data` for them. Adding to this list means adding to
 * the CTE's select list too - `shipmentListSapAggAccessBudget.test.ts` checks the two agree.
 */
export const SPD_KEYED_PASSTHROUGH_COLUMNS: readonly SapDerivedColumn[] = [
  ...new Set<SapDerivedColumn>([...SAP_FIELD_ARMS.qtyTrucking, ...SAP_FIELD_ARMS.qtyVessel]),
];

/** `alias.col, alias.col2, ...` - what a CTE selects to pass the columns down. */
export function sqlSapColumnPassthrough(
  alias: string,
  columns: readonly SapDerivedColumn[] = SPD_KEYED_PASSTHROUGH_COLUMNS,
  indent = '          ',
): string {
  return columns.map((c) => `${alias}.${c}`).join(`,\n${indent}`);
}

/**
 * `NULL::text AS col, ...` - the stub form of the same list.
 *
 * The stub CTE has to declare every column the real one does, or `skipSapJoin=true` fails to
 * resolve a reference the shared expressions emit. Generated from the same array for that reason.
 */
export function sqlSapColumnNullStubs(
  columns: readonly SapDerivedColumn[] = SPD_KEYED_PASSTHROUGH_COLUMNS,
  indent = '          ',
): string {
  return columns.map((c) => `NULL::text AS ${c}`).join(`,\n${indent}`);
}

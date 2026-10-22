/**
 * Exchange what two shipment rows hold: every column except their identity (id, contract_id, shipment_id, created_at), and the child rows that point at them.
 *
 * Use: STO 1006020666 / PO 1001032737. The SAP shell (shipment_id = the STO) holds the AS MARINA 12 voyage a user planned later, while the voyage KLIP
 * planned first (AS MARINA 10, an MNL- row) holds no STO. Swapping the two puts AS MARINA 10 on the STO shell and AS MARINA 12 on its own MNL- row,
 * without copying or deleting a row (no cascade can fire) and without renaming a shipment_id.
 *
 * Must run inside a transaction (it uses a temp table). audit_logs is left alone on purpose: the history stays with the row id it was written for.
 */

type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/** Columns that stay with the row. updated_at is stamped, not swapped. */
const IDENTITY_COLUMNS = ['id', 'contract_id', 'shipment_id', 'created_at', 'updated_at'];

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

interface ChildRef {
  table: string;
  column: string;
  uniqueOnColumn: boolean;
  hasDependents: boolean;
}

/** Single-column foreign keys that reference shipments(id), found from the catalog so a new child table is never forgotten. */
export async function listShipmentChildren(db: Db): Promise<ChildRef[]> {
  const res = await db.query(
    `SELECT c.conrelid::regclass::text AS tbl,
            a.attname AS col,
            EXISTS (
              SELECT 1 FROM pg_index i
               WHERE i.indrelid = c.conrelid AND i.indisunique AND i.indnatts = 1 AND i.indkey[0] = a.attnum
            ) AS unique_on_col,
            EXISTS (SELECT 1 FROM pg_constraint d WHERE d.confrelid = c.conrelid AND d.contype = 'f') AS has_dependents
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.confrelid = 'shipments'::regclass AND c.contype = 'f' AND array_length(c.conkey, 1) = 1
      ORDER BY 1, 2`,
  );
  return res.rows.map((r) => ({ table: r.tbl, column: r.col, uniqueOnColumn: r.unique_on_col, hasDependents: r.has_dependents }));
}

export async function swapShipmentContents(db: Db, aId: string, bId: string): Promise<{ childRowsMoved: Record<string, number> }> {
  if (aId === bId) throw new Error('swapShipmentContents: the two ids are the same row');
  const pair = await db.query(`SELECT id FROM shipments WHERE id = ANY($1::uuid[]) FOR UPDATE`, [[aId, bId]]);
  if (pair.rows.length !== 2) throw new Error('swapShipmentContents: both shipment rows must exist');

  const colsRes = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'shipments'
        AND is_generated = 'NEVER' AND column_name <> ALL($1::text[])
      ORDER BY ordinal_position`,
    [IDENTITY_COLUMNS],
  );
  const cols: string[] = colsRes.rows.map((r) => String(r.column_name));
  if (cols.length === 0) throw new Error('swapShipmentContents: no columns to swap');
  const setList = cols.map((c) => `${quoteIdent(c)} = s.${quoteIdent(c)}`).join(', ');

  await db.query(`DROP TABLE IF EXISTS _shipment_swap`);
  await db.query(`CREATE TEMP TABLE _shipment_swap AS SELECT * FROM shipments WHERE id = ANY($1::uuid[])`, [[aId, bId]]);
  await db.query(
    `UPDATE shipments t SET ${setList}, updated_at = CURRENT_TIMESTAMP FROM _shipment_swap s WHERE t.id = $1::uuid AND s.id = $2::uuid`,
    [aId, bId],
  );
  await db.query(
    `UPDATE shipments t SET ${setList}, updated_at = CURRENT_TIMESTAMP FROM _shipment_swap s WHERE t.id = $1::uuid AND s.id = $2::uuid`,
    [bId, aId],
  );
  await db.query(`DROP TABLE _shipment_swap`);

  const childRowsMoved: Record<string, number> = {};
  for (const child of await listShipmentChildren(db)) {
    const t = child.table;
    const c = quoteIdent(child.column);
    if (!child.uniqueOnColumn) {
      const r = await db.query(
        `UPDATE ${t} SET ${c} = CASE WHEN ${c} = $1::uuid THEN $2::uuid ELSE $1::uuid END WHERE ${c} = ANY($3::uuid[])`,
        [aId, bId, [aId, bId]],
      );
      childRowsMoved[`${t}.${child.column}`] = r.rowCount ?? 0;
      continue;
    }
    // At most one row per shipment: a swap in one UPDATE would collide row by row, so take the rows out and put them back with the ids exchanged.
    // Safe only when nothing references those rows (no cascade).
    if (child.hasDependents) {
      throw new Error(`swapShipmentContents: ${t} is unique on ${child.column} and has dependent tables; swap it by hand`);
    }
    await db.query(`DROP TABLE IF EXISTS _shipment_swap_child`);
    await db.query(`CREATE TEMP TABLE _shipment_swap_child AS SELECT * FROM ${t} WHERE ${c} = ANY($1::uuid[])`, [[aId, bId]]);
    await db.query(`DELETE FROM ${t} WHERE ${c} = ANY($1::uuid[])`, [[aId, bId]]);
    const ins = await db.query(
      `INSERT INTO ${t}
         SELECT (jsonb_populate_record(NULL::${t}, to_jsonb(o) || jsonb_build_object($3::text, CASE WHEN o.${c} = $1::uuid THEN $2::uuid ELSE $1::uuid END))).*
           FROM _shipment_swap_child o`,
      [aId, bId, child.column],
    );
    await db.query(`DROP TABLE _shipment_swap_child`);
    childRowsMoved[`${t}.${child.column}`] = ins.rowCount ?? 0;
  }
  return { childRowsMoved };
}

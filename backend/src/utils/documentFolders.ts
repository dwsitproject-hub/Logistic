/**
 * What a document folder is NAMED after, so a person browsing the share finds it by a number they know (2026-10-29, Ryan):
 *
 *   shipment Contract / SI / BL  ->  documents/shipment/<contract|si|bl>/<STO number, or the operation id when the shipment has no STO>/
 *   documents of a trucking operation  ->  documents/trucking/<PO number>/   (the operation id when it has no PO, then the contract number)
 *
 * It used to be the shipment's database id (a uuid), which says nothing on the share. The STO is the SAME key the Shipments page and JPS use (shipmentListStoKeyExpr: the
 * numeric STO, else the contract's, else SAP's effective STO, else the operation id), so the folder is the identity of the row the user is looking at. Several rows
 * of one STO (one per PO) share its folder, as several operations of one PO share theirs; the file names stay unique.
 *
 * A shipment's folder can change over its life (a manual shipment is filed under its operation id until SAP issues an STO). The migration
 * (docs/scripts/migrate-documents-to-folders.cjs) files documents again under the current name, so it is safe to run whenever that has happened.
 *
 * The expressions are SQL because the migration reads them for every document in one query; the upload asks the same expressions for one row.
 */
import { shipmentListStoKeyExpr } from './shipmentStoTypeSql';

/** Needs: shipments s, contracts c (s.contract_id), contract_latest_spd_snapshot l (c.contract_id). */
export const SHIPMENT_FOLDER_SUBJECT_SQL = shipmentListStoKeyExpr('c', 'l', 's');

/** Needs: trucking_operations t, contracts ct (t.contract_id). */
export const TRUCKING_OPERATION_FOLDER_SUBJECT_SQL = `COALESCE(
    NULLIF(TRIM(ct.po_number::text), ''),
    NULLIF(TRIM(t.operation_id::text), ''),
    NULLIF(TRIM(ct.contract_id::text), '')
  )`;

/** For a contract with no trucking operation (a backlog row). Needs: contracts ct. */
export const CONTRACT_FOLDER_SUBJECT_SQL = `COALESCE(NULLIF(TRIM(ct.po_number::text), ''), NULLIF(TRIM(ct.contract_id::text), ''))`;

/** The folder of one shipment: its operation id (for the file name) and the subject of its folder. */
export const SELECT_SHIPMENT_FOLDER_SQL = `
  SELECT s.operation_id, ${SHIPMENT_FOLDER_SUBJECT_SQL} AS folder_subject
    FROM shipments s
    LEFT JOIN contracts c ON c.id = s.contract_id
    LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
   WHERE s.id = $1`;

export const SELECT_TRUCKING_FOLDER_SQL = `
  SELECT ${TRUCKING_OPERATION_FOLDER_SUBJECT_SQL} AS subject
    FROM trucking_operations t
    LEFT JOIN contracts ct ON ct.id = t.contract_id
   WHERE t.id = $1`;

export const SELECT_CONTRACT_TRUCKING_FOLDER_SQL = `SELECT ${CONTRACT_FOLDER_SUBJECT_SQL} AS subject FROM contracts ct WHERE ct.id = $1`;
